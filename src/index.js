import 'dotenv/config';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import {
  getServer,
  setTierChannel,
  channelForTier,
  setToggle,
  addBadWord,
  removeBadWord,
  clearBadWords,
  listBadWords,
  addGoodWord,
  removeGoodWord,
  clearGoodWords,
  listGoodWords,
  setAiEnabled,
  setAiThreshold,
  storageInfo,
  addAiTrigger,
  removeAiTrigger,
  editAiTrigger,
  clearAiTriggers,
  listAiTriggers,
  anyDebugEnabled,
  addWatchChannel,
  removeWatchChannel,
  listWatchChannels,
  clearWatchChannels,
} from './config.js';
import { classifyMessage } from './ai.js';
import { command } from './deploy-commands.js';

const commandJSON = command.toJSON();

// Timestamp every log line so output can be correlated to the exact moment the
// host reports a crash/restart. Installed before anything else logs.
for (const method of ['log', 'warn', 'error']) {
  const original = console[method].bind(console);
  console[method] = (...args) => original(`[${new Date().toISOString()}]`, ...args);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// Normalize text to defeat common filter-evasion so the keyword list catches
// stretched/disguised spellings, not just the exact word:
//   • lowercase
//   • map common leetspeak to letters (p0op, p00p → poop; @→a, $→s, etc.)
//   • strip separators/punctuation/emoji (so "p o o p", "p.o.o.p", "p-o-o-p"
//     all collapse to "poop")
//   • squash runs of 3+ repeated characters down to 2 (so "pooooop" → "poop",
//     while a deliberate double letter like "poop" is preserved)
// The message and each flagged word are normalized the same way, then matched
// as a substring — so "poop" also catches "poops", "poopy", etc.
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[@4]/g, 'a')
    .replace(/8/g, 'b')
    .replace(/[(<{]/g, 'c')
    .replace(/3/g, 'e')
    .replace(/9/g, 'g')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/2/g, 'z')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/(.)\1{2,}/g, '$1$1');
}

// Returns the configured flagged word the message matches (substring, after
// normalization), or null. Recomputed per message so word-list edits take
// effect immediately, no restart.
// Entries may be plain strings (aiTriggers) or { word, channelId, notify }
// objects (good/bad words). Returns the matching entry (string or object) or null.
function findMatch(content, entries) {
  if (!entries.length) return null;
  const haystack = normalize(content);
  if (!haystack) return null;
  for (const e of entries) {
    const word = typeof e === 'string' ? e : e.word;
    const needle = normalize(word);
    if (needle && haystack.includes(needle)) return e;
  }
  return null;
}

function truncate(text, max = 1024) {
  if (!text) return '*(no text content)*';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Parse one or more user/role mentions from a free-text `notify:` option into a
// normalized, de-duped mention string (e.g. "<@1> <@&2>"). Non-mention text is
// ignored. Returns null if no valid mentions are found.
function parseMentions(input) {
  if (!input) return null;
  const out = [];
  const re = /<@!?(\d+)>|<@&(\d+)>/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ? `<@${m[1]}>` : `<@&${m[2]}>`);
  }
  const unique = [...new Set(out)];
  return unique.length ? unique.join(' ') : null;
}

// Whether the bot should monitor a given channel. Empty watch list = watch every
// channel; otherwise only listed channels (and threads whose parent is listed).
function watched(serverId, channel) {
  const list = listWatchChannels(serverId);
  if (!list.length) return true;
  return list.includes(channel?.id) || (channel?.parentId && list.includes(channel.parentId));
}

// True if the content matches a configured good or bad word (i.e. it "caused a
// trigger"). Used to gate delete/edit logging when logFlaggedOnly is on.
function messageFlagged(serverId, content) {
  if (!content) return false;
  const s = getServer(serverId);
  return Boolean(findMatch(content, s.goodWords) || findMatch(content, s.badWords));
}

// Pure severity decision (extracted so it can be unit-tested):
//   high   = bad word AND AI confirmed harmful
//   medium = AI confirmed harmful with no bad word (caught via AI trigger)
//   low    = bad word not confirmed harmful, OR an AI-trigger msg cleared as harmless
//   null   = nothing severity-worthy
function decideTier({ badHit, aiHarmful, aiCleared }) {
  if (badHit && aiHarmful) return 'high';
  if (aiHarmful) return 'medium';
  if (badHit) return 'low';
  if (aiCleared) return 'low';
  return null;
}

// Post an embed to a specific channel id (defaults to the server's main alert
// channel when no id is given). `notify` is an optional mention string
// (<@user> or <@&role>) to ping alongside the alert.
async function sendAlert(server, embed, channelId, notify) {
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

// Severity tiers, their colour, and a label for the alert title.
const TIERS = {
  high: { color: 0xED4245, label: '🔴 High alert — bad word + Judge confirmed harmful' },
  medium: { color: 0xE67E22, label: '🟠 Warning — Judge flagged as harmful' },
  low: { color: 0xF1C40F, label: '🟡 Notice — flagged but likely harmless' },
  good: { color: 0x57F287, label: '✅ Good word used (safe)' },
};

// Register the /tattletale command in every server the bot is currently in, and
// clear any leftover global copies. Called on startup; guildCreate handles servers
// joined later. Per-server (guild) commands appear instantly and keep the
// permission lock — no global ~1h wait and no SERVER_ID juggling needed.
async function registerCommandsEverywhere(c) {
  try {
    await c.application.commands.set([]); // clear stale GLOBAL commands (we use per-server)
  } catch (err) {
    console.error('Could not clear global commands:', err?.message || err);
  }
  for (const server of c.guilds.cache.values()) {
    try {
      await server.commands.set([commandJSON]);
      console.log(`Registered /tattletale in "${server.name}" (${server.id}).`);
    } catch (err) {
      console.error(`Could not register commands in ${server.id}:`, err?.message || err);
    }
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Tattletale online as ${c.user.tag}`);

  // Register slash commands in every server the bot is in, right now. Guild
  // commands appear instantly (no ~1h global wait) and carry the Manage Server
  // permission lock. We also clear any stale GLOBAL commands so there's no
  // unrestricted duplicate. New servers are handled by the guildCreate listener.
  await registerCommandsEverywhere(c);

  // Auto-set the bot's username. Discord limits username changes to ~2/hour, so
  // only rename when it's actually wrong (skips on every normal restart). Set
  // BOT_NAME to override the target name; defaults to "TattleTale".
  const desiredName = process.env.BOT_NAME || 'TattleTale';
  if (c.user.username !== desiredName) {
    try {
      await c.user.setUsername(desiredName);
      console.log(`Renamed bot username → "${desiredName}".`);
    } catch (err) {
      console.error(
        `Could not rename bot to "${desiredName}": ${err?.message || err}. `
        + 'Discord limits username changes to ~2/hour — it will retry on the next restart, '
        + 'or set it manually in the Developer Portal (General Information → Name, and Bot → Username).',
      );
    }
  }

  // Also set a per-server nickname so the display name is correct immediately,
  // even if the global username change is rate-limited.
  for (const server of c.guilds.cache.values()) {
    try {
      const me = server.members.me ?? (await server.members.fetchMe().catch(() => null));
      if (me && me.nickname !== desiredName && me.user.username !== desiredName) {
        await me.setNickname(desiredName);
      }
    } catch { /* missing Change Nickname permission — non-fatal */ }
  }
});

// Register the command (and set the nickname) the instant the bot is added to a
// new server — so commands show up within seconds, no SERVER_ID or 1h global wait.
client.on(Events.GuildCreate, async (server) => {
  try {
    await server.commands.set([commandJSON]);
    console.log(`Joined "${server.name}" (${server.id}) — registered /tattletale.`);
  } catch (err) {
    console.error(`Could not register commands in new server ${server.id}:`, err?.message || err);
  }
  try {
    const desiredName = process.env.BOT_NAME || 'TattleTale';
    const me = server.members.me ?? (await server.members.fetchMe().catch(() => null));
    if (me && me.nickname !== desiredName && me.user.username !== desiredName) await me.setNickname(desiredName);
  } catch { /* non-fatal */ }
});

// Screen a message's content for flagged words and (optionally) AI-detected
// abuse. Shared by MessageCreate and MessageUpdate so an edit can't smuggle a
// banned word / scam link past detection that only ran at post time.
// `origin` is shown in the alert ('posted' vs 'edited').
async function screenMessage(message, origin = 'posted') {
  if (message.author?.bot || !message.guild || !message.content) return;
  if (!watched(message.guild.id, message.channel)) return;
  const settings = getServer(message.guild.id);
  const editedNote = origin === 'edited' ? ' (in an edit)' : '';

  // If this alert came from an edit AND an Edit channel is set, that channel
  // overrides the normal routing — all edit-caused alerts go to the one Edit
  // channel (not split by severity). If no Edit channel is set, alerts route by
  // severity/per-word as usual. null = no override.
  const editOverride = origin === 'edited' ? (settings.alertChannelEdits || null) : null;

  const baseFields = () => ([
    { name: 'User', value: `${message.author} (${message.author.tag})`, inline: true },
    { name: 'Channel', value: `${message.channel}`, inline: true },
  ]);

  // --- Good words: safe, notify-only, NO AI check (green). ---
  const goodHit = findMatch(message.content, settings.goodWords);
  if (goodHit) {
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

  // --- Bad words: ALWAYS AI-checked so a severity tier can be determined. ---
  const badHit = settings.logBadWords ? findMatch(message.content, settings.badWords) : null;

  // The AI runs when a bad word is present, OR (no bad word) when an AI-trigger
  // phrase is present. Good-word-only messages never reach the AI.
  let aiResult = null;
  if (settings.aiEnabled) {
    if (badHit) {
      aiResult = await classifyMessage(message.content);
    } else if (findMatch(message.content, settings.aiTriggers)) {
      aiResult = await classifyMessage(message.content);
    }
  }
  const aiHarmful = Boolean(aiResult?.flag && aiResult.confidence >= settings.aiThreshold);
  const aiCleared = Boolean(aiResult && !aiHarmful);

  // Decide whether to emit a severity (bad/AI) alert, and which tier.
  const tier = decideTier({ badHit: Boolean(badHit), aiHarmful, aiCleared });
  if (!tier) return; // nothing severity-worthy

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

  // Edit channel (if set) overrides; otherwise a bad word routes to its own
  // channel/ping if set, then the severity tier channel, then the default.
  const channelId = editOverride ?? badHit?.channelId ?? channelForTier(message.guild.id, tier);
  await sendAlert(message.guild, embed, channelId, badHit?.notify);
}

// --- Flagged-word scanning + AI contextual detection ---
client.on(Events.MessageCreate, (message) => {
  screenMessage(message, 'posted');
  screenSplitEvasion(message);
});

// Anti-evasion: catch a bad word split across several messages ("c","u","n","t"
// or "kill" / "yourself"). Keeps a short rolling window of each user's recent
// messages per channel; if the COMBINED text matches a bad word but no single
// message in the window does, it's flagged as evasion. Opt-in (antiSplit toggle).
const SPLIT_WINDOW_MS = 30_000; // how far back to combine
const SPLIT_MAX_ITEMS = 8;      // cap messages combined per user/channel
const recentByUser = new Map(); // key: guild:channel:user -> [{content, url, ts}]

async function screenSplitEvasion(message) {
  if (message.author?.bot || !message.guild || !message.content) return;
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
  // If any single message already matches on its own, it was alerted normally —
  // not evasion. Only alert when the match only appears once combined.
  if (buf.some((i) => findMatch(i.content, s.badWords))) return;

  recentByUser.delete(key); // reset so we don't re-alert on every later message

  const embed = new EmbedBuilder()
    .setTitle('⚠️ Possible filter evasion — split messages')
    .setColor(0xE67E22)
    .addFields(
      { name: 'User', value: `${message.author} (${message.author.tag})`, inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Bad word (combined)', value: `\`${comboHit.word}\``, inline: true },
      { name: 'Messages', value: truncate(buf.map((i) => i.content).join('  ⏐  ')) },
      { name: 'Jump', value: `[Latest message](${message.url})` },
    )
    .setTimestamp(new Date());
  const channelId = comboHit.channelId ?? channelForTier(message.guild.id, 'high');
  await sendAlert(message.guild, embed, channelId, comboHit.notify);
}

// --- Deleted messages ---
client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;
  const s = getServer(message.guild.id);
  if (!s.logDeletes) return;
  if (!watched(message.guild.id, message.channel)) return;
  // Only log trigger-related deletes when logFlaggedOnly is on.
  if (s.logFlaggedOnly && !messageFlagged(message.guild.id, message.content)) return;

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message deleted')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'User', value: message.author ? `${message.author} (${message.author.tag})` : '*Unknown (uncached)*', inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Content', value: truncate(message.content) },
    )
    .setTimestamp(new Date());
  await sendAlert(message.guild, embed, channelForTier(message.guild.id, 'deletes'));
});

// --- Bulk-deleted messages (purges, ban-with-message-delete, mod tools) ---
// This is a SEPARATE gateway event from MessageDelete; without it, mass deletes
// would never be logged. Uncached messages arrive with only an ID.
client.on(Events.MessageBulkDelete, async (messages, channel) => {
  const server = channel.guild;
  if (!server) return;
  const s = getServer(server.id);
  if (!s.logDeletes) return;
  if (!watched(server.id, channel)) return;

  let human = [...messages.values()].filter((m) => !m.author?.bot);
  // When logFlaggedOnly is on, only report the messages that matched a word.
  if (s.logFlaggedOnly) human = human.filter((m) => messageFlagged(server.id, m.content));
  if (s.logFlaggedOnly && !human.length) return; // nothing trigger-related in this purge
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
      {
        name: 'Cached messages',
        value: lines.length ? truncate(lines.join('\n') + more) : '*None were cached, so content is unavailable.*',
      },
    )
    .setTimestamp(new Date());
  await sendAlert(server, embed, channelForTier(server.id, 'deletes'));
});

// --- Edited messages ---
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild) return;

  // Discord also fires MessageUpdate for non-edits (a link auto-embedding, a
  // pin, etc.). Only a real user content edit sets editedTimestamp, so this
  // single check removes those false positives — even for uncached messages,
  // where the old content==new comparison below can't help.
  if (!newMessage.editedTimestamp) return;

  // Resolve a partial (uncached) message so we have author + content to work with.
  if (newMessage.partial) {
    newMessage = await newMessage.fetch().catch(() => null);
    if (!newMessage) return;
  }
  if (newMessage.author?.bot) return;
  if (!oldMessage.partial && oldMessage.content === newMessage.content) return;
  if (!watched(newMessage.guild.id, newMessage.channel)) return;

  const es = getServer(newMessage.guild.id);
  const flaggedEdit = !es.logFlaggedOnly
    || messageFlagged(newMessage.guild.id, oldMessage.content)
    || messageFlagged(newMessage.guild.id, newMessage.content);
  if (es.logEdits && flaggedEdit) {
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

  // Re-screen the edited content so a banned word / scam edited in after posting
  // is still caught.
  await screenMessage(newMessage, 'edited');
});

// --- Slash commands ---
const reply = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'tattletale') return;

  // Access control is handled by Discord natively: the command is registered with
  // setDefaultMemberPermissions(ManageGuild), and a server admin can grant extra
  // roles/members via Server Settings → Integrations → Tattletale. Any interaction
  // that reaches us has already been authorized by Discord, so there's no extra
  // permission gate here.

  const serverId = interaction.guild.id;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  // --- Access diagnostic (opt-in) ----------------------------------------------
  // Logs who invoked the command, the requirement, whether they meet it (and how),
  // and whether they used the SERVER command (permission-locked) or a stale GLOBAL
  // command (no lock). Off by default; enable with `/tattletale toggle feature:debug`
  // (or LOG_ACCESS_DIAG=true). Posts to the alert channel + console.
  if (process.env.LOG_ACCESS_DIAG === 'true' || getServer(serverId).debugLogging) try {
    const cmdPath = ['/tattletale', group, sub].filter(Boolean).join(' ');
    const hasManageServer = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    const isAdmin = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const meets = hasManageServer || isAdmin || isOwner;
    const rolesCache = interaction.member?.roles?.cache;
    const roleNames = rolesCache
      ? [...rolesCache.values()].filter((r) => r.id !== serverId).map((r) => r.name)
      : [];
    const isGlobalCmd = !interaction.commandGuildId; // null = global command was used

    console.log(
      `[access] ${interaction.user.tag} (${interaction.user.id}) -> ${cmdPath} | `
      + `scope=${isGlobalCmd ? 'GLOBAL(!)' : `server:${interaction.commandGuildId}`} | `
      + `ManageServer=${hasManageServer} Admin=${isAdmin} Owner=${isOwner} meets=${meets} | `
      + `roles=[${roleNames.join(', ')}]`,
    );

    const diag = new EmbedBuilder()
      .setTitle('🔎 Command access diagnostic')
      .setColor(meets ? 0x57F287 : 0xED4245)
      .addFields(
        { name: 'User', value: `${interaction.user} (${interaction.user.tag} · \`${interaction.user.id}\`)` },
        { name: 'Command used', value: `\`${cmdPath}\`` },
        {
          name: 'Command scope',
          value: isGlobalCmd
            ? '⚠️ **GLOBAL command** — global commands carry **no Manage Server lock**, so anyone can run them. This is almost certainly why non-admins can use it. Fix: it is auto-cleared on the next deploy, or run `npm run deploy -- --clear-global`.'
            : `✅ server command (registered to \`${interaction.commandGuildId}\`)`,
        },
        { name: 'Requirement', value: '**Manage Server** — enforced by Discord via the command\'s default permissions.' },
        { name: 'Meets requirement?', value: meets ? '✅ YES' : '❌ NO — yet Discord still delivered this command (see scope above).' },
        {
          name: 'How (breakdown)',
          value: [
            `${hasManageServer ? '✅' : '❌'} Manage Server permission`,
            `${isAdmin ? '✅' : '❌'} Administrator`,
            `${isOwner ? '✅' : '❌'} Server owner`,
            `Roles: ${roleNames.length ? roleNames.join(', ') : '*none*'}`,
          ].join('\n'),
        },
        { name: 'Result', value: '⚠️ Command **executed** — there is no in-code block; access is delegated to Discord.' },
      )
      .setTimestamp(new Date());
    await sendAlert(interaction.guild, diag);
  } catch (err) {
    console.error('Access diagnostic failed:', err?.message || err);
  }
  // --- end TEMP access diagnostic ----------------------------------------------

  try {
    // --- AI trigger list management: /tattletale judgewords <add|remove|edit|list|clear> ---
    if (group === 'judgewords') {
      switch (sub) {
        case 'add': {
          const r = addAiTrigger(serverId, interaction.options.getString('phrase'));
          if (!r.ok && r.reason === 'exists') return reply(interaction, 'That phrase is already a Judge trigger.');
          if (!r.ok) return reply(interaction, 'That phrase is empty or invalid.');
          return reply(interaction, `✅ Added \`${r.phrase}\` to the Judge trigger list. The Judge will now review messages containing it.`);
        }
        case 'remove': {
          const r = removeAiTrigger(serverId, interaction.options.getString('phrase'));
          if (!r.ok) return reply(interaction, 'That phrase is not on the Judge trigger list.');
          return reply(interaction, `✅ Removed \`${r.phrase}\` from the Judge trigger list.`);
        }
        case 'edit': {
          const r = editAiTrigger(
            serverId,
            interaction.options.getString('old'),
            interaction.options.getString('new'),
          );
          if (!r.ok && r.reason === 'missing') return reply(interaction, 'That phrase is not on the Judge trigger list.');
          if (!r.ok && r.reason === 'exists') return reply(interaction, 'The new phrase is already on the list.');
          if (!r.ok) return reply(interaction, 'The new phrase is empty or invalid.');
          return reply(interaction, `✅ Changed \`${r.oldPhrase}\` → \`${r.newPhrase}\` in the Judge trigger list.`);
        }
        case 'list': {
          const triggers = listAiTriggers(serverId);
          if (!triggers.length) return reply(interaction, 'No Judge trigger phrases set. Restore the defaults with `/tattletale judgewords clear`.');
          const body = `**Judge trigger phrases (${triggers.length}):**\n${triggers.map((t) => `\`${t}\``).join(', ')}`;
          return reply(interaction, truncate(body, 1900));
        }
        case 'clear': {
          const count = clearAiTriggers(serverId);
          return reply(interaction, `✅ Reset the Judge trigger list to the built-in defaults (${count} phrase(s)).`);
        }
        default:
          return reply(interaction, 'Unknown judgewords subcommand.');
      }
    }

    // --- Watched channels: /tattletale watch <add|remove|list|clear> ---
    if (group === 'watch') {
      switch (sub) {
        case 'add': {
          const channel = interaction.options.getChannel('channel');
          const r = addWatchChannel(serverId, channel.id);
          if (!r.ok) return reply(interaction, `${channel} is already on the watch list.`);
          return reply(interaction, `✅ Now watching ${channel} (and its threads). The bot now monitors **only** the channels on the watch list — run \`/tattletale watch clear\` to go back to watching everything.`);
        }
        case 'remove': {
          const channel = interaction.options.getChannel('channel');
          const r = removeWatchChannel(serverId, channel.id);
          if (!r.ok) return reply(interaction, `${channel} is not on the watch list.`);
          const remaining = listWatchChannels(serverId).length;
          const tail = remaining === 0 ? ' The watch list is now empty, so the bot watches **all** channels again.' : '';
          return reply(interaction, `✅ Stopped watching ${channel}.${tail}`);
        }
        case 'list': {
          const ids = listWatchChannels(serverId);
          if (!ids.length) return reply(interaction, 'Watch list is empty — the bot monitors **all** channels it can see. Add one with `/tattletale watch add`.');
          return reply(interaction, `**Watched channels (${ids.length}):**\n${ids.map((id) => `<#${id}>`).join(', ')}\n*(Only these channels + their threads are monitored.)*`);
        }
        case 'clear': {
          const n = clearWatchChannels(serverId);
          return reply(interaction, `✅ Cleared ${n} watched channel(s). The bot now monitors **all** channels it can see.`);
        }
        default:
          return reply(interaction, 'Unknown watch subcommand.');
      }
    }

    // --- Good / bad word management: /tattletale <goodword|badword> <add|remove|list|clear> ---
    if (group === 'badword' || group === 'goodword') {
      const isBad = group === 'badword';
      const fns = isBad
        ? { add: addBadWord, remove: removeBadWord, clear: clearBadWords, list: listBadWords }
        : { add: addGoodWord, remove: removeGoodWord, clear: clearGoodWords, list: listGoodWords };
      const label = isBad ? 'bad' : 'good';
      const Label = isBad ? 'Bad' : 'Good';
      const fmt = (e) => {
        const extra = [];
        if (e.channelId) extra.push(`→ <#${e.channelId}>`);
        if (e.notify) extra.push(`pings ${e.notify}`);
        return `\`${e.word}\`${extra.length ? ` (${extra.join(', ')})` : ''}`;
      };
      switch (sub) {
        case 'add': {
          const word = interaction.options.getString('word');
          const channel = interaction.options.getChannel('channel');
          if (channel && !channel.isTextBased()) return reply(interaction, 'Please choose a text channel.');
          const notify = parseMentions(interaction.options.getString('notify'));
          const r = fns.add(serverId, word, channel?.id ?? null, notify);
          if (!r.ok) return reply(interaction, 'That word is empty or invalid.');
          const e = r.entry;
          const bits = [];
          if (e.channelId) bits.push(`alerts → <#${e.channelId}>`);
          if (e.notify) bits.push(`pings ${e.notify}`);
          const detail = bits.length ? ` — ${bits.join(', ')}` : '';
          const verb = r.updated ? 'Updated' : 'Added';
          return reply(interaction, `✅ ${verb} \`${r.word}\` in the **${label}-word** list${detail}.`);
        }
        case 'remove': {
          const r = fns.remove(serverId, interaction.options.getString('word'));
          if (!r.ok) return reply(interaction, `That word is not on the ${label}-word list.`);
          return reply(interaction, `✅ Removed \`${r.word}\` from the ${label}-word list.`);
        }
        case 'clear': {
          const n = fns.clear(serverId);
          return reply(interaction, `✅ Cleared ${n} ${label} word(s).`);
        }
        case 'list': {
          const items = fns.list(serverId);
          if (!items.length) return reply(interaction, `No ${label} words set. Add one with \`/tattletale ${label}word add\`.`);
          return reply(interaction, truncate(`**${Label} words (${items.length}):**\n${items.map(fmt).join('\n')}`, 1900));
        }
        default:
          return reply(interaction, `Unknown ${label}word subcommand.`);
      }
    }

    switch (sub) {
      case 'setchannel': {
        const channel = interaction.options.getChannel('channel');
        if (!channel?.isTextBased()) return reply(interaction, 'Please choose a text channel.');
        const tier = interaction.options.getString('tier') ?? 'default';
        setTierChannel(serverId, tier, channel.id);

        // Warn up front if the bot can't actually post there, so alerts don't
        // silently vanish later.
        const me = interaction.guild.members.me;
        const perms = me ? channel.permissionsFor(me) : null;
        const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks']
          .filter((p) => !perms?.has(PermissionFlagsBits[p]))
          .map((p) => ({ ViewChannel: 'View Channel', SendMessages: 'Send Messages', EmbedLinks: 'Embed Links' }[p]));

        const tierLabel = {
          default: 'all alerts (default)',
          good: '✅ good-word notices',
          high: '🔴 high-severity alerts',
          medium: '🟠 medium (Judge-only) alerts',
          low: '🟡 low / harmless alerts',
          deletes: '🗑️ deleted-message logs',
          edits: '✏️ edited-message logs',
        }[tier];
        let msg = `✅ ${tierLabel} will now be sent to ${channel}.`;
        if (tier !== 'default') {
          msg += '\n(Any tier without its own channel falls back to the default set with `/tattletale setchannel` — no tier.)';
        }
        if (missing.length) {
          // Try to grant ourselves the missing perms in that channel. Works only
          // if the bot has Manage Roles (or Manage Channels) and a high enough role.
          let granted = false;
          try {
            await channel.permissionOverwrites.edit(me, {
              ViewChannel: true,
              SendMessages: true,
              EmbedLinks: true,
            });
            granted = true;
          } catch { /* lacks Manage Roles / can't edit overwrites */ }
          msg += granted
            ? `\n🔧 I granted myself **${missing.join(', ')}** in that channel, so alerts will post now.`
            : `\n⚠️ I'm missing **${missing.join(', ')}** there and couldn't grant it myself — I need the **Manage Roles** permission (and a role above the channel's overrides). Either give me Manage Roles, or add me to the channel manually (channel → Edit Channel → Permissions → add the bot with View Channel, Send Messages, Embed Links).`;
        }
        return reply(interaction, msg);
      }
      case 'toggle': {
        const feature = interaction.options.getString('feature');
        const enabled = interaction.options.getBoolean('enabled');
        const map = { deletes: 'logDeletes', edits: 'logEdits', badwords: 'logBadWords', debug: 'debugLogging', onlyflagged: 'logFlaggedOnly', split: 'antiSplit' };
        setToggle(serverId, map[feature], enabled);
        if (feature === 'debug') {
          return reply(interaction, `✅ Debug logging is now **${enabled ? 'ON' : 'OFF'}** (gateway firehose + per-command access diagnostic).`);
        }
        if (feature === 'split') {
          return reply(interaction, enabled
            ? '✅ **Anti-evasion** ON — the bot now also checks a user\'s recent messages combined, to catch a bad word split across several messages.'
            : '✅ **Anti-evasion** OFF — messages are only checked individually.');
        }
        if (feature === 'onlyflagged') {
          return reply(interaction, enabled
            ? '✅ **Only-flagged** mode ON — delete/edit logs now fire **only** for messages that matched a good/bad word.'
            : '✅ **Only-flagged** mode OFF — delete/edit logs fire for **all** messages again.');
        }
        return reply(interaction, `✅ Logging for **${feature}** is now **${enabled ? 'ON' : 'OFF'}**.`);
      }
      case 'judge': {
        const enabled = interaction.options.getBoolean('enabled');
        if (enabled && !process.env.ANTHROPIC_API_KEY) {
          return reply(interaction, '⚠️ Judging needs an `ANTHROPIC_API_KEY` set on the host. Add it, then enable.');
        }
        setAiEnabled(serverId, enabled);
        return reply(interaction, `✅ Contextual judging is now **${enabled ? 'ON' : 'OFF'}**.`);
      }
      case 'judgethreshold': {
        const value = setAiThreshold(serverId, interaction.options.getNumber('value'));
        return reply(
          interaction,
          `✅ Judge confidence threshold set to **${value}**. The Judge must be at least ${Math.round(value * 100)}% sure a message is abusive before it alerts (lower = more sensitive, higher = stricter).`,
        );
      }
      case 'settings': {
        const s = getServer(serverId);
        const ch = s.alertChannelId ? `<#${s.alertChannelId}>` : '*not set*';
        const tierCh = (id) => (id ? `<#${id}>` : '↳ default');
        const store = storageInfo();
        const persistence = store.dataDirSet
          ? `✅ saving to \`${store.path}\` (ensure a volume is mounted there so it survives redeploys)`
          : `⚠️ **NOT persistent** — \`DATA_DIR\` is unset, so settings are stored at \`${store.path}\` and **reset on every redeploy/restart**. Set \`DATA_DIR\` to a mounted volume path.`;
        return reply(
          interaction,
          [
            '**Tattletale settings**',
            `Alert channel (default): ${ch}`,
            `• ✅ Good-word notices: ${tierCh(s.alertChannelGood)}`,
            `• 🔴 High alerts: ${tierCh(s.alertChannelHigh)}`,
            `• 🟠 Medium alerts: ${tierCh(s.alertChannelMedium)}`,
            `• 🟡 Low/harmless alerts: ${tierCh(s.alertChannelLow)}`,
            `• 🗑️ Delete logs: ${tierCh(s.alertChannelDeletes)}`,
            `• ✏️ Edit logs: ${tierCh(s.alertChannelEdits)}`,
            `Watching: ${s.watchChannels.length ? s.watchChannels.map((id) => `<#${id}>`).join(', ') : '*all channels*'}`,
            `Log deletes: ${s.logDeletes ? 'ON' : 'OFF'}`,
            `Log edits: ${s.logEdits ? 'ON' : 'OFF'}`,
            `Only log flagged deletes/edits: ${s.logFlaggedOnly ? 'ON' : 'OFF'}`,
            `Anti-evasion (split messages): ${s.antiSplit ? 'ON' : 'OFF'}`,
            `Log bad words: ${s.logBadWords ? 'ON' : 'OFF'}`,
            `Judging: ${s.aiEnabled ? 'ON' : 'OFF'}`,
            `Judge threshold: ${s.aiThreshold} (${Math.round(s.aiThreshold * 100)}% confidence)`,
            `Debug logging: ${s.debugLogging ? 'ON' : 'OFF'}`,
            `✅ Good words: ${s.goodWords.length} · 🚫 Bad words: ${s.badWords.length} · 🤖 Judge triggers: ${s.aiTriggers.length}`,
            'Command access: Manage Server by default — manage extra roles in Server Settings → Integrations → Tattletale.',
            `Storage: ${persistence}`,
          ].join('\n'),
        );
      }
      default:
        return reply(interaction, 'Unknown subcommand.');
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) return reply(interaction, 'Something went wrong running that command.');
  }
});

// Gateway lifecycle logging — makes a restart loop or connection instability
// obvious in the host's logs (ClientReady only fires once, so it can't show
// reconnects). A healthy bot logs ShardReady once; repeated Disconnect/Resume
// lines mean it's struggling to stay connected.
client.on(Events.ShardReady, (id) => console.log(`Gateway: shard ${id} ready (connected to Discord).`));
client.on(Events.ShardResume, (id, replayed) => console.log(`Gateway: shard ${id} reconnected (resumed, ${replayed} events replayed).`));
client.on(Events.ShardReconnecting, (id) => console.warn(`Gateway: shard ${id} reconnecting…`));
client.on(Events.ShardDisconnect, (event, id) => console.warn(`Gateway: shard ${id} disconnected (code ${event?.code}).`));
client.on(Events.ShardError, (err, id) => console.error(`Gateway: shard ${id} error:`, err.message));

// Keep the process alive on stray errors: discord.js handles its own gateway
// reconnects, and a single bad event, rejected promise, or uncaught throw
// shouldn't crash the whole bot (which the host would report as a failed deploy).
client.on(Events.Error, (err) => console.error('Client error:', err));
// uncaughtExceptionMonitor fires for EVERY uncaught exception (even though the
// uncaughtException handler below keeps us alive) and gives the full stack +
// origin — so a real code crash is always captured in the logs.
process.on('uncaughtExceptionMonitor', (err, origin) => console.error(`uncaughtExceptionMonitor [${origin}]:`, err?.stack || err));
process.on('uncaughtException', (err) => console.error('Uncaught exception (kept alive):', err?.stack || err));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection (kept alive):', reason?.stack || reason));
process.on('warning', (w) => console.warn('Node warning:', w?.stack || w?.message || w));
process.on('beforeExit', (code) => console.log(`beforeExit (event loop empty) with code ${code}.`));

// Shut down cleanly when the host stops the container (Railway sends SIGTERM on
// every redeploy). Without this, Node's default SIGTERM handling exits with code
// 143 (non-zero), which Railway flags as a "crash" and emails about — on every
// single deploy. Exiting 0 makes replacement deploys graceful and silent.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal} — shutting down cleanly (exit 0).`);
  try { client.destroy(); } catch { /* ignore */ }
  process.exit(0);
}
// Catch every stop signal a host might send. NOTE: this only works if signals
// reach THIS process — running via `npm start` means npm gets the signal and
// doesn't forward it, so production must run `node src/index.js` directly
// (see railway.json) for these handlers to fire.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT']) {
  process.on(sig, () => shutdown(sig));
}
// Last-resort visibility: always log the final exit code so a "crash" in the
// host dashboard can be matched to an actual code (0 = clean, 137 = SIGKILL/OOM).
process.on('exit', (code) => console.log(`Process exiting with code ${code}.`));

// Only connect to Discord when run directly (npm start) — importing this module
// for tests/tooling should not attempt a login. screenMessage/findMatch/decideTier
// are exported so the screening logic can be unit-tested in isolation.
export { screenMessage, findMatch, decideTier, screenSplitEvasion };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // Startup diagnostic banner — printed to the host's Deploy Logs (e.g. Railway)
  // so a failed start shows *exactly* what's configured, without leaking secrets.
  // Logs presence (set/MISSING), never the values.
  const present = (v) => (process.env[v] ? 'set' : '— MISSING');
  console.log('──────────────────────────────────────────');
  console.log('Tattletale starting up…');
  console.log(`  Node:              ${process.version}`);
  console.log(`  DISCORD_TOKEN:     ${present('DISCORD_TOKEN')}`);
  console.log(`  CLIENT_ID:         ${present('CLIENT_ID')}`);
  console.log(`  SERVER_ID:         ${(process.env.SERVER_ID ?? process.env.GUILD_ID) ? 'set (instant server commands)' : 'unset (global commands, ~1h)'}`);
  console.log(`  DATA_DIR:          ${process.env.DATA_DIR ? `set (${process.env.DATA_DIR})` : 'unset (settings WIPED on redeploy)'}`);
  console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set (judging available)' : 'unset (judging disabled)'}`);
  console.log(`  PID / PPID:        ${process.pid} / ${process.ppid}`);
  // DEFINITIVE check of whether the signal-handling fix is active: if this was
  // launched by `npm start`, npm sits in front of node and eats SIGTERM (causing
  // the "crashed" emails). "direct node" means signals reach us and shutdown is clean.
  console.log(`  Launched by:       ${process.env.npm_lifecycle_event
    ? `⚠️ npm "${process.env.npm_lifecycle_event}" — npm may swallow SIGTERM (set start cmd to run node directly)`
    : '✅ direct node (SIGTERM will reach the bot)'}`);
  console.log('  Requires the privileged "Message Content Intent" (Dev Portal → Bot).');
  console.log('──────────────────────────────────────────');

  // Heartbeat: proves the bot is still alive and surfaces memory growth. If the
  // host OOM-kills the container (SIGKILL/exit 137, which CANNOT be caught), the
  // logs end right after a heartbeat showing climbing RSS — that's the evidence.
  const mb = (n) => Math.round(n / 1048576);
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(`Heartbeat: up ${Math.round(process.uptime())}s | rss ${mb(m.rss)}MB | heap ${mb(m.heapUsed)}/${mb(m.heapTotal)}MB | discord ${client.isReady() ? 'ready' : 'DOWN'} | ws ping ${Math.round(client.ws?.ping ?? -1)}ms`);
  }, 30000).unref();

  // Firehose: discord.js internal gateway log (heartbeats, resumes, session
  // invalidations, rate limits). Off by default — enable per server with
  // `/tattletale toggle feature:debug` (or globally with LOG_DISCORD_DEBUG=true).
  // The listener is always attached but only prints when debug is on. Warnings stay on.
  const debugForced = process.env.LOG_DISCORD_DEBUG === 'true';
  client.on(Events.Warn, (m) => console.warn('[discord:warn]', m));
  client.on(Events.Debug, (m) => { if (debugForced || anyDebugEnabled()) console.log('[discord:debug]', m); });

  // Tiny HTTP server so platform healthchecks (e.g. Railway) get a 200 response.
  // A Discord bot has no web server of its own, so without this a configured
  // healthcheck times out and the host marks the deploy "failed" — even though
  // the bot is running fine. Binds the host-provided $PORT (falls back to 3000).
  const healthPort = process.env.PORT || 3000;
  http.createServer((req, res) => {
    const status = client.isReady() ? 'ready' : 'starting';
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Tattletale ${status}\n`);
  })
    .listen(healthPort, () => console.log(`Healthcheck server listening on :${healthPort}`))
    .on('error', (err) => console.error('Healthcheck server error:', err.message));

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ Missing DISCORD_TOKEN. Set it in your host\'s Variables (or .env locally).');
    process.exit(1);
  }

  // Log in with a clear, actionable message if it fails, so a crashed deploy says
  // *why* in the logs instead of dumping a raw stack trace.
  client.login(token).catch((err) => {
    const msg = err?.message || String(err);
    console.error('❌ Could not log in to Discord.');
    if (err?.code === 'TokenInvalid' || /invalid token/i.test(msg)) {
      console.error('   → The DISCORD_TOKEN is invalid or expired. Reset it in the Developer Portal (Bot → Reset Token) and update the Variables/.env.');
    } else if (err?.code === 'DisallowedIntents' || /disallowed intents/i.test(msg)) {
      console.error('   → Enable the Message Content Intent (Developer Portal → Bot → Privileged Gateway Intents), then redeploy.');
    } else {
      console.error('   →', msg);
    }
    process.exit(1);
  });
}
