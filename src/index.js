import 'dotenv/config';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  Client, GatewayIntentBits, Partials, Events,
} from 'discord.js';
import { anyDebugEnabled } from './config.js';
import { reload as reloadLicenses } from './licenses.js';
import {
  screenMessage, screenSplitEvasion, handleDelete, handleBulkDelete, handleEdit, sweepBuffers,
} from './screening.js';
import { handleInteraction } from './commands.js';
import { command, ownerCommand } from './deploy-commands.js';

const commandJSON = command.toJSON();
const ownerCommandJSON = ownerCommand.toJSON();
// Owner key-management subcommands are registered only in your own server.
const jsonForServer = (id) => (process.env.OWNER_SERVER_ID && id === process.env.OWNER_SERVER_ID ? ownerCommandJSON : commandJSON);

// Timestamp every log line so output can be correlated to the exact moment the
// host reports a crash/restart. Installed before anything else logs.
for (const method of ['log', 'warn', 'error']) {
  const original = console[method].bind(console);
  console[method] = (...args) => original(`[${new Date().toISOString()}]`, ...args);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

// Register /tattletale in every server the bot is in, and clear any stale global
// copies. Per-server commands appear instantly and keep the permission lock.
async function registerCommandsEverywhere(c) {
  try {
    await c.application.commands.set([]);
  } catch (err) {
    console.error('Could not clear global commands:', err?.message || err);
  }
  for (const server of c.guilds.cache.values()) {
    try {
      await server.commands.set([jsonForServer(server.id)]);
      console.log(`Registered /tattletale in "${server.name}" (${server.id}).`);
    } catch (err) {
      console.error(`Could not register commands in ${server.id}:`, err?.message || err);
    }
  }
}

async function applyName(server) {
  try {
    const desiredName = process.env.BOT_NAME || 'TattleTale';
    const me = server.members.me ?? (await server.members.fetchMe().catch(() => null));
    if (me && me.nickname !== desiredName && me.user.username !== desiredName) await me.setNickname(desiredName);
  } catch { /* missing Change Nickname permission — non-fatal */ }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Tattletale online as ${c.user.tag}`);
  await registerCommandsEverywhere(c);

  const desiredName = process.env.BOT_NAME || 'TattleTale';
  if (c.user.username !== desiredName) {
    try {
      await c.user.setUsername(desiredName);
      console.log(`Renamed bot username → "${desiredName}".`);
    } catch (err) {
      console.error(`Could not rename bot to "${desiredName}": ${err?.message || err}. Discord limits username changes to ~2/hour; it will retry next restart, or set it in the Developer Portal.`);
    }
  }
  for (const server of c.guilds.cache.values()) await applyName(server);
});

// Register the command + set nickname the instant the bot joins a new server.
client.on(Events.GuildCreate, async (server) => {
  try {
    await server.commands.set([jsonForServer(server.id)]);
    console.log(`Joined "${server.name}" (${server.id}) — registered /tattletale.`);
  } catch (err) {
    console.error(`Could not register commands in new server ${server.id}:`, err?.message || err);
  }
  await applyName(server);
});

// --- Message events → screening "brain" ---
client.on(Events.MessageCreate, (message) => {
  screenMessage(message, 'posted');
  screenSplitEvasion(message);
});
client.on(Events.MessageDelete, (message) => handleDelete(message));
client.on(Events.MessageBulkDelete, (messages, channel) => handleBulkDelete(messages, channel));
client.on(Events.MessageUpdate, (oldMessage, newMessage) => handleEdit(oldMessage, newMessage));

// --- Slash commands ---
client.on(Events.InteractionCreate, (interaction) => handleInteraction(interaction));

// --- Gateway lifecycle logging (makes a restart loop / instability obvious) ---
client.on(Events.ShardReady, (id) => console.log(`Gateway: shard ${id} ready (connected to Discord).`));
client.on(Events.ShardResume, (id, replayed) => console.log(`Gateway: shard ${id} reconnected (resumed, ${replayed} events replayed).`));
client.on(Events.ShardReconnecting, (id) => console.warn(`Gateway: shard ${id} reconnecting…`));
client.on(Events.ShardDisconnect, (event, id) => console.warn(`Gateway: shard ${id} disconnected (code ${event?.code}).`));
client.on(Events.ShardError, (err, id) => console.error(`Gateway: shard ${id} error:`, err.message));

// Keep the process alive on stray errors so a single bad event/promise/throw
// doesn't crash the bot (which the host would report as a failed deploy).
client.on(Events.Error, (err) => console.error('Client error:', err));
process.on('uncaughtExceptionMonitor', (err, origin) => console.error(`uncaughtExceptionMonitor [${origin}]:`, err?.stack || err));
process.on('uncaughtException', (err) => console.error('Uncaught exception (kept alive):', err?.stack || err));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection (kept alive):', reason?.stack || reason));
process.on('warning', (w) => console.warn('Node warning:', w?.stack || w?.message || w));
process.on('beforeExit', (code) => console.log(`beforeExit (event loop empty) with code ${code}.`));

// Graceful shutdown so a host SIGTERM (every redeploy) exits 0 — no false
// "crashed" emails. Only fires if signals reach THIS process (run node directly,
// not via npm; see railway.json).
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal} — shutting down cleanly (exit 0).`);
  try { client.destroy(); } catch { /* ignore */ }
  process.exit(0);
}
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT']) process.on(sig, () => shutdown(sig));
process.on('exit', (code) => console.log(`Process exiting with code ${code}.`));

// Only connect to Discord when run directly (importing for tests must not log in).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
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
  console.log(`  Launched by:       ${process.env.npm_lifecycle_event
    ? `⚠️ npm "${process.env.npm_lifecycle_event}" — npm may swallow SIGTERM (run node directly)`
    : '✅ direct node (SIGTERM will reach the bot)'}`);
  console.log('  Requires the privileged "Message Content Intent" (Dev Portal → Bot).');
  console.log('──────────────────────────────────────────');

  // Heartbeat: proves liveness and surfaces memory growth (OOM = climbing RSS then silence).
  const mb = (n) => Math.round(n / 1048576);
  setInterval(() => {
    const m = process.memoryUsage();
    console.log(`Heartbeat: up ${Math.round(process.uptime())}s | rss ${mb(m.rss)}MB | heap ${mb(m.heapUsed)}/${mb(m.heapTotal)}MB | discord ${client.isReady() ? 'ready' : 'DOWN'} | ws ping ${Math.round(client.ws?.ping ?? -1)}ms`);
  }, 30_000).unref();

  // Periodically sweep screening buffers (idle-user memory) and reload the license
  // store (so CLI-minted/revoked keys are picked up without a restart).
  setInterval(() => { sweepBuffers(); reloadLicenses(); }, 60_000).unref();

  // Gateway debug firehose — off unless a server has debug on or LOG_DISCORD_DEBUG=true.
  const debugForced = process.env.LOG_DISCORD_DEBUG === 'true';
  client.on(Events.Warn, (m) => console.warn('[discord:warn]', m));
  client.on(Events.Debug, (m) => { if (debugForced || anyDebugEnabled()) console.log('[discord:debug]', m); });

  // Tiny HTTP server so platform healthchecks get a 200 (a Discord bot has no web
  // server of its own). Binds the host-provided $PORT (falls back to 3000).
  const healthPort = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Tattletale ${client.isReady() ? 'ready' : 'starting'}\n`);
  }).listen(healthPort, () => console.log(`Healthcheck server listening on :${healthPort}`))
    .on('error', (err) => console.error('Healthcheck server error:', err.message));

  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ Missing DISCORD_TOKEN. Set it in your host\'s Variables (or .env locally).');
    process.exit(1);
  }
  client.login(token).catch((err) => {
    const msg = err?.message || String(err);
    console.error('❌ Could not log in to Discord.');
    if (err?.code === 'TokenInvalid' || /invalid token/i.test(msg)) {
      console.error('   → The DISCORD_TOKEN is invalid or expired. Reset it in the Developer Portal (Bot → Reset Token).');
    } else if (err?.code === 'DisallowedIntents' || /disallowed intents/i.test(msg)) {
      console.error('   → Enable the Message Content Intent (Developer Portal → Bot → Privileged Gateway Intents), then redeploy.');
    } else {
      console.error('   →', msg);
    }
    process.exit(1);
  });
}
