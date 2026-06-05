import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

function persist() {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
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
