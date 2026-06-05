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
