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
- **Word/Judge alerts** — from three lists (**good words**, **bad words**, **Judge
  words**), colour-coded by severity:
  - ✅ **Good** (green) — a good word was used; safe FYI, **no Judge check**.
  - 🔴 **High** (red) — a **bad word** *and* the Judge both rule it harmful.
  - 🟠 **Medium** (orange) — the Judge rules it harmful (via a Judge word, no bad word).
  - 🟡 **Low** (yellow) — a bad word/Judge-reviewed but **not** confirmed harmful.

Every alert goes to the **channel(s) you pick** — never the channel where the
message appeared. By default all alerts share one channel; you can route by
severity tier (`/tattletale setchannel … tier:…`) **or per word**
(`/tattletale badword add … channel:#x`), and ping a user/role with `notify:`.

---

## 2. First-time setup (2 steps)

1. **Pick an alert channel.** Create a private channel (e.g. `#mod-alerts`) that
   only mods can see, and make sure the bot can **View Channel** and
   **Send Messages** there. Then run:
   ```
   /tattletale setchannel channel:#mod-alerts
   ```
2. **Add some bad words** (optional):
   ```
   /tattletale badword add word:scam
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

All commands are subcommands of `/tattletale`. By default **anyone** can use them;
add a role allowlist (`/tattletale allowrole`) to restrict access. Responses are
private (only you see them).

| Command | What it does |
|---------|--------------|
| `/tattletale setchannel channel:<#channel> [tier:default\|high\|medium\|low]` | Set the alert channel. No `tier` = default for all; a `tier` routes that severity to its own channel. |
| `/tattletale badword add\|remove\|list\|clear` | Manage **bad words** (Judge-checked → tiered). `add` takes optional `channel:` + `notify:` (user/role) per word. |
| `/tattletale goodword add\|remove\|list\|clear` | Manage **good words** (safe, notify-only, **no Judge**). Same optional `channel:` + `notify:`. |
| `/tattletale toggle feature:<deletes\|edits\|badwords> enabled:<true\|false>` | Turn a logging feature on or off. |
| `/tattletale judge enabled:<true\|false>` | Turn contextual scam/abuse judging on or off (needs an API key on the host). |
| `/tattletale judgethreshold value:<0–1>` | How sure the Judge must be before it alerts. Lower = more sensitive, higher = stricter. Default `0.6`. |
| `/tattletale judgewords add\|remove\|edit\|list\|clear` | Manage the scam/harassment phrases that trigger Judge review. `clear` restores the built-in defaults. |
| `/tattletale allowrole role:<@role>` | Restrict commands to this role. Empty allowlist = everyone; once a role is added, only members with an allowed role can use the bot. |
| `/tattletale denyrole role:<@role>` | Remove a role from the allowlist (empty again = everyone). |
| `/tattletale settings` | Show the current configuration. |

---

## 5. Managing word lists (good / bad / Judge)

All done in Discord — no restart needed. Three lists:

- **🚫 Bad words** — always Judge-checked, then tiered (🔴 high / 🟡 low):
  - `/tattletale badword add word:scam`
  - `/tattletale badword add word:slur channel:#serious notify:@Mods` (own channel + ping)
  - `remove` / `list` / `clear` as well.
- **✅ Good words** — safe, notify-only, **no Judge check** (green):
  - `/tattletale goodword add word:welcome channel:#welcomes notify:@Greeter`
  - `remove` / `list` / `clear` as well.
- **🤖 Judge words** — signal phrases that let the Judge review other messages:
  `/tattletale judgewords add|remove|edit|list|clear`.

`channel:` and `notify:` (a user **or** role to ping) are optional per word.

How matching works (evasion-resistant, all lists):

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
- Pause bad-word alerts: `/tattletale toggle feature:badwords enabled:false`

Check everything at once with `/tattletale settings`.

All settings are saved per-server and survive restarts automatically.

---

## 6a. contextual judging (optional)

The keyword list catches specific words you chose. judging is a second
layer that judges *intent and context* on messages generally — scams, phishing,
harassment, hate, threats, unwanted sexual content, and spam worded to slip past
a word list. The two work together.

- Turn on: `/tattletale judge enabled:true`
- Turn off: `/tattletale judge enabled:false`
- Tune sensitivity: `/tattletale judgethreshold value:0.6`
- Manage trigger phrases: `/tattletale judgewords list` (and `add`/`remove`/`edit`/`clear`)

How it works and what it costs:
- It requires an `ANTHROPIC_API_KEY` set on the host (Railway variable). Without
  one, enabling it returns a warning and nothing runs.
- The Judge only reviews a message when it contains a phrase from the **Judge trigger
  list** (scam/harassment signals like `free nitro`, `http`, `kill yourself`).
  Everything else is ignored, so API calls stay low. The list has built-in
  defaults and is editable via `/tattletale judgewords …`; `clear` restores the
  defaults rather than emptying it. Identical messages are cached, and it uses a
  small, cheap model (Claude Haiku) with prompt caching — pennies on most servers.
- A trigger only *starts* a review; the Judge still judges intent, so an innocent
  message that merely contains a trigger phrase won't be alerted on.
- When the Judge flags a message at or above your **confidence threshold** (default
  60%), an alert with the category and a short reason is posted to your mod
  channel. It never deletes or punishes — same notify-only behavior as the rest
  of the bot.
- **Confidence threshold** (`/tattletale judgethreshold value:0–1`): for each
  screened message the Judge returns how sure it is (0–1) that the message is
  abusive. Only messages scoring at or above your threshold trigger an alert.
  Lower it (e.g. `0.4`) to catch more borderline cases at the cost of more false
  alarms; raise it (e.g. `0.8`) to alert only on near-certain abuse. Default `0.6`.

## 6b. Restricting who can use the bot

Access is controlled by a **role allowlist** — no Discord permission needed. By
default the allowlist is empty, so **anyone** can use `/tattletale`. Add a role
and only members holding an allowed role can use it:

- Allow a role: `/tattletale allowrole role:@Bot Admin`
- Remove a role: `/tattletale denyrole role:@Bot Admin`

⚠️ Adding the first role restricts access immediately — add a role **you have**
first, or you'll lock yourself out (only an allowed role can run `denyrole`).
You can also restrict the command in **Server Settings → Integrations →
TattleTaleBot → Commands**, which is enforced by Discord itself.

---

## 7. Quick reference

| I want to… | Command |
|------------|---------|
| Choose / change the alert channel | `/tattletale setchannel channel:<#channel>` |
| Add a bad word | `/tattletale badword add word:<text>` |
| Remove a bad word | `/tattletale badword remove word:<text>` |
| See bad words | `/tattletale badword list` |
| Add a good word | `/tattletale goodword add word:<text>` |
| Turn a feature on/off | `/tattletale toggle feature:<...> enabled:<...>` |
| View current config | `/tattletale settings` |

---

## 8. Troubleshooting

- **No alerts appear** — Set an alert channel (`/tattletale setchannel`), confirm
  the bot can view/post there, and make sure the **Message Content Intent** is
  enabled in the Developer Portal (see `README.md`).
- **`/tattletale` doesn't show up** — An admin needs to run `npm run deploy` once
  to register commands. Global commands can take up to an hour to appear.
- **"You do not have a role authorized to use this bot"** — A role allowlist is
  set and you don't have an allowed role. Someone with an allowed role can adjust
  it via `/tattletale allowrole` / `denyrole`.
- **A keyword over-matches** — Matching is substring-based and evasion-resistant,
  so short entries can flag bigger words. Use more specific entries.

---

For installation and the Discord documentation reference, see `README.md` and
`CLAUDE.md`.
