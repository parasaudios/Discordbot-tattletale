# Tattletale — How-To Guide

A complete, practical guide to configuring and running the Tattletale moderation
bot. Everything the bot does is **notify-only**: it watches your server and posts
alerts to a channel you choose. It never deletes messages, kicks, bans, or
punishes anyone.

> **Two kinds of configuration**
> 1. **Host setup** — a few secrets/variables set once on the machine (or
>    Railway) that runs the bot. See [Part A](#part-a--host-setup-one-time).
> 2. **In-Discord settings** — everything day-to-day (alert channel, words,
>    toggles) is configured live with the `/tattletale` command. No restarts, no
>    file editing. See [Part B](#part-b--in-discord-commands).

---

## Table of contents

- [What the bot watches for](#what-the-bot-watches-for)
- [Part A — Host setup (one time)](#part-a--host-setup-one-time)
  - [Environment variables](#environment-variables)
  - [Registering the slash command](#registering-the-slash-command)
  - [Required Discord permissions & intents](#required-discord-permissions--intents)
- [Part B — In-Discord commands](#part-b--in-discord-commands)
  - [Command reference](#command-reference)
- [Part C — First-time setup in 3 steps](#part-c--first-time-setup-in-3-steps)
- [Part D — Managing flagged words (with examples)](#part-d--managing-flagged-words-with-examples)
- [Part E — Toggles: turning logging on and off](#part-e--toggles-turning-logging-on-and-off)
- [Part F — AI contextual detection](#part-f--ai-contextual-detection)
- [Part G — Restricting who can use the bot](#part-g--restricting-who-can-use-the-bot)
- [Part H — Every setting at a glance](#part-h--every-setting-at-a-glance)
- [Part I — Troubleshooting](#part-i--troubleshooting)

---

## What the bot watches for

| Alert | Trigger | Default |
|-------|---------|---------|
| 🗑️ **Message deleted** | A user's message is deleted | ON |
| 🧹 **Bulk delete** | Many messages purged at once (mod tools, ban-with-cleanup) | ON (follows the delete toggle) |
| ✏️ **Message edited** | A user edits a message (before/after shown) | ON |
| 🚩 **Flagged word** | A message (or edit) contains a word on your list | ON |
| 🤖 **AI flagged** | The AI judges a message to be a scam/phishing/harassment | OFF |

Every alert is posted to the **single mod-alert channel you pick** — never the
channel where the original message appeared.

---

## Part A — Host setup (one time)

These are set on the machine running the bot, **not** in Discord. Copy
`.env.example` to `.env` and fill it in.

### Environment variables

| Variable | Required | What it is | Where to get it |
|----------|----------|------------|-----------------|
| `DISCORD_TOKEN` | ✅ Yes | The bot's login token. **Keep secret.** | Developer Portal → your app → **Bot** → Reset/Copy Token |
| `CLIENT_ID` | ✅ Yes | Your application (client) ID. Needed to register commands. | Developer Portal → your app → **General Information** → Application ID |
| `GUILD_ID` | ⬜ Optional | A server ID. If set, slash commands register to that server **instantly** (great for testing). Leave blank to register globally (can take up to ~1 hour to appear). | Right-click your server icon → Copy Server ID (Developer Mode on) |
| `DATA_DIR` | ⬜ Optional | Folder where `settings.json` is saved. Point it at a mounted volume (e.g. `/data` on Railway) so settings survive redeploys. Defaults to the project root. | You choose |
| `ANTHROPIC_API_KEY` | ⬜ Optional | Enables AI detection. Without it, the `ai` feature simply stays off. | https://console.anthropic.com |

Example `.env`:

```bash
DISCORD_TOKEN=your-bot-token-here
CLIENT_ID=123456789012345678
GUILD_ID=                      # blank = register globally
DATA_DIR=                      # blank = project root
ANTHROPIC_API_KEY=             # blank = AI detection disabled
```

> ⚠️ Never commit `.env` or your token to git. `.env` and `settings.json` are
> already in `.gitignore`.

### Registering the slash command

The `/tattletale` command must be registered with Discord whenever its structure
changes (adding words/toggles at runtime does **not** count). This is wired to
happen **automatically**: `npm start` runs a `prestart` hook that registers the
command first, so every launch/redeploy picks up the latest definition.

```bash
npm install          # first time only
npm start            # auto-registers the command, then starts the bot
```

You can also register manually without starting the bot:

```bash
npm run deploy       # registers the /tattletale command only
```

- With `GUILD_ID` set → the command appears in that server immediately.
- With `GUILD_ID` blank → it registers globally and may take up to ~1 hour.

### Required Discord permissions & intents

When you invite the bot (OAuth2 URL), use the **`bot`** and
**`applications.commands`** scopes, and grant at least:

- **View Channel** and **Send Messages** and **Embed Links** — in the channel
  where alerts will be posted (so it can post the embeds).
- **Read Message History** — helps it show content for older messages.

In the **Developer Portal → Bot → Privileged Gateway Intents**, enable:

- ✅ **Message Content Intent** — *required*. Without it the bot can't read
  message text, so keyword and AI detection silently do nothing.

---

## Part B — In-Discord commands

All configuration is done with subcommands of **`/tattletale`**, typed in any
channel the bot can see. By default you need the **Manage Server** permission to
use them (see [Part G](#part-g--restricting-who-can-use-the-bot) to tighten that).

### Command reference

| Command | What it does |
|---------|--------------|
| `/tattletale setchannel channel:<#channel>` | Set/Change the channel where **all** alerts are posted. |
| `/tattletale addword word:<text>` | Add a word or phrase to the flagged list. |
| `/tattletale removeword word:<text>` | Remove one word/phrase from the list. |
| `/tattletale listwords` | Show every flagged word. |
| `/tattletale clearwords` | Remove **all** flagged words at once. |
| `/tattletale toggle feature:<deletes\|edits\|flagged> enabled:<true\|false>` | Turn a logging feature on or off. |
| `/tattletale ai enabled:<true\|false>` | Turn AI contextual detection on or off. |
| `/tattletale aithreshold value:<0–1>` | Set how confident the AI must be before it alerts. |
| `/tattletale aiwords add phrase:<text>` | Add a scam/harassment phrase that triggers AI review. |
| `/tattletale aiwords remove phrase:<text>` | Remove a phrase from the AI trigger list. |
| `/tattletale aiwords edit old:<text> new:<text>` | Replace one AI trigger phrase with another. |
| `/tattletale aiwords list` | Show all AI trigger phrases. |
| `/tattletale aiwords clear` | Reset the AI trigger list to the built-in defaults. |
| `/tattletale allowrole role:<@role>` | Allow a role to use the bot's commands (on top of Manage Server). |
| `/tattletale denyrole role:<@role>` | Remove a role from the command allowlist. |
| `/tattletale settings` | Show the current configuration. |

> All replies are **ephemeral** — only you see them, so configuring the bot
> doesn't clutter the channel.

---

## Part C — First-time setup in 3 steps

1. **Pick an alert channel.** Make a private channel (e.g. `#mod-alerts`) only
   mods can see, and make sure the bot can post there. Then:
   ```
   /tattletale setchannel channel:#mod-alerts
   ```
   > If the bot is missing permissions in that channel, the command warns you so
   > alerts don't silently disappear.

2. **Add a few flagged words** (optional):
   ```
   /tattletale addword word:scam
   /tattletale addword word:free nitro
   ```

3. **Check your work:**
   ```
   /tattletale settings
   ```

That's it. Delete and edit logging are already on by default.

---

## Part D — Managing flagged words (with examples)

Matching is **evasion-resistant** and **substring-based**, so a single entry
catches the obvious dodges people use. Adding `poop` flags all of these:

- Case variations — `Poop`, `POOP`
- Letter-stretching — `pooooop`, `Poooooop`
- Leetspeak / symbol swaps — `po0p`, `p00p`
- Inserted separators — `p o o p`, `p.o.o.p`, `p-o-o-p`
- As part of a bigger word — `poops`, `poopy`, "help i pooped"

It does **not** match unrelated words that merely share letters (e.g. `popular`,
`lollipop`). Phrases work too, and words are stored lowercased.

> **Heads up — this can over-match.** Because it matches as a substring, a short
> entry will also flag longer words that contain it. Prefer specific entries
> (e.g. a full slur rather than a 3-letter fragment) to avoid false alarms.

**Add a single word**
```
/tattletale addword word:phishing
```
→ ✅ Added `phishing` to the flagged list.

**Add a multi-word phrase** (everything after `word:` is one entry)
```
/tattletale addword word:click this link
```
→ ✅ Added `click this link` to the flagged list.

**Try to add a duplicate**
```
/tattletale addword word:phishing
```
→ That word is already on the list.

**Remove one word**
```
/tattletale removeword word:phishing
```
→ ✅ Removed `phishing` from the flagged list.

**See the whole list**
```
/tattletale listwords
```
→ **Flagged words (3):** `scam`, `free nitro`, `click this link`

**Wipe the entire list** (irreversible — it tells you how many it cleared)
```
/tattletale clearwords
```
→ ✅ Cleared 3 flagged word(s).

> **What an alert looks like:** when someone posts a message matching a flagged
> word, the mod channel gets a 🚩 embed with the user, the channel, the flagged
> word that matched, the full message, and a jump link. Edits are re-scanned too,
> so sneaking a banned word in *after* posting still triggers an alert.

---

## Part E — Toggles: turning logging on and off

Three independent switches, each on by default. Use `enabled:true` or
`enabled:false`.

| Feature value | Controls |
|---------------|----------|
| `deletes` | 🗑️ deleted-message and 🧹 bulk-delete alerts |
| `edits` | ✏️ edited-message alerts |
| `flagged` | 🚩 flagged-word alerts |

**Examples**
```
/tattletale toggle feature:deletes enabled:false     # stop logging deletions
/tattletale toggle feature:edits enabled:true        # (re)enable edit logging
/tattletale toggle feature:flagged enabled:false     # pause keyword alerts
```

> Turning off `flagged` only stops the **keyword** alerts; your saved word list
> is kept and resumes when you turn it back on. AI detection is a separate switch
> (see below).

---

## Part F — AI contextual detection

The keyword list catches *specific words you chose*. AI detection is the second
layer that judges **intent and context** on messages generally — catching
scams, phishing, harassment, hate, threats, unwanted sexual content, and spam
that are worded to slip past a word list. The two work **together**: the keyword
filter flags your banned words, and the AI independently reviews messages for
anything harmful.

**Requirements:** an `ANTHROPIC_API_KEY` set on the host (Part A). Enabling it
without a key returns a warning and nothing runs.

**Turn it on / off**
```
/tattletale ai enabled:true
/tattletale ai enabled:false
```

**What it screens & costs:** the AI only reviews a message when it contains a
phrase from the **AI trigger list** (scam/harassment signals like `free nitro`,
`http`, `kill yourself`, `seed phrase`, …). Everything else is ignored, so API
calls — and cost — stay low. Identical messages are cached for a few minutes too.
It uses a small, inexpensive model (Claude Haiku) with prompt caching.

### The AI trigger list

The trigger list is what makes the AI work *together with* the keyword filter:
the filter flags your exact banned words, while the trigger list decides which
messages are worth an AI intent-check. It ships with a sensible default set and
is fully editable:

```
/tattletale aiwords list                          # see the current phrases
/tattletale aiwords add phrase:get rich quick      # add a signal
/tattletale aiwords remove phrase:loser            # drop one
/tattletale aiwords edit old:kys new:end it        # rename one
/tattletale aiwords clear                          # restore the built-in defaults
```

- Triggers are matched with the same evasion-resistant logic as flagged words
  (so `fr33 n1tro` still trips `free nitro`).
- A trigger only *starts* an AI review — the AI still judges intent, so an
  innocent message that merely contains a trigger phrase won't be alerted on.
- **`clear` restores the defaults** rather than emptying the list, so the AI
  always keeps a baseline of scam/harassment signals to watch for.

### The confidence threshold

For each screened message the AI returns a **confidence score from 0 to 1** — how
sure it is the message is abusive. The bot only alerts when that score is **at or
above your threshold**. Think of it as a sensitivity dial.

```
/tattletale aithreshold value:0.6
```

| Threshold | Effect |
|-----------|--------|
| `0.4` (low) | **More sensitive** — catches borderline cases, but more false alarms |
| `0.6` (default) | Balanced |
| `0.85` (high) | **Stricter** — only near-certain abuse alerts; fewer false alarms, may miss subtle cases |

The value is clamped to the 0–1 range and shown in `/tattletale settings`.

> **What an AI alert looks like:** a 🤖 embed with the user, channel, the
> **category** (scam / phishing / harassment / hate / threat / sexual / self-harm
> / spam / other) and confidence %, a short reason, the message, and a jump link.
> Like everything else, it only notifies — it never acts on the message.

---

## Part G — Restricting who can use the bot

By default, **anyone with Manage Server** can run `/tattletale`. For tighter
control you can require a specific role *in addition to* Manage Server (defense in
depth — a caller must have Manage Server **and** an allowed role).

**Allow a role**
```
/tattletale allowrole role:@Bot Admin
```
→ ✅ Members with @Bot Admin can now use the bot's commands.

**Remove a role from the allowlist**
```
/tattletale denyrole role:@Bot Admin
```

- **Empty allowlist** (default) → Manage Server alone is enough.
- **Non-empty allowlist** → the caller must have Manage Server **and** at least
  one listed role.

> Keep at least one role you hold on the allowlist, or make sure you have Manage
> Server, so you don't lock yourself out.

---

## Part H — Every setting at a glance

These per-server settings are stored in `settings.json` and managed entirely
through the commands above (no manual editing needed).

| Setting | Default | Set with |
|---------|---------|----------|
| Alert channel | *none* (must be set) | `/tattletale setchannel` |
| Flagged words | empty list | `/tattletale addword` / `removeword` / `clearwords` |
| Log deletes (incl. bulk) | **ON** | `/tattletale toggle feature:deletes` |
| Log edits | **ON** | `/tattletale toggle feature:edits` |
| Log flagged words | **ON** | `/tattletale toggle feature:flagged` |
| AI detection | **OFF** | `/tattletale ai` |
| AI confidence threshold | **0.6** | `/tattletale aithreshold` |
| AI trigger phrases | built-in default set | `/tattletale aiwords add` / `remove` / `edit` / `list` / `clear` |
| Command access roles | empty (anyone w/ Manage Server) | `/tattletale allowrole` / `denyrole` |

View the live values any time:
```
/tattletale settings
```

---

## Part I — Troubleshooting

| Symptom | Likely cause & fix |
|---------|--------------------|
| **No alerts appear at all** | No alert channel set — run `/tattletale setchannel`. Confirm the feature toggle is on with `/tattletale settings`. |
| **Alerts stopped / never post to the channel** | The bot lacks **View Channel / Send Messages / Embed Links** in the alert channel. Re-run `/tattletale setchannel` — it warns about missing permissions. |
| **Keyword & AI detection do nothing** | **Message Content Intent** isn't enabled in the Developer Portal (Bot → Privileged Gateway Intents). |
| **`/tattletale` doesn't show up** | Registration runs automatically on start, but global commands can take ~1 hour to appear; set `GUILD_ID` for instant registration. If still missing, redeploy/restart the bot (or run `npm run deploy`) and check the logs for a registration error. |
| **"You need the Manage Server permission"** | You're missing Manage Server, or a role allowlist is set and you don't hold an allowed role (`/tattletale allowrole`). |
| **AI won't enable** | `ANTHROPIC_API_KEY` isn't set on the host. Add it, restart, then `/tattletale ai enabled:true`. |
| **Settings reset after a redeploy** | Set `DATA_DIR` to a persistent/mounted volume so `settings.json` survives. |
| **Deleted/edited message shows "Unknown (uncached)"** | The message was posted before the bot started (not in its cache), so Discord can't supply the original author/content. New messages are unaffected. |

---

*Tattletale is notify-only by design — it surfaces what happened so your mod team
can decide what to do. It never deletes, edits, or punishes on its own.*
