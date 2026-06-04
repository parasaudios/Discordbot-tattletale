import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');
const SETTINGS_PATH = join(DATA_DIR, 'settings.json');

const DEFAULTS = {
  alertChannelId: null,
  flaggedWords: [],
  logDeletes: true,
  logEdits: true,
  logFlagged: true,
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

export function getGuild(guildId) {
  settings[guildId] = { ...DEFAULTS, ...(settings[guildId] ?? {}) };
  return settings[guildId];
}

export function setAlertChannelId(guildId, channelId) {
  getGuild(guildId).alertChannelId = channelId;
  persist();
}

export function setToggle(guildId, key, value) {
  getGuild(guildId)[key] = value;
  persist();
}

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