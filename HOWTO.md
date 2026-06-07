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
- [Part D — Managing word lists (good / bad / judge)](#part-d--managing-word-lists-good--bad--judge)
- [Part E — Toggles: turning logging on and off](#part-e--toggles-turning-logging-on-and-off)
- [Part F — Contextual judging](#part-f--contextual-judging)
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
| ✅🔴🟠🟡 **Content alert** | A good/bad word or the Judge flags a message — colour-coded (see below) | bad words ON, Judge OFF |

There are **three word lists** (manage them in Part D):
- **✅ Good words** — safe words you just want a heads-up about. **No Judge check.** Green.
- **🚫 Bad words** — bad words. **Always Judge-checked** so a severity tier is decided.
- **🤖 Judge words** — scam/harassment signal phrases that let the Judge review *other* messages.

Content alerts are **colour-coded by severity**, and each can route to its own channel:

| Tier | Colour | When |
|------|--------|------|
| ✅ **Good** | green | A good word was used (safe, FYI) — no Judge |
| 🔴 **High** | red | A **bad word** *and* the Judge both rule it harmful |
| 🟠 **Medium** | orange | The Judge rules it harmful (caught via a Judge word, no bad word) |
| 🟡 **Low** | yellow | A bad word and/or Judge-reviewed, but **not** confirmed harmful (a heads-up) |

Every alert goes to the **channel(s) you pick** — never where the message appeared.
By default everything shares one channel; you can split by tier
(`/tattletale setchannel … tier:…`) **or per word** (`badword add … channel:#x`).

---

## Part A — Host setup (one time)

These are set on the machine running the bot, **not** in Discord. Copy
`.env.example` to `.env` and fill it in.

### Environment variables

| Variable | Required | What it is | Where to get it |
|----------|----------|------------|-----------------|
| `DISCORD_TOKEN` | ✅ Yes | The bot's login token. **Keep secret.** | Developer Portal → your app → **Bot** → Reset/Copy Token |
| `CLIENT_ID` | ✅ Yes | Your application (client) ID. Needed to register commands. | Developer Portal → your app → **General Information** → Application ID |
| `SERVER_ID` | ⬜ Optional | A server ID. If set, slash commands register to that server **instantly** (great for testing). Leave blank to register globally (~1 hour to appear). Legacy `GUILD_ID` still works. | Right-click your server icon → Copy Server ID (Developer Mode on) |
| `DATA_DIR` | ⬜ Optional | Folder where `settings.json` is saved. Point it at a mounted volume (e.g. `/data` on Railway) so settings survive redeploys. Defaults to the project root. | You choose |
| `ANTHROPIC_API_KEY` | ⬜ Optional | Enables judging. Without it, the `judge` feature simply stays off. | https://console.anthropic.com |

Example `.env`:

```bash
DISCORD_TOKEN=your-bot-token-here
CLIENT_ID=123456789012345678
SERVER_ID=                     # blank = register globally
DATA_DIR=                      # blank = project root
ANTHROPIC_API_KEY=             # blank = judging disabled
```

> ⚠️ Never commit `.env` or your token to git. `.env` and `settings.json` are
> already in `.gitignore`.

### Registering the slash command

This is **fully automatic** — you don't need to run anything. On startup the bot
registers `/tattletale` in **every server it's in** (instant, server-scoped
commands), and it registers in **any new server the moment it's added** (via the
`guildCreate` event). It also clears any stale global copies. So:

- **Invite the bot → commands appear within seconds.** No `SERVER_ID` needed, no
  ~1-hour global wait.
- A redeploy re-registers automatically and picks up any structure changes.

> **Invite scope matters:** the invite URL **must** include both `bot` **and**
> `applications.commands` scopes, or the slash commands won't appear no matter what.

`SERVER_ID` is now optional and only affects the manual `npm run deploy` path
(which still exists for one-off registration/clearing). `BOT_NAME` (optional)
sets the auto-applied bot name; defaults to `TattleTale`.

### Required Discord permissions & intents

When you invite the bot (OAuth2 URL), use the **`bot`** and
**`applications.commands`** scopes, and grant at least:

- **View Channel** and **Send Messages** and **Embed Links** — in the channel
  where alerts will be posted (so it can post the embeds).
- **Read Message History** — helps it show content for older messages.

In the **Developer Portal → Bot → Privileged Gateway Intents**, enable:

- ✅ **Message Content Intent** — *required*. Without it the bot can't read
  message text, so keyword and judging silently do nothing.

---

## Part B — In-Discord commands

All configuration is done with subcommands of **`/tattletale`**, typed in any
channel the bot can see. By default only members with **Manage Server** can use
them; grant extra roles/members via Discord's **Server Settings → Integrations**
(see [Part G](#part-g--restricting-who-can-use-the-bot)).

### Command reference

| Command | What it does |
|---------|--------------|
| `/tattletale setchannel channel:<#channel> [tier:default\|good\|high\|medium\|low\|deletes\|edits]` | Set where alerts go. With no `tier`, sets the default/fallback channel for everything. With a `tier`, routes just that category there. |
| `/tattletale badword add word:<text> [channel:<#ch>] [notify:<@user/role…>]` | Add a **bad word** (Judge-checked → tiered). Optional per-word channel + ping (one or more users/roles). |
| `/tattletale badword remove\|list\|clear` | Remove one / show all / clear all bad words. |
| `/tattletale goodword add word:<text> [channel:<#ch>] [notify:<@user/role…>]` | Add a **good word** (safe, notify-only, **no Judge**). Optional per-word channel + ping (one or more users/roles). |
| `/tattletale goodword remove\|list\|clear` | Remove one / show all / clear all good words. |
| `/tattletale toggle feature:<deletes\|edits\|badwords\|debug> enabled:<true\|false>` | Turn a logging feature (or **debug** logging) on or off. |
| `/tattletale judge enabled:<true\|false>` | Turn contextual judging on or off. |
| `/tattletale judgethreshold value:<0–1>` | Set how confident the Judge must be before it alerts. |
| `/tattletale judgewords add phrase:<text>` | Add a scam/harassment phrase that triggers Judge review. |
| `/tattletale judgewords remove phrase:<text>` | Remove a phrase from the Judge trigger list. |
| `/tattletale judgewords edit old:<text> new:<text>` | Replace one Judge trigger phrase with another. |
| `/tattletale judgewords list` | Show all Judge trigger phrases. |
| `/tattletale judgewords clear` | Reset the Judge trigger list to the built-in defaults. |
| `/tattletale watch add\|remove\|list\|clear` | Choose which channels the bot monitors. Empty list = **all** channels (default); add channels to restrict it. |
| `/tattletale settings` | Show the current configuration. |

> All replies are **ephemeral** — only you see them, so configuring the bot
> doesn't clutter the channel.

### Routing severity tiers to different channels

By default, **one** `/tattletale setchannel channel:#x` sends every alert (all
tiers, plus delete/edit logs) to that channel. To split them up, set a channel
per tier — any tier you don't set falls back to the default channel:

```
/tattletale setchannel channel:#mod-alerts                 # default / fallback for everything
/tattletale setchannel channel:#urgent      tier:high      # 🔴 only critical alerts here
/tattletale setchannel channel:#ai-flags    tier:medium    # 🟠 Judge-only catches here
/tattletale setchannel channel:#noise        tier:low      # 🟡 harmless heads-ups out of the way
```

So you can keep the serious 🔴/🟠 alerts in your main mod channel and shove the
chatty 🟡 harmless ones into a low-priority channel. To send a tier back to the
default, just set it to your default channel again.

---

## Part C — First-time setup in 3 steps

1. **Pick an alert channel.** Make a private channel (e.g. `#mod-alerts`) only
   mods can see, and make sure the bot can post there. Then:
   ```
   /tattletale setchannel channel:#mod-alerts
   ```
   > If the bot is missing permissions in that channel, the command warns you so
   > alerts don't silently disappear.

2. **Add a few bad words** (optional):
   ```
   /tattletale badword add word:scam
   /tattletale badword add word:slur channel:#serious notify:@Mods
   ```

3. **Check your work:**
   ```
   /tattletale settings
   ```

That's it. Delete and edit logging are already on by default.

---

## Part D — Managing word lists (good / bad / judge)

There are three lists, each with its own job:

| List | Judge check? | Colour | Use it for | Manage with |
|------|-----------|--------|-----------|-------------|
| **🚫 Bad words** | ✅ always | 🔴/🟡 | Words that are bad — the Judge then decides *how* bad | `/tattletale badword …` |
| **✅ Good words** | ❌ never | ✅ green | "Safe" words you just want to be notified about | `/tattletale goodword …` |
| **🤖 Judge words** | (gates the Judge) | 🟠/🟡 | Signal phrases that let the Judge review *other* messages | `/tattletale judgewords …` |

**Matching** is the same for all three: **evasion-resistant and substring-based**.
Adding `poop` catches `Poop`, `pooooop`, `po0p`, `p o o p`, `poops`, "i pooped" —
but not unrelated words like `popular`. Phrases work; entries are stored lowercased.

> **Heads up — substring matching can over-match.** A short entry also flags
> longer words containing it. Prefer specific entries (a full word/slur, not a
> 2–3 letter fragment).

### Bad words (Judge-checked, tiered)
```
/tattletale badword add word:scam                         # plain bad word
/tattletale badword add word:slur channel:#serious notify:@Mods   # own channel + ping
/tattletale badword remove word:scam
/tattletale badword list
/tattletale badword clear
```
When a bad word is used, the Judge weighs intent → 🔴 **High** if it confirms harm,
🟡 **Low** if it looks harmless. Alerts go to that word's `channel` (if set),
otherwise the tier/default channel, and ping its `notify` user(s)/role(s) if set.

### Good words (safe, no Judge)
```
/tattletale goodword add word:welcome channel:#welcomes notify:@Greeter
/tattletale goodword remove word:welcome
/tattletale goodword list
/tattletale goodword clear
```
Good words **never** hit the Judge. When one is used you get a ✅ green "safe"
notice (optionally in its own channel / pinging someone). Handy for tracking a
keyword without treating it as an offense.

> **Per-word channel & ping:** both `channel:` and `notify:` are optional on
> `badword add` / `goodword add`. `notify:` accepts **one or more users/roles** —
> just @mention several in the field — and pings them all when that word fires.
> Leave them off to use the default channel.
>
> **Re-adding a word updates it** — e.g. `goodword add` the same word with a new
> `notify:` changes the ping but keeps its `channel:` (and vice versa). Only the
> fields you pass change; to clear a field, remove the word and add it fresh.

> **What an alert looks like:** the mod channel gets a colour-coded embed with the
> user, channel, the matched word, the Verdict (for bad words), the message,
> and a jump link. Edits are re-scanned, so words added *after* posting still fire.

---

## Part E — Toggles: turning logging on and off

Three independent switches, each on by default. Use `enabled:true` or
`enabled:false`.

| Feature value | Controls |
|---------------|----------|
| `deletes` | 🗑️ deleted-message and 🧹 bulk-delete alerts |
| `edits` | ✏️ edited-message alerts |
| `badwords` | 🚫 bad-word alerts |

**Examples**
```
/tattletale toggle feature:deletes enabled:false      # stop logging deletions
/tattletale toggle feature:edits enabled:true         # (re)enable edit logging
/tattletale toggle feature:badwords enabled:false     # pause bad-word alerts
```

> Turning off `badwords` only pauses bad-word alerts; your saved list is kept and
> resumes when you turn it back on. Good words and judging are separate.

---

## Part F — Contextual judging

judging judges **intent and context** — catching scams, phishing,
harassment, hate, threats, unwanted sexual content, and spam. It runs when a
message contains a **bad word** (always) or an **Judge word** (signal phrase), then
decides severity. **Good words never trigger the Judge.**

**Requirements:** an `ANTHROPIC_API_KEY` set on the host (Part A). Enabling it
without a key returns a warning and nothing runs.

**Turn it on / off**
```
/tattletale judge enabled:true
/tattletale judge enabled:false
```

**What it screens & costs:** the Judge only reviews a message when it contains a
phrase from the **Judge trigger list** (scam/harassment signals like `free nitro`,
`http`, `kill yourself`, `seed phrase`, …). Everything else is ignored, so API
calls — and cost — stay low. Identical messages are cached for a few minutes too.
It uses a small, inexpensive model (Claude Haiku) with prompt caching.

### The Judge trigger list

The trigger list is what makes the Judge work *together with* the keyword filter:
the filter flags your exact banned words, while the trigger list decides which
messages are worth a Judge intent-check. It ships with a sensible default set and
is fully editable:

```
/tattletale judgewords list                          # see the current phrases
/tattletale judgewords add phrase:get rich quick      # add a signal
/tattletale judgewords remove phrase:loser            # drop one
/tattletale judgewords edit old:kys new:end it        # rename one
/tattletale judgewords clear                          # restore the built-in defaults
```

- Triggers are matched with the same evasion-resistant logic as bad words
  (so `fr33 n1tro` still trips `free nitro`).
- A trigger only *starts* a Judge review — the Judge still judges intent, so an
  innocent message that merely contains a trigger phrase won't be alerted on.
- **`clear` restores the defaults** rather than emptying the list, so the Judge
  always keeps a baseline of scam/harassment signals to watch for.

### The confidence threshold

For each screened message the Judge returns a **confidence score from 0 to 1** — how
sure it is the message is abusive. The bot only alerts when that score is **at or
above your threshold**. Think of it as a sensitivity dial.

```
/tattletale judgethreshold value:0.6
```

| Threshold | Effect |
|-----------|--------|
| `0.4` (low) | **More sensitive** — catches borderline cases, but more false alarms |
| `0.6` (default) | Balanced |
| `0.85` (high) | **Stricter** — only near-certain abuse alerts; fewer false alarms, may miss subtle cases |

The value is clamped to the 0–1 range and shown in `/tattletale settings`.

> **What a Judge alert looks like:** a 🤖 embed with the user, channel, the
> **category** (scam / phishing / harassment / hate / threat / sexual / self-harm
> / spam / other) and confidence %, a short reason, the message, and a jump link.
> Like everything else, it only notifies — it never acts on the message.

---

## Part G — Restricting who can use the bot

Access is handled entirely by **Discord's native command permissions** — the bot
keeps no separate allowlist. The command is registered with a default permission
of **Manage Server**, so by default Discord **hides and blocks** `/tattletale`
for everyone except members with Manage Server.

To grant access to a specific **role or member** (with or without Manage Server),
a server admin uses Discord's built-in command-permission UI:

1. **Server Settings → Integrations → Tattletale** (or **Apps**).
2. Click **Manage** / the command list, then add the role(s), member(s), or
   channel(s) you want to allow (and/or remove the default restriction).
3. Save. Discord enforces this itself — no bot command needed.

This is Discord's official way to control who can see and run a slash command,
and it supports per-role, per-member, and per-channel overrides.

> The simplest option: give trusted mods the **Manage Server** permission — then
> they see and use it with no extra setup. Use the Integrations overrides only
> when you want someone to have bot access *without* Manage Server.

---

## Part H — Every setting at a glance

These per-server settings are stored in `settings.json` and managed entirely
through the commands above (no manual editing needed).

| Setting | Default | Set with |
|---------|---------|----------|
| Alert channel (default/fallback) | *none* (must be set) | `/tattletale setchannel` |
| Per-tier channels (good/high/medium/low) | fall back to default | `/tattletale setchannel … tier:good\|high\|medium\|low` |
| Bad words (Judge-checked) | empty list | `/tattletale badword add` / `remove` / `list` / `clear` |
| Good words (no Judge, safe) | empty list | `/tattletale goodword add` / `remove` / `list` / `clear` |
| Log deletes (incl. bulk) | **ON** | `/tattletale toggle feature:deletes` |
| Log edits | **ON** | `/tattletale toggle feature:edits` |
| Log bad words | **ON** | `/tattletale toggle feature:badwords` |
| judging | **OFF** | `/tattletale judge` |
| Judge confidence threshold | **0.6** | `/tattletale judgethreshold` |
| Judge trigger phrases | built-in default set | `/tattletale judgewords add` / `remove` / `edit` / `list` / `clear` |
| Command access | Manage Server (default) | Discord-native — Server Settings → Integrations → Tattletale |

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
| **Keyword & judging do nothing** | **Message Content Intent** isn't enabled in the Developer Portal (Bot → Privileged Gateway Intents). |
| **`/tattletale` doesn't show up** | Registration runs automatically on start, but global commands can take ~1 hour to appear; set `SERVER_ID` for instant registration. If still missing, redeploy/restart the bot (or run `npm run deploy`) and check the logs for a registration error. |
| **Can't see / use `/tattletale`** | You don't have **Manage Server** and haven't been granted the command. A server admin can allow your role/account in **Server Settings → Integrations → Tattletale**. |
| **Judge won't enable** | `ANTHROPIC_API_KEY` isn't set on the host. Add it, restart, then `/tattletale judge enabled:true`. |
| **Settings reset after a redeploy** | Set `DATA_DIR` to a persistent/mounted volume so `settings.json` survives. |
| **Deleted/edited message shows "Unknown (uncached)"** | The message was posted before the bot started (not in its cache), so Discord can't supply the original author/content. New messages are unaffected. |

---

*Tattletale is notify-only by design — it surfaces what happened so your mod team
can decide what to do. It never deletes, edits, or punishes on its own.*
