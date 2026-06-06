# CLAUDE.md

## ⚠️ Required workflow for this project

**EVERY TIME** you make a change to this Discord bot, you MUST first consult the
official Discord developer documentation referenced below and verify your change
against it. Do not make API calls, define commands, set intents/scopes, or alter
bot behavior without confirming the relevant detail in the docs first.

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
- **OAuth2 scopes:** for a server (guild) install, use the `bot` scope plus
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

- `src/index.js` — gateway client, event handlers, message screening, slash-command
  handling, startup/health/diagnostics.
- `src/config.js` — per-guild settings, persisted to `settings.json` (see `DATA_DIR`).
- `src/deploy-commands.js` — builds & registers the `/tattletale` slash command.
- `src/ai.js` — Anthropic (Claude) contextual classification.

### Word lists (three, independent)

Each good/bad word is stored as `{ word, channelId, notify }` — both overrides
optional. Matching is case-insensitive, substring-based, and evasion-resistant
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

- Good word → its own `channel` → default alert channel.
- Bad word → its own `channel` → its tier channel (high/low) → default.
- AI-word catch → its tier channel (medium/low) → default.
- Each good/bad word may also `notify` a **user or role** (a Discord *mentionable*),
  which is pinged in the alert via message content + `allowedMentions`.

### Other features

- Logs **deleted**, **bulk-deleted**, and **edited** messages. Edited content is
  re-screened so a banned word added after posting is still caught.
- Toggles: `deletes`, `edits`, `badwords` (each on by default).
- AI contextual detection (off by default; needs `ANTHROPIC_API_KEY`), with a
  configurable confidence threshold.
- Command access controlled by a **role allowlist** (no Discord permission
  required): empty = everyone; once a role is added, only members with an allowed
  role can use the commands. No `setDefaultMemberPermissions` is set on the command.

### Slash commands (`/tattletale`)

`setchannel [tier]`, `badword add|remove|list|clear`, `goodword add|remove|list|clear`,
`judgewords add|remove|edit|list|clear`, `toggle`, `judge`, `judgethreshold`,
`allowrole`, `denyrole`, `settings`. `add` for good/bad words takes optional
`channel:` and `notify:` (mentionable). Re-register only when the command
*structure* changes (adding words at runtime does not).

### Environment variables

`DISCORD_TOKEN` (req), `CLIENT_ID` (req, for command registration),
`GUILD_ID` (optional, instant guild commands), `DATA_DIR` (point at a mounted
volume so `settings.json` survives redeploys), `ANTHROPIC_API_KEY` (optional, AI),
`PORT` (healthcheck server; host-provided), `LOG_DISCORD_DEBUG` (set `false` to
silence the gateway debug firehose).

### Deployment & reliability (Railway) — important

These fixes exist because of real production issues; do not regress them:

- **Run `node` directly, not `npm start`.** `npm` does **not** forward `SIGTERM`
  to the node child, so on every redeploy the old container was force-killed
  (non-zero exit) and Railway emailed "Deployment crashed". `railway.json` sets
  `startCommand` to `node src/deploy-commands.js || true; exec node src/index.js`
  so node becomes the signalled process (PID 1) and our graceful shutdown runs.
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
  - **Access model:** removed the Manage Server requirement — command access is
    now purely the role allowlist (empty = everyone; a role added = only that
    role). No `setDefaultMemberPermissions` on the command.
- **1.0.0** — Initial bot: delete/edit/bulk-delete logging, flagged-word alerts,
  optional AI detection, role allowlist, per-guild persisted settings.
