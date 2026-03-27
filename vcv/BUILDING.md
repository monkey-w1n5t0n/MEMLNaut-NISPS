# Building MEMLNaut VCV Plugin

## Prerequisites

- **VCV Rack 2 SDK** — download from https://vcvrack.com/manual/PluginDevelopmentTutorial or build from source
- **C++20 compiler** — GCC 10+, Clang 11+, or MSVC 19.29+ (required by nisps-core for `std::span` and concepts)
- **GNU Make**
- **zip** (for distribution packaging only)

## Build Steps

```bash
# 1. Set the SDK path (adjust to your installation)
export RACK_DIR=/path/to/Rack-SDK

# 2. Build the plugin
cd vcv
make

# This produces plugin.so (Linux), plugin.dylib (macOS), or plugin.dll (Windows)
```

The Makefile adds `-std=c++20` and includes nisps-core headers from `../nisps-core/include`. The VCV SDK's default `-std=c++11` flag is filtered out to avoid conflicts.

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
# Build and package in one step
make -f Makefile.dist dist

# Or package an already-built plugin
make -f Makefile.dist package-only

# Output: dist/MEMLNaut-0.1.0-Linux-x86_64.zip (platform name varies)
```

The zip contains a `MEMLNaut/` directory with `plugin.so` (or `.dylib`/`.dll`), `plugin.json`, and `res/`. Users extract this into their VCV Rack plugins directory.

## Cross-Compilation

Cross-compilation is **not currently supported**. Building for each platform requires the native VCV Rack SDK and a matching C++20 toolchain.

Options for multi-platform releases:

- **GitHub Actions CI** — build on Linux, macOS, and Windows runners. The VCV SDK provides Docker images for consistent builds.
- **Docker** — VCV provides `ghcr.io/vcvrack/rack-plugin-toolchain` images for cross-platform builds from a Linux host.
- **Manual** — build natively on each target platform.

The VCV Library submission process handles multi-platform builds automatically via their CI pipeline, but we are not submitting to the Library initially.

## Troubleshooting

- **`-std=c++11` conflicts**: The Makefile filters this out, but if you see C++20 errors, verify your `RACK_DIR` points to a v2 SDK and that your compiler supports C++20.
- **nisps-core not found**: The include path assumes nisps-core is at `../nisps-core/include` relative to the `vcv/` directory. Verify the path or adjust `-I` in the Makefile.
- **Plugin not appearing**: Check that the built `.so`/`.dylib`/`.dll` is in the correct plugins directory and that `plugin.json` is alongside it.
