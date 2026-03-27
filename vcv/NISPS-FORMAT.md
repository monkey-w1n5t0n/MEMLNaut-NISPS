# .nisps File Format Specification

Version: 1

## Overview

The `.nisps` format is a JSON file that captures the complete state of a NISPS interactive ML engine: network weights, training examples, I/O configuration, and MLP architecture metadata. It enables preset sharing between the VCV Rack module and the web playground.

## Top-Level Structure

```json
{
  "version": 1,
  "noiseLevel": 0.1,
  "slewMs": 10.0,
  "outputRangeUnipolar": [true, false, ...],
  "inputRangeUnipolar": [true, true, ...],
  "weights": [[[...], ...], ...],
  "examples": {
    "features": [[...], ...],
    "labels": [[...], ...]
  },
  "mlpConfig": {
    "layers": [3, 16, 24, 16, 12],
    "activations": ["relu", "relu", "relu", "sigmoid"]
  },
  "params": [0.5, 0.8, ...]
}
```

## Field Reference

### `version` (integer, required)

Format version number. Currently `1`. Loaders must reject files where `version < 1`. Future versions will increment this value; loaders should accept any version they understand and reject higher versions gracefully.

### `noiseLevel` (float, optional)

RL exploration noise amplitude. Range: 0.0-1.0. Default: `0.1`. Controls how much random perturbation is applied to weights during reinforcement learning exploration.

### `slewMs` (float, optional)

Output slew rate in milliseconds. Default: `10.0`. Smooths transitions between output values to prevent clicks/artifacts. In VCV Rack this is the time constant for exponential smoothing on output voltages.

### `outputRangeUnipolar` (boolean[], optional)

Per-output voltage range flag. Length must equal the number of MLP outputs. When `true`, the output maps to 0-10V (unipolar); when `false`, it maps to +/-5V (bipolar). Default: all `false`.

This field is VCV Rack-specific. The web playground ignores it but should preserve it on round-trip.

### `inputRangeUnipolar` (boolean[], optional)

Per-input voltage range flag. Length must equal the maximum number of inputs (8 in VCV Rack). When `true`, the input expects 0-10V; when `false`, +/-5V. Default: all `false`.

This field is VCV Rack-specific. The web playground ignores it but should preserve it on round-trip.

### `weights` (float[][][], required for state restore)

MLP weights as a 3D array: `weights[layer][node][weight]`.

**Serialization order:**
- Outer dimension: layers, from first hidden layer to output layer. Length = number of layers - 1 (i.e., number of weight matrices).
- Middle dimension: nodes within that layer. Length = `mlpConfig.layers[i+1]` (the number of nodes in the destination layer).
- Inner dimension: connection weights from source nodes. Length = `mlpConfig.layers[i]` (the number of nodes in the source layer, including bias for the first layer).

**Bias handling:** In the VCV Rack C++ implementation, bias is stored separately from connection weights and is **not** included in this array. The bias values are not serialized. On load, biases remain at their current values (typically 0).

In the web playground, bias is also stored separately per node. The webapp's export/import methods handle the structural difference by serializing weights without bias (matching the VCV format) and preserving bias in a separate optional field.

**Example for a `[3, 4, 2]` network** (3 inputs, 4 hidden, 2 outputs):
```json
"weights": [
  [                          // layer 0: input -> hidden
    [0.1, -0.3, 0.5],       // hidden node 0: 3 weights from 3 inputs
    [0.2, 0.4, -0.1],       // hidden node 1
    [-0.6, 0.3, 0.2],       // hidden node 2
    [0.1, -0.5, 0.7]        // hidden node 3
  ],
  [                          // layer 1: hidden -> output
    [0.3, -0.2, 0.4, 0.1],  // output node 0: 4 weights from 4 hidden nodes
    [-0.1, 0.5, -0.3, 0.2]  // output node 1
  ]
]
```

### `examples` (object, optional)

Training examples as parallel arrays.

#### `examples.features` (float[][], required if examples present)

Input feature vectors. Each inner array has length equal to `mlpConfig.layers[0]` minus the bias term. In the VCV module, features are stored **without** the bias term appended.

#### `examples.labels` (float[][], required if examples present)

Output label vectors. Each inner array has length equal to `mlpConfig.layers[last]`. Must have the same outer length as `features`.

**Example:**
```json
"examples": {
  "features": [
    [0.3, 0.7],
    [0.8, 0.2]
  ],
  "labels": [
    [0.1, 0.9, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.1, 0.5, 0.3],
    [0.9, 0.1, 0.4, 0.7, 0.3, 0.8, 0.2, 0.6, 0.4, 0.9, 0.5, 0.7]
  ]
}
```

### `mlpConfig` (object, required)

Architecture metadata for validation on load.

#### `mlpConfig.layers` (integer[], required)

Layer sizes including input (with bias) and output. For the default VCV configuration with 2 inputs and 12 outputs: `[3, 16, 24, 16, 12]`. The first element includes the +1 bias node.

#### `mlpConfig.activations` (string[], optional)

Activation function names per weight layer. Length = `layers.length - 1`. Valid values: `"relu"`, `"sigmoid"`, `"tanh"`, `"linear"`. Default: all hidden layers use `"relu"`, output layer uses `"sigmoid"`.

The VCV Rack module currently does not serialize this field (the architecture is fixed). The web playground includes it for forward compatibility.

### `params` (float[], optional)

VCV Rack module parameter values (knob positions, attenuators, etc.). Array indexed by the module's parameter enum. Present only in files saved from the VCV Rack "Save .nisps preset" menu.

The web playground may use this field to store synth parameter values for preset portability. Consumers that don't understand the parameter layout should ignore this field.

## Validation Rules

Loaders should check the following on import:

1. **Version gate**: `version` must be present and >= 1. Reject unknown future versions.
2. **Weight dimensions**: If `weights` and `mlpConfig.layers` are both present, verify:
   - `weights.length === mlpConfig.layers.length - 1`
   - `weights[i].length === mlpConfig.layers[i + 1]`
   - `weights[i][j].length === mlpConfig.layers[i]`
3. **Example dimensions**: If `examples` is present:
   - `features.length === labels.length`
   - Each feature vector length should equal `mlpConfig.layers[0]` (or `mlpConfig.layers[0] - 1` if bias is excluded)
   - Each label vector length should equal `mlpConfig.layers[last]`
4. **Architecture compatibility**: If the loader's MLP has a different architecture than `mlpConfig.layers`, the file cannot be loaded directly. The loader should reject or warn.
5. **Numeric validity**: All weight and example values must be finite (not NaN or Infinity).

## Compatibility Notes

### VCV Rack -> Web Playground

- The VCV module uses a `[3, 16, 24, 16, 12]` architecture (2 inputs + bias, 12 outputs).
- The web playground uses a `[3, 32, 48, 64, 126]` architecture (2 inputs + bias, 126 outputs).
- Direct weight transfer between these architectures is not possible. The `mlpConfig.layers` field enables loaders to detect this mismatch and report it.
- Training examples (features/labels) are also architecture-dependent due to different output counts.

### Bias Values

The VCV C++ serialization does not include node bias values in the `weights` array. Bias is stored separately in `Node::m_bias` but is not written to JSON. This means bias values are reset to their pre-load state when restoring from a `.nisps` file. In practice this has minimal impact because:
- The MLP uses leaky ReLU (hidden) and sigmoid (output) activations
- Training quickly adjusts bias values
- Initial bias is typically 0

### Future Extensions

New fields may be added to the top level without incrementing the version number, as long as they are optional and backward-compatible. The version number increments only for breaking changes to existing field semantics.

## Complete Example

A minimal but complete `.nisps` file for a `[3, 4, 2]` network (2 inputs, 4 hidden nodes, 2 outputs):

```json
{
  "version": 1,
  "noiseLevel": 0.15,
  "slewMs": 10.0,
  "outputRangeUnipolar": [true, false],
  "inputRangeUnipolar": [false, false],
  "weights": [
    [
      [0.123, -0.456, 0.789],
      [-0.321, 0.654, -0.987],
      [0.111, -0.222, 0.333],
      [-0.444, 0.555, -0.666]
    ],
    [
      [0.12, -0.34, 0.56, -0.78],
      [0.91, -0.23, 0.45, -0.67]
    ]
  ],
  "examples": {
    "features": [
      [0.3, 0.7],
      [0.8, 0.2]
    ],
    "labels": [
      [0.9, 0.1],
      [0.2, 0.8]
    ]
  },
  "mlpConfig": {
    "layers": [3, 4, 2],
    "activations": ["relu", "sigmoid"]
  }
}
```
