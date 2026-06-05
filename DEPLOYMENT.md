# Deploying Tattletale to Railway

This guide walks you through hosting the bot on [Railway](https://railway.com) so
it runs 24/7, deploying straight from your GitHub repo. No web server or domain
is needed — a Discord bot is a background service, not a website.

> Railway is a great fit for a single-server moderation bot like this. It's best
> suited to hobby and low-stakes services rather than large mission-critical
> production systems, which is exactly this use case.

---

## Before you start

You'll need:

- The bot pushed to your GitHub repo (`parasaudios/Discordbot-tattletale`).
- Your **bot token** and **application (client) ID** from the
  [Developer Portal](https://discord.com/developers/applications).
- A Railway account (sign up with GitHub to make linking easy).

---

## Step 1 — Create the project from GitHub

1. Go to [railway.com](https://railway.com) and open your dashboard.
2. Click **New Project** → **Deploy from GitHub repo**.
3. If your GitHub isn't linked yet, Railway will prompt you to connect it. Grant
   access to the `Discordbot-tattletale` repo.
4. Select the repo. When asked, choose **Add Variables** (not "Deploy Now") —
   the bot needs its token before it can start. Railway will detect it as a
   Node.js app automatically.

---

## Step 2 — Add environment variables

In the service's **Variables** tab, add these (from your `.env.example`):

| Variable | Value |
|----------|-------|
| `DISCORD_TOKEN` | Your bot token (keep secret) |
| `CLIENT_ID` | Your application ID |
| `DATA_DIR` | `/data` |
| `GUILD_ID` | *(optional)* your server ID, for instant command registration |
| `ANTHROPIC_API_KEY` | *(optional)* enables AI detection; get one at console.anthropic.com |

`DATA_DIR=/data` tells the bot to store its settings on the persistent volume
you'll add in Step 3. Without it, settings would reset on every redeploy.

---

## Step 3 — Add a persistent volume (important)

The bot saves each server's config (alert channel, flagged words, toggles) to a
`settings.json` file. Railway rebuilds the container on every deploy, which wipes
ordinary files — so you must attach a volume to keep your settings.

1. On the project canvas, right-click the service (or open its settings).
2. Find **Volumes** → **Add Volume**.
3. Set the **mount path** to `/data` (matching the `DATA_DIR` variable above).
4. Save.

Now `settings.json` lives on the volume and survives every redeploy and restart.

---

## Step 4 — Deploy

1. Click **Deploy** on the project canvas to apply your variables and volume.
2. Railway installs dependencies and runs `npm start` (already defined in
   `package.json`) automatically.
3. Open **View Logs** and watch for:
   ```
   Tattletale online as <YourBot#1234>
   ```
   That means it connected to Discord successfully.

You do **not** need to generate a domain — skip that step. The bot has no web
server and doesn't listen on a port.

---

## Step 5 — Slash-command registration (now automatic)

The `/tattletale` command must be registered with Discord whenever its definition
changes. **This now happens automatically on every deploy**: the `npm start`
script runs a `prestart` hook (`node src/deploy-commands.js`) first, so each time
Railway deploys or restarts the bot, the latest commands are re-registered before
it comes online. A registration hiccup can't block the bot — the hook is allowed
to fail without stopping startup.

So on Railway you don't need to do anything here. If you ever want to register
manually (e.g. from your own machine without restarting the host), you still can:

- **Locally:** with your `.env` filled in, run `npm run deploy`.

Global commands can take up to an hour to appear. Setting `GUILD_ID` registers
them to your server instantly — useful while testing.

> Note: registration is idempotent, so re-running it on every deploy/restart is
> harmless — it just overwrites the command list with the same (or newly updated)
> definition.

---

## Step 6 — Invite the bot and configure it

1. In the Developer Portal, **OAuth2 → URL Generator**: select the `bot` and
   `applications.commands` scopes, plus **View Channels** and **Send Messages**
   permissions. Open the generated URL and add the bot to your server.
2. Make sure the **Message Content Intent** is enabled (Developer Portal →
   **Bot → Privileged Gateway Intents**), or logging won't work.
3. In your server, run `/tattletale setchannel channel:#mod-alerts` and add some
   flagged words. See `USAGE.md` for the full command list.

---

## Automatic redeploys

Once connected, Railway redeploys automatically every time you push to the repo's
main branch. Your settings persist on the volume across these deploys.

---

## Troubleshooting

- **Logs show a token error / bot won't start** — Check `DISCORD_TOKEN` is set
  correctly in Variables. The error is rarely on the last log line, so scroll up.
- **Settings reset after a deploy** — The volume isn't mounted at `/data`, or
  `DATA_DIR` isn't set to `/data`. Both must match.
- **`/tattletale` doesn't appear** — Run the registration step (Step 5). Global
  commands can take up to an hour; use `GUILD_ID` for instant testing.
- **No alerts post** — Confirm the Message Content Intent is on, the bot can see
  and post in the alert channel, and you've run `/tattletale setchannel`.

---

For commands and configuration, see `USAGE.md`. For the Discord documentation
reference, see `CLAUDE.md`.
