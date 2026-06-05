# Tattletale — User Guide

Everything about Tattletale is configured **inside Discord** with the
`/tattletale` command. There are no files to edit and no restarts — every change
takes effect immediately. This guide covers setup, every command, keywords,
channels, and toggles.

For first-time installation and hosting, see `README.md`.

---

## 1. What the bot does

Tattletale reports three things to a single **mod-alert channel** you choose:

- **Deleted messages** — who deleted what, and where. Bulk deletes (purges,
  ban-with-message-cleanup) are reported as a single summary too.
- **Edited messages** — the before/after text with a jump link. Edited content
  is re-scanned, so a banned word or scam link added *after* posting is still caught.
- **Flagged keywords** — when someone uses a word on your list, with the user,
  channel, matched word, and full message.

Every alert goes to the **dedicated alert channel you pick** — never the channel
where the message or keyword appeared.

---

## 2. First-time setup (2 steps)

1. **Pick an alert channel.** Create a private channel (e.g. `#mod-alerts`) that
   only mods can see, and make sure the bot can **View Channel** and
   **Send Messages** there. Then run:
   ```
   /tattletale setchannel channel:#mod-alerts
   ```
2. **Add some flagged words** (optional):
   ```
   /tattletale addword word:scam
   ```

That's it. Delete and edit logging are on by default.

> Until you set an alert channel, the bot has nowhere to post. Do step 1 first.

---

## 3. Choosing channels

You only choose **one** channel — where alerts are sent. The bot watches the
whole server automatically; you don't configure which channels are watched.

To make the alert channel private:
1. Create a text channel.
2. Channel settings → **Permissions**.
3. Turn off **View Channel** for `@everyone`.
4. Turn it on for your mod/admin role and for the Tattletale bot.

If alerts don't appear, the bot most likely can't see or post in that channel.

---

## 4. Commands

All commands are subcommands of `/tattletale` and require the **Manage Server**
permission. Responses are private (only you see them).

| Command | What it does |
|---------|--------------|
| `/tattletale setchannel channel:<#channel>` | Set the alert channel. Run again to change it. |
| `/tattletale addword word:<text>` | Add a word or phrase to the flagged list. |
| `/tattletale removeword word:<text>` | Remove a word from the list. |
| `/tattletale listwords` | Show all flagged words. |
| `/tattletale clearwords` | Remove **all** flagged words. |
| `/tattletale toggle feature:<deletes\|edits\|flagged> enabled:<true\|false>` | Turn a logging feature on or off. |
| `/tattletale ai enabled:<true\|false>` | Turn AI contextual scam/abuse detection on or off (needs an API key on the host). |
| `/tattletale aithreshold value:<0–1>` | How sure the AI must be before it alerts. Lower = more sensitive, higher = stricter. Default `0.6`. |
| `/tattletale aiwords add\|remove\|edit\|list\|clear` | Manage the scam/harassment phrases that trigger AI review. `clear` restores the built-in defaults. |
| `/tattletale allowrole role:<@role>` | Allow a role to use the bot's commands (in addition to Manage Server). |
| `/tattletale denyrole role:<@role>` | Remove a role from the command allowlist. |
| `/tattletale settings` | Show the current configuration. |

---

## 5. Managing flagged keywords

All done in Discord — no restart needed.

- **Add:** `/tattletale addword word:scam`
- **Add a phrase:** `/tattletale addword word:free nitro`
- **Remove:** `/tattletale removeword word:scam`
- **See the list:** `/tattletale listwords`
- **Wipe the list:** `/tattletale clearwords`

How matching works (evasion-resistant):

- **Case-insensitive** — `Scam`, `SCAM`, and `scam` all match.
- **Beats common dodges** — one entry catches letter-stretching (`scaaaam`),
  leetspeak (`sc4m`, `5cam`), inserted separators (`s c a m`, `s.c.a.m`), and the
  word inside bigger words (`scammer`, `scams`). So adding `poop` also catches
  `pooooop`, `po0p`, `p o o p`, and `poops`.
- **Can over-match** — because it matches as a substring, keep entries specific
  (a full word/slur, not a 2–3 letter fragment) to avoid false alarms. It still
  won't flag unrelated words that merely share letters (e.g. `popular`).
- **Phrases** — add multi-word entries like `free nitro` to match the phrase.

---

## 6. Toggles and other settings

Turn any feature on or off at any time:

- Stop logging deletes: `/tattletale toggle feature:deletes enabled:false`
- Re-enable edits: `/tattletale toggle feature:edits enabled:true`
- Pause keyword alerts: `/tattletale toggle feature:flagged enabled:false`

Check everything at once with `/tattletale settings`.

All settings are saved per-server and survive restarts automatically.

---

## 6a. AI contextual detection (optional)

The keyword list catches specific words you chose. AI detection is a second
layer that judges *intent and context* on messages generally — scams, phishing,
harassment, hate, threats, unwanted sexual content, and spam worded to slip past
a word list. The two work together.

- Turn on: `/tattletale ai enabled:true`
- Turn off: `/tattletale ai enabled:false`
- Tune sensitivity: `/tattletale aithreshold value:0.6`
- Manage trigger phrases: `/tattletale aiwords list` (and `add`/`remove`/`edit`/`clear`)

How it works and what it costs:
- It requires an `ANTHROPIC_API_KEY` set on the host (Railway variable). Without
  one, enabling it returns a warning and nothing runs.
- The AI only reviews a message when it contains a phrase from the **AI trigger
  list** (scam/harassment signals like `free nitro`, `http`, `kill yourself`).
  Everything else is ignored, so API calls stay low. The list has built-in
  defaults and is editable via `/tattletale aiwords …`; `clear` restores the
  defaults rather than emptying it. Identical messages are cached, and it uses a
  small, cheap model (Claude Haiku) with prompt caching — pennies on most servers.
- A trigger only *starts* a review; the AI still judges intent, so an innocent
  message that merely contains a trigger phrase won't be alerted on.
- When the AI flags a message at or above your **confidence threshold** (default
  60%), an alert with the category and a short reason is posted to your mod
  channel. It never deletes or punishes — same notify-only behavior as the rest
  of the bot.
- **Confidence threshold** (`/tattletale aithreshold value:0–1`): for each
  screened message the AI returns how sure it is (0–1) that the message is
  abusive. Only messages scoring at or above your threshold trigger an alert.
  Lower it (e.g. `0.4`) to catch more borderline cases at the cost of more false
  alarms; raise it (e.g. `0.8`) to alert only on near-certain abuse. Default `0.6`.

## 6b. Restricting who can use the bot

By default, anyone with **Manage Server** can use `/tattletale`. For tighter
control, add a role allowlist — then a user must have Manage Server **and** one
of the allowed roles:

- Allow a role: `/tattletale allowrole role:@Bot Admin`
- Remove a role: `/tattletale denyrole role:@Bot Admin`

With no roles on the allowlist, Manage Server alone is sufficient (the default).
You can also restrict the command in **Server Settings → Integrations →
TattleTaleBot → Commands**, which is enforced by Discord itself.

---

## 7. Quick reference

| I want to… | Command |
|------------|---------|
| Choose / change the alert channel | `/tattletale setchannel channel:<#channel>` |
| Add a flagged word | `/tattletale addword word:<text>` |
| Remove a flagged word | `/tattletale removeword word:<text>` |
| See flagged words | `/tattletale listwords` |
| Remove all flagged words | `/tattletale clearwords` |
| Turn a feature on/off | `/tattletale toggle feature:<...> enabled:<...>` |
| View current config | `/tattletale settings` |

---

## 8. Troubleshooting

- **No alerts appear** — Set an alert channel (`/tattletale setchannel`), confirm
  the bot can view/post there, and make sure the **Message Content Intent** is
  enabled in the Developer Portal (see `README.md`).
- **`/tattletale` doesn't show up** — An admin needs to run `npm run deploy` once
  to register commands. Global commands can take up to an hour to appear.
- **"You need the Manage Server permission"** — Only members with that permission
  can use these commands.
- **A keyword over-matches** — Matching is substring-based and evasion-resistant,
  so short entries can flag bigger words. Use more specific entries.

---

For installation and the Discord documentation reference, see `README.md` and
`CLAUDE.md`.
