#!/usr/bin/env bash
#
# build-mac.sh — cross-build the MEMLNaut VCV plugin for macOS (x64 + arm64),
# here, in a RESOURCE-BOUNDED Docker container.
#
# Why Docker + caps: this host also runs live production services. The container
# is hard-capped (CPU + memory + no extra swap) so the build physically cannot
# starve or crash the host — the cgroup OOM-kills the container, not the system,
# if it ever exceeded the cap. Tune CPUS / MEM below for your machine.
#
# How (crucially): we do NOT compile Clang/LLVM from source. The official
# rack-plugin-toolchain runs build_clang.sh (LLVM from source = multi-hour,
# RAM-hungry — FORBIDDEN here). Instead we build osxcross with the container's
# SYSTEM clang (apt install clang lld); osxcross then only needs to build
# cctools-port + ld64 + wrappers, which is moderate and bounded (~15-20 min).
#
# That osxcross toolchain is cached as a local Docker image
# (nisps-osxcross:<darwin>-<sdkver>) on first build, so subsequent runs skip
# straight to compiling the plugin (~2 min). Set REBUILD_TOOLCHAIN=1 to force a
# fresh osxcross build.
#
# Apple's macOS SDK is fetched from joseluisq/macosx-sdks (MacOSX12.3.sdk) only
# inside the container, for the duration of the toolchain build. We never
# redistribute it; it lives only inside the local cache image.
#
# Output: vcv/dist/MEMLNaut-<version>-mac-x64.vcvplugin
#         vcv/dist/MEMLNaut-<version>-mac-arm64.vcvplugin  (both ad-hoc signed)
# Requires: docker. Run from anywhere; paths are resolved from this script.

set -euo pipefail

CPUS="${CPUS:-8}"          # cores the container may use
MEM="${MEM:-20g}"          # hard memory cap (== memory-swap, so no host swap)
RACK_SDK_VERSION="${RACK_SDK_VERSION:-2.6.4}"
OSXCROSS_COMMIT="${OSXCROSS_COMMIT:-4372d5560307c649af5dbbfa20b39199c9ef48be}"  # same pin as rack-plugin-toolchain
MACOS_SDK_VERSION="${MACOS_SDK_VERSION:-12.3}"
DARWIN_TARGET="darwin21.4"  # macOS 12.x = Darwin 21
TOOLCHAIN_IMAGE="${TOOLCHAIN_IMAGE:-nisps-osxcross:${DARWIN_TARGET}-${MACOS_SDK_VERSION}}"
REBUILD_TOOLCHAIN="${REBUILD_TOOLCHAIN:-0}"

CAPS=(--cpus="$CPUS" --memory="$MEM" --memory-swap="$MEM")  # the mandatory hard caps

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # vcv/

# ---------------------------------------------------------------------------
# Stage 1: osxcross toolchain image (built once, cached). Uses the container's
# SYSTEM clang — never build_clang.sh / LLVM-from-source.
# ---------------------------------------------------------------------------
build_toolchain_image () {
  echo "==> building osxcross toolchain image $TOOLCHAIN_IMAGE (cpus=$CPUS, mem=$MEM, no extra swap)"
  echo "    cctools-port + ld64 + wrappers with SYSTEM clang. May take 15-20 min."
  local TC="$(mktemp /tmp/osxcross-stage.XXXXXX.sh)"
  cat > "$TC" <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "==> [tc] installing build deps (system clang + lld; NO LLVM-from-source)"
apt-get update -qq
apt-get install -y -qq \
  clang lld llvm-dev libxml2-dev uuid-dev libssl-dev zlib1g-dev libbz2-dev \
  cmake make python3 git patch xz-utils bzip2 curl unzip zstd jq tar wget rsync \
  >/dev/null
cd /tmp
echo "==> [tc] cloning osxcross @ ${OSXCROSS_COMMIT}"
git clone -q https://github.com/tpoechtrager/osxcross.git
cd osxcross
git checkout -q ${OSXCROSS_COMMIT}
echo "==> [tc] fetching macOS ${MACOS_SDK_VERSION} SDK"
wget -q -O tarballs/MacOSX${MACOS_SDK_VERSION}.sdk.tar.xz \
  "https://github.com/joseluisq/macosx-sdks/releases/download/${MACOS_SDK_VERSION}/MacOSX${MACOS_SDK_VERSION}.sdk.tar.xz"
echo "==> [tc] building osxcross (UNATTENDED, system clang, no build_clang.sh)"
UNATTENDED=1 TARGET_DIR=/opt/osxcross JOBS=${CPUS} ./build.sh
echo "==> [tc] building compiler-rt (best-effort)"
UNATTENDED=1 TARGET_DIR=/opt/osxcross JOBS=${CPUS} ENABLE_COMPILER_RT_INSTALL=1 \
  ./build_compiler_rt.sh || echo "    (compiler-rt skipped; continuing)"
echo "==> [tc] osxcross wrappers:"
ls /opt/osxcross/bin/ | grep -E "apple-${DARWIN_TARGET}-(clang|strip)" || true
echo "OSXCROSS_TOOLCHAIN_READY"
EOF
  trap 'rm -f "$TC"' RETURN
  docker rm -f nisps-osxcross-stage >/dev/null 2>&1 || true
  docker run --name nisps-osxcross-stage "${CAPS[@]}" \
    -v "$TC":/stage.sh:ro ubuntu:24.04 bash /stage.sh
  echo "==> committing toolchain image $TOOLCHAIN_IMAGE"
  docker commit nisps-osxcross-stage "$TOOLCHAIN_IMAGE" >/dev/null
  docker rm -f nisps-osxcross-stage >/dev/null 2>&1 || true
}

if [ "$REBUILD_TOOLCHAIN" = "1" ] || ! docker image inspect "$TOOLCHAIN_IMAGE" >/dev/null 2>&1; then
  build_toolchain_image
else
  echo "==> reusing cached osxcross toolchain image $TOOLCHAIN_IMAGE (set REBUILD_TOOLCHAIN=1 to rebuild)"
fi

# ---------------------------------------------------------------------------
# Stage 2: build (and ad-hoc sign) the plugin for both mac arches, against the
# cached toolchain image. Staged in a clean copy of vcv/ so artefacts never
# pollute the repo tree.
# ---------------------------------------------------------------------------
WORK="$(mktemp -d /tmp/vcv-mac-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "==> staging a clean copy of the plugin source"
cp -r "$SCRIPT_DIR/." "$WORK/"
rm -rf "$WORK/build" "$WORK/dist" "$WORK/out" "$WORK/plugin.so" "$WORK"/*.vcvplugin 2>/dev/null || true

cat > "$WORK/_in-container.sh" <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export PATH=/opt/osxcross/bin:\$PATH

# ---- apple-codesign (rcodesign) for ad-hoc signing -------------------------
RCODESIGN=""
echo "==> [container] fetching apple-codesign (rcodesign) for ad-hoc signing"
RC_VER="0.27.0"
RC_URL="https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F\${RC_VER}/apple-codesign-\${RC_VER}-x86_64-unknown-linux-musl.tar.gz"
if wget -q -O /tmp/rcodesign.tar.gz "\$RC_URL"; then
  mkdir -p /tmp/rc && tar -xzf /tmp/rcodesign.tar.gz -C /tmp/rc --strip-components=1 2>/dev/null || \
    tar -xzf /tmp/rcodesign.tar.gz -C /tmp/rc 2>/dev/null || true
  RCODESIGN="\$(find /tmp/rc -name rcodesign -type f | head -1)"
  if [ -n "\$RCODESIGN" ]; then chmod +x "\$RCODESIGN"; echo "    rcodesign: \$RCODESIGN"; fi
fi
[ -z "\$RCODESIGN" ] && echo "    (rcodesign unavailable; will skip ad-hoc signing)"

build_arch () {
  local PLAT="\$1"        # mac-x64 | mac-arm64
  local SDK_ARCH="\$2"    # x64 | arm64
  local TRIPLE="\$3"      # x86_64-apple-${DARWIN_TARGET} | arm64-apple-${DARWIN_TARGET}
  local ARCH_FLAG="\$4"   # x86_64 | arm64  (passed to clang -arch)

  echo "==> [container] === building \$PLAT ==="
  cd /tmp
  rm -rf "Rack-SDK"
  wget -q "https://vcvrack.com/downloads/Rack-SDK-${RACK_SDK_VERSION}-mac-\${SDK_ARCH}.zip"
  unzip -q "Rack-SDK-${RACK_SDK_VERSION}-mac-\${SDK_ARCH}.zip"
  rm -f "Rack-SDK-${RACK_SDK_VERSION}-mac-\${SDK_ARCH}.zip"

  cd /src
  # Wipe all build products between arches explicitly. 'make clean' is unreliable
  # here because the Makefile's 'include \$(RACK_DIR)/arch.mk' needs RACK_DIR set
  # just to parse — without it clean silently no-ops, leaving the previous arch's
  # plugin.dylib in place so 'make dist' skips recompilation and ships the WRONG
  # architecture (x86_64 in the arm64 package). Remove the products outright.
  rm -rf build dist plugin.dylib plugin.so 2>/dev/null || true
  find . -maxdepth 3 \( -name '*.o' -o -name '*.d' \) -delete 2>/dev/null || true

  # The mac Rack SDK's plugin.mk dist target calls Apple-only tools by bare name:
  #   \$(STRIP) \$(INSTALL_NAME_TOOL) \$(OTOOL) and (unconditionally for mac) \$(CODESIGN).
  # osxcross provides the first three as <triple>-prefixed binaries; point the make
  # vars at them. CODESIGN we override to a no-op (true) and instead ad-hoc sign with
  # rcodesign below — the SDK's default 'codesign -f -s -' is a native-macOS binary
  # that does not exist on Linux (was Error 127). rsync is needed for the res/ copy.
  #
  # arch.mk derives the target arch from \`\$(CC) -dumpmachine\`. The osxcross clang
  # wrappers are all symlinks to one binary, so -dumpmachine reports the host default
  # (x86_64) regardless of the prefix — which made arch.mk pick the x64 path
  # (-march=nehalem) even for the arm64 wrapper, silently producing an x86_64 dylib in
  # the arm64 package. Pass CROSS_COMPILE=<triple> so arch.mk classifies correctly
  # (-> ARCH_ARM64, -march=armv8-a) and append an explicit -arch to CC/CXX so the
  # wrapper emits the right Mach-O architecture.
  export MACOSX_DEPLOYMENT_TARGET=10.15
  RACK_DIR=/tmp/Rack-SDK \
    CROSS_COMPILE="\${TRIPLE}" \
    CC="\${TRIPLE}-clang -arch \${ARCH_FLAG}" \
    CXX="\${TRIPLE}-clang++ -arch \${ARCH_FLAG}" \
    STRIP="\${TRIPLE}-strip" \
    INSTALL_NAME_TOOL="\${TRIPLE}-install_name_tool" \
    OTOOL="\${TRIPLE}-otool" \
    CODESIGN=true \
    make -j${CPUS} dist

  # Ad-hoc sign the dylib inside the produced .vcvplugin, if rcodesign is available.
  local PKG="\$(ls dist/MEMLNaut-*-\${PLAT}.vcvplugin)"
  local BASENAME="\$(basename "\$PKG")"
  if [ -n "\$RCODESIGN" ] && [ -n "\$PKG" ]; then
    echo "==> [container] ad-hoc signing dylib in \$PKG"
    local TMP=/tmp/sign-\${PLAT}
    rm -rf "\$TMP" && mkdir -p "\$TMP"
    tar --use-compress-program=unzstd -xf "\$PKG" -C "\$TMP"
    local DYLIB="\$(find "\$TMP" -name plugin.dylib | head -1)"
    if [ -n "\$DYLIB" ]; then
      "\$RCODESIGN" sign "\$DYLIB" && echo "    signed: \$DYLIB"
      # \$PKG is relative to /src; resolve to absolute before the cd into \$TMP.
      ( cd "\$TMP" && tar --use-compress-program=zstd -cf "/src/\$PKG" MEMLNaut )
      echo "SIGNED_\${PLAT}=yes" >> /src/out/_sign_report.txt
    fi
  else
    echo "SIGNED_\${PLAT}=no" >> /src/out/_sign_report.txt
  fi

  # Stash the (signed) artefact in /src/out/ BEFORE the next arch's 'make clean'
  # wipes dist/ — clean runs 'rm -rf dist', which would otherwise delete this file.
  cp "\$PKG" /src/out/
  echo "==> [container] verifying \$BASENAME architecture (cputype: 16777223=x86_64, 16777228=arm64):"
  "\${TRIPLE}-otool" -h "\$TMP/MEMLNaut/plugin.dylib" 2>/dev/null | sed -n '3,4p' || true
  ls -la "/src/out/\$BASENAME"
}

mkdir -p /src/out
: > /src/out/_sign_report.txt
build_arch mac-x64   x64   "x86_64-apple-${DARWIN_TARGET}" x86_64
build_arch mac-arm64 arm64 "arm64-apple-${DARWIN_TARGET}"  arm64

echo "==> [container] final artefacts:"
ls -la /src/out/*.vcvplugin
cat /src/out/_sign_report.txt

# Hand the staged tree back to the invoking host user so the cleanup trap and
# dist copy work without root-owned leftovers.
chown -R \${HOST_UID}:\${HOST_GID} /src 2>/dev/null || true
EOF

echo "==> building macOS plugins in a bounded container (cpus=$CPUS, mem=$MEM, no extra swap)"
free -h
docker run --rm "${CAPS[@]}" \
  -e RACK_SDK_VERSION="$RACK_SDK_VERSION" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$WORK:/src" "$TOOLCHAIN_IMAGE" bash /src/_in-container.sh
free -h

mkdir -p "$SCRIPT_DIR/dist"
cp "$WORK"/out/*-mac-x64.vcvplugin "$SCRIPT_DIR/dist/"
cp "$WORK"/out/*-mac-arm64.vcvplugin "$SCRIPT_DIR/dist/"
echo "==> done:"
ls -la "$SCRIPT_DIR"/dist/*-mac-*.vcvplugin
