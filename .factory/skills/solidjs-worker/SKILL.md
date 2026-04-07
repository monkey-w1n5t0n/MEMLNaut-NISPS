---
name: solidjs-worker
description: General-purpose SolidJS feature implementation worker for the NISPS migration
---

# SolidJS Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

All feature implementation for the SolidJS migration. This worker builds components, stores, hooks, and transplants core modules from the old playground app.

## Required Skills

- **agent-browser**: For manual verification of UI behavior in the browser. Use after implementation to verify component rendering and interactions.
- **tuistory**: NOT required for this mission.

## Work Procedure

### Step 1: Understand the Feature

1. Read `mission.md` in the mission directory for overall mission context.
2. Read `.factory/library/architecture.md` for system architecture.
3. Read `.factory/library/environment.md` for environment details.
4. Read the assigned feature from `features.json` carefully — understand every `expectedBehavior` and `fulfills` assertion.
5. Read the relevant assertion descriptions from `validation-contract.md`.

### Step 2: Reference the Old Code

1. The old playground app is at `playground/` (READ-ONLY reference).
2. `playground/js/a-app.js` is the main app (~4300 lines, read in chunks).
3. Identify the exact behavior to replicate by reading the relevant old code sections.
4. For transplanted modules (listed in `architecture.md`), copy from the old code and adapt to TypeScript with minimal changes.

### Step 3: Write Tests First (TDD)

1. Write failing tests BEFORE implementation. Tests go in `tests/` at the repo root.
2. For SolidJS components: use vitest + solid-testing-library (install if needed).
3. For behavioral assertions matching the validation contract: write Playwright e2e tests that use the `window.__nisps` debug probe.
4. For transplanted core modules: write unit tests verifying the same behavior as the old JS code.
5. Run tests to confirm they fail (red).

### Step 4: Implement

1. Follow the architecture in `.factory/library/architecture.md`.
2. Use SolidJS patterns from `.factory/library/solidjs-patterns.md`.
3. For transplanted modules: copy from `playground/js/`, add TypeScript types, adapt imports.
4. For new SolidJS code: use stores (createStore) for structured config, signals (createSignal) for Float32Arrays.
5. Ensure all workers are cleaned up in `onCleanup()`.
6. Ensure CSS uses the glass morphism design system (custom properties from `a-immersive.css`).

### Step 5: Verify

1. Run all tests: `npm test` (or the appropriate test command from services.yaml).
2. Run typecheck: `npx tsc --noEmit`.
3. Start the Vite dev server: `npx vite --port 5174`.
4. Use **agent-browser** to visually verify the feature:
   - Navigate to `http://localhost:5174?debug=1`
   - Verify the UI renders correctly
   - Interact with the component and verify behavior
   - Take screenshots as evidence
5. Compare behavior against the old app at `http://localhost:7331/a-immersive.html?debug=1` if needed.
6. Stop the dev server when done.

### Step 6: Commit and Hand Off

1. Stage and commit all changes with a descriptive message.
2. Report all verification evidence in the handoff.

## Example Handoff

```json
{
  "salientSummary": "Implemented Joystick component with pointer events and follow mode. Created input-store with joyX/joyY signals. Verified dragging updates position [0,1] and follow mode toggles on double-tap. All 5 tests pass, typecheck clean.",
  "whatWasImplemented": "src/components/input/Joystick.tsx (pointer events, position tracking, follow mode toggle), src/stores/input-store.ts (joyX, joyY, isDragging, followMode), src/components/input/JoyMap.tsx (canvas minimap scaffold), tests/e2e/joystick.spec.js (3 tests: drag, follow, clamp)",
  "whatWasLeftUndone": "JoyMap trail rendering deferred to layout milestone",
  "verification": {
    "commandsRun": [
      { "command": "npx tsc --noEmit", "exitCode": 0, "observation": "No type errors" },
      { "command": "npx vitest run tests/e2e/joystick.spec.js", "exitCode": 0, "observation": "3 tests passing" }
    ],
    "interactiveChecks": [
      { "action": "Navigate to localhost:5174?debug=1, drag joystick", "observed": "Joystick dot follows pointer, probe.setInputs matches visual position" },
      { "action": "Double-tap joystick", "observed": "Follow badge appears, pulse animation starts" }
    ]
  },
  "tests": {
    "added": [
      { "file": "tests/e2e/joystick.spec.js", "cases": [
        { "name": "drag updates position", "verifies": "VAL-JOY-001" },
        { "name": "double-tap toggles follow", "verifies": "VAL-JOY-002" },
        { "name": "input clamping", "verifies": "VAL-JOY-005" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on infrastructure not yet built (e.g., a store that doesn't exist)
- Requirements are ambiguous — cannot determine correct behavior from old code or contract
- Existing bugs in the codebase block this feature
- Need to modify files in `playground/` (off-limits without orchestrator approval)
- Cannot complete within the session — return with `whatWasLeftUndone` detailed
