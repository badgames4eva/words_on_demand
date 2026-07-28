# Words on Demand

A daily word-puzzle prototype for Connected TV (Fire TV / Android TV first), built
remote-first: fully playable with a D-pad + OK button, at a 10-foot viewing distance.

This is the "recommended first game" from the CTV gaming strategy — a Wordle-style
5-letter guess with an on-screen keyboard, procedurally sourced from a local
dictionary (zero content-licensing cost).

> **Why it's built this way:** see [STEERING.md](STEERING.md) for the strategy
> rationale behind the genre choice, remote-first constraints, monetization rules,
> COPPA guardrail, and launch sequencing.

**Live:** <https://wordsondemand.badgames4eva.com/> — served by **Cloudflare** from this
repo's `main` branch via Cloudflare's Git integration. See [Deploy](#deploy) for the full
picture, including the now-inert `CNAME` file left over from the old GitHub Pages setup.

**Privacy policy:** <https://wordsondemand.badgames4eva.com/privacy> — the URL both
stores require in the listing. Source of truth is [PRIVACY.md](PRIVACY.md); keep
[privacy.html](privacy.html) in sync with it. Store questionnaire answers (Data Safety,
ads declaration, content rating) are in [STORE_COMPLIANCE.md](STORE_COMPLIANCE.md).

In-app, the policy is summarized on the **How to Play & About** screen (`#howto`), and
the **full policy renders inside the app** on the `#policy` screen — no browser handoff.
That was a deliberate reversal: opening the device browser works on Fire OS, but the
browser doesn't share app data with the WebView, it covers the app, and getting back is
the wrapper's problem. `#btn-privacy` is still a real `<a href>` to the hosted copy so a
JS-less press degrades to the browser rather than doing nothing; `showPolicy()` cancels
that navigation whenever JS is alive.

Two layout rules there, both remote-driven:

- `#howto` must **fit without scrolling** — its only controls are its two buttons, so a
  scrollbar would be unreachable. That's what the `@media (max-height: …)` tiers in
  [styles.css](styles.css) are for (verified `overflow=0` from 800×480 up to 4K).
- `#policy` is the one screen that **does** scroll, because the scrolling region is
  itself the focused control: `#policy-doc` carries `.focusable`, and Up/Down page it
  (`scrollPolicy` in [game.js](game.js)). At either end `scrollPolicy` returns false and
  the press falls through to normal focus movement, so Down reaches **Done** and the
  D-pad can never be trapped in the text. BACK/Done return to About, not home.

> **Changing the support email, publisher name, or policy wording?** They're literal
> strings duplicated across four files (no build step to interpolate them). Follow
> [*How to change the email, publisher name, or policy text*](STORE_COMPLIANCE.md#how-to-change-the-email-publisher-name-or-policy-text)
> in STORE_COMPLIANCE.md — it has the one-line swap command, the trap to avoid
> (`badgames4eva` is also in the domain), and what to verify. Editing `index.html` means
> it's a release, so bump the version too.

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
skip, carry-down greens, config, the native BACK contract, time formatting, and
the privacy-policy copies' date sync) — no framework, no build step. Run either
way:

```bash
node run-tests.js          # headless, exits non-zero on failure (good for CI)
```

…or open [tests.html](tests.html) in a browser for a green/red readout. Both run
the same assertions in [tests.js](tests.js) against the real `words.js`/`game.js`.
Visual and feel (10-foot layout, focus ring, ad screen) stay a manual check in
the actual page.

One assertion is Node-only: the policy-date check reads PRIVACY.md, privacy.html,
and index.html off disk (`POLICY_FILES` in [run-tests.js](run-tests.js)), which a
browser can't do. It skips itself in `tests.html` and says so, rather than quietly
passing. **`node run-tests.js` is the gate before a push**, so run that one.

## Deploy

Hosted on **Cloudflare**, served straight from `main` (no `gh-pages` branch, no build
step) at the custom domain above, via Cloudflare's **Connect to Git** integration.
**Pushing to `main` is the deploy** — Cloudflare redeploys in ~1 min. Every release bumps
a version so TVs and browsers don't serve stale cached assets; the on-screen build badge
(bottom-right) is how you confirm the new code actually went live.

> **How we can tell it's Cloudflare and not GitHub Pages:** every response carries
> `server: cloudflare` and a 404 returns a **zero-byte** body (Cloudflare's static-asset
> serving), where GitHub Pages returns its own styled HTML 404. The site ran on GitHub
> Pages until ~build v33 and was migrated to Cloudflare; the leftovers are documented at
> the end of this section.

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

Only bump the version for player-facing asset changes (HTML/CSS/JS); doc-only commits
don't need it.

### Leftovers from the GitHub Pages era — safe, but know they're there

Cloudflare now owns the custom domain, so two GitHub Pages artifacts are inert:

- **The `CNAME` file** at the repo root. GitHub Pages read it to claim the custom domain;
  Cloudflare ignores it entirely and gets its domain from the dashboard. It's harmless to
  leave and harmless to delete — Cloudflare won't notice either way. (Contrast with the
  `badgames4eva_site` repo, which never had one.)
- **GitHub Pages itself may still be enabled** on the repo: `badgames4eva.github.io/words_on_demand/`
  still `301`s to the custom domain. That's the old Pages CNAME config, not Cloudflare.
  It does no harm because Cloudflare is what actually answers `wordsondemand.badgames4eva.com`,
  but if you want a single source of truth, disable Pages in the repo's Settings → Pages.

### Load performance

Origin is Cloudflare (static assets served from `main`). What's already handled in this repo:

- **Deferred scripts** — `words.js`/`game.js` carry `defer`, so neither blocks HTML
  parsing. They keep document order and run before `DOMContentLoaded`, which is what
  the bottom-of-body boot block in [game.js](game.js) needs (`#btn-play` must exist).
- **Lazy ad SDK** — the ~488 KB Google IMA SDK is *not* in a `<script>` tag. It's
  injected by `ensureImaSdk()` on the first "Play" (see [game.js](game.js)), so it never
  competes with initial render. It also no-ops entirely while `CONFIG.vastTags` are
  `null`, so the demo/dev path never touches Google's CDN.
- **Compression is already on** via Cloudflare — Brotli, verified. Note that
  `curl -I` *without* an `Accept-Encoding` header reports the uncompressed origin size
  (words.js 119 KB); real browsers always send one and get ~42 KB. Measure with
  `curl -sSI -H 'Accept-Encoding: br, gzip' <url> | grep -i content-encoding`.

**Not fixable from a code change — needs a Cloudflare dashboard change.** Assets still go
out with `cache-control: public, max-age=0, must-revalidate` (verified on `game.js`), so
the browser revalidates all three files on every load and caching never helps. Since
assets are already cache-busted with `?v=NN`, add a Cloudflare **Cache Rule**:

- **When** `http.request.uri.path` ends with `.js` or `.css`
- **Then** Cache eligibility: *Eligible for cache*; Edge TTL + **Browser TTL: 1 year**
- Leave `index.html` alone (must stay `max-age=0, must-revalidate` so new `?v=` rolls out)

That makes warm launches near-instant. Without it, the `?v=` scheme is doing correctness
work but buying no speed.

## Controls (remote contract)

| Remote        | Keyboard (desktop) | Action                                        |
|---------------|--------------------|-----------------------------------------------|
| D-pad         | Arrow keys         | Move focus                                    |
| OK / Select   | Enter              | Activate focused element (type a letter, press the on-screen Enter/Erase keys) |
| Play/pause    | (MediaPlay)        | Submit the current guess (shortcut — no need to reach the Enter key). Off the board: same as OK |
| Rewind        | (MediaRewind)      | Delete: tap = one letter, hold = wipe the row (incl. carried-down greens) |
| Back          | Backspace / Esc    | Close dialog, delete letter, or go home       |
| —             | A–Z keys           | Type directly (testing only)                  |

A hold is invisible, so the row-wipe gesture is taught on screen: a static line
under the board (`#row-wipe-note`, `renderRowWipeNote` in [game.js](game.js))
shows the Rewind glyph + "Hold to clear the whole row" exactly while the current
row has a carried-down green pinned in it — the only state where wiping does
something tap-to-delete can't. It needs no persisted counter and no timer,
because the condition *is* the relevance: it retires itself.

This replaced a counted coach toast, which landed over the board right after the
reveal, pulled the eye off the tiles the player just earned, and was gone before
it could be read from a couch. Don't reintroduce a toast for it. The glyph
carries no word — the same icon is on the Erase key, so it identifies the control
by sight instead of naming a button that isn't labeled "Rewind" on screen.

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
  `back` → close an open dialog, else go back a screen (the policy screen steps back to
  About, everything else to home), else (on home) raise the exit-confirmation dialog;
  `pause`/`resume` → stop/start the solve timer.
- **Outbound** (`postMessage`, with a `ReactNativeWebView` JSON-string fallback):
  `ready` on load, `back-handled` **synchronously** for every `back` (so the app
  never exits under an open dialog), and `exit` only when the user confirms.

`nativeBridge.send()` accepts an optional payload (`send("open-url", { url })`) but
nothing in the app sends one today — the policy renders in-app instead, so the wrapper
needs no URL-opening support. The messages above still go out as exactly `{ type }`.

**Wrapper note — don't let the WebView navigate.** Fire OS's default for a clicked link
in a WebView is to hand it to whatever app handles URLs (the browser). We rely on that
only as the no-JS fallback for `#btn-privacy`. A wrapper that wants links kept in-app
should supply a `WebViewClient` overriding `shouldOverrideUrlLoading()` (Fire OS) or set
`onShouldStartLoadWithRequest` (Vega) — for a SPA that never navigates, neither is
required.

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
