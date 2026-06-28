/* Console 2.0 — The Manifold: full-bleed input surface + joy-map visualisation.
   Pointer-down anywhere drives the joystick dot; a ~5s vanishing trail fades
   behind it; noise rings breathe at the current cap; pins overlay regions. */
function Manifold({ pos, onMove, noiseCap = 0.1, pins = [], frozen = false, follow = false, onLongPress }) {
  const wrapRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const stateRef = React.useRef({ pos, noiseCap, pins, frozen, follow });
  const trailRef = React.useRef([]); // {x,y,t}
  const draggingRef = React.useRef(false);
  const driftRef = React.useRef({ vx: 0.0011, vy: 0.0008 });
  const lpTimer = React.useRef(null);

  stateRef.current = { pos, noiseCap, pins, frozen, follow };

  // push trail point whenever pos changes
  React.useEffect(() => {
    trailRef.current.push({ x: pos[0], y: pos[1], t: performance.now() });
    if (trailRef.current.length > 240) trailRef.current.shift();
  }, [pos[0], pos[1]]);

  const setFromEvent = (e) => {
    const el = wrapRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    onMove(x, y);
  };

  const down = (e) => {
    if (stateRef.current.frozen) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setFromEvent(e);
    clearTimeout(lpTimer.current);
    lpTimer.current = setTimeout(() => { onLongPress && onLongPress(stateRef.current.pos); }, 600);
  };
  const move = (e) => { if (draggingRef.current) { setFromEvent(e); clearTimeout(lpTimer.current); } };
  const up = (e) => { draggingRef.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); clearTimeout(lpTimer.current); };

  React.useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    let raf;
    const css = getComputedStyle(document.documentElement);
    const C = (n, f) => (css.getPropertyValue(n).trim() || f);
    const accent = C('--accent', '#ff6a00'), cyan = C('--accent-2', '#00ccff'), line = C('--line-strong', '#3a3a3a');

    const dpr = window.devicePixelRatio || 1;
    let lastW = -1, lastH = -1;
    const ensureSize = (W, H) => {
      if (W === lastW && H === lastH) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastW = W; lastH = H;
    };

    const draw = () => {
      const W = wrap.clientWidth, H = wrap.clientHeight;
      // Self-heal against deferred / zero initial sizing (e.g. inside a flex
      // child that lays out after mount): size each frame, skip until non-zero,
      // but always keep the rAF chain alive.
      if (W === 0 || H === 0) return;
      ensureSize(W, H);
      const { pos, noiseCap, pins, frozen, follow } = stateRef.current;
      const now = performance.now();

      // drift in follow mode
      if (follow && !draggingRef.current && !frozen) {
        let [x, y] = pos; const d = driftRef.current;
        x += d.vx; y += d.vy;
        if (x < 0.05 || x > 0.95) d.vx *= -1;
        if (y < 0.05 || y > 0.95) d.vy *= -1;
        x = Math.max(0.05, Math.min(0.95, x)); y = Math.max(0.05, Math.min(0.95, y));
        onMove(x, y);
      }

      ctx.clearRect(0, 0, W, H);

      // adaptive graph-paper grid (8 major, 4 minor subdivisions)
      const minor = 32, major = 8;
      ctx.lineWidth = 1;
      for (let i = 0; i <= minor; i++) {
        const t = i / minor; const isMajor = i % (minor / major) === 0;
        ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.022)';
        ctx.beginPath(); ctx.moveTo(t * W, 0); ctx.lineTo(t * W, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, t * H); ctx.lineTo(W, t * H); ctx.stroke();
      }
      // center crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

      const px = pos[0] * W, py = (1 - pos[1]) * H;

      // pins
      for (const p of pins) {
        const ppx = p.x * W, ppy = (1 - p.y) * H;
        ctx.fillStyle = p.color || 'rgba(255,106,0,0.18)';
        ctx.beginPath(); ctx.arc(ppx, ppy, 34, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(ppx, ppy, 34, 0, Math.PI * 2); ctx.stroke();
      }

      // vanishing trail (~5s)
      const LIFE = 5000;
      const pts = trailRef.current;
      ctx.lineWidth = 2;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const age = now - b.t; if (age > LIFE) continue;
        const alpha = (1 - age / LIFE) * 0.5;
        ctx.strokeStyle = `rgba(0,204,255,${alpha})`;
        ctx.beginPath(); ctx.moveTo(a.x * W, (1 - a.y) * H); ctx.lineTo(b.x * W, (1 - b.y) * H); ctx.stroke();
      }

      // noise rings — breathe at cap
      if (noiseCap > 0.001) {
        const breathe = 1 + Math.sin(now / 600) * 0.06;
        const rCap = noiseCap * Math.min(W, H) * 0.5 * breathe;
        const rCur = rCap * 0.55;
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = `rgba(255,106,0,0.4)`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, rCap, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(255,106,0,0.7)`;
        ctx.beginPath(); ctx.arc(px, py, rCur, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }

      // the joystick dot
      ctx.shadowColor = frozen ? cyan : accent; ctx.shadowBlur = 18;
      ctx.fillStyle = frozen ? cyan : accent;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0d0d0d';
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    };
    // Paint immediately + on every resize (robust to deferred flex sizing and to
    // rAF being throttled in background/preview contexts); rAF drives animation.
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    // Initial paint via setTimeout retries (rAF and ResizeObserver are both
    // throttled/withheld in some preview contexts; setTimeout is not). Keep
    // retrying until the flex child has a non-zero width and the canvas is sized.
    let timer = null, kicks = 0;
    const kick = () => { draw(); if (lastW <= 0 && kicks++ < 80) timer = setTimeout(kick, 40); };
    kick();
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); clearTimeout(timer); };
  }, []);

  return (
    <div
      ref={wrapRef}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      style={{ position: 'absolute', inset: 0, cursor: frozen ? 'not-allowed' : 'crosshair', touchAction: 'none', userSelect: 'none' }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}
window.Manifold = Manifold;
