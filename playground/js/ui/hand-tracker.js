// HandTracker — MediaPipe hand tracking input for NISPS playground
// Extracts 14 derived features from right hand, gesture recognition from left hand

// MediaPipe landmark indices
const WRIST = 0;
const THUMB_CMC = 1, THUMB_MCP = 2, THUMB_IP = 3, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_DIP = 7, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_DIP = 15, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_DIP = 19, PINKY_TIP = 20;

const FINGER_LANDMARKS = [
  [THUMB_CMC, THUMB_MCP, THUMB_IP, THUMB_TIP],
  [INDEX_MCP, INDEX_PIP, INDEX_DIP, INDEX_TIP],
  [MIDDLE_MCP, MIDDLE_PIP, MIDDLE_DIP, MIDDLE_TIP],
  [RING_MCP, RING_PIP, RING_DIP, RING_TIP],
  [PINKY_MCP, PINKY_PIP, PINKY_DIP, PINKY_TIP],
];

const FINGER_TIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];
const FINGER_MCPS = [THUMB_MCP, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP];

// Hand connections for skeleton drawing
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

// Default tuning parameters (exported for dev panel)
export const HAND_TRACKER_DEFAULTS = {
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  smoothingFactor: 0.4,
  gestureHoldMs: 400,
  useWorldLandmarks: false,
};

export class HandTracker {
  /**
   * @param {Object} options
   * @param {function(number[])} options.onTrackingInput - called with 14 derived features [0,1]
   * @param {function('thumbsup'|'thumbsdown')} options.onGesture - called when gesture confirmed
   * @param {function(boolean)} [options.onConnectionChange] - called when tracking starts/stops
   * @param {HTMLVideoElement} options.videoElement - video element for camera feed
   * @param {HTMLCanvasElement} options.overlayCanvas - canvas for skeleton drawing
   */
  constructor(options = {}) {
    this.onTrackingInput = options.onTrackingInput || (() => {});
    this.onGesture = options.onGesture || (() => {});
    this.onConnectionChange = options.onConnectionChange || null;
    this.videoElement = options.videoElement;
    this.overlayCanvas = options.overlayCanvas;
    this.overlayCtx = this.overlayCanvas?.getContext('2d');

    this.active = false;
    this.features = new Array(14).fill(0.5);
    this._handLandmarker = null;
    this._stream = null;
    this._rafId = null;
    this._lastDetectTime = 0;
    this._minDetectInterval = 33; // ~30fps, will increase if slow

    // Tuning parameters (runtime-adjustable via setOptions)
    this.opts = { ...HAND_TRACKER_DEFAULTS };

    // Gesture state
    this._gestureCandidate = null; // 'thumbsup' | 'thumbsdown' | null
    this._gestureStartTime = 0;
    this._gestureProgress = 0; // 0-1 for UI
    this._lastGestureFired = 0;

    // Smoothing
    this._smoothedFeatures = new Array(14).fill(0.5);

    // Status
    this._trackingRight = false;
    this._trackingLeft = false;
  }

  /**
   * Update tuning parameters at runtime.
   * Confidence changes require re-creating the HandLandmarker (async).
   */
  async setOptions(patch) {
    const prev = { ...this.opts };
    Object.assign(this.opts, patch);

    // Check if MediaPipe confidence thresholds changed — requires re-init
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
      console.log('[HandTracker] Updated confidence thresholds:', this.opts);
    }
  }

  get gestureProgress() { return this._gestureProgress; }
  get gestureCandidate() { return this._gestureCandidate; }
  get trackingRight() { return this._trackingRight; }
  get trackingLeft() { return this._trackingLeft; }

  async start() {
    if (this.active) return;

    try {
      // Request camera
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      this.videoElement.srcObject = this._stream;
      await this.videoElement.play();

      // Load MediaPipe (only once)
      if (!this._handLandmarker) {
        await this._initHandLandmarker();
      }

      this.active = true;
      if (this.onConnectionChange) this.onConnectionChange(true);
      this._detectLoop();
    } catch (e) {
      console.error('[HandTracker] Failed to start:', e);
      this.stop();
      throw e;
    }
  }

  stop() {
    this.active = false;
    if (this._rafId) {
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
    if (this.onConnectionChange) this.onConnectionChange(false);
  }

  destroy() {
    this.stop();
    if (this._handLandmarker) {
      this._handLandmarker.close();
      this._handLandmarker = null;
    }
  }

  async _initHandLandmarker() {
    // Dynamic import of MediaPipe vision tasks
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs');
    const { HandLandmarker, FilesetResolver } = vision;

    const wasmFileset = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
    );

    this._handLandmarker = await HandLandmarker.createFromOptions(wasmFileset, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: this.opts.minHandDetectionConfidence,
      minHandPresenceConfidence: this.opts.minHandPresenceConfidence,
      minTrackingConfidence: this.opts.minTrackingConfidence,
    });
  }

  _detectLoop() {
    if (!this.active) return;

    const now = performance.now();
    if (now - this._lastDetectTime >= this._minDetectInterval) {
      const frameStart = now;

      if (this.videoElement.readyState >= 2 && this._handLandmarker) {
        const results = this._handLandmarker.detectForVideo(this.videoElement, now);
        this._processResults(results, now);
      }

      // Adaptive frame rate: slow down if detection is heavy, recover gradually
      const elapsed = performance.now() - frameStart;
      if (elapsed > 25) {
        this._minDetectInterval = 66; // drop to 15fps
      } else if (this._minDetectInterval > 33) {
        this._minDetectInterval = 33; // recover to 30fps
      }
    }

    this._rafId = requestAnimationFrame(() => this._detectLoop());
  }

  _processResults(results, now) {
    // Set canvas to a fixed size matching the PIP aspect ratio
    if (this.overlayCtx) {
      this.overlayCanvas.width = 360;
      this.overlayCanvas.height = 270;
      this._drawBackground();
    }

    let rightHand = null;
    let leftHand = null;
    let rightHandNorm = null; // always normalized (for drawing)
    let leftHandNorm = null;

    // Classify hands
    if (results.handednesses && results.landmarks) {
      // Choose landmark source: world (meters, hand-centric) or normalized (image-relative)
      const useWorld = this.opts.useWorldLandmarks && results.worldLandmarks;
      const lmSource = useWorld ? results.worldLandmarks : results.landmarks;

      for (let i = 0; i < results.handednesses.length; i++) {
        const handedness = results.handednesses[i][0];
        const landmarks = lmSource[i];
        const normLandmarks = results.landmarks[i]; // always keep normalized for drawing
        if (handedness.categoryName === 'Right') {
          rightHand = landmarks;
          rightHandNorm = normLandmarks;
        } else {
          leftHand = landmarks;
          leftHandNorm = normLandmarks;
        }
      }
    }

    // If only one hand detected, use it as tracking hand
    if (!rightHand && leftHand) {
      rightHand = leftHand;
      rightHandNorm = leftHandNorm;
      leftHand = null;
      leftHandNorm = null;
    }

    this._trackingRight = !!rightHand;
    this._trackingLeft = !!leftHand;

    // Extract features from tracking hand (right)
    if (rightHand) {
      const raw = this._extractFeatures(rightHand);
      // Smooth features
      const sf = this.opts.smoothingFactor;
      for (let i = 0; i < 14; i++) {
        this._smoothedFeatures[i] += (raw[i] - this._smoothedFeatures[i]) * sf;
        this.features[i] = this._smoothedFeatures[i];
      }
      this.onTrackingInput(this.features);
    }

    // Gesture recognition from left hand (uses normalized landmarks for finger counting)
    if (leftHandNorm) {
      this._processGesture(leftHandNorm, now);
    } else {
      this._gestureCandidate = null;
      this._gestureProgress = 0;
    }

    // Draw skeletons with zone awareness (always use normalized landmarks for drawing)
    // In canvas (pre-CSS-mirror) coords: right 1/3 = gesture zone, left 2/3 = tracking zone
    // After CSS scaleX(-1): left 1/3 = gesture, right 2/3 = tracking
    if (this.overlayCtx) {
      const w = this.overlayCanvas.width;
      const dividerX = w * (2 / 3);

      if (rightHandNorm) {
        const avgX = rightHandNorm[WRIST].x * w;
        const crossingZone = avgX > dividerX;
        this._drawSkeleton(rightHandNorm, '#ff6a00', crossingZone ? 0.25 : 0.9);
      }
      if (leftHandNorm) {
        const avgX = leftHandNorm[WRIST].x * w;
        const crossingZone = avgX < dividerX;
        this._drawSkeleton(leftHandNorm, '#00ccff', crossingZone ? 0.25 : 0.9);
      }
    }
  }

  _extractFeatures(landmarks) {
    const f = new Array(14);
    const isWorld = this.opts.useWorldLandmarks;

    // 0-1: Palm position X, Y
    // For world landmarks, x/y are in meters centered on hand — normalize differently
    if (isWorld) {
      // World coords: origin at hand center, range roughly ±0.1m
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

    // 7-10: Finger spread (4 adjacent pairs)
    for (let fi = 0; fi < 4; fi++) {
      f[7 + fi] = this._fingerSpread(landmarks, fi);
    }

    // 11: Hand roll (rotation around forward axis)
    const wrist = landmarks[WRIST];
    const middleMcp = landmarks[MIDDLE_MCP];
    const dx = middleMcp.x - wrist.x;
    const dy = middleMcp.y - wrist.y;
    const roll = (Math.atan2(dx, -dy) / Math.PI + 1) * 0.5;
    f[11] = clamp01(roll);

    // 12: Hand pitch (tilt forward/back from z-depth difference)
    const avgTipZ = (landmarks[INDEX_TIP].z + landmarks[MIDDLE_TIP].z + landmarks[RING_TIP].z) / 3;
    if (isWorld) {
      // World z is in meters — typical pitch range ~±0.05m
      f[12] = clamp01((wrist.z - avgTipZ + 0.05) / 0.1);
    } else {
      f[12] = clamp01((wrist.z - avgTipZ + 0.15) / 0.3);
    }

    // 13: Pinch distance (thumb tip to index tip)
    const pinch = dist3d(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
    if (isWorld) {
      // World pinch: range 0–0.15m typically
      f[13] = clamp01(1.0 - pinch / 0.15);
    } else {
      f[13] = clamp01(1.0 - pinch / 0.3);
    }

    return f;
  }

  _fingerCurl(landmarks, fingerIndex) {
    const joints = FINGER_LANDMARKS[fingerIndex];
    // Angle at PIP joint (middle joint)
    const a = landmarks[joints[0]]; // MCP/CMC
    const b = landmarks[joints[1]]; // MCP/PIP
    const c = landmarks[joints[2]]; // PIP/DIP
    const d = landmarks[joints[3]]; // DIP/TIP

    // Use angle between base→mid and mid→tip vectors
    const v1x = b.x - a.x, v1y = b.y - a.y, v1z = b.z - a.z;
    const v2x = d.x - b.x, v2y = d.y - b.y, v2z = d.z - b.z;

    const dot = v1x * v2x + v1y * v2y + v1z * v2z;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z) || 0.001;
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z) || 0.001;

    const cosAngle = clamp(dot / (mag1 * mag2), -1, 1);
    const angle = Math.acos(cosAngle); // 0 = straight, PI = fully bent

    // Also consider distance from tip to MCP (more robust)
    const tipDist = dist3d(landmarks[joints[0]], landmarks[joints[3]]);
    const baseDist = dist3d(landmarks[joints[0]], landmarks[joints[2]]);
    const ratio = baseDist > 0.001 ? tipDist / (baseDist * 1.8) : 1;

    // Blend angle-based and distance-based curl
    const angleCurl = clamp01(1.0 - angle / Math.PI);
    const distCurl = clamp01(1.0 - ratio);

    return clamp01(angleCurl * 0.4 + distCurl * 0.6);
  }

  _fingerSpread(landmarks, pairIndex) {
    // Spread between adjacent finger tips
    const tip1 = landmarks[FINGER_TIPS[pairIndex]];
    const tip2 = landmarks[FINGER_TIPS[pairIndex + 1]];
    const mcp1 = landmarks[FINGER_MCPS[pairIndex]];
    const mcp2 = landmarks[FINGER_MCPS[pairIndex + 1]];

    // Direction vectors from MCP to tip
    const v1x = tip1.x - mcp1.x, v1y = tip1.y - mcp1.y;
    const v2x = tip2.x - mcp2.x, v2y = tip2.y - mcp2.y;

    const dot = v1x * v2x + v1y * v2y;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y) || 0.001;
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y) || 0.001;

    const cosAngle = clamp(dot / (mag1 * mag2), -1, 1);
    const angle = Math.acos(cosAngle); // 0 = parallel, larger = more spread

    // Normalize: typical spread is 0-0.5 radians
    return clamp01(angle / 0.6);
  }

  _processGesture(landmarks, now) {
    const extended = this._countExtendedFingers(landmarks);

    let candidate = null;
    if (extended === 1) candidate = 'thumbsup';
    else if (extended === 2) candidate = 'thumbsdown';

    if (candidate !== this._gestureCandidate) {
      // New gesture or cleared
      this._gestureCandidate = candidate;
      this._gestureStartTime = now;
      this._gestureProgress = 0;
    } else if (candidate) {
      // Same gesture continuing
      const elapsed = now - this._gestureStartTime;
      this._gestureProgress = Math.min(elapsed / this.opts.gestureHoldMs, 1);

      if (this._gestureProgress >= 1 && now - this._lastGestureFired > 800) {
        // Fire gesture
        this.onGesture(candidate);
        this._lastGestureFired = now;
        this._gestureCandidate = null;
        this._gestureProgress = 0;
      }
    }
  }

  _countExtendedFingers(landmarks) {
    let count = 0;

    // Thumb: check if tip is far from palm center (different axis)
    const thumbExtended = dist3d(landmarks[THUMB_TIP], landmarks[THUMB_MCP]) >
                          dist3d(landmarks[THUMB_IP], landmarks[THUMB_MCP]) * 1.2;

    // Other fingers: tip should be farther from wrist than PIP
    for (let fi = 1; fi < 5; fi++) {
      const joints = FINGER_LANDMARKS[fi];
      const tipToWrist = dist3d(landmarks[joints[3]], landmarks[WRIST]);
      const pipToWrist = dist3d(landmarks[joints[1]], landmarks[WRIST]);
      if (tipToWrist > pipToWrist * 1.05) count++;
    }

    // Don't count thumb for gesture (only counting index, middle, ring, pinky)
    return count;
  }

  _drawBackground() {
    const ctx = this.overlayCtx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;

    // Dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);

    // Zone backgrounds (subtle tint)
    // In canvas coords (pre-CSS-mirror): left 2/3 = tracking (right hand), right 1/3 = gesture (left hand)
    const dividerX = w * (2 / 3);

    // Tracking zone — very subtle warm tint
    ctx.fillStyle = 'rgba(255, 106, 0, 0.03)';
    ctx.fillRect(0, 0, dividerX, h);

    // Gesture zone — very subtle cool tint
    ctx.fillStyle = 'rgba(0, 204, 255, 0.03)';
    ctx.fillRect(dividerX, 0, w - dividerX, h);

    // Dashed divider line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(dividerX, 0);
    ctx.lineTo(dividerX, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zone labels (drawn in canvas coords, CSS mirror flips them)
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';

    // Tracking label (left 2/3 of canvas → right 2/3 of display)
    ctx.fillStyle = 'rgba(255, 106, 0, 0.3)';
    ctx.fillText('TRACKING', dividerX / 2, 12);

    // Gesture label (right 1/3 of canvas → left 1/3 of display)
    ctx.fillStyle = 'rgba(0, 204, 255, 0.3)';
    ctx.fillText('GESTURE', dividerX + (w - dividerX) / 2, 12);

    ctx.textAlign = 'start'; // reset
  }

  _drawSkeleton(landmarks, color, opacity) {
    const ctx = this.overlayCtx;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;

    // Draw connections
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = opacity * 0.8;

    for (const [a, b] of HAND_CONNECTIONS) {
      const la = landmarks[a], lb = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(la.x * w, la.y * h);
      ctx.lineTo(lb.x * w, lb.y * h);
      ctx.stroke();
    }

    // Draw landmarks
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

// --- Utility ---
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function clamp01(v) { return clamp(v, 0, 1); }
function dist3d(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
