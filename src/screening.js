// Message screening + activity logging. This is the "brain" that decides what to
// alert on; index.js just wires Discord events to these functions. Depends on
// config, ai, matching, and discord.js — but NOT on the client, so the core can
// be exercised in tests with fake message objects.
import { EmbedBuilder, AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { getServer, channelForTier, listWatchChannels } from './config.js';
import { classifyMessage } from './ai.js';
import { findMatch, decideTier, truncate, TIERS } from './matching.js';
import { isLicensed } from './licenses.js';

// --- Tunables (env-overridable) ---------------------------------------------
const numEnv = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const SPLIT_WINDOW_MS = numEnv('SPLIT_WINDOW_MS', 30_000); // how far back to combine messages
const SPLIT_MAX_ITEMS = numEnv('SPLIT_MAX_ITEMS', 8);      // cap messages combined per user/channel
const FLOOD_COOLDOWN_MS = numEnv('FLOOD_COOLDOWN_MS', 8_000); // min gap between identical alerts (0 disables)

// --- In-memory state (bounded; swept by sweepBuffers) -----------------------
const recentByUser = new Map(); // anti-split: key -> [{content, url, ts}]
const floodSeen = new Map();    // flood control: alert-key -> last-sent ts

// Allow an alert only if an identical one (same key) hasn't fired within the
// cooldown — so a spammer repeating a bad word doesn't post 50 alerts. Returns
// true (send) at most once per cooldown window per key; sustained spam yields a
// periodic alert rather than silence.
function floodAllow(key) {
  if (FLOOD_COOLDOWN_MS <= 0) return true;
  const now = Date.now();
  const last = floodSeen.get(key);
  if (last && now - last < FLOOD_COOLDOWN_MS) return false;
  floodSeen.set(key, now);
  return true;
}

// Drop stale entries so the maps don't grow for inactive users. Call on an interval.
export function sweepBuffers() {
  const now = Date.now();
  for (const [k, items] of recentByUser) {
    const live = items.filter((i) => now - i.ts <= SPLIT_WINDOW_MS);
    if (live.length) recentByUser.set(k, live);
    else recentByUser.delete(k);
  }
  for (const [k, ts] of floodSeen) {
    if (now - ts > FLOOD_COOLDOWN_MS) floodSeen.delete(k);
  }
}

// Post an embed to a specific channel id (defaults to the server's main alert
// channel when no id is given). `notify` is an optional mention string.
export async function sendAlert(server, embed, channelId, notify) {
  const target = channelId ?? getServer(server.id).alertChannelId;
  if (!target) return;
  const channel = server.channels.cache.get(target)
    ?? (await server.channels.fetch(target).catch(() => null));
  if (!channel || !channel.isTextBased()) return;
  const payload = { embeds: [embed] };
  if (notify) {
    payload.content = notify;
    payload.allowedMentions = { parse: ['users', 'roles'] };
  }
  await channel.send(payload).catch(() => null);
}

// Whether the bot should monitor a given channel. Empty watch list = watch every
// channel; otherwise only listed channels (and threads whose parent is listed).
export function watched(serverId, channel) {
  const list = listWatchChannels(serverId);
  if (!list.length) return true;
  return list.includes(channel?.id) || (channel?.parentId && list.includes(channel.parentId));
}

// True if the content matches a configured good or bad word (i.e. it "caused a
// trigger"). Used to gate delete/edit logging when logFlaggedOnly is on.
export function messageFlagged(serverId, content) {
  if (!content) return false;
  const s = getServer(serverId);
  return Boolean(findMatch(content, s.goodWords) || findMatch(content, s.badWords));
}

// Screen a message's content for flagged words and (optionally) the Judge.
// Shared by MessageCreate and MessageUpdate so an edit can't smuggle a banned
// word past detection that only ran at post time. `origin` is 'posted'|'edited'.
export async function screenMessage(message, origin = 'posted') {
  if (message.author?.bot || !message.guild || !message.content) return;
  if (!isLicensed(message.guild.id)) return;
  if (!watched(message.guild.id, message.channel)) return;
  const settings = getServer(message.guild.id);
  const editedNote = origin === 'edited' ? ' (in an edit)' : '';
  const userId = message.author.id;

  // Edit channel (if set) overrides routing for edit-caused alerts.
  const editOverride = origin === 'edited' ? (settings.alertChannelEdits || null) : null;

  const baseFields = () => ([
    { name: 'User', value: `${message.author} (${message.author.tag})`, inline: true },
    { name: 'Channel', value: `${message.channel}`, inline: true },
  ]);

  // --- Good words: safe, notify-only, NO Judge check (green). ---
  const goodHit = findMatch(message.content, settings.goodWords);
  if (goodHit && floodAllow(`${message.guild.id}:${userId}:good:${goodHit.word}`)) {
    const embed = new EmbedBuilder()
      .setTitle(`${TIERS.good.label}${editedNote}`)
      .setColor(TIERS.good.color)
      .addFields(
        ...baseFields(),
        { name: 'Good word', value: `\`${goodHit.word}\``, inline: true },
        { name: 'Message', value: truncate(message.content) },
        { name: 'Jump', value: `[Go to message](${message.url})` },
      )
      .setTimestamp(message.createdAt);
    await sendAlert(message.guild, embed, editOverride ?? goodHit.channelId ?? channelForTier(message.guild.id, 'good'), goodHit.notify);
  }

  // --- Bad words: ALWAYS Judge-checked so a severity tier can be determined. ---
  const badHit = settings.logBadWords ? findMatch(message.content, settings.badWords) : null;

  let aiResult = null;
  if (settings.aiEnabled) {
    if (badHit) aiResult = await classifyMessage(message.content);
    else if (findMatch(message.content, settings.aiTriggers)) aiResult = await classifyMessage(message.content);
  }
  const aiHarmful = Boolean(aiResult?.flag && aiResult.confidence >= settings.aiThreshold);
  const aiCleared = Boolean(aiResult && !aiHarmful);

  const tier = decideTier({ badHit: Boolean(badHit), aiHarmful, aiCleared });
  if (!tier) return; // nothing severity-worthy

  // Flood control: at most one identical severity alert per cooldown.
  const floodKey = `${message.guild.id}:${userId}:${tier}:${badHit?.word || aiResult?.category || 'judge'}`;
  if (!floodAllow(floodKey)) return;

  const fields = baseFields();
  if (badHit) fields.push({ name: 'Bad word', value: `\`${badHit.word}\``, inline: true });
  if (aiResult) {
    const verdict = aiHarmful
      ? `${aiResult.category} (${Math.round(aiResult.confidence * 100)}%)`
      : `harmless (${aiResult.category || 'none'})`;
    fields.push({ name: 'Verdict', value: verdict, inline: true });
    if (aiResult.reason) fields.push({ name: 'Reasoning', value: truncate(aiResult.reason, 256) });
  }
  fields.push(
    { name: 'Message', value: truncate(message.content) },
    { name: 'Jump', value: `[Go to message](${message.url})` },
  );

  const embed = new EmbedBuilder()
    .setTitle(`${TIERS[tier].label}${editedNote}`)
    .setColor(TIERS[tier].color)
    .addFields(fields)
    .setTimestamp(message.createdAt);

  const channelId = editOverride ?? badHit?.channelId ?? channelForTier(message.guild.id, tier);
  await sendAlert(message.guild, embed, channelId, badHit?.notify);
}

// Anti-evasion: catch a bad word split across several messages ("c","u","n","t"
// or "kill" / "yourself"). Combines a short rolling window of a user's recent
// messages; alerts when the COMBINED text matches a bad word but no single
// message does. Opt-in (antiSplit toggle).
export async function screenSplitEvasion(message) {
  if (message.author?.bot || !message.guild || !message.content) return;
  if (!isLicensed(message.guild.id)) return;
  const s = getServer(message.guild.id);
  if (!s.antiSplit || !s.badWords.length) return;
  if (!watched(message.guild.id, message.channel)) return;

  const key = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
  const now = Date.now();
  let buf = (recentByUser.get(key) || []).filter((i) => now - i.ts <= SPLIT_WINDOW_MS);
  buf.push({ content: message.content, url: message.url, ts: now });
  if (buf.length > SPLIT_MAX_ITEMS) buf = buf.slice(-SPLIT_MAX_ITEMS);
  recentByUser.set(key, buf);
  if (buf.length < 2) return; // need at least two messages to be a "split"

  const combined = buf.map((i) => i.content).join(' ');
  const comboHit = findMatch(combined, s.badWords);
  if (!comboHit) return;
  // If any single message already matches on its own, it was alerted normally.
  if (buf.some((i) => findMatch(i.content, s.badWords))) return;

  recentByUser.delete(key); // reset so we don't re-alert on every later message

  // Optionally let the Judge weigh in on the combined text.
  let aiResult = null;
  if (s.aiEnabled) aiResult = await classifyMessage(combined);

  const fields = [
    { name: 'User', value: `${message.author} (${message.author.tag})`, inline: true },
    { name: 'Channel', value: `${message.channel}`, inline: true },
    { name: 'Bad word (combined)', value: `\`${comboHit.word}\``, inline: true },
  ];
  if (aiResult) {
    const harmful = Boolean(aiResult.flag && aiResult.confidence >= s.aiThreshold);
    fields.push({ name: 'Verdict', value: harmful ? `${aiResult.category} (${Math.round(aiResult.confidence * 100)}%)` : `harmless (${aiResult.category || 'none'})`, inline: true });
  }
  fields.push(
    { name: 'Messages', value: truncate(buf.map((i) => i.content).join('  ⏐  ')) },
    { name: 'Jump', value: `[Latest message](${message.url})` },
  );

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Possible filter evasion — split messages')
    .setColor(0xE67E22)
    .addFields(fields)
    .setTimestamp(new Date());
  const channelId = comboHit.channelId ?? channelForTier(message.guild.id, 'high');
  await sendAlert(message.guild, embed, channelId, comboHit.notify);
}

// Best-effort: who removed a message (a mod vs the author). Discord only logs
// deletions of OTHER people's messages in the audit log (self-deletes aren't
// logged), and entries are aggregated — so this is heuristic. Returns the
// executor user or null. Needs View Audit Log.
async function whoDeleted(guild, message) {
  try {
    const me = guild.members?.me;
    if (!me?.permissions?.has(PermissionFlagsBits.ViewAuditLog)) return null;
    if (!message.author) return null;
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 5 });
    const now = Date.now();
    for (const entry of logs.entries.values()) {
      const recent = now - entry.createdTimestamp < 10_000;
      const sameAuthor = entry.targetId === message.author.id;
      const sameChannel = (entry.extra?.channel?.id ?? entry.extra?.channelId) === message.channelId;
      if (recent && sameAuthor && sameChannel && entry.executorId !== message.author.id) {
        return entry.executor;
      }
    }
  } catch { /* no permission / fetch failed — fall through */ }
  return null;
}

export async function handleDelete(message) {
  if (!message.guild || message.author?.bot) return;
  if (!isLicensed(message.guild.id)) return;
  const s = getServer(message.guild.id);
  if (!s.logDeletes) return;
  if (!watched(message.guild.id, message.channel)) return;
  if (s.logFlaggedOnly && !messageFlagged(message.guild.id, message.content)) return;

  const remover = await whoDeleted(message.guild, message);
  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message deleted')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Author', value: message.author ? `${message.author} (${message.author.tag})` : '*Unknown (uncached)*', inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Deleted by', value: remover ? `${remover} (${remover.tag})` : '*self-deleted or unknown*', inline: true },
      { name: 'Content', value: truncate(message.content) },
    )
    .setTimestamp(new Date());
  await sendAlert(message.guild, embed, channelForTier(message.guild.id, 'deletes'));
}

export async function handleBulkDelete(messages, channel) {
  const server = channel.guild;
  if (!server) return;
  if (!isLicensed(server.id)) return;
  const s = getServer(server.id);
  if (!s.logDeletes) return;
  if (!watched(server.id, channel)) return;

  let human = [...messages.values()].filter((m) => !m.author?.bot);
  if (s.logFlaggedOnly) human = human.filter((m) => messageFlagged(server.id, m.content));
  if (s.logFlaggedOnly && !human.length) return;
  const lines = human.slice(0, 15).map((m) => {
    const who = m.author ? m.author.tag : 'Unknown (uncached)';
    return `**${who}:** ${truncate(m.content || '*no cached content*', 120)}`;
  });
  const more = human.length > 15 ? `\n…and ${human.length - 15} more` : '';

  const embed = new EmbedBuilder()
    .setTitle('🧹 Bulk message delete')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Channel', value: `${channel}`, inline: true },
      { name: s.logFlaggedOnly ? 'Flagged deleted' : 'Total deleted', value: `${s.logFlaggedOnly ? human.length : messages.size}`, inline: true },
      { name: 'Cached messages', value: lines.length ? truncate(lines.join('\n') + more) : '*None were cached, so content is unavailable.*' },
    )
    .setTimestamp(new Date());
  await sendAlert(server, embed, channelForTier(server.id, 'deletes'));
}

export async function handleEdit(oldMessage, newMessage) {
  if (!newMessage.guild) return;
  if (!isLicensed(newMessage.guild.id)) return;
  // Only a real user content edit sets editedTimestamp (filters embeds/pins).
  if (!newMessage.editedTimestamp) return;
  if (newMessage.partial) {
    newMessage = await newMessage.fetch().catch(() => null);
    if (!newMessage) return;
  }
  if (newMessage.author?.bot) return;
  if (!oldMessage.partial && oldMessage.content === newMessage.content) return;
  if (!watched(newMessage.guild.id, newMessage.channel)) return;

  const s = getServer(newMessage.guild.id);
  const flaggedEdit = !s.logFlaggedOnly
    || messageFlagged(newMessage.guild.id, oldMessage.content)
    || messageFlagged(newMessage.guild.id, newMessage.content);
  if (s.logEdits && flaggedEdit) {
    const embed = new EmbedBuilder()
      .setTitle('✏️ Message edited')
      .setColor(0x5865F2)
      .addFields(
        { name: 'User', value: newMessage.author ? `${newMessage.author} (${newMessage.author.tag})` : '*Unknown (uncached)*', inline: true },
        { name: 'Channel', value: `${newMessage.channel}`, inline: true },
        { name: 'Before', value: oldMessage.partial ? '*Unknown (uncached)*' : truncate(oldMessage.content) },
        { name: 'After', value: truncate(newMessage.content) },
        { name: 'Jump', value: `[Go to message](${newMessage.url})` },
      )
      .setTimestamp(new Date());
    await sendAlert(newMessage.guild, embed, channelForTier(newMessage.guild.id, 'edits'));
  }

  // Re-screen the edited content so a banned word edited in after posting is caught.
  await screenMessage(newMessage, 'edited');
}
