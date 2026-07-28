# Store submission: Data Safety, ads declaration, content rating

Fill-in-the-blank answers for the Google Play Console and Amazon Appstore submission
forms. Every answer below is grounded in an audit of what the code actually does — see
[What the code actually does](#what-the-code-actually-does) at the bottom for the evidence.

- **Publisher (legal name):** badgames4eva
- **Support / privacy contact:** badgameseva@gmail.com
- **Developer / publisher website:** <https://badgames4eva.com>
  (its own repo, `badgames4eva_site` — it also hosts `app-ads.txt`, which the IAB spec
  requires at the root of the site named here; see [ADS_SETUP.md](ADS_SETUP.md))
- **Privacy policy URL:** <https://wordsondemand.badgames4eva.com/privacy>
  (source of truth: [PRIVACY.md](PRIVACY.md), rendered as [privacy.html](privacy.html), and
  mirrored in-app on the `#policy` screen in [index.html](index.html))
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
| Does the app link to external websites? | **No** — the privacy policy renders inside the app on its own screen; nothing navigates out. (The policy button is an `<a href>` only as a no-JS fallback; with JS alive it never leaves the app.) |
| Miscellaneous — unrestricted internet access | **No** — the app has no URL entry and no browsing surface |

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
| Developer / publisher website | <https://badgames4eva.com> — **the apex, not the game subdomain.** `app-ads.txt` is looked for at the root of whatever is entered here (see [ADS_SETUP.md](ADS_SETUP.md)); naming the subdomain means it's never found and ad demand suffers. |
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

---

## How to change the email, publisher name, or policy text

The contact email and publisher name are **duplicated across four files** — there's no
build step to interpolate them, so they're literal strings in each place. Miss one and the
in-app text disagrees with the hosted policy, which is exactly what a store reviewer
notices.

### Where each value lives

| Value | Files |
|---|---|
| Support / privacy email | [PRIVACY.md](PRIVACY.md), [privacy.html](privacy.html), [index.html](index.html), this file |
| Publisher name | [PRIVACY.md](PRIVACY.md), [privacy.html](privacy.html), [index.html](index.html), this file |
| Effective / Last updated date | [PRIVACY.md](PRIVACY.md), [privacy.html](privacy.html), [index.html](index.html) (`.policy-dates` on the `#policy` screen) |
| Policy body text | [PRIVACY.md](PRIVACY.md) and [privacy.html](privacy.html) (full), [index.html](index.html) (full text again on the `#policy` screen, plus a short summary in the `#howto` About block) |

Current values: **badgames4eva** / **badgameseva@gmail.com**

Don't trust a memorized occurrence count — ask the repo, since these numbers drift as the
docs grow:

```bash
grep -rc 'badgameseva@gmail.com' --include='*.md' --include='*.html' . | grep -v ':0'
```

### Changing the email or publisher name

From the repo root — swap the old and new values, then verify:

```bash
OLD='badgameseva@gmail.com'; NEW='your-new@email.com'
grep -rl "$OLD" --include='*.md' --include='*.html' . | xargs sed -i '' "s|$OLD|$NEW|g"
grep -rn "$OLD" --include='*.md' --include='*.html' .   # must print NOTHING
grep -rc "$NEW" --include='*.md' --include='*.html' .   # sanity-check the counts
```

Same pattern for the publisher name, but **don't** blanket-replace `badgames4eva` — it's
also in the domain `wordsondemand.badgames4eva.com`, and a global swap would break every
URL. Change those by hand (2 in PRIVACY.md, 2 in privacy.html, 1 in index.html, 1 here), or
anchor the match so it can't hit the domain:

```bash
grep -rn 'badgames4eva' --include='*.md' --include='*.html' . | grep -v 'badgames4eva\.com'
```

After any swap, confirm the URLs survived — this must still find the domain in every file
that had it:

```bash
grep -rc 'badgames4eva\.com' --include='*.md' --include='*.html' . | grep -v ':0'
```

Because [index.html](index.html) is a player-facing asset, an email/name change is a
**release**: bump the version in all four places and redeploy (see the *Deploy* section of
[README.md](README.md)). A change to PRIVACY.md / privacy.html / this file alone is
docs-only and needs no bump — but it *does* still need a push, since the hosted policy page
IS privacy.html.

### Changing the policy text itself

The policy now exists in **three** places, all of which must agree. There's no build step
to include it once, so this is manual — and a store reviewer can compare them:

| File | What it is |
|---|---|
| [PRIVACY.md](PRIVACY.md) | Source of truth. Edit here first. |
| [privacy.html](privacy.html) | The hosted page at the store-listing URL. Full text. |
| `#policy` section of [index.html](index.html) | The in-app screen a player actually reads. Condensed but must not contradict the other two. |

1. Edit [PRIVACY.md](PRIVACY.md) — treat it as the source of truth.
2. Mirror the change into [privacy.html](privacy.html). The HTML uses curly quotes and
   `&nbsp;`; match the surrounding style.
3. Mirror it into the `#policy` section of [index.html](index.html). This copy is shorter
   on purpose (it's read from a couch), so carry over the *substance*, not the wording —
   but never let it say less than the hosted page about what data leaves the device.
4. **Bump the "Last updated" date in all three** — including the `.policy-dates` line on
   the in-app screen. Leave "Effective date" alone unless the change is material (new data
   collected, personalized ads, analytics added) — for those, set a future effective date
   and ship the notice before the behavior changes.
5. If the change affects the in-app *summary* (accounts, storage, ad personalization),
   update the *About & Privacy* block in [index.html](index.html) too.
6. Editing index.html is a **release**: bump the build version in all four places.
7. Re-check the answers in this document — a policy change usually means a Data Safety
   change, and the two must agree.
8. Push, then confirm <https://wordsondemand.badgames4eva.com/privacy> serves the new text.
   Cloudflare redeploys in ~1 min.

### Verify after any change

```bash
node run-tests.js                                     # 87/87 — includes the date-sync check
grep -rn 'PUBLISHER_NAME\|CONTACT_EMAIL' . --include='*.md' --include='*.html'   # no placeholders left
curl -s https://wordsondemand.badgames4eva.com/privacy | grep -c 'your-new@email.com'
```

`node run-tests.js` now fails if the three copies' **"Last updated"** dates
disagree, which is the cheap proxy for "you forgot one" — nothing links the files,
so a missed copy shows up as a stale date. It does *not* diff the prose (the in-app
wording is legitimately shorter), so re-read the copies yourself for substance.

Then open **How to Play & About** in the app, read the summary, and press *Read Full
Privacy Policy* — that opens the in-app `#policy` screen, which is the copy a player
actually reads. Scroll it to the end with Down to confirm nothing is clipped and that the
D-pad reaches **Done**.

## When to revisit this document

- Changing the contact email or publisher name → follow the procedure above; four files
- Pasting real VAST tags into `CONFIG.vastTags` → nothing here changes (it already assumes
  ads are live), but verify `npa=1` is on the tag
- Switching to **personalized** ads → rewrite the ads declaration, add consent (CMP/GDPR
  + US state signals), and update the policy's advertising section
- Adding **any** analytics or crash reporting → new Data Safety data types, new policy text
- Adding accounts, cloud sync, or a leaderboard → personal data, a real deletion mechanism,
  and a substantially longer policy
- Adding in-app purchases → content-rating and store-listing changes
- Regenerating or expanding the `words.js` answer pool → re-run the content-rating check
