import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { DeltaController } from '../delta.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EPS = 1e-6;

function approxEqual(actual, expected, msg) {
  assert.ok(
    Math.abs(actual - expected) < EPS,
    `${msg || ''} expected ${expected}, got ${actual}`
  );
}

function makeSchemas(count, boundary = 'clamp', scaledRange) {
  const schemas = [];
  for (let i = 0; i < count; i++) {
    const entry = { boundary };
    if (boundary === 'scaled' && scaledRange !== undefined) {
      entry.scaledRange = scaledRange;
    }
    schemas.push({ schema: entry });
  }
  return schemas;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeltaController.computeEffective', () => {

  it('all frozen (liveFlags all 0): output === frozenParams', () => {
    const frozen = new Float32Array([0.2, 0.5, 0.8]);
    const live = new Uint8Array([0, 0, 0]);
    const mlp = new Float32Array([0.0, 1.0, 0.5]);
    const schemas = makeSchemas(3);

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas);

    approxEqual(result[0], 0.2, 'param 0');
    approxEqual(result[1], 0.5, 'param 1');
    approxEqual(result[2], 0.8, 'param 2');
  });

  it('all live with clamp boundary: delta applied, result clamped to [0,1]', () => {
    const frozen = new Float32Array([0.9, 0.1]);
    const live = new Uint8Array([1, 1]);
    const mlp = new Float32Array([1.0, 0.0]); // max positive, max negative
    const schemas = makeSchemas(2, 'clamp');
    const deltaScale = 0.3;

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas, deltaScale);

    // param 0: 0.9 + (1.0 - 0.5)*2*0.3 = 0.9 + 0.3 = 1.2 -> clamped to 1.0
    approxEqual(result[0], 1.0, 'param 0 clamped high');
    // param 1: 0.1 + (0.0 - 0.5)*2*0.3 = 0.1 - 0.3 = -0.2 -> clamped to 0.0
    approxEqual(result[1], 0.0, 'param 1 clamped low');
  });

  it('live with wrap boundary: values wrap around', () => {
    const frozen = new Float32Array([0.9, 0.1]);
    const live = new Uint8Array([1, 1]);
    const mlp = new Float32Array([1.0, 0.0]);
    const schemas = makeSchemas(2, 'wrap');
    const deltaScale = 0.3;

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas, deltaScale);

    // param 0: 0.9 + 0.3 = 1.2 -> wrap -> 0.2
    approxEqual(result[0], 0.2, 'param 0 wrapped high');
    // param 1: 0.1 - 0.3 = -0.2 -> wrap -> 0.8
    approxEqual(result[1], 0.8, 'param 1 wrapped low');
  });

  it('live with scaled boundary: delta operates within scaledRange of frozen value', () => {
    const frozen = new Float32Array([0.5]);
    const live = new Uint8Array([1]);
    // With scaled boundary, applyBoundary maps [0,1] input to [frozen-range, frozen+range]
    // The raw value passed to applyBoundary is frozen + delta
    // For scaled: lo = 0.5 - 0.3 = 0.2, hi = 0.5 + 0.3 = 0.8
    // mapped = 0.2 + raw * 0.6
    const mlp = new Float32Array([0.75]); // delta = (0.75 - 0.5)*2*0.3 = 0.15, raw = 0.65
    const schemas = makeSchemas(1, 'scaled', 0.3);
    const deltaScale = 0.3;

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas, deltaScale);

    // raw = 0.5 + 0.15 = 0.65
    // scaled: lo = 0.5 - 0.3 = 0.2, hi = 0.5 + 0.3 = 0.8
    // mapped = 0.2 + 0.65 * (0.8 - 0.2) = 0.2 + 0.39 = 0.59
    approxEqual(result[0], 0.59, 'scaled boundary');
  });

  it('MLP value 0.5 produces zero delta (frozen value unchanged)', () => {
    const frozen = new Float32Array([0.3, 0.7]);
    const live = new Uint8Array([1, 1]);
    const mlp = new Float32Array([0.5, 0.5]);
    const schemas = makeSchemas(2, 'clamp');

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas);

    approxEqual(result[0], 0.3, 'param 0 unchanged');
    approxEqual(result[1], 0.7, 'param 1 unchanged');
  });

  it('MLP value 0.0 produces max negative delta', () => {
    const frozen = new Float32Array([0.5]);
    const live = new Uint8Array([1]);
    const mlp = new Float32Array([0.0]);
    const schemas = makeSchemas(1, 'clamp');
    const deltaScale = 0.3;

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas, deltaScale);

    // 0.5 + (0.0 - 0.5)*2*0.3 = 0.5 - 0.3 = 0.2
    approxEqual(result[0], 0.2, 'max negative delta');
  });

  it('MLP value 1.0 produces max positive delta', () => {
    const frozen = new Float32Array([0.5]);
    const live = new Uint8Array([1]);
    const mlp = new Float32Array([1.0]);
    const schemas = makeSchemas(1, 'clamp');
    const deltaScale = 0.3;

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas, deltaScale);

    // 0.5 + (1.0 - 0.5)*2*0.3 = 0.5 + 0.3 = 0.8
    approxEqual(result[0], 0.8, 'max positive delta');
  });

  it('mixed frozen/live params', () => {
    const frozen = new Float32Array([0.2, 0.5, 0.8, 0.4]);
    const live = new Uint8Array([0, 1, 0, 1]);
    const mlp = new Float32Array([0.9, 0.5, 0.1, 0.75]);
    const schemas = makeSchemas(4, 'clamp');
    const deltaScale = 0.3;

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas, deltaScale);

    // param 0: frozen -> 0.2
    approxEqual(result[0], 0.2, 'frozen param 0');
    // param 1: live, mlp=0.5 -> zero delta -> 0.5
    approxEqual(result[1], 0.5, 'live param 1 zero delta');
    // param 2: frozen -> 0.8
    approxEqual(result[2], 0.8, 'frozen param 2');
    // param 3: live, 0.4 + (0.75 - 0.5)*2*0.3 = 0.4 + 0.15 = 0.55
    approxEqual(result[3], 0.55, 'live param 3');
  });

  it('deltaScale affects magnitude', () => {
    const frozen = new Float32Array([0.5]);
    const live = new Uint8Array([1]);
    const mlp = new Float32Array([1.0]); // max positive
    const schemas = makeSchemas(1, 'clamp');

    const r1 = DeltaController.computeEffective(frozen, live, mlp, schemas, 0.1);
    const r2 = DeltaController.computeEffective(frozen, live, mlp, schemas, 0.5);

    // scale 0.1: 0.5 + 0.1 = 0.6
    approxEqual(r1[0], 0.6, 'small deltaScale');
    // scale 0.5: 0.5 + 0.5 = 1.0
    approxEqual(r2[0], 1.0, 'large deltaScale');
  });

  it('defaults deltaScale to 0.3 when not provided', () => {
    const frozen = new Float32Array([0.5]);
    const live = new Uint8Array([1]);
    const mlp = new Float32Array([1.0]);
    const schemas = makeSchemas(1, 'clamp');

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas);

    // 0.5 + (1.0 - 0.5)*2*0.3 = 0.8
    approxEqual(result[0], 0.8, 'default deltaScale 0.3');
  });

  it('falls back to clamp when schema is missing', () => {
    const frozen = new Float32Array([0.9]);
    const live = new Uint8Array([1]);
    const mlp = new Float32Array([1.0]);
    const schemas = []; // empty — no schema for this index

    const result = DeltaController.computeEffective(frozen, live, mlp, schemas, 0.3);

    // 0.9 + 0.3 = 1.2 -> clamped to 1.0
    approxEqual(result[0], 1.0, 'missing schema falls back to clamp');
  });
});
