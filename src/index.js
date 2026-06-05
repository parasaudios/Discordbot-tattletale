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

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a case-insensitive, whole-word regex from a guild's current word list.
// Rebuilt on demand so keyword changes take effect immediately, no restart.
function buildRegex(words) {
  if (!words.length) return null;
  return new RegExp(`\\b(${words.map(escapeRegex).join('|')})\\b`, 'i');
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

// --- Flagged-word scanning + AI contextual detection ---
client.on(Events.MessageCreate, async (message) => {
  if (message.author?.bot || !message.guild) return;
  const settings = getGuild(message.guild.id);

  // Keyword scan (only if logFlagged is on and words exist).
  if (settings.logFlagged) {
    const regex = buildRegex(settings.flaggedWords);
    const match = regex ? message.content.match(regex) : null;
    if (match) {
      const embed = new EmbedBuilder()
        .setTitle('🚩 Flagged word detected')
        .setColor(0xED4245)
        .addFields(
          { name: 'User', value: `${message.author} (${message.author.tag})`, inline: true },
          { name: 'Channel', value: `${message.channel}`, inline: true },
          { name: 'Matched', value: `\`${match[0]}\``, inline: true },
          { name: 'Message', value: truncate(message.content) },
          { name: 'Jump', value: `[Go to message](${message.url})` },
        )
        .setTimestamp(message.createdAt);
      await sendAlert(message.guild, embed);
    }
  }

  // AI contextual detection — only if enabled AND the cheap pre-filter trips,
  // so the vast majority of messages never trigger a paid API call.
  if (settings.aiEnabled && shouldScreen(message.content)) {
    const result = await classifyMessage(message.content);
    if (result?.flag && result.confidence >= 0.6) {
      const embed = new EmbedBuilder()
        .setTitle('🤖 AI flagged a message')
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
});

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

// --- Edited messages ---
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (!getGuild(newMessage.guild.id).logEdits) return;
  if (!oldMessage.partial && oldMessage.content === newMessage.content) return;

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
        return reply(interaction, `✅ Mod alerts will now be sent to ${channel}.`);
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

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}
client.login(token);
