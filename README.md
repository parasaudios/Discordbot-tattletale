# Tattletale — Discord moderation bot

A [discord.js](https://discord.js.org) v14 bot that:

- Logs **deleted** and **edited** messages
- **Alerts mods to bad words** (Judge-checked) and **good words** (safe) — posted to a channel you choose,
  **not** the channel where the word was used

All events (deletes, edits, good/bad words, Judge catches) are sent to the mod-alert channel(s)
that a server admin selects with `/tattletale setchannel`.

## Setup

1. **Create the app & bot** at the [Developer Portal](https://discord.com/developers/applications)
   → New Application → Bot. Copy the **token** (keep it secret).
2. **Enable the Message Content Intent**: in the portal under **Bot →
   Privileged Gateway Intents**, turn on **Message Content Intent**. This is
   required to read message text for logging and flagged-word scanning.
3. **Invite the bot**: under **OAuth2 → URL Generator**, select the `bot` and
   `applications.commands` scopes, plus the **Send Messages** and
   **View Channels** permissions. Open the generated URL and add it to your server.
4. **Install & configure:**
   ```bash
   npm install
   cp .env.example .env   # then fill in DISCORD_TOKEN and CLIENT_ID
   ```
5. **Register the slash command:**
   ```bash
   npm run deploy
   ```
6. **Run the bot:**
   ```bash
   npm start
   ```
7. In your server, run `/tattletale setchannel` and pick the channel where mod alerts
   should appear. (By default only members with **Manage Server** can use the
   commands — grant extra roles in Server Settings → Integrations → Tattletale.)

## Configuration

Everything is configured **inside Discord** with the `/tattletale` command — no
file edits and no restarts. For the **complete how-to** — every setting,
environment variable, and command with worked examples — see
**[HOWTO.md](HOWTO.md)** (or `USAGE.md` for a shorter user-facing version).
Quick start:

```
/tattletale setchannel channel:#mod-alerts   # where alerts go
/tattletale badword add word:scam            # flag a bad word
/tattletale settings                         # view current config
```

By default only members with **Manage Server** can use the commands; grant extra roles/members via Discord's Server Settings → Integrations → Tattletale.

## Notes

- `settings.json` (per-server config: alert channel, words, toggles) and `.env`
  are git-ignored.
- Uncached messages (sent before the bot started) are still logged on
  delete/edit, but their original content may show as "Unknown".

## Reference

Built against the official Discord developer documentation — see `CLAUDE.md`.

## Hosting

To run the bot 24/7, see `DEPLOYMENT.md` for a step-by-step Railway deploy.
