import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Settings are written to DATA_DIR if set (e.g. a mounted Railway volume so
// config survives redeploys), otherwise the project root for local use.
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');
const SETTINGS_PATH = join(DATA_DIR, 'settings.json');

// Make sure the directory exists, so a DATA_DIR pointing at a not-yet-created
// path (a common cause of silent "settings won't save" failures) doesn't make
// every write throw ENOENT. (For persistence across redeploys, DATA_DIR still
// needs to be a *mounted volume* — see DEPLOYMENT.md.)
try {
  mkdirSync(DATA_DIR, { recursive: true });
} catch (err) {
  console.error(`Could not create settings directory ${DATA_DIR}: ${err.message}`);
}

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

// Built-in scam/harassment signal words & phrases. The AI is only invoked on a
// message that contains one of these (so API calls happen only when something
// looks worth checking — the AI then judges intent). Admins can add/remove/edit
// this list; clearing it restores exactly this default set.
export const DEFAULT_AI_TRIGGERS = [
  // Scam / phishing signals
  'http', 'discord.gg', 'nitro', 'free nitro', 'airdrop', 'giveaway',
  'claim your', 'crypto', 'wallet', 'seed phrase', 'dm me', 'click here',
  'verify your', 'account will be', 'free robux', 'steam gift',
  'password reset', 'login here',
  // Harassment / abuse signals
  'kill yourself', 'kys', 'go die', 'you should die', 'neck yourself',
  'nobody likes you', 'worthless', 'i hate you', 'retard', 'loser',
];

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
  // Words/phrases that gate the AI: it only runs on messages containing one of
  // these. Seeded from DEFAULT_AI_TRIGGERS; editable per guild.
  aiTriggers: [...DEFAULT_AI_TRIGGERS],
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
    try {
      writeFileSync(SETTINGS_PATH, json);
    } catch (err) {
      // Surface the real reason (ENOENT/EACCES/EROFS...) so the cause of a
      // failed save is obvious in the logs, then re-throw so the command
      // visibly fails rather than silently losing data.
      console.error(
        `❌ Failed to save settings to ${SETTINGS_PATH}: ${err.message}. ` +
        'Changes will be lost on restart. Check that DATA_DIR points at a ' +
        'mounted, writable volume.',
      );
      throw err;
    }
  }
}

// Returns a guild's settings, filling in any missing defaults. Defaults are
// deep-cloned so each guild gets its own arrays (otherwise mutating one guild's
// flaggedWords/aiTriggers would corrupt the shared defaults for every guild).
export function getGuild(guildId) {
  settings[guildId] = { ...structuredClone(DEFAULTS), ...(settings[guildId] ?? {}) };
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

// --- AI trigger list (scam/harassment signals that gate AI screening) ---

export function addAiTrigger(guildId, phrase) {
  const g = getGuild(guildId);
  const p = phrase.trim().toLowerCase();
  if (!p) return { ok: false, reason: 'empty' };
  if (g.aiTriggers.includes(p)) return { ok: false, reason: 'exists' };
  g.aiTriggers.push(p);
  persist();
  return { ok: true, phrase: p };
}

export function removeAiTrigger(guildId, phrase) {
  const g = getGuild(guildId);
  const p = phrase.trim().toLowerCase();
  const i = g.aiTriggers.indexOf(p);
  if (i === -1) return { ok: false, reason: 'missing' };
  g.aiTriggers.splice(i, 1);
  persist();
  return { ok: true, phrase: p };
}

export function editAiTrigger(guildId, oldPhrase, newPhrase) {
  const g = getGuild(guildId);
  const oldP = oldPhrase.trim().toLowerCase();
  const newP = newPhrase.trim().toLowerCase();
  if (!newP) return { ok: false, reason: 'empty' };
  const i = g.aiTriggers.indexOf(oldP);
  if (i === -1) return { ok: false, reason: 'missing' };
  if (g.aiTriggers.includes(newP)) return { ok: false, reason: 'exists' };
  g.aiTriggers[i] = newP;
  persist();
  return { ok: true, oldPhrase: oldP, newPhrase: newP };
}

// Clearing restores the built-in default set rather than emptying the list, so
// the AI keeps a sensible baseline of scam/harassment signals to watch for.
export function clearAiTriggers(guildId) {
  const g = getGuild(guildId);
  g.aiTriggers = [...DEFAULT_AI_TRIGGERS];
  persist();
  return g.aiTriggers.length;
}

export function listAiTriggers(guildId) {
  return [...getGuild(guildId).aiTriggers];
}

// Where settings are stored and whether persistence is configured. Surfaced in
// /tattletale settings so a "my words keep resetting" problem is visible in
// Discord without reading host logs.
export function storageInfo() {
  return {
    path: SETTINGS_PATH,
    dataDirSet: Boolean(process.env.DATA_DIR),
    fileExists: existsSync(SETTINGS_PATH),
  };
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
