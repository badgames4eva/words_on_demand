# Store submission: Data Safety, ads declaration, content rating

Fill-in-the-blank answers for the Google Play Console and Amazon Appstore submission
forms. Every answer below is grounded in an audit of what the code actually does — see
[What the code actually does](#what-the-code-actually-does) at the bottom for the evidence.

- **Publisher (legal name):** badgames4eva
- **Support / privacy contact:** badgameseva@gmail.com
- **Privacy policy URL:** <https://wordsondemand.badgames4eva.com/privacy>
  (source of truth: [PRIVACY.md](PRIVACY.md), rendered as [privacy.html](privacy.html))
- **Target audience:** general audience, **not** child-directed
  (a child-directed classification forfeits ad revenue under COPPA — see [STEERING.md](STEERING.md))
- **Ad targeting:** **non-personalized only**

> ### Read this before you submit
>
> These answers describe the app **with ads enabled** — i.e. once real VAST tags are
> pasted into `CONFIG.vastTags` (see [ADS_SETUP.md](ADS_SETUP.md)). In the current build
> those tags are `null`, so the shipped app contacts **no third party at all** and shares
> nothing.
>
> Declare it **as it will behave when ads are live**. Both stores treat a
> later-than-declared behavior change as a policy violation, and "we'll turn ads on next
> week" is exactly that. Declaring ads you haven't switched on yet is allowed and harmless;
> the reverse is not.

---

## 1. Google Play — Data Safety

Play Console → **Policy → App content → Data safety**.

### Overview questions

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** — the ad SDK shares data (see below) |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — the ad SDK uses HTTPS; the app makes no other network calls |
| Do you provide a way for users to request that their data be deleted? | **No** — see the note under [Deletion](#deletion) |

**Why "Yes" to the first question when the app itself collects nothing:** Play's
definition of *collect* is "transmitted off the device", and *share* is "transferred to a
third party". Google Ad Manager / the IMA SDK is a third party, and it transmits the items
below. Local `localStorage` game state is explicitly **out of scope** — Play does not
count data that stays on the device.

### Data types to declare

Declare exactly these two. Everything else: **not collected, not shared**.

#### Device or other IDs → **Device or other IDs**

| Field | Answer |
|---|---|
| Collected | **No** |
| Shared | **Yes** |
| Processed ephemerally | No |
| Required or optional | **Required** (users can't turn ads off) |
| Purposes | **Advertising or marketing**, **Fraud prevention, security, and compliance** |

#### Location → **Approximate location**

| Field | Answer |
|---|---|
| Collected | **No** |
| Shared | **Yes** |
| Processed ephemerally | No |
| Required or optional | **Required** |
| Purposes | **Advertising or marketing**, **Fraud prevention, security, and compliance** |

**Why declare approximate location when the app requests no location permission:** the
ad request carries the device's IP address, from which Google infers a coarse
(city/region) location for ad serving and fraud checks. Play does not require you to
declare an IP address by itself, but it *does* require declaring location when location is
derived and used. Declaring it is the conservative reading and costs nothing; omitting it
is the kind of gap a reviewer flags. **Do not** declare *Precise location* — the app has
no location permission and cannot obtain one.

### Explicitly NOT collected and NOT shared

Answer **No / No** for every one of these. Say so plainly if a reviewer asks:

Name · Email address · User IDs · Address · Phone number · Race and ethnicity ·
Political or religious beliefs · Sexual orientation · Other personal info ·
Payment info · Purchase history · Credit score · Financial info ·
Health info · Fitness info · Emails · SMS or MMS · Other in-app messages ·
Photos · Videos · Voice or sound recordings · Music files · Other audio files ·
Contacts · Calendar events · App interactions · In-app search history ·
Installed apps · Other user-generated content · Other actions ·
Web browsing history · App performance / crash logs · Diagnostics · Files and docs

There is **no analytics SDK, no crash reporter, and no telemetry** in this app, which is
why *App interactions* and *Crash logs* are both "No" — an unusual answer that is
nonetheless accurate here.

### Deletion

Answer **No** to "Do you provide a way for users to request that their data be deleted?"

Justification if asked: the app has no accounts and no backend, so there is no server-side
data to delete. The only stored data is on the user's own device and is erased by clearing
the app's data or uninstalling. This is stated in the privacy policy under *Your rights*.

---

## 2. Google Play — Ads declaration

Play Console → **Policy → App content → Ads**.

| Question | Answer |
|---|---|
| Does your app contain ads? | **Yes** |
| Ad formats | **Video ads** (full-screen, between rounds) and **Rewarded ads** (the opt-in "Reveal a Letter" hint) |
| Where do ads appear? | Between rounds and on the result screen only — **never during a puzzle** |
| Do you use an ad network / mediation? | **Google Ad Manager** (video, VAST via the IMA HTML5 SDK) |
| Are ads personalized? | **No — non-personalized only** |

The store listing will show an **"Contains ads"** badge. That's expected.

**Families / child-safety questions:** the app is **not** in the Designed for Families
program and its target age is **13+**. If Play's target-audience form offers under-13 age
bands, do **not** select them. If it asks whether the app complies with the Families Ads
program, the answer is that the app is not directed to children, so the Families ads
requirements do not apply.

### Ad-related settings that live in Google Ad Manager, not in this repo

- **Non-personalized ads** is enforced at the ad-request level. Confirm your VAST tag URL
  carries `&npa=1`, and/or set the network-level restriction in GAM. If you copy a tag out
  of GAM without `npa=1`, the app will serve personalized ads and this declaration becomes
  false. See [ADS_SETUP.md](ADS_SETUP.md).
- **Non-skippable creatives** — a GAM creative setting, needed because the IMA HTML5 skip
  button may be unreachable by a D-pad. Also in [ADS_SETUP.md](ADS_SETUP.md).
- **Ad content rating filter** — in GAM, restrict served creatives to a maturity level at
  or below the app's content rating. A "Rated for 3+" app serving an alcohol ad is a
  policy violation even though the app's own content is clean.

---

## 3. Content rating questionnaire (IARC — Play, and Amazon's equivalent)

Play Console → **Policy → App content → Content rating**. Amazon Appstore asks a
near-identical set.

| Question | Answer |
|---|---|
| Category | **Game** → puzzle / word game |
| Violence — realistic, fantasy, or cartoon | **No** |
| Blood, gore, or depictions of injury | **No** |
| Sexual content, nudity, or suggestive themes | **No** |
| Profanity, crude humor, or offensive language | **No** |
| References to alcohol, tobacco, or drugs | **No** |
| Simulated gambling or gambling themes | **No** |
| Real-money gambling | **No** |
| In-app purchases | **No** |
| Loot boxes / randomized paid items | **No** |
| Digital purchases of any kind | **No** |
| Horror or fear-inducing content | **No** |
| Discrimination, hate, or extremist content | **No** |
| User-generated content | **No** — guesses are validated against a fixed local dictionary and never leave the device |
| User-to-user interaction, chat, or messaging | **No** |
| Sharing of user location | **No** |
| Sharing of personal information with third parties | **Yes** — ad identifiers only, for advertising and fraud prevention (matches the Data Safety answers above) |
| Does the app contain ads? | **Yes** |
| Does the app link to external websites? | **No** in-app links; the privacy policy URL is in the store listing |
| Miscellaneous — unrestricted internet access | **No** — the app opens no browser and has no URL entry |

**Expected outcome:** the lowest or near-lowest rating band (ESRB *Everyone*, PEGI *3*,
USK *0*, "Rated for 3+"), with the *Contains ads* / *shares info with third parties*
annotations.

### The word list backs up these answers — verified

A content rating is about content, and the puzzle content is the word list in
[words.js](words.js). Checked, so the low rating is honest:

- The **1,162-word answer pool** contains no slurs, profanity, or sexual or drug terms.
- `DENYLIST` in [words.js](words.js) already strips unambiguous slurs, strong vulgarity,
  and explicit sexual/drug terms out of the *accepted-guess* set, so a player can't type
  them onto the board either. None of its entries appear in the answer pool.
- The pool does include ordinary words with an incidental second reading — `STONE`,
  `JOINT`, `SMOKE`, `SHOOT`. These are correct to keep and don't affect the rating: IARC
  asks about *references to* drugs/violence, and a word with a plain everyday meaning in a
  vocabulary game isn't one. The `DENYLIST` comment already documents this policy.

This is worth re-checking if the answer pool is ever regenerated or expanded from a raw
dictionary. Note the distinction: a clean pool keeps the game family-*friendly* without
making it child-*directed* — the COPPA line in [STEERING.md](STEERING.md) is about who the
app targets and how it's marketed, not about whether the vocabulary is polite.

---

## 4. Amazon Appstore differences

The Amazon developer console asks for the same substance under different labels:

| Amazon field | Answer |
|---|---|
| Privacy policy URL | <https://wordsondemand.badgames4eva.com/privacy> (**required**, not optional) |
| Does your app collect personal information? | **No** by the app itself; **Yes**, the ad SDK shares device ad IDs |
| Does your app contain ads? | **Yes** |
| Advertising ID usage | **Yes**, non-personalized ad serving and fraud prevention |
| Does your app target children under 13? | **No** |
| Amazon Kids / Kids+ eligible | **No** — do not opt in; Kids+ requires an ad-free build |
| Content rating | Same answers as the IARC table above |
| Import/export compliance (encryption) | Uses **HTTPS/TLS only** (standard, exempt category) |
| Requires a Fire TV remote / no touchscreen | **Yes** — remote-only; declare the app as TV-compatible, not phone-compatible |

Amazon also reviews for **remote-navigability** — every control must be reachable by
D-pad. That's already a hard constraint on this codebase (see [STEERING.md](STEERING.md)),
including the `#btn-ad-continue` escape hatch that guarantees an ad can never strand a
remote-only player.

---

## What the code actually does

The evidence behind the answers above, so a future change can be checked against it.

**Stored locally, never transmitted** — `localStorage` key `wordsondemand.v1`
(`CONFIG.storageKey` in [game.js](game.js)):

```
{ streak, played, wins, lastDay, progress: { <day>: { guesses, finished, won,
  hintsUsed, hintRow, hintReveal, solveMs, startedAt } } }
```

**No network egress from the app itself.** There is no `fetch`, `XMLHttpRequest`,
`WebSocket`, `sendBeacon`, or `navigator.*` data call anywhere in the codebase, and
`CONFIG.wordListUrl` is `null` (the dictionary is bundled in `words.js`). No cookies, no
analytics, no crash reporting.

**Only two external origins appear in the entire codebase**, both ad-related:

- `https://imasdk.googleapis.com` — the IMA SDK, lazy-loaded by `ensureImaSdk()` in
  [game.js](game.js) and **only** when a VAST tag is configured
- `https://pubads.g.doubleclick.net` — the Google Ad Manager ad-request host, in a comment
  as the example VAST tag format

So: **ads are the only data-collection vector in this app**, and they are inert until
`CONFIG.vastTags` is set. If a future change adds analytics, a leaderboard, a backend, or
personalized ads, **every section of this document and [PRIVACY.md](PRIVACY.md) has to be
revisited before that build ships.**

## When to revisit this document

- Pasting real VAST tags into `CONFIG.vastTags` → nothing here changes (it already assumes
  ads are live), but verify `npa=1` is on the tag
- Switching to **personalized** ads → rewrite the ads declaration, add consent (CMP/GDPR
  + US state signals), and update the policy's advertising section
- Adding **any** analytics or crash reporting → new Data Safety data types, new policy text
- Adding accounts, cloud sync, or a leaderboard → personal data, a real deletion mechanism,
  and a substantially longer policy
- Adding in-app purchases → content-rating and store-listing changes
