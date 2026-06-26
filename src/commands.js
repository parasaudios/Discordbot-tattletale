// Slash-command router for /tattletale. index.js wires InteractionCreate here.
import {
  EmbedBuilder, PermissionFlagsBits, MessageFlags, AttachmentBuilder,
} from 'discord.js';
import {
  getServer, setTierChannel, setToggle,
  addBadWord, removeBadWord, clearBadWords, listBadWords,
  addGoodWord, removeGoodWord, clearGoodWords, listGoodWords,
  setAiEnabled, setAiThreshold, storageInfo,
  addAiTrigger, removeAiTrigger, editAiTrigger, clearAiTriggers, listAiTriggers,
  addWatchChannel, removeWatchChannel, listWatchChannels, clearWatchChannels,
  exportServer, importServer,
} from './config.js';
import { parseMentions, truncate } from './matching.js';
import { sendAlert } from './screening.js';

const reply = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral });

// Send a possibly-long body as one ephemeral reply plus follow-ups, each kept
// under Discord's 2000-char limit (so long word lists aren't truncated).
async function replyPaged(interaction, header, lines, footer = '') {
  const chunks = [];
  let cur = header;
  for (const line of lines) {
    if (`${cur}\n${line}`.length > 1900) { chunks.push(cur); cur = line; }
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) chunks.push(cur);
  if (footer && chunks.length) chunks[chunks.length - 1] += `\n${footer}`;
  await interaction.reply({ content: chunks[0] ?? header, flags: MessageFlags.Ephemeral });
  for (let i = 1; i < chunks.length; i += 1) {
    await interaction.followUp({ content: chunks[i], flags: MessageFlags.Ephemeral });
  }
}

const HELP = [
  '**🛡️ Tattletale — commands**',
  '`/tattletale setchannel channel: [tier:]` — where alerts go (tier: good/high/medium/low/deletes/edits, or none = default).',
  '`/tattletale badword add|remove|list|clear` — bad words (Judge-checked → tiered). `add` takes `channel:`, `notify:` (one+ @mentions), `wholeword:`.',
  '`/tattletale goodword add|remove|list|clear` — safe words, no Judge (green notice). Same options.',
  '`/tattletale judge enabled:` — turn the Judge on/off. `judgethreshold value:0–1` — sensitivity.',
  '`/tattletale judgewords add|remove|edit|list|clear` — phrases that trigger a Judge review.',
  '`/tattletale watch add|remove|list|clear` — which channels to monitor (empty = all).',
  '`/tattletale toggle feature:<deletes|edits|badwords|onlyflagged|split|debug> enabled:` — feature switches.',
  '`/tattletale export` / `import file:` — back up or restore this server\'s config.',
  '`/tattletale settings` — show everything currently configured.',
].join('\n');

// eslint-disable-next-line complexity
export async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'tattletale') return;

  // Access is enforced by Discord (the command's default_member_permissions);
  // any interaction that reaches us is already authorized.
  const serverId = interaction.guild.id;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  await maybeAccessDiagnostic(interaction, serverId, group, sub);

  try {
    if (group === 'judgewords') return await handleJudgewords(interaction, serverId, sub);
    if (group === 'watch') return await handleWatch(interaction, serverId, sub);
    if (group === 'badword' || group === 'goodword') return await handleWordList(interaction, serverId, group, sub);

    switch (sub) {
      case 'setchannel': return await handleSetChannel(interaction, serverId);
      case 'toggle': return handleToggle(interaction, serverId);
      case 'judge': return handleJudge(interaction, serverId);
      case 'judgethreshold': return handleJudgeThreshold(interaction, serverId);
      case 'help': return reply(interaction, HELP);
      case 'export': return await handleExport(interaction, serverId);
      case 'import': return await handleImport(interaction, serverId);
      case 'settings': return handleSettings(interaction, serverId);
      default: return reply(interaction, 'Unknown subcommand.');
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) return reply(interaction, 'Something went wrong running that command.');
    return undefined;
  }
}

// --- Subhandlers ------------------------------------------------------------

async function handleJudgewords(interaction, serverId, sub) {
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
      const r = editAiTrigger(serverId, interaction.options.getString('old'), interaction.options.getString('new'));
      if (!r.ok && r.reason === 'missing') return reply(interaction, 'That phrase is not on the Judge trigger list.');
      if (!r.ok && r.reason === 'exists') return reply(interaction, 'The new phrase is already on the list.');
      if (!r.ok) return reply(interaction, 'The new phrase is empty or invalid.');
      return reply(interaction, `✅ Changed \`${r.oldPhrase}\` → \`${r.newPhrase}\` in the Judge trigger list.`);
    }
    case 'list': {
      const triggers = listAiTriggers(serverId);
      if (!triggers.length) return reply(interaction, 'No Judge trigger phrases set. Restore the defaults with `/tattletale judgewords clear`.');
      return replyPaged(interaction, `**Judge trigger phrases (${triggers.length}):**`, [triggers.map((t) => `\`${t}\``).join(', ')]);
    }
    case 'clear': {
      const count = clearAiTriggers(serverId);
      return reply(interaction, `✅ Reset the Judge trigger list to the built-in defaults (${count} phrase(s)).`);
    }
    default: return reply(interaction, 'Unknown judgewords subcommand.');
  }
}

async function handleWatch(interaction, serverId, sub) {
  switch (sub) {
    case 'add': {
      const channel = interaction.options.getChannel('channel');
      const r = addWatchChannel(serverId, channel.id);
      if (!r.ok) return reply(interaction, `${channel} is already on the watch list.`);
      return reply(interaction, `✅ Now watching ${channel} (and its threads). The bot now monitors **only** the channels on the watch list — run \`/tattletale watch clear\` to watch everything again.`);
    }
    case 'remove': {
      const channel = interaction.options.getChannel('channel');
      const r = removeWatchChannel(serverId, channel.id);
      if (!r.ok) return reply(interaction, `${channel} is not on the watch list.`);
      const tail = listWatchChannels(serverId).length === 0 ? ' The watch list is now empty, so the bot watches **all** channels again.' : '';
      return reply(interaction, `✅ Stopped watching ${channel}.${tail}`);
    }
    case 'list': {
      const ids = listWatchChannels(serverId);
      if (!ids.length) return reply(interaction, 'Watch list is empty — the bot monitors **all** channels it can see. Add one with `/tattletale watch add`.');
      return replyPaged(interaction, `**Watched channels (${ids.length}):**`, [ids.map((id) => `<#${id}>`).join(', ')], '*(Only these channels + their threads are monitored.)*');
    }
    case 'clear': {
      const n = clearWatchChannels(serverId);
      return reply(interaction, `✅ Cleared ${n} watched channel(s). The bot now monitors **all** channels it can see.`);
    }
    default: return reply(interaction, 'Unknown watch subcommand.');
  }
}

async function handleWordList(interaction, serverId, groupName, sub) {
  const isBad = groupName === 'badword';
  const fns = isBad
    ? { add: addBadWord, remove: removeBadWord, clear: clearBadWords, list: listBadWords }
    : { add: addGoodWord, remove: removeGoodWord, clear: clearGoodWords, list: listGoodWords };
  const label = isBad ? 'bad' : 'good';
  const Label = isBad ? 'Bad' : 'Good';
  const fmt = (e) => {
    const extra = [];
    if (e.channelId) extra.push(`→ <#${e.channelId}>`);
    if (e.notify) extra.push(`pings ${e.notify}`);
    if (e.wholeword) extra.push('whole word');
    return `\`${e.word}\`${extra.length ? ` (${extra.join(', ')})` : ''}`;
  };
  switch (sub) {
    case 'add': {
      const word = interaction.options.getString('word');
      const channel = interaction.options.getChannel('channel');
      if (channel && !channel.isTextBased()) return reply(interaction, 'Please choose a text channel.');
      const notify = parseMentions(interaction.options.getString('notify'));
      const wholeword = interaction.options.getBoolean('wholeword');
      const r = fns.add(serverId, word, channel?.id ?? null, notify, wholeword);
      if (!r.ok) return reply(interaction, 'That word is empty or invalid.');
      const e = r.entry;
      const bits = [];
      if (e.channelId) bits.push(`alerts → <#${e.channelId}>`);
      if (e.notify) bits.push(`pings ${e.notify}`);
      if (e.wholeword) bits.push('whole-word match');
      const detail = bits.length ? ` — ${bits.join(', ')}` : '';
      return reply(interaction, `✅ ${r.updated ? 'Updated' : 'Added'} \`${r.word}\` in the **${label}-word** list${detail}.`);
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
      return replyPaged(interaction, `**${Label} words (${items.length}):**`, items.map(fmt));
    }
    default: return reply(interaction, `Unknown ${label}word subcommand.`);
  }
}

async function handleSetChannel(interaction, serverId) {
  const channel = interaction.options.getChannel('channel');
  if (!channel?.isTextBased()) return reply(interaction, 'Please choose a text channel.');
  const tier = interaction.options.getString('tier') ?? 'default';
  setTierChannel(serverId, tier, channel.id);

  const me = interaction.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const labels = { ViewChannel: 'View Channel', SendMessages: 'Send Messages', EmbedLinks: 'Embed Links' };
  const missing = ['ViewChannel', 'SendMessages', 'EmbedLinks']
    .filter((p) => !perms?.has(PermissionFlagsBits[p])).map((p) => labels[p]);

  const tierLabel = {
    default: 'all alerts (default)', good: '✅ good-word notices', high: '🔴 high-severity alerts',
    medium: '🟠 medium (Judge-only) alerts', low: '🟡 low / harmless alerts',
    deletes: '🗑️ deleted-message logs', edits: '✏️ edited-message logs',
  }[tier];
  let msg = `✅ ${tierLabel} will now be sent to ${channel}.`;
  if (tier !== 'default') msg += '\n(Any tier without its own channel falls back to the default set with `/tattletale setchannel` — no tier.)';
  if (missing.length) {
    let granted = false;
    try {
      await channel.permissionOverwrites.edit(me, { ViewChannel: true, SendMessages: true, EmbedLinks: true });
      granted = true;
    } catch { /* lacks Manage Roles */ }
    msg += granted
      ? `\n🔧 I granted myself **${missing.join(', ')}** in that channel, so alerts will post now.`
      : `\n⚠️ I'm missing **${missing.join(', ')}** there and couldn't grant it myself — I need the **Manage Roles** permission. Either give me Manage Roles, or add me to the channel manually.`;
  }
  return reply(interaction, msg);
}

function handleToggle(interaction, serverId) {
  const feature = interaction.options.getString('feature');
  const enabled = interaction.options.getBoolean('enabled');
  const map = { deletes: 'logDeletes', edits: 'logEdits', badwords: 'logBadWords', debug: 'debugLogging', onlyflagged: 'logFlaggedOnly', split: 'antiSplit' };
  setToggle(serverId, map[feature], enabled);
  if (feature === 'debug') return reply(interaction, `✅ Debug logging is now **${enabled ? 'ON' : 'OFF'}** (gateway firehose + per-command access diagnostic).`);
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

function handleJudge(interaction, serverId) {
  const enabled = interaction.options.getBoolean('enabled');
  if (enabled && !process.env.ANTHROPIC_API_KEY) {
    return reply(interaction, '⚠️ Judging needs an `ANTHROPIC_API_KEY` set on the host. Add it, then enable.');
  }
  setAiEnabled(serverId, enabled);
  return reply(interaction, `✅ Contextual judging is now **${enabled ? 'ON' : 'OFF'}**.`);
}

function handleJudgeThreshold(interaction, serverId) {
  const value = setAiThreshold(serverId, interaction.options.getNumber('value'));
  return reply(interaction, `✅ Judge confidence threshold set to **${value}**. The Judge must be at least ${Math.round(value * 100)}% sure a message is abusive before it alerts (lower = more sensitive, higher = stricter).`);
}

async function handleExport(interaction, serverId) {
  const json = JSON.stringify(exportServer(serverId), null, 2);
  const file = new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: `tattletale-${serverId}.json` });
  return interaction.reply({
    content: '📦 This server\'s Tattletale config. Keep it as a backup — restore it any time with `/tattletale import file:`.',
    files: [file],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleImport(interaction, serverId) {
  const att = interaction.options.getAttachment('file');
  if (!att) return reply(interaction, 'Attach the config JSON file (from `/tattletale export`).');
  if (att.size > 1_000_000) return reply(interaction, 'That file is too large to be a config.');
  let data;
  try {
    const res = await fetch(att.url);
    data = await res.json();
  } catch {
    return reply(interaction, 'Could not read that file as JSON.');
  }
  const r = importServer(serverId, data);
  if (!r.ok) return reply(interaction, 'That file isn\'t a valid Tattletale config.');
  return reply(interaction, `✅ Imported config — applied **${r.applied}** setting(s). Run \`/tattletale settings\` to review.`);
}

function handleSettings(interaction, serverId) {
  const s = getServer(serverId);
  const ch = s.alertChannelId ? `<#${s.alertChannelId}>` : '*not set*';
  const tierCh = (id) => (id ? `<#${id}>` : '↳ default');
  const store = storageInfo();
  const persistence = store.dataDirSet
    ? `✅ saving to \`${store.path}\``
    : `⚠️ **NOT persistent** — \`DATA_DIR\` unset; settings stored at \`${store.path}\` and reset on every redeploy. Set \`DATA_DIR\` to a mounted volume.`;
  return reply(interaction, [
    '**Tattletale settings**',
    `Alert channel (default): ${ch}`,
    `• ✅ Good-word notices: ${tierCh(s.alertChannelGood)}`,
    `• 🔴 High alerts: ${tierCh(s.alertChannelHigh)}`,
    `• 🟠 Medium alerts: ${tierCh(s.alertChannelMedium)}`,
    `• 🟡 Low/harmless alerts: ${tierCh(s.alertChannelLow)}`,
    `• 🗑️ Delete logs: ${tierCh(s.alertChannelDeletes)}`,
    `• ✏️ Edit logs: ${tierCh(s.alertChannelEdits)}`,
    `Watching: ${s.watchChannels.length ? s.watchChannels.map((id) => `<#${id}>`).join(', ') : '*all channels*'}`,
    `Log deletes: ${s.logDeletes ? 'ON' : 'OFF'} · Log edits: ${s.logEdits ? 'ON' : 'OFF'} · Only flagged: ${s.logFlaggedOnly ? 'ON' : 'OFF'}`,
    `Bad-word alerts: ${s.logBadWords ? 'ON' : 'OFF'} · Anti-evasion: ${s.antiSplit ? 'ON' : 'OFF'} · Debug: ${s.debugLogging ? 'ON' : 'OFF'}`,
    `Judging: ${s.aiEnabled ? 'ON' : 'OFF'} (threshold ${s.aiThreshold}, ${Math.round(s.aiThreshold * 100)}%)`,
    `✅ Good words: ${s.goodWords.length} · 🚫 Bad words: ${s.badWords.length} · 🤖 Judge triggers: ${s.aiTriggers.length}`,
    'Command access: set by the command\'s required permission (COMMAND_PERMISSION) + Server Settings → Integrations.',
    `Storage: ${persistence}`,
  ].join('\n'));
}

// Opt-in per-command access diagnostic (LOG_ACCESS_DIAG=true or the debug toggle).
async function maybeAccessDiagnostic(interaction, serverId, group, sub) {
  if (!(process.env.LOG_ACCESS_DIAG === 'true' || getServer(serverId).debugLogging)) return;
  try {
    const cmdPath = ['/tattletale', group, sub].filter(Boolean).join(' ');
    const hasManageServer = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
    const isAdmin = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
    const isOwner = interaction.guild?.ownerId === interaction.user.id;
    const meets = hasManageServer || isAdmin || isOwner;
    const rolesCache = interaction.member?.roles?.cache;
    const roleNames = rolesCache ? [...rolesCache.values()].filter((r) => r.id !== serverId).map((r) => r.name) : [];
    const isGlobalCmd = !interaction.commandGuildId;
    console.log(`[access] ${interaction.user.tag} (${interaction.user.id}) -> ${cmdPath} | scope=${isGlobalCmd ? 'GLOBAL(!)' : `server:${interaction.commandGuildId}`} | ManageServer=${hasManageServer} Admin=${isAdmin} Owner=${isOwner} meets=${meets} | roles=[${roleNames.join(', ')}]`);
    const diag = new EmbedBuilder()
      .setTitle('🔎 Command access diagnostic')
      .setColor(meets ? 0x57F287 : 0xED4245)
      .addFields(
        { name: 'User', value: `${interaction.user} (${interaction.user.tag} · \`${interaction.user.id}\`)` },
        { name: 'Command used', value: `\`${cmdPath}\`` },
        { name: 'Command scope', value: isGlobalCmd ? '⚠️ **GLOBAL command** (no permission lock — auto-cleared on next deploy)' : `✅ server command (\`${interaction.commandGuildId}\`)` },
        { name: 'How (breakdown)', value: [`${hasManageServer ? '✅' : '❌'} Manage Server`, `${isAdmin ? '✅' : '❌'} Administrator`, `${isOwner ? '✅' : '❌'} Server owner`, `Roles: ${roleNames.length ? roleNames.join(', ') : '*none*'}`].join('\n') },
      )
      .setTimestamp(new Date());
    await sendAlert(interaction.guild, diag);
  } catch (err) {
    console.error('Access diagnostic failed:', err?.message || err);
  }
}
