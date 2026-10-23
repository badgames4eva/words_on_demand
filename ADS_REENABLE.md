# Re-enabling ads (undoing the 2026-10-22 "ads off" release)

For the first Amazon Appstore submission, ads were switched **off** so the declarations,
listing, and privacy policy are accurate for what ships. This file lists everything that
changed so it can be reversed when a real ad network is added. Ad Manager (GAM) is **not**
the plan; the replacement network is undecided (AdMob / AppLovin MAX were evaluated, see
"Open questions").

Do these in **one release**, in this order, and update the stores' declarations at the
same time. Both stores treat a behavior change that isn't declared as a policy violation.

## What was changed (web repo: `badgames4eva/words_on_demand`)

| # | Change | Where | How it was done |
|---|---|---|---|
| 1 | Master ad switch | `CONFIG.adsEnabled = false` in [game.js](game.js) | commit `0fc6c70` (build v45). `playAd()` returns early, calling `onDone()` immediately: no ad screen, no latch, no escape button. |
| 2 | Hint button shows no "Watch Ad" pill | `HINT_COPY.available.badge` and `refreshHintButton()` aria-label in [game.js](game.js); the `<span class="hint-badge" hidden>` and `aria-label="Reveal a letter"` in [index.html](index.html) | same commit. Both read `CONFIG.adsEnabled`, so flipping the flag restores the pill and "watch an ad" aria label. The `hidden` attribute in the HTML is overwritten at runtime by `refreshHintButton()`. |
| 3 | Test for the off state | `ads: adsEnabled is off, ...` in [tests.js](tests.js) | same commit. **Update or replace** when you enable ads (it asserts `adsEnabled === false`). |
| 4 | Privacy policy rewritten ("no ads") | [PRIVACY.md](PRIVACY.md), [privacy.html](privacy.html), and the `#policy` screen + About block in [index.html](index.html) | commit tagged `[ads-off] privacy` (build v46). Last-updated date set to Oct 22, 2026. |
| 5 | Store answers | "Read this before you submit" box at the top of [STORE_COMPLIANCE.md](STORE_COMPLIANCE.md) | same commit. Sections 1-4 below the box are still the ads-live template. |

## Where the ads-live originals are saved

[docs/ads-live/](docs/ads-live/) holds verbatim copies taken **before** edit #4:

| Saved copy | Restores |
|---|---|
| `docs/ads-live/PRIVACY.ads-live.md` | `PRIVACY.md` |
| `docs/ads-live/privacy.ads-live.html` | `privacy.html` |
| `docs/ads-live/index.about-block.ads-live.html` | the "About & Privacy" paragraphs in `index.html` (original lines 160-169) |
| `docs/ads-live/index.policy-screen.ads-live.html` | the `#policy` section body in `index.html` (original lines 221-312) |

Those policy texts describe **Google Ad Manager + IMA, non-personalized**. They are a
starting point, not the final wording: rewrite the "Advertising" section for whichever
network you choose (who receives what, ad-ID use, consent for EEA/UK if the network needs
it, personalization setting). Also `git show ffe948f:<file>` gives the exact pre-change
files if you prefer git over the copies.

## Re-enable checklist

1. **Pick and integrate the network.**
   - Web-only path (IMA/VAST): paste tags into `CONFIG.vastTags`, see [ADS_SETUP.md](ADS_SETUP.md).
   - Native path (Fire OS wrapper, Java): bridge `playAd('rewarded'|'interstitial')` to the
     native SDK and grant rewards only from the SDK's reward callback. The wrapper repo is
     `badgames4eva/words_on_demand_tv` (`fireos/`). Vega has no SDK for MAX/AdMob.
2. **Flip the switch:** `CONFIG.adsEnabled = true` in [game.js](game.js).
3. **Fix the test** from change #3.
4. **Restore/rewrite the privacy policy** (all three places: `PRIVACY.md`, `privacy.html`,
   in-app `#policy`) from `docs/ads-live/`, adjusted for the real network. Bump the
   "Last updated" date.
5. **Update the store declarations** per the ads-live sections of
   [STORE_COMPLIANCE.md](STORE_COMPLIANCE.md): contains ads = Yes, ad network, data shared
   (ad ID, approximate location, etc.), personalization. Then remove or rewrite the
   "ads OFF" box at the top of that file.
6. **Store listing copy** in the wrapper repo: see `store/archive/README.md` in
   `badgames4eva/words_on_demand_tv` for the lines to put back in `store/LISTING.md`
   and the saved ads-UI screenshots.
7. **app-ads.txt** in `badgames4eva_site` must include the new network's line.
8. Bump the build (`?v=` + badge + boot log, see [README.md](README.md)), run
   `node run-tests.js`, deploy, then test on a Fire TV. Check D-pad reachability of
   every ad control, and that the reward fires only on completion.
9. Native path only: bump `minSdk` to 24 (MAX and AdMob require it), rebuild and
   re-sign the APK, bump `versionCode`.

## Open questions (as of 2026-10-22)

- Google's AdMob policy on TV apps is **unverified** (this repo's older docs say AdMob has
  no CTV support and risks account bans; Google's docs fetched on 2026-10-22 neither
  confirmed nor denied). Get an answer in writing from AdMob support before building on it.
- AppLovin MAX is listed by Amazon as Fire OS compatible (older SDK version).
