/**
 * NispsOscClient — WebSocket transport to the Deno OSC bridge (osc-bridge/
 * bridge.ts). Ported cleanly to TS from the deployed
 * `js/nisps/osc-client.js`; the bridge does the actual OSC encode/UDP send, so
 * this client speaks the bridge's JSON protocol:
 *
 *   browser → bridge:
 *     { type: 'params', payload: [[name, value], ...] }   (per-param floats)
 *     { type: 'state',  payload: <JSON> }                  (full state)
 *     { type: 'weights',payload: <JSON> }                  (weights only)
 *   bridge → browser:
 *     { type: 'outputs', values: [...] }
 *     { type: 'inputs',  values: [...] }
 *     { type: 'info',    message: '...' }
 *
 * Auto-reconnect with backoff; the bridge process must be running locally
 * (default ws://localhost:8765).
 */

export type OscParamBatch = ReadonlyArray<readonly [string, number]>;

export class NispsOscClient {
  private wsUrl: string;
  private ws: WebSocket | null = null;
  private connected_ = false;
  private reconnect = false;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private outputsCbs: Array<(v: number[]) => void> = [];
  private inputsCbs: Array<(v: number[]) => void> = [];
  private infoCbs: Array<(m: string) => void> = [];
  private stateCbs: Array<(connected: boolean) => void> = [];

  constructor(wsUrl = 'ws://localhost:8765') {
    this.wsUrl = wsUrl;
  }

  get connected(): boolean {
    return this.connected_;
  }

  get url(): string {
    return this.wsUrl;
  }

  setUrl(url: string): void {
    if (this.connected_) this.disconnect();
    this.wsUrl = url;
  }

  connect({ reconnect = true } = {}): Promise<void> {
    this.reconnect = reconnect;
    return new Promise((resolve, reject) => {
      if (this.connected_ && this.ws) {
        resolve();
        return;
      }
      if (typeof WebSocket === 'undefined') {
        reject(new Error('WebSocket not available'));
        return;
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (err) {
        reject(err as Error);
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.connected_ = true;
        this.reconnectDelay = 1000;
        this.emitState();
        resolve();
      };
      ws.onclose = () => {
        const wasConnected = this.connected_;
        this.connected_ = false;
        this.ws = null;
        this.emitState();
        if (this.reconnect) this.scheduleReconnect();
        if (!wasConnected) reject(new Error('WebSocket closed before connecting'));
      };
      ws.onerror = () => {
        /* surfaced via onclose */
      };
      ws.onmessage = (e) => this.handleMessage(e.data as string);
    });
  }

  disconnect(): void {
    this.reconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.connected_ = false;
    this.emitState();
  }

  // ── Send ───────────────────────────────────────────────────────────
  sendParams(params: OscParamBatch): void {
    this.send({ type: 'params', payload: params });
  }

  sendState(stateJson: object | string): void {
    const payload = typeof stateJson === 'string' ? JSON.parse(stateJson) : stateJson;
    this.send({ type: 'state', payload });
  }

  sendWeights(weightsObj: object | string): void {
    const payload = typeof weightsObj === 'string' ? JSON.parse(weightsObj) : weightsObj;
    this.send({ type: 'weights', payload });
  }

  /**
   * Send the current input VECTOR as ONE multi-float OSC message to
   * `<prefix>/input` (the bridge `input` verb). Used in VCV bridged mode so the
   * browser drives the module's inputs. Distinct from `sendParams` (which emits
   * one single-float message per entry).
   */
  sendInput(values: ReadonlyArray<number>): void {
    this.send({ type: 'input', payload: Array.from(values) });
  }

  /**
   * Send a verdict op as a JSON string to `<prefix>/feedback` (the bridge
   * `feedback` verb). Trains the VCV module's embedded learner over the bridge.
   */
  sendFeedback(op: object): void {
    this.send({ type: 'feedback', payload: op });
  }

  // ── Receive ────────────────────────────────────────────────────────
  onOutputsReceived(cb: (v: number[]) => void): () => void {
    this.outputsCbs.push(cb);
    return () => this.removeCb(this.outputsCbs, cb);
  }

  onInputsReceived(cb: (v: number[]) => void): () => void {
    this.inputsCbs.push(cb);
    return () => this.removeCb(this.inputsCbs, cb);
  }

  onInfo(cb: (m: string) => void): () => void {
    this.infoCbs.push(cb);
    return () => this.removeCb(this.infoCbs, cb);
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.stateCbs.push(cb);
    return () => this.removeCb(this.stateCbs, cb);
  }

  // ── Internal ───────────────────────────────────────────────────────
  private send(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(data));
  }

  private handleMessage(raw: string): void {
    let msg: { type?: string; values?: number[]; message?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'outputs':
        if (msg.values) for (const cb of this.outputsCbs) cb(msg.values);
        break;
      case 'inputs':
        if (msg.values) for (const cb of this.inputsCbs) cb(msg.values);
        break;
      case 'info':
        if (msg.message) for (const cb of this.infoCbs) cb(msg.message);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.connected_ && this.reconnect) {
        this.connect({ reconnect: true }).catch(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
        });
      }
    }, this.reconnectDelay);
  }

  private emitState(): void {
    for (const cb of this.stateCbs) cb(this.connected_);
  }

  private removeCb<T>(arr: T[], cb: T): void {
    const i = arr.indexOf(cb);
    if (i >= 0) arr.splice(i, 1);
  }
}
