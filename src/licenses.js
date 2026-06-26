// Per-server license store for the paid bot. Persisted to licenses.json next to
// settings.json (on the DATA_DIR volume). This is the trusted source of truth and
// runs only on the host YOU control — customers invite the bot, they never run
// this code, so the gate can't be bypassed. Keep minting (genkey/revoke) owner-only.
import {
  readFileSync, writeFileSync, renameSync, existsSync, mkdirSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');
const LICENSES_PATH = join(DATA_DIR, 'licenses.json');
const DAY_MS = 86_400_000;

function load() {
  if (!existsSync(LICENSES_PATH)) return { keys: {} };
  try {
    const d = JSON.parse(readFileSync(LICENSES_PATH, 'utf8'));
    return d && typeof d === 'object' && d.keys ? d : { keys: {} };
  } catch {
    return { keys: {} };
  }
}
let store = load();

// Re-read from disk (so a CLI minting/revoking in another process is picked up).
export function reload() { store = load(); }

function persist() {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* non-fatal */ }
  const json = JSON.stringify(store, null, 2);
  try {
    const tmp = `${LICENSES_PATH}.tmp`;
    writeFileSync(tmp, json);
    renameSync(tmp, LICENSES_PATH);
  } catch {
    try { writeFileSync(LICENSES_PATH, json); } catch (err) {
      console.error(`❌ Failed to save licenses to ${LICENSES_PATH}: ${err.message}`);
      throw err;
    }
  }
}

// Unambiguous key like TT-XXXX-XXXX-XXXX-XXXX (no I/L/O/U/0/1 confusables).
function newKeyString() {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = randomBytes(16);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `TT-${s.slice(0, 16).match(/.{1,4}/g).join('-')}`;
}

// Mint one or more unused keys. durationDays=null → lifetime. Owner-only.
export function generateKeys({ durationDays = null, plan = '', count = 1 } = {}) {
  reload();
  const created = [];
  for (let i = 0; i < count; i += 1) {
    let key;
    do { key = newKeyString(); } while (store.keys[key]);
    store.keys[key] = {
      durationDays: durationDays === null ? null : Number(durationDays),
      plan: String(plan || ''),
      createdAt: Date.now(),
      serverId: null,
      activatedAt: null,
      expiresAt: null,
      revoked: false,
    };
    created.push(key);
  }
  persist();
  return created;
}

export function revokeKey(rawKey) {
  reload();
  const key = (rawKey || '').trim().toUpperCase();
  const k = store.keys[key];
  if (!k) return { ok: false, reason: 'missing' };
  k.revoked = true;
  persist();
  return { ok: true, serverId: k.serverId };
}

export function listKeys() {
  reload();
  return Object.entries(store.keys).map(([key, v]) => ({ key, ...v }));
}

// Bind a key to a server and compute its expiry. A key works in exactly one
// server (first to activate); re-activating in the same server is idempotent.
export function activate(serverId, rawKey) {
  reload();
  const key = (rawKey || '').trim().toUpperCase();
  const k = store.keys[key];
  if (!k) return { ok: false, reason: 'invalid' };
  if (k.revoked) return { ok: false, reason: 'revoked' };
  if (k.serverId && k.serverId !== serverId) return { ok: false, reason: 'bound_elsewhere' };
  k.serverId = serverId;
  if (!k.activatedAt) k.activatedAt = Date.now();
  k.expiresAt = k.durationDays === null ? null : k.activatedAt + k.durationDays * DAY_MS;
  persist();
  return { ok: true, expiresAt: k.expiresAt, plan: k.plan };
}

function exemptServers() {
  const list = (process.env.LICENSE_EXEMPT_SERVERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (process.env.OWNER_SERVER_ID) list.push(process.env.OWNER_SERVER_ID);
  return list;
}

// The best (lifetime, else furthest-future) non-revoked license bound to a server.
export function licenseStatus(serverId) {
  if (exemptServers().includes(serverId)) return { licensed: true, exempt: true, expiresAt: null };
  const now = Date.now();
  let best = null;
  for (const [key, v] of Object.entries(store.keys)) {
    if (v.serverId !== serverId || v.revoked) continue;
    const valid = v.expiresAt === null || now < v.expiresAt;
    if (!valid) continue;
    if (!best || v.expiresAt === null || (best.expiresAt !== null && v.expiresAt > best.expiresAt)) {
      best = { key, plan: v.plan, expiresAt: v.expiresAt };
    }
  }
  return best ? { licensed: true, ...best } : { licensed: false };
}

export function isLicensed(serverId) {
  return licenseStatus(serverId).licensed;
}
