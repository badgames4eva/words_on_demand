# Words on Demand — project instructions

A daily Wordle-style word-puzzle prototype for Connected TV (Fire TV / Android TV
first), built remote-first for D-pad + OK at a 10-foot viewing distance. Vanilla
HTML/CSS/JS, no build step.

## Read this first

**Before making changes, read [STEERING.md](STEERING.md).** It holds the strategy
rationale and the non-negotiable constraints. Key ones to never violate:

- **Remote-first:** everything must be reachable by 4-way D-pad + OK. No pointer / free cursor.
- **10-foot UI:** oversized elements, unmistakable high-contrast focus ring.
- **No precision timing:** discrete turn-based selection only (~100ms remote latency).
- **Ads only between rounds**, never mid-solve; rewarded video is opt-in (the hint).
- **Keep it general-audience** — a child-directed classification forfeits ad revenue (COPPA).

## Tech / conventions

- Vanilla HTML/CSS/JS on purpose — this same code is the Phase-2 Tizen/webOS build and
  wraps in a WebView for the Phase-1 Android build. Don't add a framework or build step
  without discussing the tradeoff.
- No backend: puzzle-of-the-day is deterministic (`puzzleForDay`), stats are local.
- `playAd()` is a deliberate placeholder seam for the real per-platform ad SDK.

## Files

- `index.html` — screens: home, game, result, ad, how-to
- `styles.css` — 10-foot design system
- `words.js` — answer pool, valid-guess set, day-based puzzle selection
- `game.js` — navigation, scoring, round lifecycle, stats, ad flow
