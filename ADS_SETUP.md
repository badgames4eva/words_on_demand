# Ad Setup — Google Ad Manager → VAST → `CONFIG.vastTags`

The one-time checklist to turn on real ads. When it's done, the **only code change**
is pasting two VAST tag URLs into `CONFIG.vastTags` in [game.js](game.js) — everything
else is account/console configuration.

Read [STEERING.md](STEERING.md) "Monetization rules" first for *why* these choices
(GAM not AdMob, non-skippable at launch, the D-pad escape hatch). This doc is the *how*.

---

## How the code already works

`playAd(seconds, onDone, placement)` is the single seam. At runtime it picks a path:

- **Real ad** — used only when *both* are true: a VAST tag is set for that placement in
  `CONFIG.vastTags`, **and** the IMA HTML5 SDK loaded (`ima3.js`, included async in
  [index.html](index.html)). Then `playImaAd()` requests and plays the VAST creative.
- **Placeholder** — otherwise (browser demo, offline, no tag set, tests). The faux
  countdown. This is the current default because both `vastTags` are `null`.

So the game ships and runs today with zero ad infrastructure. Wiring ads live is
additive and reversible: set the tags to go live, set them back to `null` to go dark.

Two placements, mapped to the two natural break points:

| `CONFIG.vastTags` key | Placement | Trigger |
|---|---|---|
| `interstitial` | full-screen between rounds | "One More Round" |
| `rewarded` | opt-in reward | "Reveal a Letter" hint |

---

## Checklist

### 1. Create a Google Ad Manager account (free)

- Sign up at **admanager.google.com**. Choose **Google Ad Manager** (the free tier —
  aka GAM 360's non-enterprise sibling). Free up to ~90M ad impressions/month, which is
  far beyond launch volume.
- It links to a **Google AdSense** account for payment/identity — that's normal. AdSense
  here is just the payee + a backfill demand source; we are **not** building an AdSense
  display integration. (This is the AdMob-vs-AdSense-vs-GAM confusion resolved: GAM is
  the ad *server*; AdSense/AdX are *demand* inside it; AdMob is not used at all.)

### 2. Create a video ad unit

- **Inventory → Ad units → New ad unit.**
- Set the format to **Video / Audio** (an "instream video" ad unit). A 16:9 linear video
  slot matches our full-screen `.ad-box` (`aspect-ratio: 16/9`).
- Create **two** ad units (or one unit with two placements) so interstitial and rewarded
  can be reported and capped separately.
- Enable programmatic demand: turn on **Google AdX / Open Bidding** and **AdSense video
  backfill** so the units actually fill once eligible.

### 3. Configure creatives as NON-SKIPPABLE

This is the launch-critical setting, not code. The IMA **HTML5** SDK has no documented
Connected-TV/D-pad support, so a skip button may be **unreachable by a remote**.

- In the ad unit / line item creative settings, serve **non-skippable / auto-completing**
  linear creatives only (≤ ~15–30s). No "skippable in 5s" formats.
- Because there's no skip button, there's nothing the remote needs to reach mid-ad. The
  ad plays to completion, then the SDK fires `ALL_ADS_COMPLETED` → `resume()`.
- The in-app **D-pad "Continue" escape hatch** (`#btn-ad-continue`, revealed after
  `CONFIG.adEscapeAfterMs`) is the backstop if a creative overruns or freezes anyway —
  it is not the primary skip path.

### 4. Generate the VAST tag URL

- **Ad unit → Tags → select VAST.** Google gives you a URL like:

  ```
  https://pubads.g.doubleclick.net/gampad/ads?iu=/NETWORK/ad-unit&sz=640x480&...&output=vast
  ```

- Generate one for the interstitial unit and one for the rewarded unit.
- **Append `&npa=1` to both tags.** This requests **non-personalized ads** — no
  interest-profile targeting off the device's advertising ID. It's not optional bookkeeping:
  the store submissions declare "ads are non-personalized"
  ([STORE_COMPLIANCE.md](STORE_COMPLIANCE.md)), and a tag without `npa=1` makes that
  declaration false, which is a policy violation in both stores. It also keeps the app out
  of consent-banner territory (GDPR/CPRA) — hard to do well with a D-pad and no pointer.
  Belt-and-braces: also set the restriction at the GAM network level so a hand-copied tag
  can't quietly re-enable personalization.
- While you're in GAM, set the **ad content rating filter** to the app's own rating band or
  lower. A "Rated for 3+" app serving an alcohol creative violates policy even though the
  game's own content is clean.
- Sanity-check each in Google's **VAST Suite Inspector** (search "IMA VAST inspector")
  before wiring — confirms the tag returns a playable creative.

### 5. Paste the tags into the code (the only code change)

In [game.js](game.js), in the `CONFIG` block (~line 30):

```js
vastTags: {
  interstitial: "https://pubads.g.doubleclick.net/gampad/ads?iu=/NETWORK/wod-interstitial&...&output=vast&npa=1",
  rewarded:     "https://pubads.g.doubleclick.net/gampad/ads?iu=/NETWORK/wod-rewarded&...&output=vast&npa=1",
},
```

Bump the build (`?v=` + badge + boot log) and redeploy. That's it — `playAd()` now routes
to IMA for both placements, with the placeholder still covering fill misses and errors.

### 6. Expect near-zero fill at first (not a bug)

- New GAM/AdX inventory goes through an **eligibility review** and ad demand ramps slowly.
  Expect **near-zero fill for days to weeks** at launch. The placeholder fallback and the
  no-fill → `resume()` path mean the game stays fully playable throughout — a player is
  never blocked on an ad that didn't load.
- Watch fill rate / completion in GAM reporting. Indie CTV fill runs ~30–60% even once
  ramped; design expectations (and Phase 4 revenue models) around the miss.

---

## Escalation path (post-launch, only if needed)

If skippable/rewarded ads with a proper remote-driven skip become worth it, that's the
trigger to move ads to the **native Android IMA SDK** inside the WebView wrapper — its
Android-TV guide handles D-pad skip focus automatically. That's a wrapper-side change
(the APK, built in the separate project), **not** a change to this repo. Add **Amazon
Publisher Services (APS)** later as Fire-TV-specific demand alongside GAM.

## Tuning knobs (in `CONFIG`, no console needed)

- `adSeconds.interstitial` / `adSeconds.rewarded` — placeholder countdown length only.
- `adLoadTimeoutMs` — how long to wait for IMA to load a creative before falling back.
- `adEscapeAfterMs` — when the D-pad "Continue" escape button appears (must exceed the
  longest creative you serve, plus load time).
