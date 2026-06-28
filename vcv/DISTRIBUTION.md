# Distributing the MEMLNaut VCV Rack plugin

How the `MEMLNaut` plugin is built for every platform and published to the public
download page at **https://meml.lnfinitemonkeys.org/next/vcv/**.

Plugin slug: `MEMLNaut`. Version comes from `plugin.json` (`jq -r .version`).

---

## 1. Build artefacts (`.vcvplugin`)

A `.vcvplugin` is a `tar.zst` archive of a `MEMLNaut/` directory containing the
platform binary (`plugin.so` / `.dll` / `.dylib`), `plugin.json`, and `res/`. The
official `plugin.mk` `dist` target produces it, named
`<slug>-<version>-<platform>.vcvplugin` (e.g. `MEMLNaut-0.2.0-lin-x64.vcvplugin`).
Platforms: `lin-x64`, `win-x64`, `mac-x64`, `mac-arm64`.

We have no dedicated build box, so we build **on this host**, but **resource-bounded**
so a build can never starve the live services. Build products (`build/`, `dist/`,
`plugin.so`, `*.vcvplugin`) are git-ignored — they are publish artefacts, not source.

### Linux x64 — locally (works today)

The Rack 2 SDK is installed at `$HOME/.local/share/Rack2/Rack-SDK`:

```bash
cd vcv
RACK_DIR=$HOME/.local/share/Rack2/Rack-SDK make dist
# -> vcv/dist/MEMLNaut-<version>-lin-x64.vcvplugin
```

Native host toolchain, SDK already present — trivial, no caps needed.

### Windows x64 — locally, resource-bounded (works today)

`vcv/build-win.sh` cross-builds Windows in a **hard-capped Docker container** using
**prebuilt mingw-w64** (no GCC/toolchain compile — it only apt-installs mingw and
compiles two `.cpp` files). The container is capped on CPU + memory with no extra
swap, so the cgroup OOM-kills the container rather than the host if it ever exceeded
the cap. In practice the host stays at full free RAM throughout.

```bash
vcv/build-win.sh                 # defaults: CPUS=6 MEM=8g, Rack SDK 2.6.4
CPUS=4 MEM=6g vcv/build-win.sh   # tighter caps
# -> vcv/dist/MEMLNaut-<version>-win-x64.vcvplugin
```

Note: the OSC bridge server needs Winsock on Windows; `vcv/Makefile` links
`-lws2_32` when `ARCH_WIN` is set (mingw ignores the MSVC `#pragma comment(lib,…)`).

### macOS (x64 + arm64) — Apple SDK required

macOS cross-builds need Apple's **licensed macOS SDK**, which we never download or
redistribute on this host. Two routes:

1. **CI** (`.github/workflows/vcv-plugin.yml`) — the
   [VCVRack/rack-plugin-toolchain](https://github.com/VCVRack/rack-plugin-toolchain)
   builds mac-x64 + mac-arm64 on tagged releases (the toolchain fetches the SDK only
   inside its own image build).
2. **A Mac** — build with the native SDK + `RACK_DIR` set to the macOS Rack SDK.

The full rack-plugin-toolchain image build is **not** run on this host: its Dockerfile
`COPY`s the Apple SDK and compiles osxcross, so it both needs the SDK and is multi-GB
/ multi-hour. That belongs on CI. (Linux + Windows above need none of it.)

---

## 2. CI: `.github/workflows/vcv-plugin.yml`

Builds all four platforms on `ubuntu-latest` runners via the pinned toolchain
(`TOOLCHAIN_REF`, currently Rack SDK 2.6.6 / toolchain image v19). Triggers on:

- pushes touching `vcv/**` (smoke-build the matrix),
- pull requests touching `vcv/**`,
- tag pushes `v*` (build **and** attach to a GitHub Release),
- manual `workflow_dispatch`.

Per matrix platform the job: checks out the plugin + pinned toolchain, fetches the
per-platform Rack SDKs (`make rack-sdk-all`), builds/loads the cached toolchain
Docker image, then runs `make docker-plugin-build-<platform>
PLUGIN_DIR=$GITHUB_WORKSPACE/vcv`. The resulting `.vcvplugin` is uploaded as a
workflow artifact. On a `v*` tag the `release` job downloads all four and attaches
them to the release via `softprops/action-gh-release`.

The heavy toolchain image is cached by `TOOLCHAIN_REF`, so only the first run on a
new pin pays the build cost.

### Cutting a release

```bash
# bump version in vcv/plugin.json, commit, then:
git tag v0.2.0
git push origin v0.2.0
```

CI builds lin-x64 / win-x64 / mac-x64 / mac-arm64 and attaches the four
`.vcvplugin` files to the GitHub release for `v0.2.0`.

### Bumping the toolchain

Edit `TOOLCHAIN_REF` (and `TOOLCHAIN_IMAGE_VERSION` if the image version changes)
in `.github/workflows/vcv-plugin.yml`. Pin to a commit — never float on `master`.

---

## 3. Publishing to `/next/vcv`

The download page lives in the live a-immersive docroot at
`/home/w1n5t0n/deployments/meml-aimmersive/next/vcv/`. It is **purely additive** —
a new subdir alongside `/next/animations`, disturbing nothing else.

Files:

- `index.html` — the download page (Manifold design tokens: dark, JetBrains Mono,
  `--accent #ff6a00`). Lists each platform with a download link, the version, VCV
  install instructions, and which platforms are available now vs built by CI.
- `a-immersive.html` — a byte-identical copy of `index.html`. nginx for
  `meml.lnfinitemonkeys.org` sets `index a-immersive.html`, so `/next/vcv/`
  resolves via this alias (same trick `/next/animations` uses). No nginx change is
  needed for a new subdir.
- `MEMLNaut-<version>-<platform>.vcvplugin` — the artefact(s).

### Adding CI release artifacts to `/next/vcv`

After a `v*` release builds on CI, copy the new `.vcvplugin` files into the publish
dir and refresh the cards/links in both HTML copies:

```bash
# from a checkout, with the release tag's artifacts downloaded e.g. via:
#   gh release download v0.2.0 -p '*.vcvplugin' -D /tmp/vcvrel
PUB=/home/w1n5t0n/deployments/meml-aimmersive/next/vcv
cp /tmp/vcvrel/*.vcvplugin "$PUB"/
# then edit $PUB/index.html: flip the win/mac cards from "built by CI"
# (.dl.disabled) to live download links, and copy index.html -> a-immersive.html:
cp "$PUB/index.html" "$PUB/a-immersive.html"
```

Bumping the version means updating the `v0.2.0` strings and the filenames in the
two HTML copies. Keep `index.html` and `a-immersive.html` identical.

### Verify

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://meml.lnfinitemonkeys.org/next/vcv/
curl -sk -o /dev/null -w '%{http_code}\n' \
  https://meml.lnfinitemonkeys.org/next/vcv/MEMLNaut-0.2.0-lin-x64.vcvplugin
```

Both should return `200`. Don't disturb `/next/`, `/next/animations/`, or the live
a-immersive at `/`.
