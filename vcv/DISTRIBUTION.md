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

### Linux x64 — locally (works today)

The Rack 2 SDK is installed at `$HOME/.local/share/Rack2/Rack-SDK`:

```bash
cd vcv
RACK_DIR=$HOME/.local/share/Rack2/Rack-SDK make dist
# -> vcv/dist/MEMLNaut-<version>-lin-x64.vcvplugin
```

This is the only platform we build on the server: the host toolchain is native
Linux x64 and the SDK is already present. Build products (`build/`, `dist/`,
`plugin.so`, `*.vcvplugin`) are git-ignored — they are publish artefacts, not
source.

### Windows / macOS — cross-built on CI (NOT on the server)

The other three platforms are cross-built by the official
[VCVRack/rack-plugin-toolchain](https://github.com/VCVRack/rack-plugin-toolchain),
the same Docker cross-builder the VCV Library uses. **We do not run that toolchain
on the production VPS** — its image build compiles mingw + osxcross and pulls the
Apple SDK (multi-GB, multi-hour), which would overload a host that serves live
services. macOS additionally requires the Apple SDK, which we never redistribute.
CI is the right place for all of this; for a local-only macOS build the operator
can use a Mac with the native SDK.

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
