/**
 * HandTracker — TypeScript port of playground/js/ui/hand-tracker.js
 *
 * Extracts 14 derived features from the right hand and recognises
 * hold-to-confirm gestures on the left hand.
 *
 * MediaPipe is loaded dynamically from CDN so it is never bundled.
 * All public configuration is available via HandTrackingController.
 */

// ─── MediaPipe landmark indices ──────────────────────────────────────────────

const WRIST = 0;
const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8;
const MIDDLE_MCP = 9; // MIDDLE_PIP=10, MIDDLE_DIP=11
const MIDDLE_TIP = 12;
const RING_MCP = 13; // RING_PIP=14, RING_DIP=15
const RING_TIP = 16;
const PINKY_MCP = 17; // PINKY_PIP=18, PINKY_DIP=19
const PINKY_TIP = 20;

const FINGER_LANDMARKS = [
  [THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP],
  [INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP],
  [MIDDLE_MCP, 10, 11, MIDDLE_TIP],
  [RING_MCP, 14, 15, RING_TIP],
  [PINKY_MCP, 18, 19, PINKY_TIP],
] as const;

const FINGER_TIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP] as const;
const FINGER_MCPS = [THUMB_MCP, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single 3-D landmark as returned by MediaPipe HandLandmarker. */
interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** Subset of HandLandmarkerResult that we consume. */
interface HandLandmarkerResult {
  handednesses?: Array<Array<{ categoryName: string }>>;
  landmarks?: Landmark[][];
  worldLandmarks?: Landmark[][];
}

/** Tuning parameters, all runtime-adjustable via setOptions(). */
export interface HandTrackerOptions {
  /** Minimum confidence for initial hand detection (default 0.5). */
  minHandDetectionConfidence: number;
  /** Minimum confidence for hand presence tracking (default 0.5). */
  minHandPresenceConfidence: number;
  /** Minimum tracking confidence (default 0.5). */
  minTrackingConfidence: number;
  /** Exponential smoothing factor [0,1] — higher means more responsive (default 0.4). */
  smoothingFactor: number;
  /** How long a gesture must be held before firing, in ms (default 400). */
  gestureHoldMs: number;
  /** Use world landmarks (metres, hand-centric) instead of normalised image coords. */
  useWorldLandmarks: boolean;
}

export const HAND_TRACKER_DEFAULTS: HandTrackerOptions = {
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  smoothingFactor: 0.4,
  gestureHoldMs: 400,
  useWorldLandmarks: false,
};

/** Public interface exposed by HandTracker (satisfies HandTrackingController). */
export interface HandTrackingController {
  start(): Promise<void>;
  stop(): void;
  isActive(): boolean;
  getFeatures(): number[];
  setSmoothing(factor: number): void;
}

// ─── HandTracker ──────────────────────────────────────────────────────────────

export interface HandTrackerInit {
  /** Called with 14 normalised features [0,1] from the right (tracking) hand. */
  onTrackingInput?: (features: number[]) => void;
  /** Called when a left-hand gesture is confirmed. */
  onPositiveFeedback?: () => void;
  /** Called when a left-hand negative gesture is confirmed. */
  onNegativeFeedback?: () => void;
  /** Called when the tracking connection state changes. */
  onConnectionChange?: (active: boolean) => void;
  /** Video element that will display the camera feed. */
  videoElement: HTMLVideoElement;
  /** Optional canvas for skeleton overlay drawing. */
  overlayCanvas?: HTMLCanvasElement;
  /** Initial options (falls back to HAND_TRACKER_DEFAULTS). */
  options?: Partial<HandTrackerOptions>;
}

export class HandTracker implements HandTrackingController {
  private readonly onTrackingInput: (features: number[]) => void;
  private readonly onPositiveFeedback: () => void;
  private readonly onNegativeFeedback: () => void;
  private readonly onConnectionChange: ((active: boolean) => void) | null;
  private readonly videoElement: HTMLVideoElement;
  private readonly overlayCanvas: HTMLCanvasElement | null;
  private readonly overlayCtx: CanvasRenderingContext2D | null;

  private _active = false;
  private _features: number[] = new Array(14).fill(0.5);
  private _smoothedFeatures: number[] = new Array(14).fill(0.5);

  // MediaPipe handle (any — loaded dynamically, no bundled types)
  private _handLandmarker: any = null;
  private _stream: MediaStream | null = null;
  private _rafId: number | null = null;
  private _lastDetectTime = 0;
  private _minDetectInterval = 33; // ~30 fps

  // Tuning
  opts: HandTrackerOptions;

  // Gesture state
  private _gestureCandidate: 'positive' | 'negative' | null = null;
  private _gestureStartTime = 0;
  private _gestureProgress = 0;
  private _lastGestureFired = 0;

  // Status
  private _trackingRight = false;
  private _trackingLeft = false;

  constructor(init: HandTrackerInit) {
    this.onTrackingInput = init.onTrackingInput ?? (() => {});
    this.onPositiveFeedback = init.onPositiveFeedback ?? (() => {});
    this.onNegativeFeedback = init.onNegativeFeedback ?? (() => {});
    this.onConnectionChange = init.onConnectionChange ?? null;
    this.videoElement = init.videoElement;
    this.overlayCanvas = init.overlayCanvas ?? null;
    this.overlayCtx = this.overlayCanvas?.getContext('2d') ?? null;
    this.opts = { ...HAND_TRACKER_DEFAULTS, ...init.options };
  }

  // ─── HandTrackingController ───────────────────────────────────────────────

  isActive(): boolean { return this._active; }

  getFeatures(): number[] { return [...this._features]; }

  setSmoothing(factor: number): void {
    this.opts.smoothingFactor = Math.max(0, Math.min(1, factor));
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._active) return;

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      this.videoElement.srcObject = this._stream;
      await this.videoElement.play();

      if (!this._handLandmarker) {
        await this._initHandLandmarker();
      }

      this._active = true;
      this.onConnectionChange?.(true);
      this._detectLoop();
    } catch (err) {
      console.error('[HandTracker] Failed to start:', err);
      this.stop();
      throw err;
    }
  }

  stop(): void {
    this._active = false;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this._stream) {
      for (const track of this._stream.getTracks()) track.stop();
      this._stream = null;
    }

    this.videoElement.srcObject = null;
    this._trackingRight = false;
    this._trackingLeft = false;
    this.onConnectionChange?.(false);
  }

  destroy(): void {
    this.stop();
    if (this._handLandmarker) {
      this._handLandmarker.close?.();
      this._handLandmarker = null;
    }
  }

  // ─── Runtime option updates ───────────────────────────────────────────────

  /**
   * Update tuning options at runtime.
   * Changes to confidence thresholds require a HandLandmarker re-configure call.
   */
  async setOptions(patch: Partial<HandTrackerOptions>): Promise<void> {
    const prev = { ...this.opts };
    Object.assign(this.opts, patch);

    const confidenceChanged =
      prev.minHandDetectionConfidence !== this.opts.minHandDetectionConfidence ||
      prev.minHandPresenceConfidence !== this.opts.minHandPresenceConfidence ||
      prev.minTrackingConfidence !== this.opts.minTrackingConfidence;

    if (confidenceChanged && this._handLandmarker) {
      await this._handLandmarker.setOptions({
        minHandDetectionConfidence: this.opts.minHandDetectionConfidence,
        minHandPresenceConfidence: this.opts.minHandPresenceConfidence,
        minTrackingConfidence: this.opts.minTrackingConfidence,
      });
    }
  }

  // ─── Read-only status ─────────────────────────────────────────────────────

  get gestureProgress(): number { return this._gestureProgress; }
  get gestureCandidate(): string | null { return this._gestureCandidate; }
  get trackingRight(): boolean { return this._trackingRight; }
  get trackingLeft(): boolean { return this._trackingLeft; }

  // ─── Private: MediaPipe initialisation ───────────────────────────────────

  private async _initHandLandmarker(): Promise<void> {
    // Dynamic CDN import — never bundled
    // Dynamic CDN import — no type declarations available
    const cdnUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs';
    const vision = await (Function('url', 'return import(url)')(cdnUrl)) as any;

    const { HandLandmarker, FilesetResolver } = vision;

    const wasmFileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
    );

    this._handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: this.opts.minHandDetectionConfidence,
      minHandPresenceConfidence: this.opts.minHandPresenceConfidence,
      minTrackingConfidence: this.opts.minTrackingConfidence,
    });
  }

  // ─── Private: detection loop ──────────────────────────────────────────────

  private _detectLoop(): void {
    if (!this._active) return;

    const now = performance.now();
    if (now - this._lastDetectTime >= this._minDetectInterval) {
      const frameStart = now;

      if (this.videoElement.readyState >= 2 && this._handLandmarker) {
        const results: HandLandmarkerResult = this._handLandmarker.detectForVideo(
          this.videoElement,
          now,
        );
        this._processResults(results, now);
      }

      // Adaptive frame rate: drop to 15 fps if detection is slow, recover to 30 fps otherwise
      const elapsed = performance.now() - frameStart;
      if (elapsed > 25) {
        this._minDetectInterval = 66;
      } else if (this._minDetectInterval > 33) {
        this._minDetectInterval = 33;
      }

      this._lastDetectTime = now;
    }

    this._rafId = requestAnimationFrame(() => this._detectLoop());
  }

  // ─── Private: result processing ──────────────────────────────────────────

  private _processResults(results: HandLandmarkerResult, now: number): void {
    if (this.overlayCtx) {
      this.overlayCanvas!.width = 360;
      this.overlayCanvas!.height = 270;
      this._drawBackground();
    }

    let rightHand: Landmark[] | null = null;
    let leftHand: Landmark[] | null = null;
    let rightHandNorm: Landmark[] | null = null;
    let leftHandNorm: Landmark[] | null = null;

    if (results.handednesses && results.landmarks) {
      const useWorld = this.opts.useWorldLandmarks && !!results.worldLandmarks;
      const lmSource = useWorld ? results.worldLandmarks! : results.landmarks;

      for (let i = 0; i < results.handednesses.length; i++) {
        const handedness = results.handednesses[i][0];
        const landmarks = lmSource[i];
        const normLandmarks = results.landmarks[i];

        if (handedness.categoryName === 'Right') {
          rightHand = landmarks;
          rightHandNorm = normLandmarks;
        } else {
          leftHand = landmarks;
          leftHandNorm = normLandmarks;
        }
      }
    }

    // Fallback: if only one hand is detected, treat it as the tracking hand
    if (!rightHand && leftHand) {
      rightHand = leftHand;
      rightHandNorm = leftHandNorm;
      leftHand = null;
      leftHandNorm = null;
    }

    this._trackingRight = !!rightHand;
    this._trackingLeft = !!leftHand;

    // Feature extraction from tracking (right) hand
    if (rightHand) {
      const raw = this._extractFeatures(rightHand);
      const sf = this.opts.smoothingFactor;
      for (let i = 0; i < 14; i++) {
        this._smoothedFeatures[i] += (raw[i] - this._smoothedFeatures[i]) * sf;
        this._features[i] = this._smoothedFeatures[i];
      }
      this.onTrackingInput(this._features);
    }

    // Gesture recognition from left hand (normalised landmarks only)
    if (leftHandNorm) {
      this._processGesture(leftHandNorm, now);
    } else {
      this._gestureCandidate = null;
      this._gestureProgress = 0;
    }

    // Skeleton overlay drawing
    if (this.overlayCtx) {
      const w = this.overlayCanvas!.width;
      const dividerX = w * (2 / 3);

      if (rightHandNorm) {
        const avgX = rightHandNorm[WRIST].x * w;
        this._drawSkeleton(rightHandNorm, '#ff6a00', avgX > dividerX ? 0.25 : 0.9);
      }
      if (leftHandNorm) {
        const avgX = leftHandNorm[WRIST].x * w;
        this._drawSkeleton(leftHandNorm, '#00ccff', avgX < dividerX ? 0.25 : 0.9);
      }
    }
  }

  // ─── Private: feature extraction ─────────────────────────────────────────

  /**
   * Extracts 14 features from a hand landmark array:
   *   [0-1]  palm position X, Y
   *   [2-6]  finger curls (thumb → pinky)
   *   [7-8]  finger spreads (2 adjacent pairs: thumb-index, index-middle)
   *   [9]    hand roll (rotation around forward axis)
   *   [10]   hand pitch (tilt from z-depth)
   *   [11]   thumb-index pinch distance
   *   [12-13] reserved (0.5)
   */
  private _extractFeatures(landmarks: Landmark[]): number[] {
    const f = new Array<number>(14);
    const isWorld = this.opts.useWorldLandmarks;

    // 0-1: Palm position X, Y
    if (isWorld) {
      f[0] = clamp01((landmarks[WRIST].x + 0.1) / 0.2);
      f[1] = clamp01((landmarks[WRIST].y + 0.1) / 0.2);
    } else {
      f[0] = 1.0 - landmarks[WRIST].x; // mirror X
      f[1] = landmarks[WRIST].y;
    }

    // 2-6: Finger curl (thumb through pinky)
    for (let fi = 0; fi < 5; fi++) {
      f[2 + fi] = this._fingerCurl(landmarks, fi);
    }

    // 7-8: Finger spread (2 adjacent pairs: thumb-index, index-middle)
    for (let fi = 0; fi < 2; fi++) {
      f[7 + fi] = this._fingerSpread(landmarks, fi);
    }

    // 9: Hand roll (rotation around forward axis)
    const wrist = landmarks[WRIST];
    const middleMcp = landmarks[MIDDLE_MCP];
    const dx = middleMcp.x - wrist.x;
    const dy = middleMcp.y - wrist.y;
    f[9] = clamp01((Math.atan2(dx, -dy) / Math.PI + 1) * 0.5);

    // 10: Hand pitch (tilt forward/back from z-depth difference)
    const avgTipZ = (landmarks[INDEX_TIP].z + landmarks[MIDDLE_TIP].z + landmarks[RING_TIP].z) / 3;
    if (isWorld) {
      f[10] = clamp01((wrist.z - avgTipZ + 0.05) / 0.1);
    } else {
      f[10] = clamp01((wrist.z - avgTipZ + 0.15) / 0.3);
    }

    // 11: Pinch distance (thumb tip to index tip)
    const pinch = dist3d(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
    if (isWorld) {
      f[11] = clamp01(1.0 - pinch / 0.15);
    } else {
      f[11] = clamp01(1.0 - pinch / 0.3);
    }

    // 12-13: Reserved
    f[12] = 0.5;
    f[13] = 0.5;

    return f;
  }

  private _fingerCurl(landmarks: Landmark[], fingerIndex: number): number {
    const joints = FINGER_LANDMARKS[fingerIndex];
    const a = landmarks[joints[0]];
    const b = landmarks[joints[1]];
    const c = landmarks[joints[2]];
    const d = landmarks[joints[3]];

    const v1x = b.x - a.x, v1y = b.y - a.y, v1z = b.z - a.z;
    const v2x = d.x - b.x, v2y = d.y - b.y, v2z = d.z - b.z;

    const dot = v1x * v2x + v1y * v2y + v1z * v2z;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z) || 0.001;
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z) || 0.001;

    const cosAngle = clamp(dot / (mag1 * mag2), -1, 1);
    const angle = Math.acos(cosAngle);

    const tipDist = dist3d(landmarks[joints[0]], landmarks[joints[3]]);
    const baseDist = dist3d(landmarks[joints[0]], landmarks[joints[2]]);
    const ratio = baseDist > 0.001 ? tipDist / (baseDist * 1.8) : 1;

    const angleCurl = clamp01(1.0 - angle / Math.PI);
    const distCurl = clamp01(1.0 - ratio);

    return clamp01(angleCurl * 0.4 + distCurl * 0.6);
  }

  private _fingerSpread(landmarks: Landmark[], pairIndex: number): number {
    const tip1 = landmarks[FINGER_TIPS[pairIndex]];
    const tip2 = landmarks[FINGER_TIPS[pairIndex + 1]];
    const mcp1 = landmarks[FINGER_MCPS[pairIndex]];
    const mcp2 = landmarks[FINGER_MCPS[pairIndex + 1]];

    const v1x = tip1.x - mcp1.x, v1y = tip1.y - mcp1.y;
    const v2x = tip2.x - mcp2.x, v2y = tip2.y - mcp2.y;

    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y) || 0.001;
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y) || 0.001;

    const cosAngle = clamp(dot / (mag1 * mag2), -1, 1);
    const angle = Math.acos(cosAngle);

    return clamp01(angle / 0.6);
  }

  // ─── Private: gesture recognition ────────────────────────────────────────

  /**
   * Detects hold-to-confirm gestures from the left hand:
   *   1 finger extended (≥ 0.4 s) → positive feedback
   *   2 fingers extended (≥ 0.4 s) → negative feedback
   */
  private _processGesture(landmarks: Landmark[], now: number): void {
    const extended = this._countExtendedFingers(landmarks);

    let candidate: 'positive' | 'negative' | null = null;
    if (extended === 1) candidate = 'positive';
    else if (extended === 2) candidate = 'negative';

    if (candidate !== this._gestureCandidate) {
      this._gestureCandidate = candidate;
      this._gestureStartTime = now;
      this._gestureProgress = 0;
    } else if (candidate) {
      const elapsed = now - this._gestureStartTime;
      this._gestureProgress = Math.min(elapsed / this.opts.gestureHoldMs, 1);

      if (this._gestureProgress >= 1 && now - this._lastGestureFired > 800) {
        if (candidate === 'positive') {
          this.onPositiveFeedback();
        } else {
          this.onNegativeFeedback();
        }
        this._lastGestureFired = now;
        this._gestureCandidate = null;
        this._gestureProgress = 0;
      }
    }
  }

  private _countExtendedFingers(landmarks: Landmark[]): number {
    let count = 0;

    // Other fingers (not thumb): tip farther from wrist than PIP
    for (let fi = 1; fi < 5; fi++) {
      const joints = FINGER_LANDMARKS[fi];
      const tipToWrist = dist3d(landmarks[joints[3]], landmarks[WRIST]);
      const pipToWrist = dist3d(landmarks[joints[1]], landmarks[WRIST]);
      if (tipToWrist > pipToWrist * 1.05) count++;
    }

    return count;
  }

  // ─── Private: canvas drawing ──────────────────────────────────────────────

  private _drawBackground(): void {
    const ctx = this.overlayCtx!;
    const w = this.overlayCanvas!.width;
    const h = this.overlayCanvas!.height;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    const dividerX = w * (2 / 3);

    ctx.fillStyle = 'rgba(255, 106, 0, 0.03)';
    ctx.fillRect(0, 0, dividerX, h);

    ctx.fillStyle = 'rgba(0, 204, 255, 0.03)';
    ctx.fillRect(dividerX, 0, w - dividerX, h);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(dividerX, 0);
    ctx.lineTo(dividerX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    ctx.fillStyle = 'rgba(255, 106, 0, 0.3)';
    ctx.fillText('TRACKING', dividerX / 2, 12);

    ctx.fillStyle = 'rgba(0, 204, 255, 0.3)';
    ctx.fillText('GESTURE', dividerX + (w - dividerX) / 2, 12);

    ctx.textAlign = 'start';
  }

  private _drawSkeleton(landmarks: Landmark[], color: string, opacity: number): void {
    const ctx = this.overlayCtx!;
    const w = this.overlayCanvas!.width;
    const h = this.overlayCanvas!.height;

    const HAND_CONNECTIONS: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [0, 9], [9, 10], [10, 11], [11, 12],
      [0, 13], [13, 14], [14, 15], [15, 16],
      [0, 17], [17, 18], [18, 19], [19, 20],
      [5, 9], [9, 13], [13, 17],
    ];

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = opacity * 0.8;

    for (const [a, b] of HAND_CONNECTIONS) {
      const la = landmarks[a];
      const lb = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(la.x * w, la.y * h);
      ctx.lineTo(lb.x * w, lb.y * h);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function dist3d(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
