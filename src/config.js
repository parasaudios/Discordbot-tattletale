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

// All bot settings are stored per-server in settings.json and managed entirely
// through in-Discord slash commands. No code edits or restarts are required to
// change keywords, the alert channel, or any toggle.
//
// Shape (per server): alertChannelId + per-tier channels, goodWords/badWords as
// { word, channelId, notify }[], aiTriggers as string[], plus toggles
// (logDeletes/logEdits/logBadWords), and aiEnabled/aiThreshold.
// Legacy flaggedWords/logFlagged are migrated to badWords/logBadWords on load.

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
  // Harassment / threats
  'kill yourself', 'kys', 'go die', 'you should die', 'neck yourself',
  'nobody likes you', 'i hate you',
  // Profanity / insults — the AI still judges intent, so casual swearing among
  // friends won't be flagged; only messages it reads as genuinely abusive are.
  'fuck', 'shit', 'cunt', 'bitch', 'asshole', 'dickhead', 'bastard',
  'slut', 'whore', 'prick', 'douche', 'stupid', 'idiot', 'moron',
  'dumbass', 'jackass', 'pathetic', 'ugly', 'worthless', 'piece of',
  'shut up', 'retard', 'loser',
  // Slurs (common harassment vectors)
  'faggot', 'tranny', 'nigger', 'nigga',
];

const DEFAULTS = {
  // The default/fallback alert channel. Any severity tier without its own
  // channel set falls back to this one.
  alertChannelId: null,
  // Optional per-severity-tier channels. null = fall back to alertChannelId.
  //   high   = a flagged word AND the AI both judge it harmful
  //   medium = the AI alone judges it harmful
  //   low    = flagged/triggered but judged harmless (still worth a heads-up)
  alertChannelGood: null,
  alertChannelHigh: null,
  alertChannelMedium: null,
  alertChannelLow: null,
  // Optional channels for activity logs (null = fall back to alertChannelId).
  alertChannelDeletes: null,
  alertChannelEdits: null,
  // Word lists. Each entry is { word, channelId, notify } so a word can route to
  // its own channel and ping its own user/role (null = fall back to defaults).
  //   goodWords = safe words staff want a heads-up about; NO AI check (green).
  //   badWords  = bad words; ALWAYS AI-checked so a severity tier is determined.
  goodWords: [],
  badWords: [],
  // Channels the bot monitors ("reads"). Empty = watch every channel it can see.
  // When non-empty, only these channels (and their threads) are screened/logged.
  watchChannels: [],
  logDeletes: true,
  logEdits: true,
  logBadWords: true,
  // When true (default), delete/edit logs ONLY fire for messages that matched a
  // good/bad word (trigger-related); benign deletes/edits are not logged. Turn
  // off (toggle onlyflagged) to log ALL deletes/edits as a full activity log.
  logFlaggedOnly: true,
  // When true, detect filter evasion by screening a user's recent messages
  // combined together (catches a bad word split across several messages).
  antiSplit: false,
  // Verbose debug logging (gateway firehose + per-command access diagnostic).
  debugLogging: false,
  // AI contextual scam/abuse detection (off by default; costs API usage).
  aiEnabled: false,
  // Minimum confidence (0–1) the AI must report before a message is flagged.
  // Lower = more sensitive (more alerts, more false positives); higher = stricter.
  aiThreshold: 0.6,
  // Words/phrases that gate the AI: it only runs on messages containing one of
  // these. Seeded from DEFAULT_AI_TRIGGERS; editable per server.
  aiTriggers: [...DEFAULT_AI_TRIGGERS],
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

// Surface where settings live and how many servers loaded, so a "my words reset"
// problem is diagnosable straight from the startup logs.
const serverCount = Object.keys(settings).length;
console.log(`Settings file: ${SETTINGS_PATH} (${serverCount} server${serverCount === 1 ? '' : 's'} loaded)`);
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

// Returns a server's settings, filling in any missing defaults. Defaults are
// deep-cloned so each server gets its own arrays (otherwise mutating one server's
// lists would corrupt the shared defaults for every server).
export function getServer(serverId) {
  const merged = { ...structuredClone(DEFAULTS), ...(settings[serverId] ?? {}) };

  // Migrate legacy fields from older versions.
  // flaggedWords (string[]) -> badWords ({ word, channelId, notify }[])
  if (Array.isArray(merged.flaggedWords)) {
    if (!merged.badWords?.length) {
      merged.badWords = merged.flaggedWords.map((w) => ({ word: w, channelId: null, notify: null }));
    }
    delete merged.flaggedWords;
  }
  // logFlagged (bool) -> logBadWords
  if (typeof merged.logFlagged === 'boolean') {
    if (typeof (settings[serverId] ?? {}).logBadWords !== 'boolean') merged.logBadWords = merged.logFlagged;
    delete merged.logFlagged;
  }

  settings[serverId] = merged;
  return merged;
}

// Maps a tier name to the settings key that stores its channel.
const TIER_CHANNEL_KEYS = {
  default: 'alertChannelId',
  good: 'alertChannelGood',
  high: 'alertChannelHigh',
  medium: 'alertChannelMedium',
  low: 'alertChannelLow',
  deletes: 'alertChannelDeletes',
  edits: 'alertChannelEdits',
};

// Set the channel for a tier ('default' sets the fallback used by any tier
// without its own channel). Pass channelId = null to clear a tier override so
// it falls back to the default again.
export function setTierChannel(serverId, tier, channelId) {
  const key = TIER_CHANNEL_KEYS[tier];
  if (!key) return { ok: false, reason: 'badtier' };
  getServer(serverId)[key] = channelId;
  persist();
  return { ok: true, key };
}

// Resolve which channel a given tier's alert should go to: the tier's own
// channel if set, otherwise the default alert channel.
export function channelForTier(serverId, tier) {
  const s = getServer(serverId);
  const key = TIER_CHANNEL_KEYS[tier] ?? 'alertChannelId';
  return s[key] || s.alertChannelId;
}

export function setToggle(serverId, key, value) {
  // key is one of: logDeletes, logEdits, logBadWords, debugLogging
  getServer(serverId)[key] = value;
  persist();
}

// True if ANY loaded server has debug logging on (used to gate the global gateway
// firehose, which isn't tied to a specific server).
export function anyDebugEnabled() {
  return Object.values(settings).some((s) => s?.debugLogging === true);
}

// --- Watched channels (which channels the bot monitors). Empty = all. ---

export function addWatchChannel(serverId, channelId) {
  const s = getServer(serverId);
  if (s.watchChannels.includes(channelId)) return { ok: false, reason: 'exists' };
  s.watchChannels.push(channelId);
  persist();
  return { ok: true };
}

export function removeWatchChannel(serverId, channelId) {
  const s = getServer(serverId);
  const i = s.watchChannels.indexOf(channelId);
  if (i === -1) return { ok: false, reason: 'missing' };
  s.watchChannels.splice(i, 1);
  persist();
  return { ok: true };
}

export function listWatchChannels(serverId) {
  return [...getServer(serverId).watchChannels];
}

export function clearWatchChannels(serverId) {
  const s = getServer(serverId);
  const n = s.watchChannels.length;
  s.watchChannels = [];
  persist();
  return n;
}

// --- Good / bad word management (case-insensitive, stored lowercased) ---
// Each entry: { word, channelId, notify }. channelId/notify are optional
// per-word overrides (alert channel + a user/role mention to ping).

// Add a word, or UPDATE it if it already exists (upsert). Only the fields you
// pass are changed — re-adding with a new `notify` keeps the existing `channel`,
// and vice versa. (To clear a field, remove the word and add it fresh.)
function addWordTo(list, word, channelId, notify) {
  const w = word.trim().toLowerCase();
  if (!w) return { ok: false, reason: 'empty' };
  let entry = list.find((e) => e.word === w);
  const updated = Boolean(entry);
  if (!entry) {
    entry = { word: w, channelId: null, notify: null };
    list.push(entry);
  }
  if (channelId !== null && channelId !== undefined) entry.channelId = channelId;
  if (notify !== null && notify !== undefined) entry.notify = notify;
  return { ok: true, word: w, updated, entry: { ...entry } };
}

function removeWordFrom(list, word) {
  const w = word.trim().toLowerCase();
  const i = list.findIndex((e) => e.word === w);
  if (i === -1) return { ok: false, reason: 'missing' };
  list.splice(i, 1);
  return { ok: true, word: w };
}

export function addBadWord(serverId, word, channelId, notify) {
  const g = getServer(serverId);
  const r = addWordTo(g.badWords, word, channelId, notify);
  if (r.ok) persist();
  return r;
}
export function removeBadWord(serverId, word) {
  const g = getServer(serverId);
  const r = removeWordFrom(g.badWords, word);
  if (r.ok) persist();
  return r;
}
export function clearBadWords(serverId) {
  const g = getServer(serverId);
  const n = g.badWords.length;
  g.badWords = [];
  persist();
  return n;
}
export function listBadWords(serverId) {
  return getServer(serverId).badWords.map((e) => ({ ...e }));
}

export function addGoodWord(serverId, word, channelId, notify) {
  const g = getServer(serverId);
  const r = addWordTo(g.goodWords, word, channelId, notify);
  if (r.ok) persist();
  return r;
}
export function removeGoodWord(serverId, word) {
  const g = getServer(serverId);
  const r = removeWordFrom(g.goodWords, word);
  if (r.ok) persist();
  return r;
}
export function clearGoodWords(serverId) {
  const g = getServer(serverId);
  const n = g.goodWords.length;
  g.goodWords = [];
  persist();
  return n;
}
export function listGoodWords(serverId) {
  return getServer(serverId).goodWords.map((e) => ({ ...e }));
}

// --- AI detection toggle ---

export function setAiEnabled(serverId, value) {
  getServer(serverId).aiEnabled = !!value;
  persist();
}

// Clamp to [0, 1] so an out-of-range value can never disable or spam the AI.
export function setAiThreshold(serverId, value) {
  const v = Math.max(0, Math.min(1, Number(value)));
  getServer(serverId).aiThreshold = v;
  persist();
  return v;
}

// --- AI trigger list (scam/harassment signals that gate AI screening) ---

export function addAiTrigger(serverId, phrase) {
  const g = getServer(serverId);
  const p = phrase.trim().toLowerCase();
  if (!p) return { ok: false, reason: 'empty' };
  if (g.aiTriggers.includes(p)) return { ok: false, reason: 'exists' };
  g.aiTriggers.push(p);
  persist();
  return { ok: true, phrase: p };
}

export function removeAiTrigger(serverId, phrase) {
  const g = getServer(serverId);
  const p = phrase.trim().toLowerCase();
  const i = g.aiTriggers.indexOf(p);
  if (i === -1) return { ok: false, reason: 'missing' };
  g.aiTriggers.splice(i, 1);
  persist();
  return { ok: true, phrase: p };
}

export function editAiTrigger(serverId, oldPhrase, newPhrase) {
  const g = getServer(serverId);
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
export function clearAiTriggers(serverId) {
  const g = getServer(serverId);
  g.aiTriggers = [...DEFAULT_AI_TRIGGERS];
  persist();
  return g.aiTriggers.length;
}

export function listAiTriggers(serverId) {
  return [...getServer(serverId).aiTriggers];
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

// Command access is handled natively by Discord (setDefaultMemberPermissions +
// Server Settings → Integrations), so the bot no longer stores a role allowlist.
