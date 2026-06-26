# CLAUDE.md

## ⚠️ Required workflow for this project

**1. Verify against Discord's docs.** EVERY TIME you make a change to this Discord
bot, you MUST first consult the official Discord developer documentation
referenced below and verify your change against it. Do not make API calls, define
commands, set intents/scopes, or alter bot behavior without confirming the
relevant detail in the docs first.

**2. Keep this file current — in the same commit.** After ANY change to behavior,
commands, options, toggles, env vars, architecture, or the *reasoning* behind a
decision, update the relevant section(s) below so this file never drifts from the
code. The **Implementation reference**, **Slash commands**, **Environment
variables**, **Deployment & reliability**, and **Version history** sections are
the single source of truth. Treat a change as unfinished until CLAUDE.md reflects
it. When you fix something non-obvious, record *why* (so it isn't regressed later).
Keep it concise — update existing lines rather than appending duplicates.

## Project

A custom bot for a Discord server.

## Primary reference: Official Discord Developer Documentation

- **Docs home:** https://docs.discord.com/developers/intro
- **Full documentation index (read this to discover all pages):** https://docs.discord.com/llms.txt
- **Build Your First App (step-by-step guide):** https://docs.discord.com/developers/quick-start/getting-started
- **Overview of Apps:** https://docs.discord.com/developers/quick-start/overview-of-apps
- **Bots & Apps platform docs:** https://docs.discord.com/developers/platform/bots
- **Developer Portal (create/manage apps, get bot token):** https://discord.com/developers/applications
- **API docs source / examples (GitHub):** https://github.com/discord/discord-api-docs
- **Example app referenced by the guide:** https://github.com/discord/discord-example-app

## Key facts from the docs (verify against the source before relying on them)

- An **application** is created in the Developer Portal; a **bot user** is added to it.
- Auth uses a **Bot Token** (keep secret — never commit it). This is NOT the same
  as the application's **client secret** or **public key**.
- The **public key** is used to verify incoming interactions (e.g. slash commands).
- **OAuth2 scopes:** for a server install, use the `bot` scope plus
  `applications.commands`. Selecting `bot` reveals a **Permissions** menu — request
  only the permissions the bot needs (e.g. `Send Messages`).
- The official getting-started guide builds a rock-paper-scissors app in Node.js
  using `discord-interactions`, `Express`, and `ngrok` (to tunnel a local server
  to a public URL Discord can reach).
- For other languages/libraries, see the docs' **Community Resources**.

## Reminders

- Handle the bot token and client secret as secrets (use env vars, never hardcode).
- Test in a server you control (requires `MANAGE_SERVER` permission to add the bot).
- Re-check the docs index (`llms.txt`) when working on an unfamiliar feature —
  the API changes, and your assumptions may be outdated.

---

## Implementation reference (keep this current when behavior changes)

This bot is **notify-only**: it watches the server and posts alerts to channels
you choose. It never deletes, kicks, bans, or punishes. Built with **discord.js
v14** (Node ≥18, ESM). Source lives in `src/`:

- `src/index.js` — slim orchestration: gateway client, wires Discord events to the
  screening/command modules, startup/health/diagnostics, lifecycle.
- `src/matching.js` — pure, dependency-free helpers (normalize, findMatch,
  decideTier, parseMentions, truncate, TIERS). Unit-tested in isolation.
- `src/screening.js` — the screening "brain": screenMessage, anti-split, delete/
  bulk/edit handlers, flood control, audit-log "who deleted", buffer sweeps.
- `src/commands.js` — `/tattletale` slash-command router (`handleInteraction`).
- `src/config.js` — per-server settings, persisted to `settings.json` (see `DATA_DIR`);
  includes export/import.
- `src/licenses.js` — per-server license store (`licenses.json`); mint/revoke/activate
  + the `isLicensed` gate. `src/license-cli.js` — owner CLI (`npm run genkey/keys/revokekey`).
- `src/deploy-commands.js` — builds the `/tattletale` slash command (exports
  `command`); also a manual `npm run deploy` registrar. Runtime registration is
  done by `index.js`, which registers per-server on ready and on `guildCreate`
  (instant, no SERVER_ID/global wait) and clears stale global commands.
- `src/ai.js` — Anthropic (Claude) contextual classification.
- `test/` — `node:test` suite (matching/config/screening); `npm test`. CI runs it
  on push/PR (`.github/workflows/ci.yml`, Node 18/20/22).

### Word lists (three, independent)

Each good/bad word is stored as `{ word, channelId, notify, wholeword }` — all
overrides optional. `wholeword:true` matches only a standalone word (`para` hits
`para`/`P@r@` but not `paradise`). Adding an existing word **updates** it (upsert), changing only
the fields you pass; remove + re-add to clear a field. Matching is case-insensitive, substring-based, and evasion-resistant
(handles leetspeak, stretched letters, inserted separators).

- **Good words** — safe heads-up words. **No AI check.** Green ✅ notice.
- **Bad words** — bad words. **Always AI-checked** so a severity tier is decided.
- **AI words (triggers)** — signal phrases that let the AI review *other* messages
  (so API calls only happen when something looks worth checking). Built-in default
  set; `clear` restores the defaults.

### Severity tiers & colours

- ✅ **Good** (green) — a good word was used (no AI).
- 🔴 **High** (red) — a bad word **and** the AI both judge it harmful.
- 🟠 **Medium** (orange) — the AI judges it harmful with no bad word (AI-word catch).
- 🟡 **Low** (yellow) — a bad word not AI-confirmed, or an AI-word message cleared as harmless.

### Channel routing (per alert)

- Good word → its own `channel` → its `good` tier channel → default alert channel.
- Bad word → its own `channel` → its tier channel (high/low) → default.
- AI-word catch → its tier channel (medium/low) → default.
- Each good/bad word may also `notify` **one or more users/roles** (a free-text
  field of @mentions, parsed to a mention string), pinged via message content +
  `allowedMentions`.

### Other features

- Logs **deleted**, **bulk-deleted**, and **edited** messages. Edited content is
  re-screened so a banned word added after posting is still caught. Delete logs
  attempt an **audit-log lookup** to show *who* removed the message (mod vs self).
- **Flood control:** identical alerts (same server/user/word/tier) are suppressed
  within a cooldown (`FLOOD_COOLDOWN_MS`, default 8s) so spam can't flood a channel.
- **Backup:** `/tattletale export` downloads the server config as JSON; `import`
  restores it (whitelisted, type-checked keys only).
- Toggles: `deletes`, `edits`, `badwords` (each on by default), plus
  `onlyflagged` (**on by default**) which makes delete/edit logs fire only for
  messages that matched a good/bad word (turn off for a full activity log),
  `split` (off by default) which detects a bad word split across several messages
  (per-user rolling window), and `debug`.
- AI contextual detection (off by default; needs `ANTHROPIC_API_KEY`), with a
  configurable confidence threshold.
- Command access is **handled natively by Discord** (no in-code allowlist). The
  command sets `setDefaultMemberPermissions(<COMMAND_PERMISSION env, default
  ManageGuild>)`, so by default only Manage Server members see/use it (set
  `COMMAND_PERMISSION` to a permission your mods have, e.g. `ManageChannels`); a server admin grants extra roles/members via
  Server Settings → Integrations → Tattletale. The interaction handler runs no
  permission gate of its own — any interaction Discord delivers is already authorized.

### Licensing / paywall (you host one bot; customers invite it)

The bot is gated per-server by a **license key**. Customers can't bypass it because
they never run the code — only **you** host the instance; cloning the repo gets a
cloner a *different* free bot (their own token), not your customers or revenue. So:
keep the **repo private**, all secrets in **env only**, and host it yourself.

- **Store:** `licenses.json` on the `DATA_DIR` volume. Each key:
  `{ durationDays|null(lifetime), plan, serverId, activatedAt, expiresAt, revoked }`.
  A key binds to the **first server** that activates it; `expiresAt = activatedAt +
  durationDays`. `licenseStatus`/`isLicensed` pick the best (lifetime > furthest)
  non-revoked key. `LICENSE_EXEMPT_SERVERS` + `OWNER_SERVER_ID` are always licensed.
- **Gate:** `commands.js` blocks every command except `activate`/`license`/`help`
  on unlicensed servers; `screening.js` no-ops (no alerts) on unlicensed servers.
- **Customer commands:** `/tattletale activate key:<TT-…>`, `/tattletale license`.
- **Owner commands** (`genkey`/`revoke`/`keys`): registered **only** in
  `OWNER_SERVER_ID` (so customers never see them) **and** code-gated to `OWNER_ID`.
  Also mintable via the CLI (`npm run genkey -- --days 30 --count 5 [--plan pro]`,
  `--lifetime`; `npm run revokekey -- --key TT-…`; `npm run keys`).
- **Custom durations** are chosen at mint time (per key). The bot reloads
  `licenses.json` every 60s so CLI mint/revoke propagate without a restart.

### Slash commands (`/tattletale`)

`setchannel [tier]`, `badword add|remove|list|clear`, `goodword add|remove|list|clear`,
`judgewords add|remove|edit|list|clear`, `watch add|remove|list|clear`, `toggle`
(deletes/edits/badwords/onlyflagged/split/debug), `judge`, `judgethreshold`,
`activate`, `license`, `help`, `export`, `import`, `settings`, plus owner-only
`genkey`/`revoke`/`keys` (in OWNER_SERVER_ID only). `add` for good/bad words takes optional
`channel:`, `notify:` (one or more @mentions), and `wholeword:`. Commands are
re-registered automatically at runtime (per server on ready + on guildCreate), so
a structure change just needs a restart/redeploy.

### Environment variables

`DISCORD_TOKEN` (req), `CLIENT_ID` (req, for command registration),
`SERVER_ID` (optional, instant server commands; legacy `GUILD_ID` still works), `DATA_DIR` (point at a mounted
volume so `settings.json` survives redeploys), `ANTHROPIC_API_KEY` (optional, AI),
`PORT` (healthcheck server; host-provided), `LOG_DISCORD_DEBUG` (set `true` to
enable the gateway debug firehose; off by default), `LOG_ACCESS_DIAG` (set `true`
to log a per-command access diagnostic; off by default), `COMMAND_PERMISSION`
(permission a member needs to see/use `/tattletale`, e.g. `ManageChannels`,
`ModerateMembers`; default `ManageGuild`), `FLOOD_COOLDOWN_MS` (min gap between
identical alerts; default 8000, 0 disables), `SPLIT_WINDOW_MS`/`SPLIT_MAX_ITEMS`
(anti-evasion window; default 30000ms / 8 messages), `BOT_NAME` (auto-applied bot
name; default `TattleTale`). **Licensing:** `OWNER_ID` (your user id — required for
owner key commands), `OWNER_SERVER_ID` (your server — owner commands registered
only here; also licence-exempt), `LICENSE_EXEMPT_SERVERS` (comma-separated always-
licensed server ids), `LICENSE_PURCHASE_URL` (shown to unlicensed servers).

### Deployment & reliability (Railway) — important

These fixes exist because of real production issues; do not regress them:

- **Run `node` directly, not `npm start`.** `npm` does **not** forward `SIGTERM`
  to the node child, so on every redeploy the old container was force-killed
  (non-zero exit) and Railway emailed "Deployment crashed". `railway.json` sets
  `startCommand` to `exec node src/index.js` so node becomes the signalled process
  (PID 1) and our graceful shutdown runs. (Command registration is done at runtime
  by index.js, so no separate deploy-commands step is needed at startup.)
- **Graceful shutdown** on SIGTERM/SIGINT/SIGHUP/SIGQUIT → `client.destroy()` →
  `process.exit(0)` (clean teardown, no false crash email).
- **Stay alive on stray errors:** `uncaughtException` and `unhandledRejection`
  are logged (with stack) but do not crash the process; `uncaughtExceptionMonitor`
  guarantees a stack is always captured.
- **Diagnostics:** every log line is timestamped; a startup banner reports config
  + whether launched by npm vs direct node; a 30s heartbeat logs uptime + memory
  (an OOM kill = exit 137, uncatchable, shows as climbing RSS then silence);
  shard lifecycle (ready/resume/reconnect/disconnect) is logged.
- **Healthcheck:** a tiny built-in HTTP server answers 200 on any path on `$PORT`
  (harmless; satisfies a host healthcheck if one is ever configured).
- **Persistence:** settings live in `settings.json`; set `DATA_DIR` to a mounted
  volume or config resets on every redeploy.

---

## Version history

- **1.3.0** — Per-server licensing / paywall.
  - License-key system (`licenses.js` + `licenses.json`): mint keys with a chosen
    duration (or lifetime), bind on first activation, expiry, **revocation**.
  - `/tattletale activate` + `license`; commands and message screening are gated
    by `isLicensed` (unlicensed servers are inert except activate/license/help).
  - Owner key management (`genkey`/`revoke`/`keys`) registered only in
    `OWNER_SERVER_ID` and code-gated to `OWNER_ID`; plus a CLI for self-host.
  - **Security model:** enforceable only because YOU host the single instance —
    customers invite the bot, never run the code. Keep the repo private + secrets
    in env. Self-hosted licensing would be bypassable, by design of all software.
  - Tests: `licenses.test.js` (generate/activate/expiry/revoke/binding/exempt).
- **1.2.0** — Modular refactor + safety/quality features (no behaviour change to
  existing alerts; verified by tests).
  - **Architecture:** split `index.js` into `matching.js` (pure, unit-tested),
    `screening.js` (screening brain + delete/edit/bulk handlers), and
    `commands.js` (slash router); `index.js` is now slim orchestration.
  - **Flood control** (`FLOOD_COOLDOWN_MS`, default 8s): suppress identical
    alerts (server/user/word/tier) so spam can't flood a channel.
  - **Who-deleted:** delete logs do a best-effort audit-log lookup (mod vs self).
  - **Whole-word matching** (`wholeword:true` per word): "para" not "paradise".
    (Chose deterministic word-boundary matching over AI — it's a boundary problem,
    not a meaning problem.)
  - **only-flagged delete/edit logging is now ON by default** — benign deletes/
    edits aren't logged; toggle `onlyflagged` off for a full activity log.
  - **Backup/restore** (`/tattletale export` + `import`), `/tattletale help`, and
    pagination so long word/trigger lists no longer truncate.
  - **Configurable** anti-evasion window (`SPLIT_WINDOW_MS`/`SPLIT_MAX_ITEMS`) +
    optional Judge verdict on the combined split text; periodic buffer sweep so
    in-memory maps don't grow for idle users.
  - **Configurable command-access permission** (`COMMAND_PERMISSION`, default
    Manage Server) — gate `/tattletale` behind a permission your mods already have
    (Discord hides commands by permission, not by role; this is the only bot-side
    way to restrict visibility without the Integrations override).
  - **Tests + CI:** `node:test` suite (matching/config/screening) + GitHub Actions
    on Node 18/20/22.
- **1.1.0** — Word system overhaul + production reliability.
  - Split the single flagged list into **good / bad / AI** word lists (old
    `flaggedWords` auto-migrate to **bad words**); good words skip AI, bad words
    are always AI-checked.
  - **Per-word channel** routing and **per-word user/role ping** (`notify`).
  - Severity tiers with colours incl. green "good"; per-tier channels.
  - Expanded built-in AI trigger set.
  - Reliability: run node directly so SIGTERM is handled (stop false Railway
    "crashed" emails), graceful shutdown, keep-alive on uncaught errors,
    timestamped logging, startup banner, heartbeat, shard lifecycle logs, and a
    healthcheck HTTP server.
  - Renamed the AI commands to **judge / judgethreshold / judgewords** and
    rebranded all user-facing "AI" wording to "judge/judging".
  - **Access model:** removed the custom in-code role allowlist
    (`allowrole`/`denyrole`) in favour of Discord-native command permissions —
    `setDefaultMemberPermissions(ManageGuild)` by default; extra roles/members
    granted via Server Settings → Integrations → Tattletale.
- **1.0.0** — Initial bot: delete/edit/bulk-delete logging, flagged-word alerts,
  optional AI detection, role allowlist, per-server persisted settings.
