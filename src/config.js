import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Settings are written to DATA_DIR if set (e.g. a mounted Railway volume so
// config survives redeploys), otherwise the project root for local use.
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');
const SETTINGS_PATH = join(DATA_DIR, 'settings.json');

// All bot settings are stored per-guild in settings.json and managed entirely
// through in-Discord slash commands. No code edits or restarts are required to
// change keywords, the alert channel, or any toggle.
//
// Shape:
// {
//   [guildId]: {
//     alertChannelId: string | null,
//     flaggedWords: string[],
//     logDeletes: boolean,
//     logEdits: boolean,
//     logFlagged: boolean
//   }
// }

const DEFAULTS = {
  alertChannelId: null,
  flaggedWords: [],
  logDeletes: true,
  logEdits: true,
  logFlagged: true,
  // AI contextual scam/abuse detection (off by default; costs API usage).
  aiEnabled: false,
  // Minimum confidence (0–1) the AI must report before a message is flagged.
  // Lower = more sensitive (more alerts, more false positives); higher = stricter.
  aiThreshold: 0.6,
  // Role IDs allowed to use /tattletale commands. Empty = fall back to the
  // Manage Server permission check only. When populated, the caller must ALSO
  // have one of these roles (defense-in-depth on top of Manage Server).
  allowedRoleIds: [],
};

function loadAll() {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

let settings = loadAll();

// Surface where settings live and how many guilds loaded, so a "my words reset"
// problem is diagnosable straight from the startup logs.
const guildCount = Object.keys(settings).length;
console.log(`Settings file: ${SETTINGS_PATH} (${guildCount} guild${guildCount === 1 ? '' : 's'} loaded)`);
if (!process.env.DATA_DIR) {
  console.warn(
    '⚠️ DATA_DIR is not set, so settings.json lives in the project folder. ' +
    'Many hosts (e.g. Railway) wipe that on every redeploy, which erases your ' +
    'words/config. Set DATA_DIR to a mounted volume path (e.g. /data) to keep it.',
  );
}

function persist() {
  const json = JSON.stringify(settings, null, 2);
  try {
    // Atomic write: serialize to a temp file then rename over the target, so a
    // crash mid-write can never leave a half-written (corrupt) settings.json.
    const tmp = `${SETTINGS_PATH}.tmp`;
    writeFileSync(tmp, json);
    renameSync(tmp, SETTINGS_PATH);
  } catch {
    // Fallback for filesystems/mounts where atomic rename isn't supported —
    // a direct write is better than losing the change entirely.
    writeFileSync(SETTINGS_PATH, json);
  }
}

// Returns a guild's settings, filling in any missing defaults.
export function getGuild(guildId) {
  settings[guildId] = { ...DEFAULTS, ...(settings[guildId] ?? {}) };
  return settings[guildId];
}

export function setAlertChannelId(guildId, channelId) {
  getGuild(guildId).alertChannelId = channelId;
  persist();
}

export function setToggle(guildId, key, value) {
  // key is one of: logDeletes, logEdits, logFlagged
  getGuild(guildId)[key] = value;
  persist();
}

// --- Flagged-word management (case-insensitive, stored lowercased) ---

export function addWord(guildId, word) {
  const g = getGuild(guildId);
  const w = word.trim().toLowerCase();
  if (!w) return { ok: false, reason: 'empty' };
  if (g.flaggedWords.includes(w)) return { ok: false, reason: 'exists' };
  g.flaggedWords.push(w);
  persist();
  return { ok: true, word: w };
}

export function removeWord(guildId, word) {
  const g = getGuild(guildId);
  const w = word.trim().toLowerCase();
  const i = g.flaggedWords.indexOf(w);
  if (i === -1) return { ok: false, reason: 'missing' };
  g.flaggedWords.splice(i, 1);
  persist();
  return { ok: true, word: w };
}

export function clearWords(guildId) {
  const g = getGuild(guildId);
  const count = g.flaggedWords.length;
  g.flaggedWords = [];
  persist();
  return count;
}

export function listWords(guildId) {
  return [...getGuild(guildId).flaggedWords];
}

// --- AI detection toggle ---

export function setAiEnabled(guildId, value) {
  getGuild(guildId).aiEnabled = !!value;
  persist();
}

// Clamp to [0, 1] so an out-of-range value can never disable or spam the AI.
export function setAiThreshold(guildId, value) {
  const v = Math.max(0, Math.min(1, Number(value)));
  getGuild(guildId).aiThreshold = v;
  persist();
  return v;
}

// --- Role allowlist for command access ---

export function addAllowedRole(guildId, roleId) {
  const g = getGuild(guildId);
  if (g.allowedRoleIds.includes(roleId)) return { ok: false, reason: 'exists' };
  g.allowedRoleIds.push(roleId);
  persist();
  return { ok: true };
}

export function removeAllowedRole(guildId, roleId) {
  const g = getGuild(guildId);
  const i = g.allowedRoleIds.indexOf(roleId);
  if (i === -1) return { ok: false, reason: 'missing' };
  g.allowedRoleIds.splice(i, 1);
  persist();
  return { ok: true };
}

export function listAllowedRoles(guildId) {
  return [...getGuild(guildId).allowedRoleIds];
}
