// useq-celium-mode.js — Main orchestration module for uSEQ Celium output mode
// Wires two MLPs (rhythm + CV), RatioSeq engine, output router, and WebSerial driver.

import { WasmIML } from '../nisps/nisps-wasm.js';
import { GamepadInput } from '../ui/gamepad.js';
import { RatioSeqEngine } from './ratio-seq.js';
import { OutputRouter } from './output-router.js';
import { UseqSerialDriver } from './webserial-driver.js';

const PARAMS_PER_SEQUENCE = 8;
const DEFAULT_BPM = 120;
const DEFAULT_SPREAD = 0.6;

// RL noise parameters
const RL_SPEED_UP = 0.02;
const RL_SPEED_DOWN = 0.08;

export class UseqCeliumMode {
  constructor() {
    this._rhythmMLP = null;
    this._cvMLP = null;
    this._ratioSeqEngine = null;
    this._outputRouter = null;
    this._serialDriver = null;
    this._gamepadLeft = null;
    this._gamepadRight = null;

    this._rhythmInputs = [0.5, 0.5];
    this._cvInputs = [0.5, 0.5];
    this._lastLeftMoveTime = 0;
    this._lastRightMoveTime = 0;

    this._active = false;
    this._tickWorker = null;
    this._spread = DEFAULT_SPREAD;
    this._bpm = DEFAULT_BPM;

    // Cached state for getState()
    this._rhythmOutputs = null;
    this._cvOutputs = null;
    this._gateStates = [];

    this._routingChangeUnsub = null;
    this._rebuildPending = false;

    // Manual overrides from bar interaction (sparse: index → value)
    this._manualOverrides = new Map();
  }

  async init(hiddenLayerOverrides = null) {
    // Create output router first — it determines MLP architectures
    this._outputRouter = new OutputRouter();
    this._ratioSeqEngine = new RatioSeqEngine({ bpm: this._bpm });
    this._serialDriver = new UseqSerialDriver();

    // Create MLPs based on current routing
    await this._createMLPs(hiddenLayerOverrides);

    // Listen for routing changes to rebuild MLPs
    this._routingChangeUnsub = this._outputRouter.onChange(async () => {
      await this._rebuildMLPs();
      // Send new config bitmask to hardware
      this._serialDriver.sendConfig(this._outputRouter.getModeBitmask());
    });

    // Create gamepad inputs for both sticks
    this._gamepadLeft = new GamepadInput({
      onMove: (x, y) => {
        this._rhythmInputs = [x, y];
        this._lastLeftMoveTime = performance.now();
      },
      axisX: 0,
      axisY: 1,
      deadzone: 0.08,
    });

    this._gamepadRight = new GamepadInput({
      onMove: (x, y) => {
        this._cvInputs = [x, y];
        this._lastRightMoveTime = performance.now();
      },
      axisX: 2,
      axisY: 3,
      deadzone: 0.08,
    });
  }

  activate() {
    if (this._active) return;
    this._active = true;
    this._startTickWorker();
    if (this._serialDriver.connected) {
      this._serialDriver.startStreaming();
    }
  }

  deactivate() {
    if (!this._active) return;
    this._active = false;
    this._stopTickWorker();
    this._serialDriver.stopStreaming();
  }

  tick() {
    if (!this._rhythmMLP || !this._cvMLP) return;

    // 1. Poll gamepad
    this._gamepadLeft.poll();
    this._gamepadRight.poll();

    // 2. Run rhythm MLP inference
    this._rhythmMLP.setInputs(this._rhythmInputs);
    this._rhythmMLP.process();
    this._rhythmOutputs = this._rhythmMLP.getOutputs();

    // 3. Run CV MLP inference
    this._cvMLP.setInputs(this._cvInputs);
    this._cvMLP.process();
    this._cvOutputs = this._cvMLP.getOutputs();

    // 4. Unpack rhythm MLP outputs into per-sequence params
    const numSeqs = this._outputRouter.numSequences;
    for (let i = 0; i < numSeqs; i++) {
      const base = i * PARAMS_PER_SEQUENCE;
      this._ratioSeqEngine.setSequenceParams(i, {
        ratios: [
          this._rhythmOutputs[base + 0],
          this._rhythmOutputs[base + 1],
          this._rhythmOutputs[base + 2],
        ],
        phasorMul: this._rhythmOutputs[base + 3],
        phaseOffset: this._rhythmOutputs[base + 4],
        pulseWidth: this._rhythmOutputs[base + 5],
        ampRatios: [
          this._rhythmOutputs[base + 6],
          this._rhythmOutputs[base + 7],
        ],
      });
    }

    // 5. Tick RatioSeq
    this._gateStates = this._ratioSeqEngine.tick(performance.now() / 1000);

    // 6. Route outputs
    const outputValues = this._outputRouter.routeOutputs(
      this._rhythmOutputs,
      this._cvOutputs,
      this._gateStates
    );

    // 7. Send to hardware
    this._serialDriver.setOutputValues(outputValues);
  }

  // --- WebSerial ---

  async connectSerial() {
    const success = await this._serialDriver.connect();
    if (success) {
      // Send current config bitmask
      await this._serialDriver.sendConfig(this._outputRouter.getModeBitmask());
      if (this._active) {
        this._serialDriver.startStreaming();
      }
      // Request LED identify sweep and wait for ack
      const identified = await this._serialDriver.sendIdentify();
      if (identified) {
        console.log('%c[uSEQ] Hardware identified — LED sweep confirmed', 'color:#4ade80');
      }
      return identified ? 'identified' : true;
    }
    return false;
  }

  async disconnectSerial() {
    await this._serialDriver.disconnect();
  }

  get serialConnected() {
    return this._serialDriver.connected;
  }

  // --- Virtual joystick inputs ---

  setRhythmInputs(x, y) {
    this._rhythmInputs = [x, y];
    this._lastLeftMoveTime = performance.now();
  }

  setCvInputs(x, y) {
    this._cvInputs = [x, y];
    this._lastRightMoveTime = performance.now();
  }

  // --- BPM ---

  setBpm(bpm) {
    this._bpm = bpm;
    this._ratioSeqEngine.setBpm(bpm);
  }

  getBpm() {
    return this._bpm;
  }

  // --- Output routing ---

  setOutputMode(outputId, mode) {
    this._outputRouter.setOutputMode(outputId, mode);
  }

  getRouting() {
    return this._outputRouter.getRouting();
  }

  // --- Param meta for visualizer ---

  getParamMeta() {
    return this._outputRouter.getParamMeta();
  }

  getCombinedOutputs() {
    if (!this._rhythmOutputs || !this._cvOutputs) return [];
    const combined = [...this._rhythmOutputs, ...this._cvOutputs];
    for (const [idx, val] of this._manualOverrides) {
      if (idx < combined.length) combined[idx] = val;
    }
    return combined;
  }

  setManualOverride(index, value) {
    this._manualOverrides.set(index, value);
  }

  clearManualOverrides() {
    this._manualOverrides.clear();
  }

  // --- Training controls ---

  setSpread(spread) {
    this._spread = Math.max(0, Math.min(1, spread));
  }

  saveExample() {
    // Detect which stick was most recently active
    if (this._lastLeftMoveTime >= this._lastRightMoveTime) {
      // Save rhythm example
      if (this._rhythmMLP && this._rhythmOutputs) {
        this._rhythmMLP.addExample(
          [...this._rhythmInputs],
          [...this._rhythmOutputs]
        );
        this._rhythmMLP.trainAsync();
      }
    } else {
      // Save CV example
      if (this._cvMLP && this._cvOutputs) {
        this._cvMLP.addExample(
          [...this._cvInputs],
          [...this._cvOutputs]
        );
        this._cvMLP.trainAsync();
      }
    }
  }

  thumbsUp() {
    // Reward: small perturbation, both MLPs
    if (this._rhythmMLP) {
      this._rhythmMLP.moveWeights(RL_SPEED_UP, this._spread);
    }
    if (this._cvMLP) {
      this._cvMLP.moveWeights(RL_SPEED_UP, this._spread);
    }
  }

  thumbsDown() {
    // Punish: larger perturbation, both MLPs
    if (this._rhythmMLP) {
      this._rhythmMLP.moveWeights(RL_SPEED_DOWN, this._spread);
    }
    if (this._cvMLP) {
      this._cvMLP.moveWeights(RL_SPEED_DOWN, this._spread);
    }
  }

  randomiseWeights() {
    if (this._rhythmMLP) {
      this._rhythmMLP.randomiseWeights(this._spread);
    }
    if (this._cvMLP) {
      this._cvMLP.randomiseWeights(this._spread);
    }
  }

  // --- State ---

  getState() {
    return {
      rhythmOutputs: this._rhythmOutputs ? [...this._rhythmOutputs] : null,
      cvOutputs: this._cvOutputs ? [...this._cvOutputs] : null,
      gateStates: this._gateStates,
      barPhase: this._ratioSeqEngine ? this._ratioSeqEngine.getBarPhase() : 0,
      serialConnected: this._serialDriver ? this._serialDriver.connected : false,
      routing: this._outputRouter ? this._outputRouter.getRouting() : null,
      bpm: this._bpm,
      inputs: {
        leftX: this._rhythmInputs[0],
        leftY: this._rhythmInputs[1],
        rightX: this._cvInputs[0],
        rightY: this._cvInputs[1],
      },
    };
  }

  // --- Cleanup ---

  destroy() {
    this.deactivate();

    if (this._routingChangeUnsub) {
      this._routingChangeUnsub();
      this._routingChangeUnsub = null;
    }

    if (this._gamepadLeft) {
      this._gamepadLeft.destroy();
      this._gamepadLeft = null;
    }
    if (this._gamepadRight) {
      this._gamepadRight.destroy();
      this._gamepadRight = null;
    }

    if (this._rhythmMLP) {
      this._rhythmMLP.destroy();
      this._rhythmMLP = null;
    }
    if (this._cvMLP) {
      this._cvMLP.destroy();
      this._cvMLP = null;
    }

    if (this._serialDriver) {
      this._serialDriver.disconnect();
      this._serialDriver = null;
    }

    this._ratioSeqEngine = null;
    this._outputRouter = null;
  }

  // --- Private ---


  async _createMLPs(hiddenLayerOverrides = null) {
    const archs = this._outputRouter.getMlpArchitectures();

    const rhythmHidden = hiddenLayerOverrides?.rhythm || archs.rhythm.hiddenLayers;
    const cvHidden = hiddenLayerOverrides?.cv || archs.cv.hiddenLayers;

    this._rhythmMLP = await WasmIML.create(
      archs.rhythm.inputs,
      archs.rhythm.outputs,
      rhythmHidden
    );
    this._rhythmMLP.randomiseWeights(this._spread);

    this._cvMLP = await WasmIML.create(
      archs.cv.inputs,
      archs.cv.outputs,
      cvHidden
    );
    this._cvMLP.randomiseWeights(this._spread);

    // Update RatioSeq engine sequence count
    this._ratioSeqEngine.setNumSequences(this._outputRouter.numSequences);
  }

  async _rebuildMLPs() {
    if (this._rebuildPending) return;
    this._rebuildPending = true;

    if (this._rhythmMLP) {
      this._rhythmMLP.destroy();
      this._rhythmMLP = null;
    }
    if (this._cvMLP) {
      this._cvMLP.destroy();
      this._cvMLP = null;
    }

    await this._createMLPs();
    this._rebuildPending = false;
  }

  _startTickWorker() {
    if (this._tickWorker) return;
    const blob = new Blob([
      'let iv=null;onmessage=e=>{if(e.data==="start"){iv=setInterval(()=>postMessage(0),33)}else{clearInterval(iv);iv=null}}'
    ], { type: 'application/javascript' });
    this._tickWorker = new Worker(URL.createObjectURL(blob));
    this._tickWorker.onmessage = () => this.tick();
    this._tickWorker.postMessage('start');
  }

  _stopTickWorker() {
    if (!this._tickWorker) return;
    this._tickWorker.postMessage('stop');
    this._tickWorker.terminate();
    this._tickWorker = null;
  }
}
