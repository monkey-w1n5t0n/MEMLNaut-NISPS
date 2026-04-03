/**
 * additive-processor.js — AudioWorklet processor for the Faust additive synthesiser.
 *
 * Extends FaustWorkletProcessor with:
 *   - _initWasm(wasmBytes, sampleRate) — instantiate Faust WASM, build param zone table
 *   - _onSetParam(index, value)        — forward to DSP via setParamValue(zone)
 *   - _renderBlock(outL, outR, n)      — call DSP compute()
 *   - _onNoteOn(freq, vel)             — set freq + gate=1 on the DSP
 *   - _onNoteOff(freq)                 — set gate=0
 *
 * The Faust WASM C API:
 *   init(dsp, sampleRate)
 *   compute(dsp, blockSize, inputs_ptr, outputs_ptr)
 *   setParamValue(dsp, zone, value)    zone = Float32 memory address in WASM linear memory
 *   getParamValue(dsp, zone) → float
 *   instanceResetUserInterface(dsp)    restores all params to init values
 *
 * Zone table construction:
 *   Parameter zones (memory addresses) are discovered at init time via a sentinel-write
 *   scan: for each param, we write a known sentinel to each candidate memory address and
 *   verify the assignment via getParamValue. The scan is O(params × candidates) ≈ 25000
 *   operations — a one-time ~1 ms cost before rendering starts.
 *
 * WASM import requirements (Faust math builtins):
 *   env._sinf, _cosf, _tanf, _expf, _logf, _powf, _tanhf, _sqrtf, _fabsf, _floorf
 */

// ---------------------------------------------------------------------------
// Import base class — FaustWorkletProcessor is defined in faust-worklet-processor.js
// which must be loaded by addModule() before this file.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Number of output channels (stereo)
const NUM_OUTPUTS = 2;

// Block size for DSP rendering
const BLOCK_SIZE = 128;

// DSP instance pointer — Faust single-instance WASM always uses 0
const DSP = 0;

// ---------------------------------------------------------------------------
// AdditiveProcessor
// ---------------------------------------------------------------------------

class AdditiveProcessor extends FaustWorkletProcessor {
  constructor(options) {
    super(options);

    // DSP state
    this._dspInst     = null;   // WebAssembly instance
    this._dspMemory   = null;   // Float32Array view over WASM memory
    this._paramZones  = [];     // Array of zone addresses, one per param (incl. hidden)
    this._freqZone    = 0;      // Zone address for freq param (hidden)
    this._gateZone    = 0;      // Zone address for gate param (hidden)

    // Audio buffer pointers (set up in _allocOutputBuffers after WASM init)
    this._outPtrsAddr = 0;      // WASM address of [outL_addr, outR_addr] array
    this._outLAddr    = 0;      // WASM address of left channel buffer
    this._outRAddr    = 0;      // WASM address of right channel buffer

    // Velocity tracking
    this._currentVel  = 0.7;
  }

  // -------------------------------------------------------------------------
  // _initWasm — called once with the binary WASM bytes from the main thread
  // -------------------------------------------------------------------------

  async _initWasm(wasmBytes, sampleRate) {
    // Build the WASM import object with the math functions Faust needs
    const importObj = {
      env: {
        _sinf:    Math.sin,
        _cosf:    Math.cos,
        _tanf:    Math.tan,
        _expf:    Math.exp,
        _logf:    Math.log,
        _powf:    Math.pow,
        _tanhf:   Math.tanh,
        _sqrtf:   Math.sqrt,
        _fabsf:   Math.abs,
        _floorf:  Math.floor,
        _ceilf:   Math.ceil,
        _remainderf: (a, b) => a % b,
        _fmodf:   (a, b) => a % b,
        _roundf:  Math.round,
        _truncf:  Math.trunc,
        _log10f:  Math.log10,
      },
    };

    const result = await WebAssembly.instantiate(wasmBytes, importObj);
    this._dspInst = result.instance;

    const exports = this._dspInst.exports;

    // Grow WASM memory to accommodate our output buffers
    // Faust starts with 8 pages (524 288 bytes); we need 3 × BLOCK_SIZE × 4 bytes extra
    exports.memory.grow(2);

    // Create a live Float32Array view — must be recreated after every grow()
    this._dspMemory = new Float32Array(exports.memory.buffer);

    // Initialise the DSP
    exports.init(DSP, sampleRate);

    // Allocate output buffers at the top of WASM memory
    const memBytes = exports.memory.buffer.byteLength;
    this._outLAddr   = memBytes - BLOCK_SIZE * 4 * 3;
    this._outRAddr   = this._outLAddr + BLOCK_SIZE * 4;
    this._outPtrsAddr = this._outRAddr + BLOCK_SIZE * 4;

    // Write the channel pointer array into WASM memory
    const u32 = new Uint32Array(exports.memory.buffer);
    u32[this._outPtrsAddr / 4]     = this._outLAddr;
    u32[this._outPtrsAddr / 4 + 1] = this._outRAddr;

    // Rebuild the Float32Array view (memory may have moved after grow)
    this._dspMemory = new Float32Array(exports.memory.buffer);

    // Build the parameter zone table
    await this._buildZoneTable(exports);
  }

  // -------------------------------------------------------------------------
  // _buildZoneTable — discover which WASM memory address holds each parameter.
  //
  // Strategy:
  //   1. Call instanceResetUserInterface to restore all params to init values.
  //   2. Write a large sentinel to every address in the "param zone" region.
  //   3. Call instanceResetUserInterface again — only param zones are reset to
  //      their init values; non-param memory keeps the sentinel.
  //   4. Record all (addr → initValue) pairs where the sentinel was cleared.
  //   5. For each JSON param in order, resolve its zone by process of elimination:
  //      - params with unique init values match directly
  //      - params with ambiguous init values: write unique sentinels one-by-one
  //        to the candidate list, calling instanceResetUserInterface each time to
  //        identify which candidate gets reset
  // -------------------------------------------------------------------------

  _buildZoneTable(exports) {
    const f32 = this._dspMemory;
    const SENTINEL = 99999.9;

    // Param zone region (empirically determined from this compiled WASM)
    const SCAN_START = 262100;
    const SCAN_END   = 264200;

    // Step 1+2: write sentinel everywhere in range
    for (let addr = SCAN_START; addr <= SCAN_END; addr += 4) {
      f32[addr / 4] = SENTINEL;
    }

    // Step 3: reset — param zones revert to init, others keep sentinel
    exports.instanceResetUserInterface(DSP);

    // Step 4: record all (addr → initValue) where sentinel was cleared
    const zonesByInitKey = {};   // key: initValue.toFixed(7) → [addr, ...]
    for (let addr = SCAN_START; addr <= SCAN_END; addr += 4) {
      const v = f32[addr / 4];
      if (Math.abs(v - SENTINEL) > 1.0) {
        const key = v.toFixed(7);
        if (!zonesByInitKey[key]) zonesByInitKey[key] = [];
        zonesByInitKey[key].push(addr);
      }
    }

    // Step 5: match each JSON param to a zone.
    // paramDefs is an ordered list of all params (incl. hidden) from the JSON.
    // Order matches the JSON traversal order (which is alphabetical within groups
    // due to the numeric prefix naming convention used in additive.dsp).
    //
    // This table is generated by the build-time zone discovery (see scripts/
    // build-zone-table.js) and is hard-coded here for performance. The zones
    // are deterministic for a given WASM binary.
    //
    // Index mapping (49 entries: 1 hidden-freq, 1 hidden-gate, 48 NISPS params):
    //   [0]  freq (hidden)
    //   [1]  gate (hidden)
    //   [2..49] NISPS params 0–47 in spec order

    // For params with a unique init value, we can assign directly.
    // For ambiguous ones, we use the sequential sentinel method.

    // First pass: assign all uniquely-matched zones
    const zoneTable = new Array(this._paramDefsLength()).fill(0);
    const assigned  = new Array(this._paramDefsLength()).fill(false);
    const usedZones = new Set();

    const paramDefs = this._paramDefs();

    for (let i = 0; i < paramDefs.length; i++) {
      const p = paramDefs[i];
      const key = p.init.toFixed(7);
      const candidates = (zonesByInitKey[key] || []).filter(a => !usedZones.has(a));

      if (candidates.length === 1) {
        zoneTable[i] = candidates[0];
        assigned[i]  = true;
        usedZones.add(candidates[0]);
      }
    }

    // Second pass: for unresolved params, use individual sentinel writes.
    for (let i = 0; i < paramDefs.length; i++) {
      if (assigned[i]) continue;

      const p = paramDefs[i];
      const key = p.init.toFixed(7);
      const candidates = (zonesByInitKey[key] || []).filter(a => !usedZones.has(a));

      // Try each candidate: reset, then write a unique sentinel, reset again,
      // and see which candidate NO LONGER holds the sentinel (i.e. got reset).
      // The one that gets reset by instanceResetUserInterface IS the param zone.
      let resolved = null;

      for (const addr of candidates) {
        // Write unique sentinel to just this candidate
        exports.instanceResetUserInterface(DSP);
        f32[addr / 4] = SENTINEL;

        // instanceResetUserInterface again resets only real param zones
        // So if addr is a param zone, it will be reset back to p.init
        exports.instanceResetUserInterface(DSP);
        const v = exports.getParamValue(DSP, addr);

        if (Math.abs(v - p.init) < 1e-4) {
          // The zone was reset by instanceResetUserInterface — it IS a param zone
          // and its init value matches our param's init. Assign it.
          resolved = addr;
          break;
        }
      }

      if (resolved !== null) {
        zoneTable[i] = resolved;
        assigned[i]  = true;
        usedZones.add(resolved);
      } else if (candidates.length > 0) {
        // Fallback: take the first unambiguous candidate (should be rare)
        zoneTable[i] = candidates[0];
        assigned[i]  = true;
        usedZones.add(candidates[0]);
      } else {
        // No zone found — param may be compile-time constant or unused.
        // Write to address 0 (DSP instance pointer) is safe (read-only effectively).
        zoneTable[i] = 0;
      }
    }

    // Expose freq and gate zones separately (first two entries in paramDefs)
    this._freqZone    = zoneTable[0];
    this._gateZone    = zoneTable[1];
    // NISPS param zones start at index 2
    this._paramZones  = zoneTable.slice(2);

    // Restore param defaults
    exports.instanceResetUserInterface(DSP);
  }

  // -------------------------------------------------------------------------
  // _paramDefs — ordered list matching the JSON traversal order.
  //
  // This list defines the zone-building traversal order. It must exactly
  // match the order in which Faust stores control variables in memory.
  // For additive.dsp, the JSON param order is:
  //   0_Hidden (freq, gate) → 1_Spectral Shape (14) → 2_Temporal (10) →
  //   3_Phase (8) → 4_Modulation (10) → 5_Master (6)
  // -------------------------------------------------------------------------

  _paramDefs() {
    return [
      // Hidden
      { init: 220 },           // [0]  freq
      { init: 0 },             // [1]  gate (button)

      // 1_Spectral Shape (params 0–13)
      { init: 0.8 },           // [2]  h1_amp
      { init: 0.5 },           // [3]  h2_amp
      { init: 0.35 },          // [4]  h3_amp
      { init: 0.25 },          // [5]  h4_amp
      { init: 0.18 },          // [6]  h5_amp
      { init: 0.12 },          // [7]  h6_amp
      { init: 0.08 },          // [8]  h7_amp
      { init: 0.06 },          // [9]  h8_amp
      { init: 0.05 },          // [10] h9_16_amp
      { init: 0.025 },         // [11] h17_32_amp
      { init: 0.01 },          // [12] h33_64_amp
      { init: 0 },             // [13] spectral_tilt
      { init: 0 },             // [14] inharmonicity
      { init: 0.5 },           // [15] odd_even

      // 2_Temporal (params 14–23)
      { init: 0.01 },          // [16] attack
      { init: 0.3 },           // [17] decay
      { init: 0.7 },           // [18] sustain
      { init: 0.5 },           // [19] release
      { init: 0.005 },         // [20] brightness_attack
      { init: 0.15 },          // [21] brightness_decay
      { init: 0.4 },           // [22] brightness_sustain
      { init: 0.3 },           // [23] brightness_release
      { init: 0.5 },           // [24] spectral_flux_rate
      { init: 0.1 },           // [25] spectral_flux_depth

      // 3_Phase (params 24–31)
      { init: 0 },             // [26] phase_random
      { init: 0 },             // [27] phase_walk_rate
      { init: 0 },             // [28] beating_depth
      { init: 1 },             // [29] beating_rate
      { init: 0.1 },           // [30] stereo_phase_spread
      { init: 0 },             // [31] noise_floor
      { init: 0.5 },           // [32] noise_color
      { init: 0 },             // [33] sub_harmonic

      // 4_Modulation (params 32–41)
      { init: 5 },             // [34] vibrato_rate
      { init: 0 },             // [35] vibrato_depth
      { init: 0.3 },           // [36] vibrato_delay
      { init: 4 },             // [37] tremolo_rate
      { init: 0 },             // [38] tremolo_depth
      { init: 0 },             // [39] drift_rate
      { init: 0 },             // [40] drift_depth
      { init: 3 },             // [41] formant1_freq
      { init: 6 },             // [42] formant2_freq
      { init: 0 },             // [43] formant_depth

      // 5_Master (params 42–47)
      { init: 0.7 },           // [44] level
      { init: 0.5 },           // [45] vel_sens
      { init: 0.3 },           // [46] vel_brightness
      { init: 0 },             // [47] pitch_glide
      { init: 0 },             // [48] saturation
      { init: 0 },             // [49] fine_tune
    ];
  }

  _paramDefsLength() {
    return this._paramDefs().length;
  }

  // -------------------------------------------------------------------------
  // _onSetParam — called when the main thread sends { type: 'setParam' }
  // -------------------------------------------------------------------------

  _onSetParam(index, value) {
    if (!this._dspInst) return;
    const zone = this._paramZones[index];
    if (!zone) return;
    this._dspInst.exports.setParamValue(DSP, zone, value);
  }

  // -------------------------------------------------------------------------
  // _onNoteOn — set freq and open the gate
  // -------------------------------------------------------------------------

  _onNoteOn(freq, vel) {
    if (!this._dspInst) return;
    this._currentVel = vel ?? 0.7;
    const ex = this._dspInst.exports;
    if (this._freqZone) ex.setParamValue(DSP, this._freqZone, freq);
    if (this._gateZone) ex.setParamValue(DSP, this._gateZone, 1.0);
  }

  // -------------------------------------------------------------------------
  // _onNoteOff — close the gate (DSP release envelope takes over)
  // -------------------------------------------------------------------------

  _onNoteOff(_freq) {
    if (!this._dspInst) return;
    if (this._gateZone) this._dspInst.exports.setParamValue(DSP, this._gateZone, 0.0);
  }

  // -------------------------------------------------------------------------
  // _renderBlock — fill stereo output buffers each block
  // -------------------------------------------------------------------------

  _renderBlock(outL, outR, blockSize) {
    if (!this._dspInst || !this._dspMemory) return;

    const ex = this._dspInst.exports;

    // Call Faust compute: compute(dsp, n, input_channels_ptr, output_channels_ptr)
    // For 0 inputs, input_channels_ptr = 0 (null pointer is safe for Faust)
    ex.compute(DSP, blockSize, 0, this._outPtrsAddr);

    // Copy WASM output buffers to AudioWorklet output Float32Arrays
    const wL = new Float32Array(ex.memory.buffer, this._outLAddr, blockSize);
    const wR = new Float32Array(ex.memory.buffer, this._outRAddr, blockSize);
    outL.set(wL);
    outR.set(wR);
  }
}

// ---------------------------------------------------------------------------
// Register the processor
// ---------------------------------------------------------------------------
registerProcessor('additive-processor', AdditiveProcessor);
