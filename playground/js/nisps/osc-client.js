// osc-client.js — WebSocket client for NISPS <-> OSC bridge
// Connects the webapp to VCV Rack MEMLNaut module (or any OSC target)
// via the bridge server (bridge.ts / bridge.mjs).
//
// Usage:
//   import { NispsOscClient } from './osc-client.js';
//   const osc = new NispsOscClient('ws://localhost:8765');
//   osc.onOutputsReceived(values => console.log('outputs:', values));
//   osc.onInputsReceived(values => console.log('inputs:', values));
//   await osc.connect();
//   osc.sendState(stateJson);

export class NispsOscClient extends EventTarget {
    /**
     * @param {string} wsUrl  WebSocket URL of the bridge server
     */
    constructor(wsUrl = 'ws://localhost:8765') {
        super();
        this._wsUrl = wsUrl;
        this._ws = null;
        this._connected = false;
        this._reconnect = false;
        this._reconnectDelay = 1000;
        this._reconnectTimer = null;

        // Registered callbacks
        this._outputsCallbacks = [];
        this._inputsCallbacks = [];
        this._infoCallbacks = [];
    }

    /** Current connection state */
    get connected() { return this._connected; }

    /** The WebSocket URL */
    get url() { return this._wsUrl; }
    set url(val) {
        if (this._connected) {
            this.disconnect();
        }
        this._wsUrl = val;
    }

    /**
     * Connect to the bridge server.
     * @param {object} [opts]
     * @param {boolean} [opts.reconnect=true]  Auto-reconnect on disconnect
     * @returns {Promise<void>}  Resolves when connected
     */
    connect({ reconnect = true } = {}) {
        this._reconnect = reconnect;

        return new Promise((resolve, reject) => {
            if (this._connected && this._ws) {
                resolve();
                return;
            }

            try {
                this._ws = new WebSocket(this._wsUrl);
            } catch (err) {
                reject(err);
                return;
            }

            this._ws.onopen = () => {
                this._connected = true;
                this._reconnectDelay = 1000; // reset backoff
                this.dispatchEvent(new CustomEvent('connected'));
                resolve();
            };

            this._ws.onclose = () => {
                const wasConnected = this._connected;
                this._connected = false;
                this._ws = null;
                this.dispatchEvent(new CustomEvent('disconnected'));

                if (this._reconnect) {
                    this._scheduleReconnect();
                }

                if (!wasConnected) {
                    reject(new Error('WebSocket closed before connecting'));
                }
            };

            this._ws.onerror = (e) => {
                this.dispatchEvent(new CustomEvent('error', { detail: e }));
            };

            this._ws.onmessage = (e) => {
                this._handleMessage(e.data);
            };
        });
    }

    /** Disconnect from the bridge. */
    disconnect() {
        this._reconnect = false;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        if (this._ws) {
            this._ws.onclose = null; // prevent reconnect trigger
            this._ws.close();
            this._ws = null;
        }
        this._connected = false;
        this.dispatchEvent(new CustomEvent('disconnected'));
    }

    // ── Send methods ─────────────────────────────────────────────────

    /**
     * Send full .nisps state JSON to the VCV module.
     * The module will call dataFromJson to apply it.
     * @param {object|string} stateJson
     */
    sendState(stateJson) {
        const payload = typeof stateJson === 'string' ? JSON.parse(stateJson) : stateJson;
        this._send({ type: 'state', payload });
    }

    /**
     * Send just weights to the VCV module.
     * @param {object} weightsObj  { weights: [[[...]]] }
     */
    sendWeights(weightsObj) {
        const payload = typeof weightsObj === 'string' ? JSON.parse(weightsObj) : weightsObj;
        this._send({ type: 'weights', payload });
    }

    /**
     * Send individual parameter updates (legacy format, for synth params).
     * @param {Array<[string, number]>} params  e.g. [["Env_A_Att", 0.35], ...]
     */
    sendParams(params) {
        this._send({ type: 'params', payload: params });
    }

    /**
     * Send a raw param batch in legacy format (backwards compatible).
     * @param {Array<[string, number]>} batch
     */
    sendParamBatch(batch) {
        this._send(batch);
    }

    // ── Receive handlers ─────────────────────────────────────────────

    /**
     * Register a callback for output values from VCV.
     * @param {function(number[]): void} callback
     * @returns {function} unsubscribe function
     */
    onOutputsReceived(callback) {
        this._outputsCallbacks.push(callback);
        return () => {
            const idx = this._outputsCallbacks.indexOf(callback);
            if (idx >= 0) this._outputsCallbacks.splice(idx, 1);
        };
    }

    /**
     * Register a callback for input values from VCV.
     * @param {function(number[]): void} callback
     * @returns {function} unsubscribe function
     */
    onInputsReceived(callback) {
        this._inputsCallbacks.push(callback);
        return () => {
            const idx = this._inputsCallbacks.indexOf(callback);
            if (idx >= 0) this._inputsCallbacks.splice(idx, 1);
        };
    }

    /**
     * Register a callback for bridge info messages.
     * @param {function(string): void} callback
     * @returns {function} unsubscribe function
     */
    onInfo(callback) {
        this._infoCallbacks.push(callback);
        return () => {
            const idx = this._infoCallbacks.indexOf(callback);
            if (idx >= 0) this._infoCallbacks.splice(idx, 1);
        };
    }

    // ── Internal ─────────────────────────────────────────────────────

    _send(data) {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
        this._ws.send(JSON.stringify(data));
    }

    _handleMessage(raw) {
        try {
            const msg = JSON.parse(raw);

            switch (msg.type) {
                case 'outputs':
                    for (const cb of this._outputsCallbacks) cb(msg.values);
                    this.dispatchEvent(new CustomEvent('outputs', { detail: msg.values }));
                    break;

                case 'inputs':
                    for (const cb of this._inputsCallbacks) cb(msg.values);
                    this.dispatchEvent(new CustomEvent('inputs', { detail: msg.values }));
                    break;

                case 'info':
                    for (const cb of this._infoCallbacks) cb(msg.message);
                    this.dispatchEvent(new CustomEvent('info', { detail: msg.message }));
                    break;

                case 'osc':
                    // Generic OSC message passthrough
                    this.dispatchEvent(new CustomEvent('osc', { detail: msg }));
                    break;
            }
        } catch {
            // ignore parse errors
        }
    }

    _scheduleReconnect() {
        if (this._reconnectTimer) return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            if (!this._connected && this._reconnect) {
                this.connect({ reconnect: true }).catch(() => {
                    // increase backoff, max 30s
                    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
                });
            }
        }, this._reconnectDelay);
    }
}
