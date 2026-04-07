/**
 * C15 Audio Engine - AudioWorklet Processor
 * 
 * This processor loads the C15 WASM module and calls render() each audio frame.
 * It runs in AudioWorkletGlobalScope and connects to the Web Audio graph with
 * 0 inputs and 2 outputs (stereo).
 * 
 * WASM API:
 *   - engineInit(sampleRate, polyphony) -> int
 *   - render(numFrames) -> float* (interleaved stereo)
 *   - noteOn(note, velocity)
 *   - noteOff(note, velocity)
 *   - setParameter(paramId, value)
 *   - reset()
 * 
 * Ring Buffer Protocol (SharedArrayBuffer):
 *   - Lock-free SPSC ring buffer for main thread -> worklet communication
 *   - Message types: 0=parameter, 1=noteOn, 2=noteOff
 *   - Message format: [type, id/note, value/velocity, reserved]
 * 
 * @file worklet-processor.js
 */

// WASM module state (shared across all processor instances)
let wasmInstance = null;
let wasmMemory = null;
let wasmReady = false;

// Ring buffer state
let ringBufferReader = null;

// Message type constants (must match ring-buffer.js)
const MessageType = {
    PARAMETER: 0,
    NOTE_ON: 1,
    NOTE_OFF: 2
};

/**
 * Ring buffer layout constants
 */
const HEADER_SIZE = 3;
const MESSAGE_SIZE = 4;
const RING_CAPACITY = 512;

/**
 * RingBufferReader - Reads messages from SharedArrayBuffer ring buffer
 * 
 * This is the consumer side of the SPSC ring buffer, designed for use
 * in the AudioWorklet's process() callback.
 * 
 * @class RingBufferReader
 */
class RingBufferReader {
    constructor(sharedBuffer) {
        this._buffer = new Float32Array(sharedBuffer);
        this._capacity = RING_CAPACITY;
        this._messageSize = MESSAGE_SIZE;
        this._headerSize = HEADER_SIZE;
    }
    
    /**
     * Get current write index (main thread updates this)
     * @private
     */
    _getWriteIndex() {
        return Atomics.load(new Int32Array(this._buffer.buffer), 0);
    }
    
    /**
     * Get current read index
     * @private
     */
    _getReadIndex() {
        return Atomics.load(new Int32Array(this._buffer.buffer), 1);
    }
    
    /**
     * Advance read index with atomic store
     * @private
     */
    _advanceReadIndex(currentIdx) {
        const nextIdx = (currentIdx + 1) % this._capacity;
        Atomics.store(new Int32Array(this._buffer.buffer), 1, nextIdx);
        return nextIdx;
    }
    
    /**
     * Read and process messages with callbacks
     * 
     * This is the preferred method for use in the AudioWorklet process() call.
     * It avoids creating arrays and directly calls the appropriate callback.
     * 
     * @param {Object} callbacks - Callback handlers
     * @param {Function} callbacks.onParameter - Called for parameter updates (paramId, value)
     * @param {Function} callbacks.onNoteOn - Called for note on events (note, velocity)
     * @param {Function} callbacks.onNoteOff - Called for note off events (note, velocity)
     * @param {number} maxMessages - Maximum messages to process per call
     * @returns {number} Number of messages processed
     */
    processMessages(callbacks, maxMessages = 32) {
        const writeIdx = this._getWriteIndex();
        let readIdx = this._getReadIndex();
        
        let count = 0;
        
        while (readIdx !== writeIdx && count < maxMessages) {
            // Read message from buffer
            const msgOffset = this._headerSize + (readIdx * this._messageSize);
            
            const type = this._buffer[msgOffset + 0];
            const id = this._buffer[msgOffset + 1];
            const value = this._buffer[msgOffset + 2];
            
            // Dispatch to callback based on type
            switch (type) {
                case MessageType.PARAMETER:
                    if (callbacks.onParameter) {
                        callbacks.onParameter(id, value);
                    }
                    break;
                    
                case MessageType.NOTE_ON:
                    if (callbacks.onNoteOn) {
                        callbacks.onNoteOn(id, value);
                    }
                    break;
                    
                case MessageType.NOTE_OFF:
                    if (callbacks.onNoteOff) {
                        callbacks.onNoteOff(id, value);
                    }
                    break;
                    
                default:
                    console.warn('[RingBufferReader] Unknown message type:', type);
            }
            
            // Advance read index
            readIdx = this._advanceReadIndex(readIdx);
            count++;
        }
        
        return count;
    }
    
    /**
     * Get number of available messages (for debugging/monitoring)
     */
    getAvailableCount() {
        const writeIdx = this._getWriteIndex();
        const readIdx = this._getReadIndex();
        
        if (writeIdx >= readIdx) {
            return writeIdx - readIdx;
        } else {
            return this._capacity - readIdx + writeIdx;
        }
    }
}

/**
 * Initialize WASM module from compiled WebAssembly.Module and memory
 * This is called when the main thread sends the 'init-wasm' message
 */
function initWasmFromModule(wasmModule, memory) {
    return WebAssembly.instantiate(wasmModule, {
        // Import object - Emscripten typically uses 'a' for the main import namespace
        a: {
            // Memory import if needed
            d: () => { throw new Error('abort'); },
            b: () => 1, // nowIsMonotonic
            a: () => performance.now(), // _emscripten_get_now
            c: (size) => { // _emscripten_resize_heap - not typically needed with fixed memory
                return 0;
            }
        }
    }).then(instance => {
        wasmInstance = instance;
        wasmMemory = memory;
        wasmReady = true;
        
        // Call the constructors
        if (instance.exports.f) {
            instance.exports.f();
        }
        
        return true;
    });
}

/**
 * C15Processor - AudioWorklet processor for the C15 synth engine
 * 
 * Fulfills validation assertions:
 * - VAL-M2-001: WASM module loads in AudioWorkletGlobalScope
 * - VAL-M2-002: registerProcessor() succeeds with 0 inputs, 2 outputs
 * - VAL-M2-003: AudioWorkletNode connects to AudioContext destination
 * - VAL-M2-004: WASM render produces valid stereo float32 output
 * - VAL-M2-005: Ring buffer enables lock-free parameter updates without corruption
 * - VAL-M2-006: Note on/off via ring buffer triggers audio start/release
 * 
 * NOTE: WebAssembly.Module cannot be sent via MessagePort.postMessage() in Chrome.
 * The WASM module must be passed via processorOptions in the AudioWorkletNode constructor.
 * See: https://issues.chromium.org/issues/40855462
 */
class C15Processor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        
        // Processor configuration
        this._initialized = false;
        this._sampleRate = 48000;
        this._polyphony = 24;
        this._bufferSize = 128;
        
        // Default configuration
        const processorOptions = options.processorOptions || {};
        this._sampleRate = processorOptions.sampleRate || 48000;
        this._polyphony = processorOptions.polyphony || 24;
        
        // Listen for messages from main thread
        this.port.onmessage = this._handleMessage.bind(this);
        
        // Debug: verify message handler is bound
        this.port.postMessage({ type: 'status', status: 'handler-bound', test: true });
        
        // Log that processor was created
        this._postStatus('created', {
            sampleRate: this._sampleRate,
            polyphony: this._polyphony
        });
        
        // Initialize WASM from processorOptions if provided
        // Chrome requires this approach - WebAssembly.Module cannot be sent via postMessage
        // See: https://issues.chromium.org/issues/40855462
        if (processorOptions.wasmModule instanceof WebAssembly.Module) {
            this._postStatus('wasm-module-received-via-options', { 
                hasModule: true,
                moduleType: 'WebAssembly.Module'
            });
            // Initialize WASM asynchronously
            this._initFromWasmModule(processorOptions.wasmModule, null);
        } else if (processorOptions.wasmModule) {
            this._postError(new Error('wasmModule in processorOptions is not a WebAssembly.Module'), 'constructor');
        } else {
            this._postStatus('no-wasm-in-options', { 
                hint: 'WASM module should be passed via processorOptions.wasmModule'
            });
        }
        
        // Initialize ring buffer if provided
        if (processorOptions.ringBuffer) {
            ringBufferReader = new RingBufferReader(processorOptions.ringBuffer);
            this._postStatus('ring-buffer-ready', { 
                hasRingBuffer: true,
                capacity: RING_CAPACITY 
            });
        }
    }
    
    /**
     * Post status message to main thread
     * @private
     */
    _postStatus(status, data = {}) {
        this.port.postMessage({
            type: 'status',
            status: status,
            ...data
        });
    }
    
    /**
     * Post error message to main thread
     * @private
     */
    _postError(error, context = '') {
        this.port.postMessage({
            type: 'error',
            error: error.toString(),
            context: context
        });
    }
    
    /**
     * Handle messages from main thread
     * @private
     */
    _handleMessage(event) {
        const data = event.data;  // event.data contains the message
        
        // Debug log all messages (except high-frequency ones)
        if (data.type !== 'setParameter' && data.type !== 'tick') {
            this._postStatus('message-received', { msgType: data.type });
        }
        
        switch (data.type) {
            case 'test':
                this._postStatus('test-received', { value: data.value });
                break;
            
            case 'init-wasm':
                // Initialize WASM from compiled module sent by main thread
                // NOTE: This may not work in Chrome due to cross-origin issues
                // See: https://issues.chromium.org/issues/40855462
                // The WASM module should be passed via processorOptions instead
                if (this._initialized) {
                    this._postStatus('wasm-already-initialized', { 
                        hint: 'WASM was already initialized via processorOptions'
                    });
                    return;
                }
                
                // Check if wasmModule is valid
                if (!data.wasmModule) {
                    this._postError(new Error('No wasmModule in init-wasm message'), 'init-wasm');
                    return;
                }
                
                if (!(data.wasmModule instanceof WebAssembly.Module)) {
                    this._postError(new Error('wasmModule is not a WebAssembly.Module: ' + typeof data.wasmModule), 'init-wasm');
                    return;
                }
                
                this._postStatus('starting-wasm-init', { 
                    hasModule: true,
                    moduleType: 'WebAssembly.Module',
                    note: 'Using postMessage (may fail in Chrome)'
                });
                this._initFromWasmModule(data.wasmModule, data.memory);
                break;
                
            case 'init-ring-buffer':
                // Initialize ring buffer from SharedArrayBuffer sent by main thread
                if (this._initialized && ringBufferReader) {
                    this._postStatus('ring-buffer-already-initialized', { 
                        hint: 'Ring buffer was already initialized via processorOptions'
                    });
                    return;
                }
                
                if (data.ringBuffer) {
                    ringBufferReader = new RingBufferReader(data.ringBuffer);
                    this._postStatus('ring-buffer-ready', { 
                        hasRingBuffer: true,
                        capacity: RING_CAPACITY 
                    });
                } else {
                    this._postError(new Error('No SharedArrayBuffer provided'), 'ring buffer init');
                }
                break;
                
            case 'noteOn':
                if (this._initialized && wasmInstance) {
                    wasmInstance.exports.o(data.note, data.velocity);  // _noteOn
                }
                break;

            case 'noteOff':
                if (this._initialized && wasmInstance) {
                    wasmInstance.exports.p(data.note, data.velocity);  // _noteOff
                }
                break;

            case 'setParameter':
                if (this._initialized && wasmInstance) {
                    wasmInstance.exports.q(data.paramId, data.value);  // _setParameter
                }
                break;

            case 'reset':
                if (this._initialized && wasmInstance) {
                    wasmInstance.exports.t();  // _reset
                }
                break;
                
            case 'getConfig':
                this._postStatus('config', {
                    sampleRate: this._sampleRate,
                    polyphony: this._polyphony,
                    initialized: this._initialized
                });
                break;
                
            default:
                console.warn('[C15Processor] Unknown message type:', data.type);
        }
    }
    
    /**
     * Initialize from pre-compiled WASM module
     * @private
     */
    async _initFromWasmModule(wasmModule, memory) {
        try {
            this._postStatus('loading');

            // Lazy reference to WASM memory — needed by _clock_time_get before we can
            // assign wasmMemory (which only exists after WebAssembly.instantiate returns).
            const memRef = [null];

            // Define the WASM imports matching Emscripten's expected structure.
            // Mapping (namespace 'a') as of the current build:
            //   a -> _emscripten_get_now
            //   b -> _proc_exit
            //   c -> __emscripten_runtime_keepalive_clear
            //   d -> __setitimer_js
            //   e -> _clock_time_get  (WASI clock; writes i64 nanoseconds into WASM heap)
            //   f -> _emscripten_resize_heap
            //   g -> __abort_js
            const imports = {
                a: {
                    a: () => performance.now(),
                    b: (code) => { throw new Error('WASM exit: ' + code); },
                    c: () => {},
                    d: (_which, _timeout_ms) => 0,
                    e: (clk_id, _ignored_precision, ptime) => {
                        const now = clk_id === 0 ? Date.now() : performance.now();
                        const nsec = BigInt(Math.round(now * 1e6));
                        if (memRef[0]) {
                            new BigInt64Array(memRef[0].buffer)[ptime >> 3] = nsec;
                        }
                        return 0;
                    },
                    f: (requestedSize) => {
                        console.warn('[C15Processor] Heap resize requested but not supported');
                        return 0;
                    },
                    g: () => { throw new Error('WASM abort called'); }
                }
            };

            // Instantiate the compiled module
            const instance = await WebAssembly.instantiate(wasmModule, imports);

            wasmInstance = instance;

            // Get memory from exports (export 'h' is memory)
            wasmMemory = instance.exports.h;
            memRef[0] = wasmMemory;

            // Call runtime init (export 'i' is initRuntime/__wasm_call_ctors)
            if (instance.exports.i) {
                instance.exports.i();
            }

            // Initialize the engine (export 'j' is _engineInit)
            const initResult = instance.exports.j(this._sampleRate, this._polyphony);

            if (initResult !== 1) {
                throw new Error('engineInit failed with result: ' + initResult);
            }

            this._initialized = true;
            wasmReady = true;

            // Get the default frames per render call (export 'v' is _getDefaultFrames)
            this._bufferSize = instance.exports.v();
            
            this._postStatus('ready', {
                sampleRate: this._sampleRate,
                polyphony: this._polyphony,
                bufferSize: this._bufferSize
            });
            
        } catch (error) {
            this._postError(error, 'WASM load/init');
            console.error('[C15Processor] Failed to init WASM:', error);
        }
    }
    
    /**
     * Process audio frames
     * 
     * Called by the browser for each audio render quantum (typically 128 frames).
     * 
     * VAL-M2-005: Processes ring buffer messages lock-free from main thread
     * VAL-M2-006: Note on/off via ring buffer triggers audio
     * 
     * @param {Float32Array[][]} inputs - Input audio buffers (unused)
     * @param {Float32Array[][]} outputs - Output audio buffers (stereo)
     * @param {Object} parameters - Automatable parameters (unused)
     * @returns {boolean} - True to keep processor alive
     */
    process(inputs, outputs, parameters) {
        const output = outputs[0];
        
        if (!output || output.length < 2) {
            return true; // Keep alive but no output
        }
        
        const leftChannel = output[0];
        const rightChannel = output[1];
        const numFrames = leftChannel.length;
        
        // If not initialized, output silence
        if (!this._initialized || !wasmInstance) {
            for (let i = 0; i < numFrames; i++) {
                leftChannel[i] = 0;
                rightChannel[i] = 0;
            }
            return true;
        }
        
        // Process ring buffer messages first (VAL-M2-005, VAL-M2-006)
        if (ringBufferReader) {
            ringBufferReader.processMessages({
                onParameter: (paramId, value) => {
                    wasmInstance.exports.q(paramId, value);  // _setParameter
                },
                onNoteOn: (note, velocity) => {
                    this._dbgNoteOns = (this._dbgNoteOns || 0) + 1;
                    wasmInstance.exports.o(note, velocity);  // _noteOn
                },
                onNoteOff: (note, velocity) => {
                    wasmInstance.exports.p(note, velocity);  // _noteOff
                }
            }, 64);  // Process up to 64 messages per audio frame
        }

        // Cache HEAPF32 view (recreate if memory grew)
        if (!this._heapF32 || this._heapF32.buffer !== wasmMemory.buffer) {
            this._heapF32 = new Float32Array(wasmMemory.buffer);
        }

        try {
            // Render audio using WASM
            // export 'm' is _render - returns pointer to interleaved stereo buffer
            const bufferPtr = wasmInstance.exports.m(numFrames);

            if (!bufferPtr) {
                // Render failed, output silence
                for (let i = 0; i < numFrames; i++) {
                    leftChannel[i] = 0;
                    rightChannel[i] = 0;
                }
                return true;
            }

            const heapF32 = this._heapF32;
            const bufferOffset = bufferPtr >> 2; // Convert byte offset to float32 index

            // Deinterleave stereo data from WASM buffer to output channels
            let frameMax = 0;
            for (let i = 0; i < numFrames; i++) {
                const sampleIndex = bufferOffset + (i * 2);
                const l = heapF32[sampleIndex];
                const r = heapF32[sampleIndex + 1];
                leftChannel[i] = l;
                rightChannel[i] = r;
                const v = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r);
                if (v > frameMax) frameMax = v;
            }

            // Periodic diagnostics (every ~2 seconds = 750 frames at 128 frames/quantum)
            this._dbgFrameCount = (this._dbgFrameCount || 0) + 1;
            this._dbgMaxSample = Math.max(this._dbgMaxSample || 0, frameMax);
            if (this._dbgFrameCount % 750 === 0) {
                this.port.postMessage({
                    type: 'diag',
                    frames: this._dbgFrameCount,
                    maxSample: this._dbgMaxSample,
                    noteOns: this._dbgNoteOns || 0
                });
                this._dbgMaxSample = 0;
            }

        } catch (error) {
            // On error, output silence
            console.error('[C15Processor] Render error:', error);
            for (let i = 0; i < numFrames; i++) {
                leftChannel[i] = 0;
                rightChannel[i] = 0;
            }
        }
        
        return true; // Keep processor alive
    }
    
    /**
     * Static getter for parameter descriptors (for automatable parameters)
     * Currently not used but required for proper AudioWorklet interface.
     */
    static get parameterDescriptors() {
        return [];
    }
}

// Register the processor with the AudioWorkletGlobalScope
// VAL-M2-002: This registration must succeed for the processor to be usable
registerProcessor('c15-processor', C15Processor);
