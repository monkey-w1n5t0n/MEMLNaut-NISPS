# Building MEMLNaut VCV Plugin

> **Distribution & cross-platform builds:** for packaging `.vcvplugin` files,
> the cross-platform CI matrix, and publishing to `/next/vcv`, see
> [DISTRIBUTION.md](DISTRIBUTION.md). The official `make dist` target (from the
> SDK's `plugin.mk`) produces `dist/<slug>-<version>-<platform>.vcvplugin`.

## Prerequisites

- **VCV Rack 2 SDK** — download from https://vcvrack.com/manual/PluginDevelopmentTutorial or build from source
- **C++20 compiler** — GCC 10+, Clang 11+, or MSVC 19.29+ (required by the `nisps/` core for `std::span` and concepts)
- **GNU Make**

## Build Steps

```bash
# 1. Set the SDK path (adjust to your installation)
export RACK_DIR=/path/to/Rack-SDK

# 2. Build the plugin
cd vcv
make

# This produces plugin.so (Linux), plugin.dylib (macOS), or plugin.dll (Windows)
```

The Makefile adds `-std=c++20`; the shared `nisps/` core is reached via relative `../../nisps/…` includes from `src/` (no extra `-I`). The VCV SDK's default `-std=c++11` flag is filtered out to avoid conflicts.

## Local Installation

```bash
# Option A: use the SDK's install target
make install
# Copies the plugin to ~/.local/share/Rack2/plugins-lin/ (or platform equivalent)

# Option B: manual symlink (useful during development)
ln -s $(pwd) ~/.local/share/Rack2/plugins-lin/MEMLNaut
```

After installing, restart VCV Rack (or use the module browser refresh if available). The MEMLNaut module appears in the module browser.

## Distribution Packaging

```bash
# Build and package a .vcvplugin (SDK plugin.mk target)
make dist

# Output: dist/MEMLNaut-<version>-<platform>.vcvplugin
```

See [DISTRIBUTION.md](DISTRIBUTION.md) for the full packaging, CI matrix, and publishing workflow.

## Cross-Compilation

Cross-compilation is **not currently supported**. Building for each platform requires the native VCV Rack SDK and a matching C++20 toolchain.

Options for multi-platform releases:

- **GitHub Actions CI** — build on Linux, macOS, and Windows runners. The VCV SDK provides Docker images for consistent builds.
- **Docker** — VCV provides `ghcr.io/vcvrack/rack-plugin-toolchain` images for cross-platform builds from a Linux host.
- **Manual** — build natively on each target platform.

The VCV Library submission process handles multi-platform builds automatically via their CI pipeline, but we are not submitting to the Library initially.

## Troubleshooting

- **`-std=c++11` conflicts**: The Makefile filters this out, but if you see C++20 errors, verify your `RACK_DIR` points to a v2 SDK and that your compiler supports C++20.
- **nisps headers not found**: `src/iml.hpp` reaches the core via `../../nisps/…` relative includes, so the plugin must be built from a full `MEMLNaut-NISPS` checkout (a standalone copy of `vcv/` will not compile).
- **Plugin not appearing**: Check that the built `.so`/`.dylib`/`.dll` is in the correct plugins directory and that `plugin.json` is alongside it.
