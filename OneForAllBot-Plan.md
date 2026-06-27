# OneForAllBot — Build Pathway & Tier Plan

Companion to `OneForAllBotDoc.md` (the competitive research). This is the **product
plan**: what we build, in what order, and exactly which features are free, paid, or
free-but-limited — with the reasoning for every choice.

> **Status:** Plan only — none of the paid-tier features below are built yet.
> Tattletale's moderation/logging core + per-server licensing already exist (that's
> "Phase 0"). CLAUDE.md documents *current* code and must not claim these features
> exist until they ship.

---

## 1. The one rule that drives every choice

**Charge for cost, scale, and vanity — never for safety or the basics.**

Decompose every feature into *why* it might be paid:
- **(A) It costs us real money per use** (AI API calls, per-message DB writes) →
  meter it: free gets a usable quota, paid lifts it.
- **(B) It's "more of a good thing"** (more reaction-role panels, more custom
  commands) → free gets a generous-but-capped amount, paid lifts the cap.
- **(C) It's premium-feel / vanity** (custom-branded bot, rank-card art) → fully paid.
- **(D) It's safety or a table-stakes basic** (core moderation, anti-nuke, basic
  reaction roles, basic level-role rewards) → **free forever, no asterisk.**

MEE6's fatal mistake was paywalling **(D)**. Every loved bot keeps **(D)** free
(Wick's free anti-nuke, Arcane's free level-rewards, Carl's free reaction roles).
We make that the brand promise.

---

## 2. The three tiers

| | **Free** | **Pro** — ~$5.99/mo per server | **Custom** — ~$14.99/mo per server |
|---|---|---|---|
| **Who** | Every server, forever | Growing/active servers | Brand-conscious / large servers |
| **Pitch** | Genuinely runs a server | Power, polish, scale | Pro + *your own branded bot* |
| **Billing** | — | Per-server license key, own site (Stripe/PayPal), annual = 2 months free | Same |

Per-server pricing matches ProBot and our **existing license-key system** — no
re-architecting. We deliberately undercut MEE6 ($11.95) and sit beside Arcane ($7)
and ProBot ($5/$10). Custom slots between ProBot's $10 custom-bot tier and Mimu's
$19.99 branding. (A lifetime option, à la MEE6's ~$90, is a later lever.)

---

## 3. Feature-by-feature plan

| Feature | Free | Pro | Custom | Why this split |
|---|---|---|---|---|
| **AI/context moderation** (Tattletale core) | Generous monthly *candidate-check* allowance (~1–2k), then graceful fallback to word-filtering; **BYO Anthropic key = unlimited free** | Managed/effectively-unlimited (we host the bill) + full scope | + priority routing | **(A)** Real API cost. The AI only fires on messages the free word-filter already flagged (see §3a), so most servers never hit the cap. Safety never fully drops — it falls back to word-filtering, not off. |
| **Word-filter moderation, anti-evasion, flood control** | ✅ Full | ✅ | ✅ | **(D)** Safety core. Never gated. |
| **Logging** (delete, **before/after edits**, who-deleted) | ✅ Full | ✅ + dashboard history/analytics | ✅ | **(D)** Full-fidelity logging is a *named market gap* — we give it free as a differentiator; only the analytics view is Pro **(B)**. |
| **Verification / captcha** | ✅ Captcha gate | + difficulty tuning, account-age/alt rules | ✅ | **(D)** Security. Wick set the "free protection" expectation. |
| **Anti-raid / anti-nuke** | ✅ Join-rate lockdown, mass-delete/ban protection | + raid analytics, auto-quarantine policies, VPN/alt heuristics | ✅ | **(D)** Protecting a server is never a paywall. Only the *advanced tuning* is paid **(B)**. |
| **Reaction roles** | 5 panels, 25 roles each | Unlimited panels, 250 roles/msg, buttons + dropdowns | ✅ | **(D)** basics free (Carl gives them free); **(B)** scale + fancy styles paid. |
| **Welcome / onboarding** | Text welcome, role-on-join | + **image cards**, multiple/DM welcomes, templating | ✅ | **(D)** basic welcome free; **(C/B)** image cards are ProBot's loved premium polish. |
| **Leveling / XP** | Message XP, **unlimited level-role rewards**, server leaderboard, basic rank card | + **voice XP**, custom rank-card art, XP multipliers/events, per-channel/role rules, global leveling | ✅ | **(D)** beat MEE6 *and* match Arcane by giving free unlimited rewards; **(A)** voice XP doubles DB writes → paid; **(C)** card art is vanity. |
| **Web dashboard** (config) | ✅ Full config | + analytics, audit history, scheduled actions | ✅ | **(D)** never paywall configuration (Zeppelin/Carl give dashboards free). Only premium *insights* are paid **(B)**. |
| **Custom commands / autoresponders** | 10 simple text commands | Unlimited, embeds, visual builder w/ variables | ✅ | **(B)** scale; built with a *visual builder* to dodge Mimu's "one typo breaks it" pain. Dispatch design in §3b. |
| **Custom-branded bot** (own name/avatar/status) | — | — | ✅ | **(C)** pure vanity + real infra cost. ProBot/Mimu prove people pay $10–20 for this. |
| **Priority support** | Community/docs | Faster | ✅ Direct | **(C)** Wick's #1 complaint is bad support — we sell *good* support instead of suffering it. |

### 3a. How the AI meter actually works (it does *not* scan every message)

Tattletale already uses a **two-stage funnel** (`screening.js`):

1. **Stage 1 — word match (every message, free, no API).** In-memory string
   matching against the word lists. Costs nothing, scales infinitely.
2. **Stage 2 — AI call (candidates only).** `classifyMessage()` fires *only* when
   Stage 1 found a **bad word** (always AI-checked for severity) or an **AI-trigger
   phrase**. A clean message never touches the API.

So the meter counts **escalations, not messages** — the funnel cuts volume ~10–100×,
which is *why* a quota is even feasible. Design consequences:

- **Per-check cost is tiny** (a short classification on a fast model — a fraction of
  a cent). The free allowance can be generous because the real risk is a pathological
  server, not ordinary cost.
- **Graceful fallback, never "off":** when the free allowance is spent, the server
  drops to Stage-1 word-filtering (still protected) until reset.
- **BYO key escape hatch:** a server supplying its own `ANTHROPIC_API_KEY` (already
  supported) runs AI unlimited and free — the cost isn't ours.
- **Pro's honest value** is "we host the AI bill at scale + full scope," not a bigger
  counter.
- *Held in reserve:* a scope lever (Free = AI on bad-word hits only; Pro = adds
  trigger-phrase contextual review) if volume metering proves awkward.

### 3b. How per-server custom commands work (dispatch & scaling)

Custom commands are **per-guild data, not global registrations** — keyed by guild
ID like word lists/settings already are (`config.js`). Dispatch always resolves
against *the guild the message/interaction came from*, so two servers with an
identically-named command never collide.

**Mechanism — store per guild, dispatch one of two ways:**
1. **Text triggers** (MEE6/Dyno/Carl style) — the bot already receives every message
   (MessageContent intent); match against that guild's stored triggers on the
   existing `messageCreate` path. Unlimited, no registration.
2. **One generic `/tag name:` slash command + autocomplete** (recommended primary) —
   register a *single* built-in command; autocomplete suggests that server's stored
   names. Native slash UX, its own namespace (no clash with `/tattletale` or other
   bots), zero registration churn.

**The trap we avoid:** registering each custom command as its own per-guild slash
command. Discord caps **100 chat-input commands per guild**, and every add/edit/
delete would be an API call to reconcile across thousands of servers (churn +
rate limits). We never do this.

**Scaling:** storage is trivial (small text rows, guild-keyed); runtime is a
per-guild cache lookup piggybacking the message path we already run; no registration
load as servers edit commands. **Collisions:** across servers impossible (guild-
scoped); within a server enforce unique names (upsert, like word lists); vs other
bots the `/tag` namespace keeps us clear.

### 3c. Leveling write strategy (do NOT write XP on every message)

Leveling is the one cost-driver (per-message DB writes), so it uses two stacked
mechanisms — one for gameplay, one for cost:

1. **Per-user cooldown (gameplay):** award XP at most once per ~60s per user,
   regardless of message count (MEE6/Arcane standard). This is anti-spam — bursting
   messages earns nothing extra — and is *better than "every Nth message,"* which
   would still reward spamming.
2. **Write-behind batching (cost):** increment XP in a memory/Redis counter on each
   qualifying message (free); **flush to the durable DB periodically** (~30–60s or
   every N increments). Many increments coalesce into one write — stacked with the
   cooldown this cuts DB writes ~10–50× vs naive per-message writes.

**Robustness:** short flush interval caps crash-loss to seconds of XP (invisible);
use Redis as the buffer so it survives restarts; **flush on graceful shutdown**
(already wired). Compute level-ups from the *in-memory running total* so role-reward
announcements stay instant despite deferred writes. Leaderboard reads from the live
layer (DB may lag a few seconds — fine).

**Why voice XP is Pro:** it awards on a timer to *everyone in a voice channel
continuously* — a heavier, always-on write pattern than text XP — so the cost
amplifier sits behind the paid tier.

---

## 4. Free-but-limited features (you asked specifically)

These give a real, usable taste free; the full version is paid. Each has an honest
reason (cost or scale), not artificial crippling:

1. **AI/context moderation** — free generous monthly *candidate-check* allowance (~1–2k) with graceful fallback to word-filtering + **BYO-key = unlimited free** → Pro = managed/unlimited, we host the bill. *(see §3a — AI only fires on already-flagged messages, so this meters escalations, not every message)*
2. **Reaction roles** — free 5 panels/25 roles → Pro unlimited/250 + buttons & dropdowns.
3. **Welcome** — free text → Pro image cards + multiple/DM.
4. **Anti-raid / verification** — free full *protection* → Pro advanced *tuning* + analytics.
5. **Leveling** — free message XP + unlimited rewards → Pro voice XP + card art + multipliers + per-channel rules. *(voice XP amplifies DB cost)*
6. **Custom commands** — free 10 simple → Pro unlimited + visual builder.
7. **Logging** — free full live/channel logs → Pro dashboard history + analytics.

## 5. Never-paywalled promise (the brand)

Core word-filter moderation · anti-evasion · flood control · **before/after edit
logging** · who-deleted · **captcha verification** · **anti-nuke / anti-raid
protection** · basic reaction roles · basic welcome · **basic leveling + unlimited
level-role rewards** · the config dashboard · server leaderboard.

> If a competitor charges for it and it's *safety* or a *basic*, we don't.

## 6. Fully-paid (top of the value ladder)

Custom-branded bot · direct priority support · plus the paid half of every limited
feature in §4.

---

## 7. Build pathway (phases)

Sequenced by **cost-to-run (cheap first) × adoption leverage**, so we ship loved,
event-driven features before the expensive write-heavy ones.

**Phase 0 — Done.** Tattletale: AI/context moderation, full-fidelity logging,
word lists, per-server licensing. *This is already our moat.*

**Phase 1 — Cheap, loved, event-driven (the free-tier story).**
Reaction roles · Welcome/onboarding · Verification + anti-raid/anti-nuke.
→ *Why first:* no per-message DB writes (doesn't move the cost curve), high
visibility, and it makes the **free tier genuinely complete + secure** — the
anti-MEE6 hook. Closes the Wick/Carl/ProBot gaps without a second bot.

**Phase 2 — Web dashboard + payment plumbing.**
Config dashboard (free) · Stripe checkout → auto-activates the license (MEE6-style
self-serve) · tier enforcement.
→ *Why second:* the dashboard is the connective tissue + the upsell surface, and
we can't sell Pro until checkout auto-activates. Built opinionated/simple to avoid
Arcane's "scattered settings."

**Phase 3 — Leveling/XP (the headline wedge, done carefully).**
Free: message XP + unlimited role rewards, **sub-second** (beat Arcane's lag).
Pro: voice XP, card art, multipliers, per-channel rules.
→ *Why here:* biggest adoption driver *and* MEE6's most-hated paywall — but it's
the one feature that writes to the DB on every message. We add it *after* the
dashboard and billing exist, with batched writes, and put the cost-amplifying
extras (voice XP) in Pro so heavy users fund their own load.

**Phase 4 — Monetization polish + power tools.**
AI-quota metering · custom-command visual builder · dashboard analytics/history ·
rank-card art · custom-branded-bot infrastructure (Custom tier).

**Phase 5 — Optional/later.**
Economy/fun module (Mimu/Dank territory) · lifetime plan · multi-language.

**Cross-cutting from day one:** reliability/uptime engineering and responsive
support — because *downtime* (Dyno) and *bad support* (Wick) are top named
complaints, and beating them is free differentiation.

---

## 8. How this is different — and why it's better

| Competitor | Their weakness | Our answer |
|---|---|---|
| **MEE6** | Paywalls basics (automod, level-rewards) at $11.95 | Those exact features **free**; pay only for cost/scale/vanity, cheaper |
| **Wick** | Bad support; security-only | Wick-level protection **free**, *plus* everything else, *plus* support we actually sell |
| **Dyno** | Downtime reputation; no AI | Reliability as a feature; **AI/context** moderation |
| **Carl-bot** | Reaction-roles-led; rule-based automod | Match its reaction roles; beat its automod with AI/low-false-positives |
| **Arcane** | XP lag; scattered settings | Sub-second XP, free unlimited rewards, clean dashboard |
| **ProBot/Mimu** | Custom bot/branding paywalled high; Mimu's scripting pain | Custom bot as our clean top tier; **visual** command builder, no syntax traps |
| **All of them** | You stack 3–4 bots → clutter, conflicts, multiple bills | **One unified bot**, one config, one bill |

**The thesis in one line:** every rival is either *missing a pillar* (Wick = no
engagement, Arcane = weak mod) or *charging for a basic* (MEE6). We bundle every
pillar, keep the basics + safety free, lead with the one thing nobody does well
(**AI/context moderation with low false positives**), and monetize only what
honestly costs money or flatters the buyer.

---

## 8a. Positioning: the AI-sentiment question (important)

Discord communities have a real anti-AI streak — so we position carefully.

**What the backlash actually targets:** *generative* AI (art/text/"slop"),
buzzword bolt-ons ("AI-powered!!" — MEE6's playbook, now a smell), and AI that
*acts* autonomously ("the bot banned me, no appeal"). **What people don't mind and
already use:** invisible ML *detection* — Discord's own AutoMod and Wick's beloved
heat algorithm are both essentially ML, and nobody objects.

**Why Tattletale is on the safe side of that line:**
1. **Notify-only** — the AI never punishes; it flags for a *human* who decides. The
   strongest possible answer to "scary AI moderation."
2. **Generates nothing** — no AI content, no chatbot persona; it silently scores
   severity. ~95% of the backlash is about generative AI, none of which we do.
3. **Optional, off by default** — anti-AI servers run word-filters only, lose nothing core.

**Packaging rules that follow:**
- **Sell the outcome, not the tech.** Lead with "catches scams/context other bots
  miss, without false-flagging your members — a human always makes the final call."
  The word "AI" lives in the docs, not the headline. Avoid MEE6's buzzword energy.
- **Privacy is a *separate, legitimate* concern** (messages → external API). Honest
  mitigations: only flagged candidates are sent (the §3a funnel), BYO-key, plain
  disclosure of what's sent, and a possible local/self-hosted model later.

Net: the anti-AI mood disciplines the *marketing*, not the feature. The moat is the
detection quality; the buzzword is optional and mostly unsaid.

## 9. Deliberate exclusions

- **Music** — YouTube ToS killed the big music bots; high bandwidth cost,
  commoditized, legal risk. Not worth it.
- **NFT/crypto gimmicks & ads** — reputational poison (MEE6's other scars).

---

## 10. Open decisions for you

1. **Price points** — comfortable with **Free / Pro $5.99 / Custom $14.99**, or
   tune? (Lower Pro = faster adoption, less margin.)
2. **Free AI quota** — ~500 checks/mo a fair taste, or more generous to hook people?
3. **Tier count** — two (Free + Pro, custom bot as an add-on) vs three as above.
4. **Economy module** — worth a Phase 5, or stay focused on mod + engagement?
5. **Lifetime plan** — offer one (MEE6 proves appetite) or subscription-only?
