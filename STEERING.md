# Steering: Words on Demand

Durable context and rationale for this project. The [README](README.md) covers *how*
to run and what each file does; this file preserves the *why* — the strategy decisions
that drove the build, so they survive across sessions and contributors.

## What this is

A playable web prototype (vanilla HTML/CSS/JS, no build step) of the "recommended
first game" from a CTV gaming strategy analysis: a daily Wordle-style word puzzle for
Connected TV, launching Fire TV + Android TV first, monetized by ads.

Tech stack was chosen deliberately: **vanilla HTML/CSS/JS** so the same code becomes
the Phase-2 Samsung Tizen / LG webOS build almost as-is, and wraps cleanly in a WebView
for the Phase-1 Android build.

## Why a word puzzle (genre decision)

Ranked highest for a small team's *first* CTV game across three axes:

- **Zero content-licensing cost** — puzzles are procedurally sourced from a local
  dictionary. Contrast with trivia (question authoring / IP) and music/quiz (PRO
  licensing).
- **Underserved vs. trivia** — trivia is saturated (Volley dominates: ~800K WAU,
  est. $10–15M/yr Fire TV revenue). Word/puzzle was validated by Samsung's June 2025
  GameBreaks launch but has far less competition.
- **Maps perfectly to D-pad + OK** — letter selection is discrete selection, the only
  interaction model that works within ~100ms remote latency.

## Non-negotiable design constraints (remote-first CTV)

These are hard requirements, not preferences — they come from the platform, not taste:

1. **Everything reachable by 4-way D-pad + OK.** No pointer, no free cursor. Focus
   moves by on-screen geometry (`moveFocus` in game.js) so any layout just works.
2. **10-foot legibility.** Oversized tiles, unmistakable high-contrast focus ring.
   Show roughly as much as a phone would, not a desktop.
3. **No precision timing.** ~100ms IR/BT latency makes reaction mechanics impossible.
   Ceiling is discrete, turn-based selection. Avoid anything needing <500ms input.
4. **Short, interruptible rounds** (<3 min) with a "one more round" replay hook —
   the single most important retention mechanic for lean-back TV.

## Monetization rules (baked into the code)

- **Ads only at natural break points** — full-screen interstitial *between* rounds,
  never mid-solve. Churns players otherwise.
- **Rewarded video is opt-in** — the "reveal a letter" hint is the rewarded-ad seam.
- `playAd()` is a placeholder. Swap in the real SDK per platform (APS for Fire TV,
  AdMob/IMA for Android TV) at that seam, keeping the between-rounds-only placement.
- **CTV economics are the whole case:** full-screen video CPMs $25–65 w/ 96–98%
  completion vs. mobile's $5–15 — roughly 3–5× per impression.

## Compliance guardrail

**Do not make this child-directed.** Keep vocabulary, art, and themes general-audience.
Under expanded 2025 COPPA enforcement, a child-directed classification (bright/childlike
theming, simple vocab) forfeits ad monetization. This constrains the word list and any
future art direction.

## Launch sequencing (from the strategy doc)

- **Phase 1** — Fire TV + Google/Android TV via one Android build (WebView wrap of this
  prototype, or Unity port). Highest reach-per-effort; Google TV alone is 300M+ MAU.
- **Phase 2** — Samsung Tizen + LG webOS via this shared HTML5 build, largely as-is.
- **Phase 3** — Roku, deferred. Separate BrightScript codebase, high certification
  friction, mandatory ~30% ad-inventory share. Only worth it after product-market fit.

## Discoverability notes (for when this ships)

- Title must be short and **voice-searchable** ("Word [Name]" pattern) for Alexa /
  Google Assistant.
- Front-load the store description's value prop (feeds Google TV's Gemini recommender).
- Native app status on Fire TV is the biggest discovery lever (voice search,
  "recently used" row, featured eligibility) — advantages Alexa skills don't get.
- Push for a 4.0+ rating early; conversion jumps sharply with ratings.
