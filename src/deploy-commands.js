import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
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
      .setDescription('Set where alerts go (optionally per severity tier).')
      .addChannelOption((o) =>
        o.setName('channel')
          .setDescription('The text channel to send alerts to')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .addStringOption((o) =>
        o.setName('tier')
          .setDescription('Which alerts go here (omit = default/fallback for all tiers)')
          .addChoices(
            { name: 'Default — all alerts / fallback', value: 'default' },
            { name: 'High — bad word + Judge confirms harmful', value: 'high' },
            { name: 'Medium — Judge-only harmful', value: 'medium' },
            { name: 'Low — flagged but harmless', value: 'low' },
          )))
  .addSubcommandGroup((g) =>
    g.setName('badword')
      .setDescription('Bad words: Judge-checked & tiered. Optional per-word channel + ping.')
      .addSubcommand((s) =>
        s.setName('add')
          .setDescription('Add a bad word (Judge-checked for severity).')
          .addStringOption((o) =>
            o.setName('word').setDescription('The word or phrase to flag as bad').setRequired(true))
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Channel for this word\'s alerts (else default)').addChannelTypes(ChannelType.GuildText))
          .addMentionableOption((o) =>
            o.setName('notify').setDescription('User or role to ping on this word\'s alerts')))
      .addSubcommand((s) =>
        s.setName('remove')
          .setDescription('Remove a bad word.')
          .addStringOption((o) => o.setName('word').setDescription('The word to remove').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('Show all bad words.'))
      .addSubcommand((s) => s.setName('clear').setDescription('Remove ALL bad words.')))
  .addSubcommandGroup((g) =>
    g.setName('goodword')
      .setDescription('Good words: safe notify-only, NO Judge check. Optional per-word channel + ping.')
      .addSubcommand((s) =>
        s.setName('add')
          .setDescription('Add a good (safe) word to be notified about.')
          .addStringOption((o) =>
            o.setName('word').setDescription('The word or phrase to watch for').setRequired(true))
          .addChannelOption((o) =>
            o.setName('channel').setDescription('Channel for this word\'s alerts (else default)').addChannelTypes(ChannelType.GuildText))
          .addMentionableOption((o) =>
            o.setName('notify').setDescription('User or role to ping on this word\'s alerts')))
      .addSubcommand((s) =>
        s.setName('remove')
          .setDescription('Remove a good word.')
          .addStringOption((o) => o.setName('word').setDescription('The word to remove').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('Show all good words.'))
      .addSubcommand((s) => s.setName('clear').setDescription('Remove ALL good words.')))
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
            { name: 'Bad words', value: 'badwords' },
          ))
      .addBooleanOption((o) =>
        o.setName('enabled').setDescription('On (true) or off (false)').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('judge')
      .setDescription('Turn contextual scam/abuse judging on or off.')
      .addBooleanOption((o) =>
        o.setName('enabled').setDescription('On (true) or off (false)').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('judgethreshold')
      .setDescription('Set how confident the Judge must be to flag a message (0–1).')
      .addNumberOption((o) =>
        o.setName('value')
          .setDescription('0 = very sensitive, 1 = only when certain. Default 0.6.')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(1)))
  .addSubcommandGroup((g) =>
    g.setName('judgewords')
      .setDescription('Manage the scam/harassment phrases that trigger Judge review.')
      .addSubcommand((s) =>
        s.setName('add')
          .setDescription('Add a phrase that triggers Judge review.')
          .addStringOption((o) =>
            o.setName('phrase').setDescription('Word or phrase that should trigger the Judge').setRequired(true)))
      .addSubcommand((s) =>
        s.setName('remove')
          .setDescription('Remove a phrase from the Judge trigger list.')
          .addStringOption((o) =>
            o.setName('phrase').setDescription('The phrase to remove').setRequired(true)))
      .addSubcommand((s) =>
        s.setName('edit')
          .setDescription('Replace one Judge trigger phrase with another.')
          .addStringOption((o) =>
            o.setName('old').setDescription('Existing phrase to change').setRequired(true))
          .addStringOption((o) =>
            o.setName('new').setDescription('Replacement phrase').setRequired(true)))
      .addSubcommand((s) =>
        s.setName('list').setDescription('Show all Judge trigger phrases.'))
      .addSubcommand((s) =>
        s.setName('clear').setDescription('Reset the Judge trigger list to the built-in defaults.')))
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
    s.setName('settings').setDescription('Show the current configuration.'));

// Exported so tests/tools can inspect the command definition without triggering
// a live registration. The deploy side-effects below only run when this file is
// executed directly (npm run deploy), not when imported.
export { command };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await deploy();

async function deploy() {
const body = [command.toJSON()];
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

// Utility: `npm run deploy -- --clear-global` removes any leftover GLOBAL command
// copies (e.g. registered before GUILD_ID was set) that can duplicate or confuse
// the client's command picker. Guild commands are left untouched.
if (process.argv.includes('--clear-global')) {
  try {
    await rest.put(Routes.applicationCommands(clientId), { body: [] });
    console.log('Cleared all global commands (guild commands left intact).');
  } catch (error) {
    console.error(error);
  }
  process.exit(0);
}

// Re-registering identical commands on every redeploy makes Discord's client
// re-sync the command list (causing the "commands take a moment to show up"
// flicker). So we hash the command definition + target and skip the API call
// when nothing changed. Pass --force to register regardless.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..');
const HASH_PATH = join(DATA_DIR, '.command-hash');
const target = guildId ? `guild:${guildId}` : 'global';
const hash = createHash('sha256').update(`${target}\n${JSON.stringify(body)}`).digest('hex');
const force = process.argv.includes('--force');

const readHash = () => { try { return readFileSync(HASH_PATH, 'utf8').trim(); } catch { return null; } };
const saveHash = () => { try { mkdirSync(DATA_DIR, { recursive: true }); writeFileSync(HASH_PATH, hash); } catch { /* non-fatal */ } };

if (!force && readHash() === hash) {
  console.log('Slash commands unchanged since last deploy — skipping registration.');
} else {
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`Registered /tattletale to guild ${guildId} (appears instantly).`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log('Registered /tattletale globally. May take up to 1 hour to appear.');
    }
    saveHash();
  } catch (error) {
    console.error(error);
  }
}
}
