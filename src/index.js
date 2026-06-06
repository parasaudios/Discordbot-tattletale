import 'dotenv/config';
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
  getGuild,
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
  addAllowedRole,
  removeAllowedRole,
  listAllowedRoles,
} from './config.js';
import { classifyMessage } from './ai.js';

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

// Post an embed to a specific channel id (defaults to the guild's main alert
// channel when no id is given). `notify` is an optional mention string
// (<@user> or <@&role>) to ping alongside the alert.
async function sendAlert(guild, embed, channelId, notify) {
  const target = channelId ?? getGuild(guild.id).alertChannelId;
  if (!target) return;
  const channel = guild.channels.cache.get(target)
    ?? (await guild.channels.fetch(target).catch(() => null));
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
  high: { color: 0xED4245, label: '🔴 High alert — bad word + AI confirmed harmful' },
  medium: { color: 0xE67E22, label: '🟠 Warning — AI flagged as harmful' },
  low: { color: 0xF1C40F, label: '🟡 Notice — flagged but likely harmless' },
  good: { color: 0x57F287, label: '✅ Good word used (safe)' },
};

client.once(Events.ClientReady, (c) => {
  console.log(`Tattletale online as ${c.user.tag}`);
});

// Screen a message's content for flagged words and (optionally) AI-detected
// abuse. Shared by MessageCreate and MessageUpdate so an edit can't smuggle a
// banned word / scam link past detection that only ran at post time.
// `origin` is shown in the alert ('posted' vs 'edited').
async function screenMessage(message, origin = 'posted') {
  if (message.author?.bot || !message.guild || !message.content) return;
  const settings = getGuild(message.guild.id);
  const editedNote = origin === 'edited' ? ' (in an edit)' : '';

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
    await sendAlert(message.guild, embed, goodHit.channelId ?? settings.alertChannelId, goodHit.notify);
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
    fields.push({ name: "Berry's Delicious Coochie's Verdict", value: verdict, inline: true });
    if (aiResult.reason) fields.push({ name: "Berry's Super Sexy Butt's Reasoning", value: truncate(aiResult.reason, 256) });
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

  // A bad word routes to its own channel/ping if set; otherwise fall back to the
  // tier channel (then the default). AI-only catches use the tier channel.
  const channelId = badHit?.channelId ?? channelForTier(message.guild.id, tier);
  await sendAlert(message.guild, embed, channelId, badHit?.notify);
}

// --- Flagged-word scanning + AI contextual detection ---
client.on(Events.MessageCreate, (message) => screenMessage(message, 'posted'));

// --- Deleted messages ---
client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;
  if (!getGuild(message.guild.id).logDeletes) return;

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Message deleted')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'User', value: message.author ? `${message.author} (${message.author.tag})` : '*Unknown (uncached)*', inline: true },
      { name: 'Channel', value: `${message.channel}`, inline: true },
      { name: 'Content', value: truncate(message.content) },
    )
    .setTimestamp(new Date());
  await sendAlert(message.guild, embed);
});

// --- Bulk-deleted messages (purges, ban-with-message-delete, mod tools) ---
// This is a SEPARATE gateway event from MessageDelete; without it, mass deletes
// would never be logged. Uncached messages arrive with only an ID.
client.on(Events.MessageBulkDelete, async (messages, channel) => {
  const guild = channel.guild;
  if (!guild || !getGuild(guild.id).logDeletes) return;

  const human = [...messages.values()].filter((m) => !m.author?.bot);
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
      { name: 'Total deleted', value: `${messages.size}`, inline: true },
      {
        name: 'Cached messages',
        value: lines.length ? truncate(lines.join('\n') + more) : '*None were cached, so content is unavailable.*',
      },
    )
    .setTimestamp(new Date());
  await sendAlert(guild, embed);
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

  if (getGuild(newMessage.guild.id).logEdits) {
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
    await sendAlert(newMessage.guild, embed);
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

  // Gate everything behind Manage Server.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return reply(interaction, 'You need the **Manage Server** permission to use this.');
  }

  // Defense-in-depth: if an allowlist of roles is configured, the caller must
  // also hold one of those roles. Empty allowlist = Manage Server alone is enough.
  const allowedRoles = listAllowedRoles(interaction.guild.id);
  if (allowedRoles.length > 0) {
    const memberRoleIds = interaction.member?.roles?.cache;
    const hasRole = memberRoleIds
      ? allowedRoles.some((id) => memberRoleIds.has(id))
      : false;
    if (!hasRole) {
      return reply(interaction, 'You do not have a role authorized to use this bot.');
    }
  }

  const guildId = interaction.guild.id;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  try {
    // --- AI trigger list management: /tattletale aiwords <add|remove|edit|list|clear> ---
    if (group === 'aiwords') {
      switch (sub) {
        case 'add': {
          const r = addAiTrigger(guildId, interaction.options.getString('phrase'));
          if (!r.ok && r.reason === 'exists') return reply(interaction, 'That phrase is already an AI trigger.');
          if (!r.ok) return reply(interaction, 'That phrase is empty or invalid.');
          return reply(interaction, `✅ Added \`${r.phrase}\` to the AI trigger list. The AI will now review messages containing it.`);
        }
        case 'remove': {
          const r = removeAiTrigger(guildId, interaction.options.getString('phrase'));
          if (!r.ok) return reply(interaction, 'That phrase is not on the AI trigger list.');
          return reply(interaction, `✅ Removed \`${r.phrase}\` from the AI trigger list.`);
        }
        case 'edit': {
          const r = editAiTrigger(
            guildId,
            interaction.options.getString('old'),
            interaction.options.getString('new'),
          );
          if (!r.ok && r.reason === 'missing') return reply(interaction, 'That phrase is not on the AI trigger list.');
          if (!r.ok && r.reason === 'exists') return reply(interaction, 'The new phrase is already on the list.');
          if (!r.ok) return reply(interaction, 'The new phrase is empty or invalid.');
          return reply(interaction, `✅ Changed \`${r.oldPhrase}\` → \`${r.newPhrase}\` in the AI trigger list.`);
        }
        case 'list': {
          const triggers = listAiTriggers(guildId);
          if (!triggers.length) return reply(interaction, 'No AI trigger phrases set. Restore the defaults with `/tattletale aiwords clear`.');
          const body = `**AI trigger phrases (${triggers.length}):**\n${triggers.map((t) => `\`${t}\``).join(', ')}`;
          return reply(interaction, truncate(body, 1900));
        }
        case 'clear': {
          const count = clearAiTriggers(guildId);
          return reply(interaction, `✅ Reset the AI trigger list to the built-in defaults (${count} phrase(s)).`);
        }
        default:
          return reply(interaction, 'Unknown aiwords subcommand.');
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
          const mentionable = interaction.options.getMentionable('notify');
          const notify = mentionable ? mentionable.toString() : null;
          const r = fns.add(guildId, word, channel?.id ?? null, notify);
          if (!r.ok && r.reason === 'exists') return reply(interaction, `That word is already on the ${label}-word list.`);
          if (!r.ok) return reply(interaction, 'That word is empty or invalid.');
          let m = `✅ Added \`${r.word}\` to the **${label}-word** list.`;
          if (channel) m += ` Alerts → ${channel}.`;
          if (notify) m += ` Pings ${notify}.`;
          if (isBad && notify) m += '';
          return reply(interaction, m);
        }
        case 'remove': {
          const r = fns.remove(guildId, interaction.options.getString('word'));
          if (!r.ok) return reply(interaction, `That word is not on the ${label}-word list.`);
          return reply(interaction, `✅ Removed \`${r.word}\` from the ${label}-word list.`);
        }
        case 'clear': {
          const n = fns.clear(guildId);
          return reply(interaction, `✅ Cleared ${n} ${label} word(s).`);
        }
        case 'list': {
          const items = fns.list(guildId);
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
        setTierChannel(guildId, tier, channel.id);

        // Warn up front if the bot can't actually post there, so alerts don't
        // silently vanish later.
        const me = interaction.guild.members.me;
        const perms = me ? channel.permissionsFor(me) : null;
        const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks']
          .filter((p) => !perms?.has(PermissionFlagsBits[p]))
          .map((p) => ({ ViewChannel: 'View Channel', SendMessages: 'Send Messages', EmbedLinks: 'Embed Links' }[p]));

        const tierLabel = {
          default: 'all alerts (default)',
          high: '🔴 high-severity alerts',
          medium: '🟠 medium (AI-only) alerts',
          low: '🟡 low / harmless alerts',
        }[tier];
        let msg = `✅ ${tierLabel} will now be sent to ${channel}.`;
        if (tier !== 'default') {
          msg += '\n(Any tier without its own channel falls back to the default set with `/tattletale setchannel` — no tier.)';
        }
        if (missing.length) {
          msg += `\n⚠️ I'm missing **${missing.join(', ')}** in that channel, so alerts won't post until you grant them.`;
        }
        return reply(interaction, msg);
      }
      case 'toggle': {
        const feature = interaction.options.getString('feature');
        const enabled = interaction.options.getBoolean('enabled');
        const map = { deletes: 'logDeletes', edits: 'logEdits', badwords: 'logBadWords' };
        setToggle(guildId, map[feature], enabled);
        return reply(interaction, `✅ Logging for **${feature}** is now **${enabled ? 'ON' : 'OFF'}**.`);
      }
      case 'ai': {
        const enabled = interaction.options.getBoolean('enabled');
        if (enabled && !process.env.ANTHROPIC_API_KEY) {
          return reply(interaction, '⚠️ AI detection needs an `ANTHROPIC_API_KEY` set on the host. Add it, then enable.');
        }
        setAiEnabled(guildId, enabled);
        return reply(interaction, `✅ AI contextual detection is now **${enabled ? 'ON' : 'OFF'}**.`);
      }
      case 'aithreshold': {
        const value = setAiThreshold(guildId, interaction.options.getNumber('value'));
        return reply(
          interaction,
          `✅ AI confidence threshold set to **${value}**. The AI must be at least ${Math.round(value * 100)}% sure a message is abusive before it alerts (lower = more sensitive, higher = stricter).`,
        );
      }
      case 'allowrole': {
        const role = interaction.options.getRole('role');
        const r = addAllowedRole(guildId, role.id);
        if (!r.ok) return reply(interaction, 'That role is already on the allowlist.');
        return reply(interaction, `✅ Members with ${role} can now use the bot's commands.`);
      }
      case 'denyrole': {
        const role = interaction.options.getRole('role');
        const r = removeAllowedRole(guildId, role.id);
        if (!r.ok) return reply(interaction, 'That role is not on the allowlist.');
        return reply(interaction, `✅ Removed ${role} from the command allowlist.`);
      }
      case 'settings': {
        const s = getGuild(guildId);
        const ch = s.alertChannelId ? `<#${s.alertChannelId}>` : '*not set*';
        const tierCh = (id) => (id ? `<#${id}>` : '↳ default');
        const roles = s.allowedRoleIds.length
          ? s.allowedRoleIds.map((id) => `<@&${id}>`).join(', ')
          : '*anyone with Manage Server*';
        const store = storageInfo();
        const persistence = store.dataDirSet
          ? `✅ saving to \`${store.path}\` (ensure a volume is mounted there so it survives redeploys)`
          : `⚠️ **NOT persistent** — \`DATA_DIR\` is unset, so settings are stored at \`${store.path}\` and **reset on every redeploy/restart**. Set \`DATA_DIR\` to a mounted volume path.`;
        return reply(
          interaction,
          [
            '**Tattletale settings**',
            `Alert channel (default): ${ch}`,
            `• 🔴 High alerts: ${tierCh(s.alertChannelHigh)}`,
            `• 🟠 Medium alerts: ${tierCh(s.alertChannelMedium)}`,
            `• 🟡 Low/harmless alerts: ${tierCh(s.alertChannelLow)}`,
            `Log deletes: ${s.logDeletes ? 'ON' : 'OFF'}`,
            `Log edits: ${s.logEdits ? 'ON' : 'OFF'}`,
            `Log bad words: ${s.logBadWords ? 'ON' : 'OFF'}`,
            `AI detection: ${s.aiEnabled ? 'ON' : 'OFF'}`,
            `AI threshold: ${s.aiThreshold} (${Math.round(s.aiThreshold * 100)}% confidence)`,
            `✅ Good words: ${s.goodWords.length} · 🚫 Bad words: ${s.badWords.length} · 🤖 AI triggers: ${s.aiTriggers.length}`,
            `Command access: ${roles}`,
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

// Keep the process alive on stray errors: discord.js handles its own gateway
// reconnects, and a single bad event or rejected promise shouldn't crash the bot.
client.on(Events.Error, (err) => console.error('Client error:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

// Shut down cleanly when the host stops the container (Railway sends SIGTERM on
// every redeploy). Without this, Node's default SIGTERM handling exits with code
// 143 (non-zero), which Railway flags as a "crash" and emails about — on every
// single deploy. Exiting 0 makes replacement deploys graceful and silent.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal} — shutting down cleanly.`);
  try { client.destroy(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Only connect to Discord when run directly (npm start) — importing this module
// for tests/tooling should not attempt a login. screenMessage/findMatch/decideTier
// are exported so the screening logic can be unit-tested in isolation.
export { screenMessage, findMatch, decideTier };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
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
