import 'dotenv/config';
import {
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

const command = new SlashCommandBuilder()
  .setName('tattletale')
  .setDescription('Configure the Tattletale moderation bot.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) =>
    s.setName('setchannel')
      .setDescription('Set the channel where all alerts are posted.')
      .addChannelOption((o) =>
        o.setName('channel')
          .setDescription('The text channel to send alerts to')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)))
  .addSubcommand((s) =>
    s.setName('addword')
      .setDescription('Add a word to the flagged list.')
      .addStringOption((o) =>
        o.setName('word').setDescription('The word or phrase to flag').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('removeword')
      .setDescription('Remove a word from the flagged list.')
      .addStringOption((o) =>
        o.setName('word').setDescription('The word or phrase to remove').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('listwords').setDescription('Show all flagged words.'))
  .addSubcommand((s) =>
    s.setName('clearwords').setDescription('Remove ALL flagged words.'))
  .addSubcommand((s) =>
    s.setName('toggle')
      .setDescription('Turn a logging feature on or off.')
      .addStringOption((o) =>
        o.setName('feature')
          .setDescription('Which feature to toggle')
          .setRequired(true)
          .addChoices(
            { name: 'Deleted messages', value: 'deletes' },
            { name: 'Edited messages', value: 'edits' },
            { name: 'Flagged words', value: 'flagged' },
          ))
      .addBooleanOption((o) =>
        o.setName('enabled').setDescription('On (true) or off (false)').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('ai')
      .setDescription('Turn AI contextual scam/abuse detection on or off.')
      .addBooleanOption((o) =>
        o.setName('enabled').setDescription('On (true) or off (false)').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('allowrole')
      .setDescription('Allow a role to use the bot commands (defense-in-depth).')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role to authorize').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('denyrole')
      .setDescription('Remove a role from the command allowlist.')
      .addRoleOption((o) =>
        o.setName('role').setDescription('Role to remove').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('settings').setDescription('Show the current configuration.'))
  .toJSON();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

try {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [command] });
    console.log(`Registered /tattletale to guild ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: [command] });
    console.log('Registered /tattletale globally. May take up to 1 hour to appear.');
  }
} catch (error) {
  console.error(error);
}
