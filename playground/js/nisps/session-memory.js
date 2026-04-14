// Per-preset session memory (meml-4uye)
//
// Saves a snapshot of the ML network state keyed by { engine, presetId } so
// that when a user switches presets and later comes back, their previous
// network (weights + dataset + snapshot stack + A/B slots + overrides) can be
// restored via a confirmation dialog.
//
// Storage: one localStorage key per {engine, presetId}:
//   nisps.session.<engine>::<presetId>  → JSON payload
//
// Uses '::' as separator because preset ids may contain '.' (e.g.
// 'beginner-1.2'). The previous '.' separator would collide with dotted
// ids and split parsing incorrectly.
//
// Quota-aware: before writing, we ensure the total "nisps.session.*" size
// (including the incoming blob) stays under SESSION_BUDGET_BYTES; if not,
// oldest entries are pruned first.
//
// This supersedes meml-jxga — snapshot stacks are now per-preset via session
// memory instead of globally persisted.

const PREFIX = 'nisps.session.';
const SEP = '::';
const SESSION_BUDGET_BYTES = 4 * 1024 * 1024; // 4 MB soft cap
const SCHEMA_VERSION = 1;

/**
 * Sanitise an incoming preset id — the '::' separator must not appear
 * inside the id itself. Replaces any occurrence with '_'.
 */
export function sanitizePresetId(id) {
  if (id == null) return '';
  return String(id).split(SEP).join('_');
}

function keyFor(engine, presetId) {
  return `${PREFIX}${engine}${SEP}${sanitizePresetId(presetId)}`;
}

// One-shot migration of legacy 'nisps.session.<engine>.<presetId>' keys
// to the new '::' separator. Idempotent; only runs once per page load.
let _migrated = false;
function migrateLegacyKeys() {
  if (_migrated) return;
  _migrated = true;
  const legacy = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const tail = k.slice(PREFIX.length);
    if (tail.includes(SEP)) continue; // already new format
    legacy.push(k);
  }
  for (const k of legacy) {
    const tail = k.slice(PREFIX.length);
    const dot = tail.indexOf('.');
    if (dot < 0) continue;
    const engine = tail.slice(0, dot);
    const presetId = tail.slice(dot + 1);
    const newKey = `${PREFIX}${engine}${SEP}${presetId}`;
    const val = localStorage.getItem(k);
    if (val != null) {
      try {
        localStorage.setItem(newKey, val);
        localStorage.removeItem(k);
      } catch (_) { /* ignore quota hiccups during migration */ }
    }
  }
}

/** Estimate UTF-16 byte size of a string (JS string). */
function sizeOf(str) {
  // localStorage stores as UTF-16 → ~2 bytes/char. Good enough for quota math.
  return str ? str.length * 2 : 0;
}

/** List all session keys with timestamp + size. */
export function listSessions() {
  migrateLegacyKeys();
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const raw = localStorage.getItem(k) || '';
    let ts = 0;
    try {
      ts = JSON.parse(raw).timestamp || 0;
    } catch (_) { /* ignore */ }
    // Recover {engine, presetId} from key tail.
    const tail = k.slice(PREFIX.length);
    const sepIdx = tail.indexOf(SEP);
    const engine   = sepIdx >= 0 ? tail.slice(0, sepIdx) : tail;
    const presetId = sepIdx >= 0 ? tail.slice(sepIdx + SEP.length) : '';
    out.push({ key: k, engine, presetId, timestamp: ts, size: sizeOf(raw) });
  }
  return out;
}

/** Remove oldest sessions until total session bytes <= targetBytes. */
export function pruneOldest(targetBytes) {
  const entries = listSessions().sort((a, b) => a.timestamp - b.timestamp);
  let total = entries.reduce((s, e) => s + e.size, 0);
  for (const e of entries) {
    if (total <= targetBytes) break;
    localStorage.removeItem(e.key);
    total -= e.size;
    console.log(`[session-memory] pruned ${e.key} (${(e.size/1024)|0} KB)`);
  }
}

/** Remove a specific session. */
export function clearSession(engine, presetId) {
  if (!engine || !presetId) return;
  localStorage.removeItem(keyFor(engine, presetId));
}

/** Load the session payload for {engine, presetId}, or null if absent. */
export function loadSession(engine, presetId) {
  if (!engine || !presetId) return null;
  migrateLegacyKeys();
  const raw = localStorage.getItem(keyFor(engine, presetId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.__v !== SCHEMA_VERSION) {
      console.warn('[session-memory] schema mismatch, ignoring', parsed.__v);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn('[session-memory] corrupt session, ignoring:', e);
    return null;
  }
}

/**
 * Save a payload under {engine, presetId}. Prunes older sessions if the
 * combined size would exceed the soft budget.
 *
 * @param {string} engine    e.g. 'shaper-feedback' | 'modular' | ...
 * @param {string} presetId  e.g. 'beginner-1'
 * @param {object} payload   arbitrary JSON-serializable snapshot
 */
export function saveSession(engine, presetId, payload) {
  if (!engine || !presetId) return false;
  const record = {
    __v: SCHEMA_VERSION,
    engine,
    presetId,
    timestamp: Date.now(),
    payload,
  };
  let json;
  try {
    json = JSON.stringify(record);
  } catch (e) {
    console.warn('[session-memory] failed to serialise payload:', e);
    return false;
  }
  const incomingBytes = sizeOf(json);

  // Current total minus any existing entry for this key (we're replacing it).
  const existing = listSessions();
  const existingKey = keyFor(engine, presetId);
  const existingSize = existing.find(e => e.key === existingKey)?.size || 0;
  const currentTotal = existing.reduce((s, e) => s + e.size, 0) - existingSize;

  if (currentTotal + incomingBytes > SESSION_BUDGET_BYTES) {
    // Prune other entries (not ours) until we fit.
    const target = Math.max(0, SESSION_BUDGET_BYTES - incomingBytes);
    const others = existing.filter(e => e.key !== existingKey)
      .sort((a, b) => a.timestamp - b.timestamp);
    let acc = currentTotal;
    for (const e of others) {
      if (acc <= target) break;
      localStorage.removeItem(e.key);
      acc -= e.size;
      console.log(`[session-memory] budget-pruned ${e.key}`);
    }
  }

  try {
    localStorage.setItem(existingKey, json);
    return true;
  } catch (e) {
    // Quota exceeded — aggressively prune and retry once.
    console.warn('[session-memory] setItem failed, pruning and retrying:', e);
    pruneOldest(Math.max(0, SESSION_BUDGET_BYTES - incomingBytes - 1024 * 100));
    try {
      localStorage.setItem(existingKey, json);
      return true;
    } catch (e2) {
      console.warn('[session-memory] save failed after prune:', e2);
      return false;
    }
  }
}

// ------------------------------------------------------------------
// Restore modal
// ------------------------------------------------------------------

let _modalStylesInjected = false;

function injectModalStyles() {
  if (_modalStylesInjected) return;
  _modalStylesInjected = true;
  const s = document.createElement('style');
  s.id = 'nisps-session-restore-styles';
  s.textContent = `
    .nisps-modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.65);
      z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(2px);
    }
    .nisps-modal {
      background: #1a1a1a;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.6);
      color: #eaeaea;
      font-family: inherit;
      padding: 20px 22px;
      max-width: 420px;
      width: calc(100% - 32px);
    }
    .nisps-modal h3 {
      margin: 0 0 8px;
      font-size: 1rem;
      font-weight: 600;
    }
    .nisps-modal p {
      margin: 0 0 18px;
      font-size: 0.85rem;
      color: #b8b8b8;
      line-height: 1.4;
    }
    .nisps-modal .meta {
      font-size: 0.7rem;
      color: #888;
      margin-bottom: 14px;
    }
    .nisps-modal-buttons {
      display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap;
    }
    .nisps-modal-btn {
      padding: 8px 14px;
      font-size: 0.8rem;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(255,255,255,0.05);
      color: #eaeaea;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
    }
    .nisps-modal-btn:hover { background: rgba(255,255,255,0.12); }
    .nisps-modal-btn.primary {
      background: #4a7bd9;
      border-color: #5f8de6;
    }
    .nisps-modal-btn.primary:hover { background: #5a8be9; }
    .nisps-modal-btn.danger {
      color: #ff9a8a;
    }
  `;
  document.head.appendChild(s);
}

function formatAgo(ts) {
  if (!ts) return '';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h ago`;
  return `${Math.floor(secs/86400)}d ago`;
}

/**
 * Show the restore confirmation modal.
 * Resolves to one of 'restore' | 'fresh' | 'cancel'.
 *
 * @param {object} opts
 * @param {string} opts.presetName
 * @param {number} [opts.timestamp]
 * @param {number} [opts.exampleCount]
 */
export function showRestoreModal(opts) {
  injectModalStyles();
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'nisps-modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'nisps-modal';

    const h = document.createElement('h3');
    h.textContent = `Restore your previous network?`;
    const p = document.createElement('p');
    p.textContent = `You've worked on "${opts.presetName}" before. Reload that network, examples, and history?`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const bits = [];
    if (opts.timestamp) bits.push(formatAgo(opts.timestamp));
    if (typeof opts.exampleCount === 'number') {
      bits.push(`${opts.exampleCount} example${opts.exampleCount === 1 ? '' : 's'}`);
    }
    meta.textContent = bits.join(' · ');

    const btns = document.createElement('div');
    btns.className = 'nisps-modal-buttons';
    const cancel = document.createElement('button');
    cancel.className = 'nisps-modal-btn';
    cancel.textContent = 'Cancel';
    const fresh = document.createElement('button');
    fresh.className = 'nisps-modal-btn danger';
    fresh.textContent = 'Start Fresh';
    const restore = document.createElement('button');
    restore.className = 'nisps-modal-btn primary';
    restore.textContent = 'Restore';

    const finish = (choice) => {
      try { document.body.removeChild(backdrop); } catch (_) {}
      document.removeEventListener('keydown', onKey);
      resolve(choice);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish('cancel'); }
      if (e.key === 'Enter')  { e.preventDefault(); finish('restore'); }
    };
    document.addEventListener('keydown', onKey);

    cancel.addEventListener('click', () => finish('cancel'));
    fresh.addEventListener('click', () => finish('fresh'));
    restore.addEventListener('click', () => finish('restore'));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish('cancel');
    });

    btns.appendChild(cancel);
    btns.appendChild(fresh);
    btns.appendChild(restore);
    modal.appendChild(h);
    modal.appendChild(p);
    if (bits.length) modal.appendChild(meta);
    modal.appendChild(btns);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    restore.focus();
  });
}
