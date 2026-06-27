# OneForAllBotDoc

Research & strategy for an **all-in-one Discord bot** built around Tattletale's
moderation/logging core. Goal: **bundle everything people love** about the leading
"do-all" bots while **avoiding what people hate** (chiefly MEE6-style paywalling of
once-free core features).

> **Status:** Complete across two research dives. **Dive 1** verified MEE6, ProBot,
> YAGPDB, Zeppelin to primary-source depth. **Dive 2** covered Wick, Dyno, Carl-bot,
> Arcane, Mimu + the love/hate/wishlist synthesis via direct web search (the
> automated fetch pipeline 403'd on most vendor pages, so Dive 2 facts come from
> search-result extracts — see §8).
>
> **Source-quality note:** pricing/feature facts are corroborated against vendor
> docs/wikis where reachable. Sentiment ("most loved / most hated") and server
> counts are synthesized from SEO/affiliate blogs (skywork.ai, peakbot.pro,
> communityone.io, vibebot.gg), top.gg reviews, and a Change.org petition —
> **directional, not a measured study**. Server counts vary by source (ranges
> given). Treat all prices as 2024–2026 snapshots; they change often.

---

## 1. Executive summary

- **The market's biggest opening is sentiment, not features.** MEE6 leads the
  market *and* is the most disliked — because it moved previously-free core
  features (leveling role-rewards, automod, welcome, custom commands, auto-roles)
  behind a ~$11.95/mo paywall. An organized anti-paywall ecosystem exists
  (petition, "alternatives to MEE6" sites, challenger bots). Arcane's rise (free
  unlimited level-rewards) is direct proof the migration is real. **Not repeating
  that mistake is itself the product pitch.**
- **Tattletale already owns the single clearest unmet need:** AI/context-aware
  moderation with **low false positives**. Keyword automod's false positives are a
  named, recurring complaint across the market; Tattletale's context model is the
  fix. (Bonus: Tattletale already logs the **"before" version of edited messages**,
  another named gap — most bots don't.)
- **Table-stakes to even be called "all-in-one":** a **web dashboard** +
  **reaction roles**. Even moderation-only Zeppelin ships both; Carl-bot built
  ~12–16M-server reach largely on reaction roles alone.
- **The four adoption-driving features:** automod/moderation, **leveling/XP**,
  **reaction roles**, **welcome/onboarding**. A fifth is rising fast:
  **verification/captcha + anti-raid** (now a baseline security expectation).
- **Pricing reality:** premium clusters **$5–12/mo**, billed off the vendor's own
  website (Stripe/PayPal). Discord-native App Subscriptions are essentially unused
  by the majors → Tattletale's license-key model fits the market. A **custom-branded
  bot** is the proven premium upsell (ProBot Tier 2 ~$10; Mimu $19.99/mo).

---

## 2. Per-bot breakdown

### MEE6 — the incumbent to beat
| | |
|---|---|
| **Core features** | Leveling/XP, automod, welcome, reaction roles, custom commands, music, dashboard |
| **Loved most** | Leveling/XP (defined the category) |
| **Hated most** | Paywall creep — features free in 2022 are premium in 2026; **custom automod rules + extended level-rewards behind ~$11.95/mo** is the flashpoint. Also: past DM ads, NFT push, a reverted pricing fiasco |
| **Pricing** | **~$11.95/mo** (> Nitro's $9.99), ~$89.90/yr, **~$90 lifetime**. History $4.99 → $9.99 → $11.95 |
| **Billing / Access** | Own website; hosted, invite-only, web dashboard |

### ProBot — the cleanest pricing template
| | |
|---|---|
| **Core features** | Moderation, welcome images, logs, automod, anti-raid |
| **Pricing model** | Two tiers, **per-server**: **Tier 1 ~$5/mo** (anti-raid, welcome images, deep logs); **Tier 2 ~$10/mo** = Tier 1 **+ a personalized/custom bot** (own username/avatar/status). One subscription = one server |
| **Billing / Access** | Own website (card + PayPal), **not** Discord-native, **not** Patreon; hosted, invite-only |
| **Notable** | Gates security (VIP Protection anti-vandal) behind premium |

### YAGPDB — the free open-source counter-model
| | |
|---|---|
| **Core features** | Moderation, logs, custom commands, reputation, reminders, stats, content feeds (YouTube/Reddit/streams) |
| **Pricing / Access** | **Free, MIT open-source**; web Control Panel, hosted at yagpdb.xyz **or** self-host |
| **Catch** | Self-host needs **Go + PostgreSQL + Redis** — a real technical wall. "Free + open-source" ≠ "easy to run" |

### Zeppelin — the moderation benchmark (closest to Tattletale)
| | |
|---|---|
| **Core features** | Word filters, spam detection, case management/mod notes, customizable logs + dashboard, reaction roles, tags/custom commands, starboard |
| **Pricing / Access** | **Free, source-available** (Elastic License 2.0); Docker self-host or hosted instance **vetted/gated to 5,000+ member servers** |
| **vs Tattletale** | Zeppelin automod is **rule/regex-based**; Tattletale is **AI/context-based** — a genuine edge |

### Wick — the security/anti-nuke leader (~837k+ servers)
| | |
|---|---|
| **Core features** | **Anti-nuke** (invented the concept — blocks mass channel/role create+delete, mass kick/ban), heat-algorithm **anti-spam/anti-raid**, **captcha verification** gate, moderation |
| **Loved most** | "The BEST anti-nuke/anti-raid bot"; the heat algorithm stops raiders **without harming regular members** (low false positives); **most core features incl. anti-nuke are free**; unique verification |
| **Hated most** | **Poor/unresponsive support team** (the #1 complaint); dashboard not intuitive |
| **Gap** | Lacks proactive IP/VPN filtering (per a 2026 comparison) |
| **Access** | Hosted, invite-only |

### Dyno — the trusted automod workhorse (large/partnered servers)
| | |
|---|---|
| **Core features** | "The original automod," mod tools, logging, roles, music, dashboard |
| **Loved most** | **Granular automod** (protected roles it won't punish; strict in general channels, lenient in meme channels); trusted at scale by large partnered servers |
| **Hated most** | **Reliability is contested** — reviewers call it both "stable, rarely down" *and* "historically prone to downtime, not for very large active servers." Honest read: trusted and configurable, but a real downtime history; the team has added auto-recovery |
| **Access** | Hosted, invite-only; freemium |

### Carl-bot — the reaction-roles king (~12–16M servers)
| | |
|---|---|
| **Core features** | **Reaction roles** (up to **250 roles/message**), granular automod, extensive logging, custom commands, **starboard**, embeds |
| **Loved most** | The **deepest reaction-role system** on Discord — a "favorite bot"; powerful logging + custom commands |
| **Hated most** | Automod isn't as out-of-the-box as Dyno's — needs initial configuration |
| **Access** | Hosted, invite-only, web dashboard; freemium |

### Arcane — the free-leveling MEE6 refugee magnet (~2.3–2.8M servers)
| | |
|---|---|
| **Core features** | **Leveling/XP** (message + voice), **unlimited level-up role rewards**, **free web leaderboard**, basic moderation, auto-mod |
| **Loved most** | **Free unlimited level-role rewards** — the exact thing MEE6 paywalled; grew specifically off MEE6 refugees |
| **Hated most** | Settings **scattered across dashboard pages with no clear logic**; **XP update lag** (minutes vs ~100ms on rivals) |
| **Pricing** | Premium from **~$7/mo** (undercuts MEE6's $11.95); core leveling/mod/role-rewards **free** |
| **Access** | Hosted, invite-only, web dashboard |

### Mimu — aesthetic economy & customization (Anime/K-pop/social servers)
| | |
|---|---|
| **Core features** | Custom **economy** (rename currency, custom emoji), **shop items with images → auto-role on purchase**, embeds/images/custom emojis, autoresponders, "server decoration" |
| **Loved most** | "Kawaii" aesthetics + deep visual customization; staple of social/anime/K-pop servers |
| **Hated most** | **Steep custom-command learning curve** — variables/conditionals/syntax; "one typo and the whole command broke" |
| **Pricing** | Premium from **~$11.95/mo**; **custom branding (avatar/name) $19.99/mo**; free tier capped (5 embeds free vs 300 premium) |
| **Access** | Hosted, invite-only; left Patreon, now own billing |

### Specialists (context, not direct all-in-one rivals)
- **Dank Memer** (~8.8–9M servers) — economy/gaming/memes; minigames, collecting, pets. The economy benchmark.
- **Tatsu** (~1.4M) — leveling + economy (1,000+ furniture items to decorate a virtual home).
- **Statbot** — server **analytics**; notably **five** upgrade tiers.
- **OwO** (~4M) — economy/animal-collecting.

---

## 3. What users LOVE — ranked (drives adoption)

1. **Leveling / XP with role rewards** — the single biggest engagement loop
   (MEE6, Arcane, Tatsu). Arcane proved people will switch bots to get **free,
   unlimited** level-role rewards. Sub-second XP updates matter (Arcane's lag is a
   named gripe).
2. **Reaction roles** — Carl-bot's ~12–16M-server reach rests largely on this;
   depth (many roles/message, buttons + reactions) is what wins.
3. **Granular automod** — Dyno's per-channel strictness + "protected roles."
   Configurability beats raw power.
4. **Welcome / onboarding with image cards** — ProBot's signature; personalized
   welcome cards make newcomers feel recognized.
5. **Anti-nuke + verification/captcha (security)** — Wick's heat algorithm that
   stops raiders **without false-flagging regular members**; captcha gates are now
   a baseline expectation, not a luxury.
6. **Web dashboard** — universally expected; the difference between "a bot" and
   "a product" for non-technical owners.
7. **Deep customization** — Mimu's aesthetic shop/economy; renameable currency,
   images everywhere. Identity/expression drives retention in social servers.
8. **Generous free tier** — repeatedly cited as *why* a bot is loved (Wick's free
   anti-nuke, Arcane's free leveling, Carl's free reaction roles).

## 4. What users HATE — cross-bot complaints (avoid these)

1. **Paywalling once-free / basic features** — the dominant, market-wide gripe
   (MEE6 putting custom automod + level-rewards behind $11.95/mo). The #1 thing to
   *not* do.
2. **Keyword-automod false positives** — traditional filters lack context;
   wildcards over-match and dump tuning burden on admins. **This is Tattletale's
   wedge.**
3. **Downtime / unreliability** — especially for high-traffic servers (Dyno's
   contested reputation; music-bot uptime gripes generally).
4. **Poor / unresponsive support** — Wick's single biggest complaint.
5. **Steep setup / config complexity** — Mimu's scripting curve ("one typo breaks
   it"); Carl's automod needing upfront config; Arcane's scattered settings.
6. **Needing multiple bots → clutter + command conflicts** — owners stack 3–4
   bots; commands collide; Discord itself recommends "multiple specialized bots,"
   which *is* the pain. **A genuine unified all-in-one removes this.**
7. **Weak logging** — some bots don't show the **"before" version of edited
   messages**. (Tattletale already does — keep and market it.)
8. **Ads / NFT pushes / aggressive upsells** — reputational poison (MEE6).

## 5. Feature wishlist — what people WANT that no single bot nails

These are the gaps a Tattletale-powered all-in-one can own:

- **AI/context moderation with low false positives** — repeatedly implied by the
  false-positive complaints; almost no incumbent does it. _(Tattletale: already built.)_
- **One genuinely unified bot** — everything in §3 under one install, no bot-
  stacking, no command conflicts.
- **Transparent pricing + a genuinely useful free tier** — basics free forever;
  charge only for what costs real money or is premium-feel.
- **Easy, dashboard-first setup** — no scripting language to learn, no scattered
  settings, no Go/Postgres/Redis.
- **Reliable uptime** — table-stakes that several incumbents fumble.
- **Fast leveling** (sub-second XP) **with free unlimited role rewards** — beat
  MEE6's paywall *and* Arcane's lag at once.
- **Security built in** — captcha verification + anti-raid/anti-nuke + join-rate
  lockdown, not a separate bot.
- **Full-fidelity logging** — before/after edits, who-deleted (audit log).
  _(Tattletale: already built.)_

---

## 6. Strategy: the Tattletale-powered all-in-one

**You already hold two of the wishlist items** (AI/context moderation with low
false positives; full-fidelity logging incl. before/after edits + who-deleted).
Lead the marketing with the false-positive advantage — it's the clearest unmet need.

**Build order — cheapest/highest-leverage first, expensive-to-run last:**
1. **Reaction roles** — table-stakes, cheap, event-driven (no per-message DB
   writes; doesn't move the cost curve). Match Carl-bot's depth (many roles/msg,
   buttons). Fast, visible win.
2. **Welcome / onboarding + verification/captcha** — adoption driver *and* the
   rising security expectation; both cheap and event-driven. Captcha gate + join-
   rate lockdown closes the Wick-shaped gap without a second bot.
3. **Web dashboard** — the connective tissue; makes per-server licensing + config
   far easier for non-technical customers (today config is slash-only). Avoid
   Arcane's "scattered settings" and Mimu's scripting curve — opinionated, simple.
4. **Leveling/XP — last, deliberately.** Biggest adoption driver *and* MEE6's
   most-hated paywall (sharpest wedge), and Arcane proved the demand for **free
   unlimited role rewards**. **But** it writes to the DB on every message → it
   rewrites the cost curve. Ship after the dashboard, make XP **sub-second** (beat
   Arcane's lag), price to cover its own weight.

**Monetization — learn from the backlash:**
- **Never paywall the basics** (reaction roles, welcome, core moderation, basic
  leveling = free, generous tier). This *is* the anti-MEE6 pitch and what every
  loved bot does.
- **Charge for what genuinely costs you** (leveling/XP at scale, high-volume AI
  moderation) or what's premium-feel — the **custom-branded bot** is the proven
  upsell (ProBot Tier 2 ~$10/mo; Mimu $19.99/mo).
- **Transparent per-server price below MEE6** (~$5–8), via the existing license-
  key delivery, billed off your own site. Already architected for this.
- **Don't** add ads, NFT gimmicks, or aggressive upsells.

---

## 7. Pricing benchmarks (2024–2026 snapshots)

| Bot | Entry premium | Notes |
|---|---|---|
| MEE6 | ~$11.95/mo | + ~$90/yr, ~$90 lifetime; the high anchor |
| Mimu | ~$11.95/mo | + **$19.99/mo** custom branding; free tier hard-capped |
| Arcane | ~$7/mo | core leveling + role rewards **free** |
| ProBot | ~$5 / ~$10/mo | **per-server**; Tier 2 adds custom bot |
| Wick / Carl-bot / Dyno | freemium | most core features free; premium for extras |
| YAGPDB / Zeppelin | free | open / source-available |

**Takeaway:** anchor at **~$5–8/mo per server**, undercutting MEE6, with a custom-
branded-bot upsell (~$10–20/mo) and a free tier that keeps all the basics.

---

## 8. Sources & confidence

**Verified to primary depth (Dive 1):** MEE6, ProBot, YAGPDB, Zeppelin
(vendor wikis/docs, GitHub READMEs/licenses, + a Change.org petition).

**Dive 2 (Wick, Dyno, Carl-bot, Arcane, Mimu + synthesis):** gathered via direct
web search after the automated fetch pipeline 403'd on most vendor pages. Facts
come from **search-result extracts** of SEO/affiliate/review blogs (skywork.ai,
peakbot.pro, communityone.io, vibebot.gg, restorecord), top.gg/discordbotlist
listings, and vendor sites. **Directional, not a measured sentiment study.**

**Caveats / honesty flags:**
- **Server counts conflict by source** (Carl-bot 12.1M vs 16M; Arcane 2.3M vs
  2.8M; Wick ~837k). Treated as ranges.
- **Dyno's reliability is genuinely contested** across reviewers (both "stable"
  and "downtime-prone") — presented as such, not resolved.
- No first-hand Reddit threads were fetched; sentiment is from secondary
  summaries. Affiliate blogs (peakbot.pro, vibebot.gg) sell their own bots and are
  biased against MEE6 — corroborated facts kept, framing discounted.
- Prices are 2024–2026 snapshots; MEE6 runs periodic 50%-off promos.
- **Auttaja** (named in some alternative lists) is **defunct** (ceased
  2026-03-24) — do not recommend.

**Key source URLs:** MEE6 Wiki/premium; docs.probot.io; github.com/botlabs-gg/yagpdb;
github.com/ZeppelinBot/Zeppelin; docs.wickbot.com; dyno.gg; carl.gg/docs.carl.gg;
arcane.bot; mimu.bot/docs.mimu.bot; top.gg listings; blog.communityone.io;
peakbot.pro; vibebot.gg; skywork.ai guides; a Change.org MEE6 petition.
