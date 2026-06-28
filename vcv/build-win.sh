#!/usr/bin/env bash
#
# build-win.sh — cross-build the MEMLNaut VCV plugin for Windows x64, here, in a
# RESOURCE-BOUNDED Docker container (prebuilt mingw-w64; no GCC/toolchain compile).
#
# Why Docker + caps: this host also runs live services. The container is hard-
# capped (CPU + memory + no extra swap) so the build physically cannot starve or
# crash the host — the cgroup OOM-kills the container, not the system, if it ever
# exceeded the cap. In practice this build peaks well under the cap (it only
# apt-installs prebuilt mingw + compiles two .cpp files), and the host stays at
# full free RAM throughout. Tune CPUS / MEM below for your machine.
#
# Output: vcv/dist/MEMLNaut-<version>-win-x64.vcvplugin
# Requires: docker. Run from anywhere; paths are resolved from this script.

set -euo pipefail

CPUS="${CPUS:-6}"          # cores the container may use
MEM="${MEM:-8g}"          # hard memory cap (== memory-swap, so no host swap)
RACK_SDK_VERSION="${RACK_SDK_VERSION:-2.6.4}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # vcv/
WORK="$(mktemp -d /tmp/vcv-win-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "==> staging a clean copy of the plugin source"
cp -r "$SCRIPT_DIR/." "$WORK/"
rm -rf "$WORK/build" "$WORK/dist" "$WORK/plugin.so" 2>/dev/null || true

cat > "$WORK/_in-container.sh" <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq g++-mingw-w64-x86-64-posix make unzip wget zstd tar jq >/dev/null
cd /tmp
wget -q "https://vcvrack.com/downloads/Rack-SDK-${RACK_SDK_VERSION}-win-x64.zip"
unzip -q "Rack-SDK-${RACK_SDK_VERSION}-win-x64.zip"
cd /src
export RACK_DIR=/tmp/Rack-SDK
export CC=x86_64-w64-mingw32-gcc-posix CXX=x86_64-w64-mingw32-g++-posix
export STRIP=x86_64-w64-mingw32-strip OBJCOPY=x86_64-w64-mingw32-objcopy
make clean >/dev/null 2>&1 || true
make -j${CPUS} dist
ls -la dist/
EOF

echo "==> building Windows plugin in a bounded container (cpus=$CPUS, mem=$MEM, no extra swap)"
docker run --rm --cpus="$CPUS" --memory="$MEM" --memory-swap="$MEM" \
  -v "$WORK:/src" ubuntu:24.04 bash /src/_in-container.sh

mkdir -p "$SCRIPT_DIR/dist"
cp "$WORK"/dist/*-win-x64.vcvplugin "$SCRIPT_DIR/dist/"
echo "==> done: $(ls "$SCRIPT_DIR"/dist/*-win-x64.vcvplugin)"
