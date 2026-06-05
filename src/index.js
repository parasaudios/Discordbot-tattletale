import 'dotenv/config';
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
  setAlertChannelId,
  setToggle,
  addWord,
  removeWord,
  clearWords,
  listWords,
  setAiEnabled,
  setAiThreshold,
  addAllowedRole,
  removeAllowedRole,
  listAllowedRoles,
} from './config.js';
import { shouldScreen, classifyMessage } from './ai.js';

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
function findFlaggedWord(content, words) {
  if (!words.length) return null;
  const haystack = normalize(content);
  if (!haystack) return null;
  for (const word of words) {
    const needle = normalize(word);
    if (needle && haystack.includes(needle)) return word;
  }
  return null;
}

function truncate(text, max = 1024) {
  if (!text) return '*(no text content)*';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function sendAlert(guild, embed) {
  const { alertChannelId } = getGuild(guild.id);
  if (!alertChannelId) return;
  const channel = guild.channels.cache.get(alertChannelId)
    ?? (await guild.channels.fetch(alertChannelId).catch(() => null));
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

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

  // Layer 1 — keyword scan (only if logFlagged is on and words exist).
  const matchedWord = settings.logFlagged
    ? findFlaggedWord(message.content, settings.flaggedWords)
    : null;
  if (matchedWord) {
    const embed = new EmbedBuilder()
      .setTitle(`🚩 Flagged word detected${editedNote}`)
      .setColor(0xED4245)
      .addFields(
        { name: 'User', value: `${message.author} (${message.author.tag})`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Matched', value: `\`${matchedWord}\``, inline: true },
        { name: 'Message', value: truncate(message.content) },
        { name: 'Jump', value: `[Go to message](${message.url})` },
      )
      .setTimestamp(message.createdAt);
    await sendAlert(message.guild, embed);
  }

  // Layer 2 — AI intent analysis. Works alongside the keyword filter: it judges
  // intent/context on any substantive message (not just scam-shaped ones), and
  // a flagged-word message gets analysed here too. shouldScreen() skips trivial
  // messages and classifyMessage() caches repeats to keep calls down.
  if (settings.aiEnabled && shouldScreen(message.content)) {
    const result = await classifyMessage(message.content);
    if (result?.flag && result.confidence >= settings.aiThreshold) {
      const embed = new EmbedBuilder()
        .setTitle(`🤖 AI flagged a message${editedNote}`)
        .setColor(0xEB459E)
        .addFields(
          { name: 'User', value: `${message.author} (${message.author.tag})`, inline: true },
          { name: 'Channel', value: `${message.channel}`, inline: true },
          { name: 'Category', value: `${result.category} (${Math.round(result.confidence * 100)}%)`, inline: true },
          { name: 'Why', value: truncate(result.reason || 'n/a', 256) },
          { name: 'Message', value: truncate(message.content) },
          { name: 'Jump', value: `[Go to message](${message.url})` },
        )
        .setTimestamp(message.createdAt);
      await sendAlert(message.guild, embed);
    }
  }
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
  const sub = interaction.options.getSubcommand();

  try {
    switch (sub) {
      case 'setchannel': {
        const channel = interaction.options.getChannel('channel');
        if (!channel?.isTextBased()) return reply(interaction, 'Please choose a text channel.');
        setAlertChannelId(guildId, channel.id);

        // Warn up front if the bot can't actually post there, so alerts don't
        // silently vanish later.
        const me = interaction.guild.members.me;
        const perms = me ? channel.permissionsFor(me) : null;
        const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks']
          .filter((p) => !perms?.has(PermissionFlagsBits[p]))
          .map((p) => ({ ViewChannel: 'View Channel', SendMessages: 'Send Messages', EmbedLinks: 'Embed Links' }[p]));

        let msg = `✅ Mod alerts will now be sent to ${channel}.`;
        if (missing.length) {
          msg += `\n⚠️ I'm missing **${missing.join(', ')}** in that channel, so alerts won't post until you grant them.`;
        }
        return reply(interaction, msg);
      }
      case 'addword': {
        const r = addWord(guildId, interaction.options.getString('word'));
        if (!r.ok && r.reason === 'exists') return reply(interaction, 'That word is already on the list.');
        if (!r.ok) return reply(interaction, 'That word is empty or invalid.');
        return reply(interaction, `✅ Added \`${r.word}\` to the flagged list.`);
      }
      case 'removeword': {
        const r = removeWord(guildId, interaction.options.getString('word'));
        if (!r.ok) return reply(interaction, 'That word is not on the list.');
        return reply(interaction, `✅ Removed \`${r.word}\` from the flagged list.`);
      }
      case 'clearwords': {
        const count = clearWords(guildId);
        return reply(interaction, `✅ Cleared ${count} flagged word(s).`);
      }
      case 'listwords': {
        const words = listWords(guildId);
        if (!words.length) return reply(interaction, 'No flagged words set. Add one with `/tattletale addword`.');
        return reply(interaction, `**Flagged words (${words.length}):**\n${words.map((w) => `\`${w}\``).join(', ')}`);
      }
      case 'toggle': {
        const feature = interaction.options.getString('feature');
        const enabled = interaction.options.getBoolean('enabled');
        const map = { deletes: 'logDeletes', edits: 'logEdits', flagged: 'logFlagged' };
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
        const roles = s.allowedRoleIds.length
          ? s.allowedRoleIds.map((id) => `<@&${id}>`).join(', ')
          : '*anyone with Manage Server*';
        return reply(
          interaction,
          [
            '**Tattletale settings**',
            `Alert channel: ${ch}`,
            `Log deletes: ${s.logDeletes ? 'ON' : 'OFF'}`,
            `Log edits: ${s.logEdits ? 'ON' : 'OFF'}`,
            `Log flagged words: ${s.logFlagged ? 'ON' : 'OFF'}`,
            `AI detection: ${s.aiEnabled ? 'ON' : 'OFF'}`,
            `AI threshold: ${s.aiThreshold} (${Math.round(s.aiThreshold * 100)}% confidence)`,
            `Flagged words: ${s.flaggedWords.length}`,
            `Command access: ${roles}`,
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

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
client.login(token);
