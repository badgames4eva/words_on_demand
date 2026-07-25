# Words on Demand

A daily word-puzzle prototype for Connected TV (Fire TV / Android TV first), built
remote-first: fully playable with a D-pad + OK button, at a 10-foot viewing distance.

This is the "recommended first game" from the CTV gaming strategy — a Wordle-style
5-letter guess with an on-screen keyboard, procedurally sourced from a local
dictionary (zero content-licensing cost).

> **Why it's built this way:** see [STEERING.md](STEERING.md) for the strategy
> rationale behind the genre choice, remote-first constraints, monetization rules,
> COPPA guardrail, and launch sequencing.

## Run it

No build step. Just open it in a browser:

```bash
open /Users/behyad/projects/ai/words_on_demand/index.html
# or serve it (better for TV device testing over LAN):
cd /Users/behyad/projects/ai/words_on_demand && python3 -m http.server 8080
```

Then visit http://localhost:8080

## Tests

Logic tests (scoring, puzzle-of-day math, dictionary integrity, "one more round"
skip, carry-down greens, config, the native BACK contract, time formatting) — no
framework, no build step. Run either way:

```bash
node run-tests.js          # headless, exits non-zero on failure (good for CI)
```

…or open [tests.html](tests.html) in a browser for a green/red readout. Both run
the same assertions in [tests.js](tests.js) against the real `words.js`/`game.js`.
Visual and feel (10-foot layout, focus ring, ad screen) stay a manual check in
the actual page.

## Controls (remote contract)

| Remote      | Keyboard (desktop) | Action                         |
|-------------|--------------------|--------------------------------|
| D-pad       | Arrow keys         | Move focus                     |
| OK / Select | Enter              | Activate focused element       |
| Back        | Backspace / Esc    | Close dialog, delete letter, or go home |
| —           | A–Z keys           | Type directly (testing only)   |

### Native BACK contract (Fire OS / Vega wrapper)

The wrapper injects `window.WordsOnDemand` and forwards the remote's BACK press,
waiting ~400ms for a reply before deciding whether to exit. `nativeBridge` in
[game.js](game.js) implements the SPA side (guarded to a no-op in a plain browser):

- **Inbound** (`window.WordsOnDemand.onMessage` or a `wod:message` event):
  `back` → close an open dialog, else go back a screen, else (on home) raise the
  exit-confirmation dialog; `pause`/`resume` → stop/start the solve timer.
- **Outbound** (`postMessage`, with a `ReactNativeWebView` JSON-string fallback):
  `ready` on load, `back-handled` **synchronously** for every `back` (so the app
  never exits under an open dialog), and `exit` only when the user confirms.

## How the prototype maps to the strategy doc

- **Remote-first navigation** — every control is a `.focusable`; focus moves by
  on-screen geometry, so the D-pad works on any layout ([game.js](game.js) `moveFocus`).
- **10-foot UI** — oversized tiles, high-contrast yellow focus ring, minimal text
  ([styles.css](styles.css)).
- **"One more round" loop** — the primary retention mechanic; instant replay with
  the next puzzle after each round.
- **Daily challenge + streak** — deterministic puzzle-of-the-day (no backend) and a
  local streak counter ([words.js](words.js) `puzzleForDay`, [game.js](game.js) `endRound`).
- **Ads at natural break points only** — a full-screen interstitial plays between
  rounds and for the opt-in "reveal a letter" (rewarded-video pattern); never
  mid-solve ([game.js](game.js) `playAd`, `useHint`).
- **No child-directed content** — general-audience vocabulary, preserving full ad
  monetization under 2025 COPPA rules.

## Files

- `index.html` — screens: home, game, result, ad, how-to
- `styles.css` — 10-foot design system
- `words.js` — answer pool, valid-guess set, day-based puzzle selection
- `game.js` — navigation, scoring, round lifecycle, stats, ad flow

## Next steps toward the launch plan

1. Wrap this HTML5 build for **Samsung Tizen / LG webOS** (the doc's Phase 2 shared
   web build) — largely as-is.
2. For **Fire TV / Android TV** (Phase 1), wrap in a WebView-based Android app or
   port to Unity, and integrate real ad SDKs (APS / AdMob) at the `playAd` seam.
3. Replace the placeholder `playAd()` with the platform ad SDK; keep the
   between-rounds-only placement.
