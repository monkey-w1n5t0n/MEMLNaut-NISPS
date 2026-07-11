# Agent Instructions — MEMLNaut-NISPS

One C++20 NISPS core targets RP2350 firmware and a SolidJS/WASM playground. Read
`MAP.md`, `ALIGNMENT.md`, and `docs/AGENT-REFERENCE.md`; for Manifold UI work read
`manifold/ONBOARDING.md` first. Parameter JSON schemas generate both C++ and TypeScript
contracts.

## Gates

```bash
bash scripts/build-cpp-tests.sh
bash scripts/parity-check.sh
bash scripts/lint-cpp.sh
scripts/build-firmware.sh [VARIANT]
cd playground && bun run typecheck && bun run build
```

- `nisps/` must remain platform-neutral and allocation-free in hot paths: no heap, no
  virtual dispatch, `.f` float literals, deterministic per-instance RNG, and the memory/
  hot-path attributes from `nisps/core/perf.hpp`.
- Firmware and WASM use the same engines/modes. Cross-platform outputs must retain parity;
  do not patch target-specific behavior around a core mismatch.
- Schema changes require codegen and both generated-language outputs in the same change.
- Audio-thread/WASM-worklet communication stays bounded and real-time safe.
- Preserve dual-core firmware ownership and SPSC synchronization; UI/control work must not
  block the audio path.
- UI behavior changes need the targeted unit/E2E evidence and the verification chokepoints
  documented in the detailed reference.

Use `ergo` for coding tasks. Keep `MAP.md`, `ALIGNMENT.md`, and affected docs synchronized
with code.
