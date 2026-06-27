# OneForAllBotDoc

Research & strategy for an **all-in-one Discord bot** built around Tattletale's
moderation/logging core. Goal: **bundle everything people love** about the leading
"do-all" bots while **avoiding what people hate** (chiefly MEE6-style paywalling of
once-free core features).

> **Status:** Living document. Built from **Research Dive 1** (verified: MEE6,
> ProBot, YAGPDB, Zeppelin). **Research Dive 2** (Wick, Dyno, Carl-bot, Arcane,
> Mimu + a consolidated "what users love / want" synthesis) is in progress and
> will fill the sections marked _⏳ pending Dive 2_.
>
> **Source-quality note:** pricing and feature facts are corroborated against
> vendor docs/wikis. Sentiment ("most loved / most hated") is synthesized from
> opinion/affiliate blogs + a Change.org petition + community sites — directional,
> not a measured study. Treat all prices as 2024–2026 snapshots; they change often.

---

## 1. Executive summary

- **The market's biggest opening is sentiment, not features.** MEE6 leads the
  market *and* is the most disliked — because it moved previously-free core
  features (leveling role-rewards, automod, welcome, custom commands, auto-roles)
  behind a ~$11.95/mo paywall. An organized anti-paywall ecosystem exists
  (petition, "alternatives to MEE6" sites, challenger bots). **Do not repeat that
  mistake — that restraint is the product pitch.**
- **Tattletale already owns the one real differentiator:** AI/context-aware
  moderation vs everyone else's regex/keyword automod (one source cited ~80% fewer
  false-positive mod actions with AI/context vs keyword filtering on a 15k-member
  server). Lead with this.
- **Table-stakes to even be called "all-in-one":** a **web dashboard** +
  **reaction roles**. Even a moderation-only bot (Zeppelin) ships both.
- **Adoption drivers (what gets installs):** leveling/XP, automod, welcome/
  onboarding, reaction roles.
- **Pricing reality:** premium clusters at **$5–12/mo**, billed off the vendor's
  **own website** (Stripe/PayPal) — Discord-native App Subscriptions are
  essentially unused by the majors. Tattletale's license-key model fits the market.

---

## 2. Per-bot breakdown

### MEE6 — the incumbent to beat
| | |
|---|---|
| **Core features** | Leveling/XP, automod, welcome, reaction roles, custom commands, music, dashboard |
| **Loved most** | Leveling/XP (defined the category) |
| **Hated most** | Paywall creep — features free in 2022 are premium in 2026; role-rewards behind premium is the flashpoint. Also: past DM ads, NFT push, a reverted pricing fiasco |
| **Pricing** | **~$11.95/mo** (> Nitro's $9.99), ~$89.90/yr, **~$90 lifetime**. History $4.99 → $9.99 → $11.95 |
| **Billing** | Own website |
| **Access** | Hosted, invite-only, web dashboard |

### ProBot — the cleanest pricing template
| | |
|---|---|
| **Core features** | Moderation, welcome images, logs, automod, anti-raid |
| **Pricing model** | Two tiers, **per-server**: **Tier 1 ~$5/mo** (anti-raid, welcome images, deep logs); **Tier 2 ~$10/mo** = Tier 1 **+ a personalized/custom bot** (own username/avatar/status). One subscription = one server |
| **Billing** | Own website, credit card + PayPal. **Not** Discord-native, **not** Patreon |
| **Notable** | Gates security (VIP Protection anti-vandal) behind premium |
| **Access** | Hosted, invite-only |

### YAGPDB — the free open-source counter-model
| | |
|---|---|
| **Core features** | Moderation, logs, custom commands, reputation, reminders, stats, content feeds (YouTube/Reddit/streams) |
| **Pricing** | **Free, MIT open-source**; optional Patreon premium only gates extras on the public instance |
| **Access** | Web Control Panel (no manual authorize), hosted at yagpdb.xyz **or** self-host |
| **Catch** | Self-host needs **Go + PostgreSQL + Redis** — a real technical wall. "Free + open-source" ≠ "easy to run" |

### Zeppelin — the moderation benchmark (closest to Tattletale)
| | |
|---|---|
| **Core features** | Word filters, spam detection, case management/mod notes, customizable server logs + dashboard, reaction roles, tags/custom commands, starboard |
| **Pricing** | **Free, source-available** (Elastic License 2.0). No paywall |
| **Access** | Docker self-host, or hosted instance **vetted/gated to 5,000+ member servers** |
| **vs Tattletale** | Zeppelin automod is **rule/regex-based**; Tattletale is **AI/context-based** — a genuine edge |

### Wick — _⏳ pending Dive 2_
Leading dedicated security/anti-nuke bot (~837k servers; heat-based anti-raid,
anti-nuke, verification/captcha gate). Directly adjacent to Tattletale's pillar.
_Deep feature/sentiment/pricing coverage incoming._

### Dyno — _⏳ pending Dive 2_
Automod-heavy all-in-one; "hosted, invite-only." _Full coverage incoming._

### Carl-bot — _⏳ pending Dive 2_
Reaction-roles specialist; embeds, automod, logging, starboard. _Full coverage incoming._

### Arcane — _⏳ pending Dive 2_
Leveling + auto-moderation; positioned as a MEE6 alternative. _Full coverage incoming._

### Mimu — _⏳ pending Dive 2_
Aesthetic/customization + economy; recently left Patreon and restructured tiers.
_Full coverage incoming._

---

## 3. Cross-cutting synthesis (Dive 1)

**Table-stakes (baseline, not differentiators):** web dashboard + reaction roles.

**Adoption drivers (what gets installs):** leveling/XP, automod, welcome/
onboarding, reaction roles — exactly what MEE6 paywalled.

**Pricing benchmarks:** premium clusters **$5–12/mo**. ProBot ~$5/$10 per-server is
the low anchor; MEE6 ~$12 the high anchor. Lifetime ~$90 exists.

**Billing:** everyone bills off their **own website** (Stripe/PayPal). Discord
native App Subscriptions are essentially unused by the majors → the license-key
model is mainstream-correct.

**Access:** hosted invite-only dominates. Self-host is a technical niche.

---

## 4. What users LOVE — _⏳ pending Dive 2_

Ranked, sentiment-backed list of the most-loved features across all bots
(leveling, reaction roles, automod, welcome, dashboards, verification gates,
anti-nuke, economy, music, custom commands, starboard, logging, analytics).

---

## 5. What users HATE — _⏳ pending Dive 2 (expanding Dive 1)_

Known so far (Dive 1): **paywalling once-free features** (MEE6) is the dominant
gripe. Dive 2 will add: downtime/reliability, ads, complex setup, poor support,
false-positive automod, needing multiple bots.

---

## 6. Feature wishlist — what people WANT that no bot nails — _⏳ pending Dive 2_

Consolidated list of repeatedly-requested gaps (early hypotheses to be verified):
- AI/context-aware moderation with **low false positives** (Tattletale's edge)
- One **unified** bot instead of stacking 3–4 bots
- **Transparent pricing** + a genuinely useful **free tier**
- **Easy setup** (dashboard-first, no Go/Postgres/Redis)
- **Reliable uptime**

---

## 7. Strategy: the Tattletale-powered all-in-one

**You already hold the differentiator** (AI/context moderation). Add the table-
stakes + adoption drivers around it, without MEE6's paywall mistake.

**Build order — cheapest/highest-leverage first, expensive-to-run last:**
1. **Reaction roles** — table-stakes, cheap, event-driven (no per-message DB
   writes; doesn't move the cost curve). Fast, visible win.
2. **Welcome / onboarding** — adoption driver, cheap, low backend cost.
3. **Web dashboard** — the connective tissue; also makes per-server licensing +
   config far easier for non-technical customers (today config is slash-only).
4. **Leveling/XP — last, deliberately.** Biggest adoption driver *and* MEE6's
   most-hated paywall (sharpest wedge), **but** the one feature that writes to the
   DB on every message → it rewrites the cost curve. Ship it after the dashboard,
   priced to cover its own weight.

**Monetization — learn from MEE6's backlash:**
- **Never paywall the basics** (reaction roles, welcome, core moderation = free,
  generous tier). This *is* the anti-MEE6 pitch.
- **Charge for what genuinely costs you** (leveling at scale, high-volume AI
  moderation) or what's premium-feel (**ProBot's "custom bot" tier** is a proven,
  beloved upsell).
- **Transparent per-server price below MEE6** (~$5/$8), via the existing license-
  key delivery, billed off your own site. Already architected for this.

---

## 8. Sources & confidence

**Verified to primary depth (Dive 1):** MEE6, ProBot, YAGPDB, Zeppelin.
**Key sources:** MEE6 Wiki/premium pages, ProBot docs, YAGPDB GitHub (MIT) +
help center, Zeppelin GitHub README; plus medium.com/netcord, peakbot.pro,
communityone.io, toolify.ai, a Change.org petition.

**Caveats:** sentiment findings lean on opinion/affiliate blogs (corroborated by
vendor pages + petition, but not a measured sentiment study); no Reddit threads
fetched first-hand in Dive 1; several vendor doc pages 403'd to direct fetch
(quotes via indexed snippets). Prices are 2024–2026 snapshots. **Auttaja** (named
in some alternative lists) is **defunct** (ceased 2026-03-24) — do not recommend.

_Dive 2 adds first-hand-style community sentiment, the five under-covered bots,
and the consolidated love/hate/wishlist sections._
