// OSC output via WebSocket bridge
// Sends NISPS parameter values to a local WebSocket→OSC bridge script.
// Same throttle/dead-zone pattern as C15 ring buffer output.

import { SYNTH_PARAM_MAP } from './param-map.js';

const RECONNECT_INTERVAL = 3000;
const SEND_INTERVAL = 50;       // ~20fps max
const DEAD_ZONE = 0.002;        // ~0.2% change threshold

export class OSCOutput {
  constructor(url = 'ws://localhost:8765') {
    this._url = url;
    this._ws = null;
    this._connected = false;
    this._reconnectTimer = null;
    this._lastSent = new Float32Array(SYNTH_PARAM_MAP.length);
    this._lastSendTime = 0;
    this._onStatusChange = null;
    this._enabled = false;
  }

  set onStatusChange(fn) { this._onStatusChange = fn; }
  get connected() { return this._connected; }
  get enabled() { return this._enabled; }

  _status(msg) {
    console.log('[OSC]', msg);
    this._onStatusChange?.(msg, this._connected);
  }

  connect() {
    this._enabled = true;
    this._tryConnect();
  }

  disconnect() {
    this._enabled = false;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._connected = false;
    this._status('Disconnected');
  }

  _tryConnect() {
    if (!this._enabled) return;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }

    try {
      this._ws = new WebSocket(this._url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }

    this._ws.onopen = () => {
      this._connected = true;
      this._lastSent.fill(0);
      this._status('Connected');
    };

    this._ws.onclose = () => {
      this._connected = false;
      this._status('Disconnected');
      this._scheduleReconnect();
    };

    this._ws.onerror = () => {
      // onclose will fire after this
    };

    this._ws.onmessage = (e) => {
      // Bridge can send back info (e.g. target confirmation)
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'info') this._status(msg.message);
      } catch {}
    };
  }

  _scheduleReconnect() {
    if (!this._enabled || this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._tryConnect();
    }, RECONNECT_INTERVAL);
  }

  /** Send parameter values — same signature/timing as C15 output path */
  sendParams(overriddenValues) {
    if (!this._connected || !this._ws || this._ws.readyState !== WebSocket.OPEN) return;

    const now = performance.now();
    if (now - this._lastSendTime < SEND_INTERVAL) return;
    this._lastSendTime = now;

    // Build batch of changed params
    const batch = [];
    for (let i = 0; i < overriddenValues.length && i < SYNTH_PARAM_MAP.length; i++) {
      const v = overriddenValues[i];
      if (Math.abs(v - this._lastSent[i]) > DEAD_ZONE) {
        batch.push([SYNTH_PARAM_MAP[i].name, v]);
        this._lastSent[i] = v;
      }
    }

    if (batch.length > 0) {
      this._ws.send(JSON.stringify(batch));
    }
  }
}
