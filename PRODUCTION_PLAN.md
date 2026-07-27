# Production Plan — Words on Demand (Fire TV / Android TV)

Target: ship the prototype as a real, monetized app on **Fire TV** and **Google/Android
TV** (Phase 1 of the strategy — see [STEERING.md](STEERING.md)). This is the
reach-per-effort sweet spot: one Android build covers both stores.

This document is the roadmap. It is honest about what's a prototype today and what a
shippable product needs. Effort estimates assume a 2–3 person team.

---

## Current state (what we have)

- Fully playable web prototype: vanilla HTML/CSS/JS, no build step.
- Correct Wordle scoring (verified against duplicate-letter edge cases).
- D-pad + OK navigation by on-screen geometry; 10-foot UI; streak/stats in localStorage.
- 1,162 curated daily answers (~3 years); ~12,700-word accepted-guess dictionary (denylisted).
- `playAd()` is a **placeholder** — no real ad SDK.
- Not version-controlled; no tests; no telemetry; no store assets.

## Packaging decision: WebView wrapper vs. Unity

**Recommendation: WebView-wrapped Android app** (not Unity), for this game.

| | WebView wrapper | Unity |
|---|---|---|
| Reuse of current code | ~100% | Rewrite |
| Build size | Small (~a few MB) | Large (20MB+) |
| Ad SDKs | AdMob/IMA web or native bridge | Native mediation (LevelPlay/MAX) |
| Low-end TV perf | Good (simple DOM) | Overkill for this game |
| Team skill needed | Web + light Android | Unity/C# |

A turn-based word game has no need for a game engine. Wrap the existing HTML5 in an
Android `WebView` (Kotlin), targeting Android TV's Leanback. The **same HTML5 build**
then also serves Phase 2 (Tizen/webOS) nearly as-is. Keep Unity in reserve only if a
future title needs real-time graphics.

---

## Phase 0 — Foundations & correctness (1 week)

Cheap, high-leverage, must-do-first. All in the existing web code.

- [ ] **git init** + `.gitignore`; commit the prototype as the baseline.
- [x] **Codify tests**: framework-free suite (`tests.js`) for `scoreGuess` (incl.
      duplicate letters), `puzzleForDay` (determinism + wrap), dictionary integrity
      (answers ⊆ valid), `nextUnplayedOffset`, and `formatDuration`. Runs headless
      (`node run-tests.js`) or in the browser (`tests.html`).
- [x] **No-repeat rounds**: "one more round" won't replay a solution word within a
      session. `nextUnplayedOffset` skips both finished puzzles and any offset whose
      answer is already in the session's `sessionAnswers` set (resets on reload).
- [x] **Expand answer pool** from 90 → 1,162 curated words (~3 years of dailies), still
      general-audience (COPPA — see STEERING). Adult/substance terms (CIGAR, VODKA,
      RIFLE, VOMIT) excluded from *featured answers* though still accepted as guesses.
      Integrity tests assert every answer is well-formed, unique, and in VALID_GUESSES.
- [x] **Dictionary cleanup**: denylist offensive entries from the guess set (proper-noun
      removal deliberately skipped — the ~25 candidates were mostly legit common words).
- [x] **Config seam**: `CONFIG` object in game.js holds all tunables (word length,
      guesses, ad durations for interstitial/rewarded, reveal delay, and a
      `wordListUrl` placeholder for Phase 4 remote config). Logic reads from it.

## Phase 1 — Real monetization (1–2 weeks)

The placeholder `playAd()` is where the business is. This is the core of "production."

**Step-by-step account setup: [ADS_SETUP.md](ADS_SETUP.md)** (GAM account → video ad
unit → VAST tag → paste into `CONFIG.vastTags`). The seam is already built.

- [x] Real ad path wired behind the existing `playAd()` seam: **Google IMA HTML5 SDK**
      serving VAST, gated on a tag being set in `CONFIG.vastTags` *and* the SDK being
      present; otherwise the placeholder countdown runs. Going live is config-only
      (paste two VAST tag URLs) — no code change. Back it with **Google Ad Manager**
      (NOT AdMob — no CTV support, ban risk); add **Amazon APS** later for Fire TV.
- [x] **Fill-failure fallback**: no-fill / load-timeout / ad-error all route through the
      same idempotent `resume()` as a completed ad, so the game never blocks a round.
      CTV fill rates run 30–60% and new inventory starts near zero — designed for the miss.
- [ ] **Frequency capping**: interstitial only between rounds, cap per session.
- [ ] **Rewarded flow**: the "reveal a letter" hint only grants reward on ad completion.
- [ ] Wire ad events to analytics (fill rate, completion, revenue per session).

## Phase 2 — Android packaging (2–3 weeks)

- [ ] Android Studio project: Kotlin, min/target SDK for Fire OS + Android TV, Leanback.
- [ ] `WebView` host loading the bundled HTML5; JS↔native bridge for ads + lifecycle.
- [ ] **D-pad key mapping**: map hardware remote keycodes → the app's existing arrow/OK
      handling; handle BACK/HOME correctly (Android TV certification checks this).
      - [x] **Web side of the BACK contract** is implemented: the SPA answers the native
            `back` message (`back-handled` synchronously within ~400ms), walks screens
            back, and shows a branded exit-confirmation dialog on home (`exit` on
            confirm). Sends `ready` on load; honors `pause`/`resume` for the solve
            timer. See `nativeBridge` in game.js. The native app still needs to post
            these messages and honor the replies.
- [ ] Banner/icon assets per platform (Android TV 320×180dp banner; Fire TV art).
- [ ] Offline handling, pause/resume, focus restoration on app resume.
- [ ] Test on **real hardware** (a Fire TV Stick + an Android TV device) — low-end perf
      and remote latency are the classic traps that emulators hide.

## Phase 3 — Compliance & store readiness (1–2 weeks, parallelizable)

Blocking for store submission.

- [ ] **Privacy policy** + in-app link (required by both stores).
- [ ] **COPPA/consent**: general-audience declaration; ensure ads are non-personalized
      where required; no data collection that would trip child-directed rules.
- [ ] Data-safety / content-rating questionnaires (Google Play + Amazon Appstore).
- [ ] **Store listings**: short, voice-searchable title ("Word …" pattern), front-loaded
      description (feeds Google TV Gemini), screenshots, feature graphic.
- [ ] Amazon Appstore + Google Play developer accounts and submission.

## Phase 4 — Quality, telemetry & launch (1–2 weeks)

- [ ] **Analytics**: DAU, retention (D1/D7), round completion, streak distribution,
      ad fill/completion/revenue. Needed to prove product-market fit before Phase 2/3
      platforms (Tizen/webOS/Roku) are worth it.
- [ ] **Remote config** for word lists (ship new dailies without an app update).
- [ ] Crash/error reporting.
- [ ] Accessibility pass: contrast, focus visibility, optional larger text.
- [ ] Soft launch → monitor → iterate on ad placement and retention.

---

## Priority ranking (if time is tight)

1. **Phase 0** — correctness, tests, git. Non-negotiable, ~1 week, no external deps.
2. **Phase 1** — real ads. Without this there's no business.
3. **Phase 2** — Android packaging. The actual "it's on the TV" milestone.
4. **Phase 3** — compliance. Blocks submission but is well-defined checklist work.
5. **Phase 4** — telemetry closes the loop and gates further platform investment.

## State & persistence

The prototype stores everything client-side in the browser's `localStorage` (the
`wordsondemand.v1` key): stats, streak, and a per-puzzle `progress` record (guesses,
finished/won, hints used, answer). That progress record does double duty — it powers
both **resume** (leave mid-puzzle and return to the same board, not a fresh one) and
the **History** screen — so history and hint counts need no separate data model.

How this carries to the native targets:

- **Fire TV / Android TV (WebView wrap)** — `localStorage` persists as long as the
  WebView has `domStorageEnabled = true` and a persistent data dir. This exact code
  keeps working; no change needed.
- **Vega (Fire TV's newer OS)** — same: a web-runtime app persists `localStorage`. For
  durable/native-backed storage, use Vega's KV/persistence APIs via the JS↔native bridge.

**Anti-cheat caveat.** Any client-side cache — `localStorage`, Android
SharedPreferences/DataStore, Vega KV — is user-clearable and editable. The current
resume fix stops the casual "Back button resets my board" exploit, but a determined
user can wipe app data to reset. Truly tamper-proof daily state (for leaderboards or
streaks that carry weight) requires **server-authoritative per-user state** — out of
scope for launch, but the prerequisite for any competitive/social feature.

**Telemetry hook (Phase 4).** History and hint counts are strong engagement signals —
wire them to analytics alongside the ad metrics. Hint usage in particular is a direct
read on both difficulty tuning and rewarded-ad demand.

## Explicitly out of scope for launch

- Tizen / webOS (Phase 2 of the *strategy*) — reuse this HTML5 later.
- Roku — deferred until product-market fit (separate BrightScript codebase).
- Multiplayer, accounts, cloud sync, IAP-to-remove-ads — post-launch experiments.

## Key risks

- **Ad fill rates** on indie CTV inventory are low (30–60%) and hard to predict — the
  fallback design in Phase 1 is what keeps the game playable regardless.
- **Certification friction**: Android TV BACK/D-pad handling and Fire TV app-behavior
  checks are common rejection causes — budget a re-submission cycle.
- **Low-end TV performance**: test on real cheap hardware early, not just emulators.
