# Words on Demand

A daily word-puzzle prototype for Connected TV (Fire TV / Android TV first), built
remote-first: fully playable with a D-pad + OK button, at a 10-foot viewing distance.

This is the "recommended first game" from the CTV gaming strategy — a Wordle-style
5-letter guess with an on-screen keyboard, procedurally sourced from a local
dictionary (zero content-licensing cost).

> **Why it's built this way:** see [STEERING.md](STEERING.md) for the strategy
> rationale behind the genre choice, remote-first constraints, monetization rules,
> COPPA guardrail, and launch sequencing.

**Live:** <https://wordsondemand.badgames4eva.com/> (GitHub Pages, custom domain — the
`CNAME` file pins it; don't delete it or a push reverts to the `*.github.io` URL).

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

## Deploy

Hosted on **GitHub Pages**, served straight from `main` (no `gh-pages` branch, no
build step) at the custom domain above. **Pushing to `main` is the deploy** — Pages
rebuilds in ~1–2 min. Every release bumps a version so TVs and browsers don't serve
stale cached assets; the on-screen build badge (bottom-right) is how you confirm the
new code actually went live.

To cut a release:

1. **Bump the version** everywhere it appears — the `?v=N` cache-bust on all three
   asset links *and* the badge in [index.html](index.html), plus the boot-log line in
   [game.js](game.js). From the repo root:
   ```bash
   sed -i '' 's/?v=34/?v=35/g; s/build v34/build v35/g' index.html   # N → N+1
   ```
   Then hand-edit the `console.log("… build vN …")` at the bottom of [game.js](game.js)
   (it's not covered by the sed). Keep all four in sync — a mismatch means the badge
   lies about what's loaded.
2. **Run the tests** — `node run-tests.js` must be all-green before pushing.
3. **Commit and push** `git push origin main`.
4. **Confirm live**: hard-refresh <https://wordsondemand.badgames4eva.com/>
   (Cmd+Shift+R to beat the cache) and check the badge shows the new `vN`.

The `CNAME` file at the repo root pins the custom domain — leave it in place; deleting
it reverts the site to the `*.github.io` URL on the next push. Only bump the version
for player-facing asset changes (HTML/CSS/JS); doc-only commits don't need it.

## Controls (remote contract)

| Remote        | Keyboard (desktop) | Action                                        |
|---------------|--------------------|-----------------------------------------------|
| D-pad         | Arrow keys         | Move focus                                    |
| OK / Select   | Enter              | Activate focused element (type a letter, press the on-screen Enter/Erase keys) |
| Play/pause    | (MediaPlay)        | Submit the current guess (shortcut — no need to reach the Enter key). Off the board: same as OK |
| Rewind        | (MediaRewind)      | Delete: tap = one letter, hold = wipe the row (incl. carried-down greens) |
| Back          | Backspace / Esc    | Close dialog, delete letter, or go home       |
| —             | A–Z keys           | Type directly (testing only)                  |

On the on-screen keyboard, **Left/Right wrap within a row** (P⇄Q, L⇄A, ENTER⇄Z)
so the D-pad never dead-ends at a row edge. The ENTER key shows the remote's
**Play/pause** icon and DEL shows the **Rewind** icon, matching the physical
buttons bound to those actions.

Those two icons are **inline SVG** (`ICON_REWIND` / `ICON_PLAY_PAUSE` in
[game.js](game.js)), deliberately not the ⏯/⏪ emoji. Emoji carry no intrinsic
color or shape — each platform paints them with its own emoji font, so the same
characters rendered blue/grey in the Fire OS WebView but orange on Vega. SVG
filled with `currentColor` renders identically everywhere. Don't reintroduce
emoji on these keys.

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
