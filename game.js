/* ============================================================
   Words on Demand game logic
   - Remote-first: arrow keys = D-pad, Enter = OK, Backspace/Esc = Back
   - Spatial focus navigation across a 2D grid of .focusable elements
   - Interstitial ad only at natural break points (never mid-solve)
   ============================================================ */

// ---------------------------------------------------------------------------
// CONFIG — the one place for tunables. Kept as a plain object so it can later
// be overridden by remote config (Phase 4) or a per-platform build without
// hunting for magic numbers. Anything a product/monetization decision might
// change lives here; game logic reads from it.
// ---------------------------------------------------------------------------
const CONFIG = {
  wordLength: 5,          // letters per guess
  maxGuesses: 6,          // rows on the board
  storageKey: "wordsondemand.v1",
  revealDelayMs: 700,     // pause after the final guess before showing the result
  holdToWipeMs: 500,      // hold the remote's Rewind this long to clear the whole row
  adSeconds: {
    interstitial: 5,      // "one more round" break ad
    rewarded: 5,          // hint (rewarded video) — reward granted on completion
  },
  // ---- Real ads (Google IMA HTML5 SDK, serving VAST) -----------------------
  // The whole ad integration is gated on these two things being present:
  //   1) the IMA SDK script (loaded from index.html), and
  //   2) a VAST tag URL below.
  // When EITHER is missing, playAd() falls back to the built-in placeholder
  // countdown — so the browser demo, GitHub Pages, and the headless tests all
  // keep working with zero ad infrastructure. To go live, paste your Google Ad
  // Manager VAST tag URLs here (per placement) — no code change needed.
  //
  // AdMob is deliberately NOT used: it has no CTV/TV form-factor support and
  // running it on TV apps risks account bans. IMA+VAST is the web/WebView path
  // that works identically on Fire TV and Android TV.
  vastTags: {
    interstitial: null,   // e.g. "https://pubads.g.doubleclick.net/gampad/ads?..."
    rewarded: null,       // rewarded-hint VAST tag (may be the same GAM ad unit)
  },
  // Hard ceiling on how long we wait for the SDK to start an ad before giving
  // up and resuming play. An ad must never strand the player.
  adLoadTimeoutMs: 8000,
  // D-pad safety net. The IMA HTML5 SDK has no documented TV/remote support, so
  // its own ad UI (skip, click-through) may be UNREACHABLE by a D-pad. We serve
  // only non-skippable creatives (they auto-complete), but if an ad freezes
  // mid-play a player must never be trapped. After this long on the ad screen we
  // reveal a remote-focusable "Continue" button that resumes play. Set well
  // above a normal creative's length so it can't be used to skip a legit ad.
  adEscapeAfterMs: 32000,
  // Placeholder seam for Phase 4 remote word lists (ship new dailies without an
  // app update). null = use the built-in ANSWERS pool.
  wordListUrl: null,
};

// Convenience aliases so the hot paths stay readable.
const WORD_LEN = CONFIG.wordLength;
const MAX_GUESSES = CONFIG.maxGuesses;
const STORAGE_KEY = CONFIG.storageKey;

// ---------------------------------------------------------------------------
// Persisted stats (streaks, played, wins) — local only, no backend needed.
// ---------------------------------------------------------------------------
const store = {
  data: loadStore(),
  save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data)); },
};

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (!d.progress) d.progress = {}; // per-puzzle saved board (guesses + result)
      pruneForwardWalkArtifacts(d.progress);
      return d;
    }
  } catch (e) { /* fall through to defaults */ }
  return { streak: 0, played: 0, wins: 0, lastDay: null, progress: {} };
}

// One-more-round used to walk FORWARD, saving finished puzzles under future day
// indices. When such a day arrived, its daily puzzle opened already-finished and
// dumped the player onto the result screen. Extra rounds now walk backward, but
// existing saves may still hold those artifacts — clean them on load:
//   • any index in the future can only be a forward-walk artifact (a daily can
//     never be reached ahead of its day) -> always drop it.
//   • today's index is an artifact only if it was finished BEFORE today began
//     (its startedAt predates local midnight); a genuinely-played-today board
//     keeps its fresh timestamp and is preserved.
function pruneForwardWalkArtifacts(progress) {
  const today = dayIndexToday();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const midnightMs = midnight.getTime();
  for (const key of Object.keys(progress)) {
    const idx = Number(key);
    if (idx > today) { delete progress[key]; continue; }
    if (idx === today) {
      const startedAt = progress[key] && progress[key].startedAt;
      if (!startedAt || startedAt < midnightMs) delete progress[key];
    }
  }
}

// Absolute puzzle number for a given offset from today (also the store key).
function puzzleIndex(offset) { return dayIndexToday() + offset; }

// Persist the current board so leaving and returning resumes it (no restart /
// "reroll" of the same word — that would be cheating).
function saveProgress() {
  commitTimer(); // fold in any elapsed time so the saved total is current
  store.data.progress[puzzleIndex(game.roundOffset)] = {
    guesses: game.guesses.slice(),
    finished: game.finished,
    won: game.won,
    hintsUsed: game.hintsUsed,
    hintRow: game.hintRow, // row a hint was spent on (one-hint-per-row cap survives resume)
    hintReveal: game.hintReveal, // last revealed letter, so it persists across resume
    solveMs: game.solveMs, // active solve time (timer pauses off the game screen)
    startedAt: game.startedAt, // device time the puzzle was first opened
    answer: game.answer, // stored so history can render without re-deriving
  };
  store.save();
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const game = {
  answer: "",
  guesses: [],       // array of completed guess strings
  // In-progress row is positional (not a plain string) so we can carry down
  // known-correct letters. cells[i] is the letter in column i (or ""); locked[i]
  // marks a carried-down green that the player can't edit or delete — saves
  // re-typing letters they've already pinned, which matters most on a remote.
  cells: [],
  locked: [],
  finished: false,
  won: false,
  hintsUsed: 0,
  hintRow: -1,       // row index a hint was last spent on; caps hints at one/row
  hintReveal: null,  // {pos, letter} last revealed; shown under the button until next submit
  solveMs: 0,        // active solve time; the timer pauses off the game screen
  timerStart: null,  // Date.now() when the timer last resumed; null while paused
  startedAt: null,   // device wall-clock (Date.now()) when this puzzle was first opened
  roundOffset: 0,    // 0 = today's puzzle; grows with "one more round"
};

// keyStates: letter -> "correct" | "present" | "absent"
let keyStates = {};

// Answer words seen this session (resets on reload). "One more round" won't hand
// back a word already played, so a long sitting never repeats a solution — even
// though the pool wraps and two far-apart offsets can map to the same word.
let sessionAnswers = new Set();

// ---------------------------------------------------------------------------
// Screen management
// ---------------------------------------------------------------------------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("is-active"));
  document.getElementById(id).classList.add("is-active");
  activeScreen = id;
  // The solve timer only advances while the game board is on screen — it pauses
  // for ads, results, history, or stepping away. No timing pressure during play
  // (STEERING), but we can still record how long a solve actually took.
  if (id === "game") resumeTimer(); else pauseTimer();
  // Focus first focusable in the new screen — unless a modal is capturing focus.
  if (!modalEl) focusFirstIn(id);
}

// ---------------------------------------------------------------------------
// Solve timer — accumulates active game-screen time into game.solveMs. Paused
// whenever the board isn't the active screen so ads and idle time never count.
// ---------------------------------------------------------------------------
function resumeTimer() {
  if (game.finished) return;          // a completed puzzle's time is frozen
  if (game.timerStart === null) game.timerStart = Date.now();
}
function pauseTimer() {
  if (game.timerStart !== null) {
    game.solveMs += Date.now() - game.timerStart;
    game.timerStart = null;
  }
}
// Fold any in-flight elapsed time into solveMs without stopping the clock.
function commitTimer() {
  if (game.timerStart !== null) {
    const now = Date.now();
    game.solveMs += now - game.timerStart;
    game.timerStart = now;
  }
}
function formatDuration(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
// A short device-local "when you started" stamp for history, e.g.
// "Jul 24, 2026 · 3:07 PM". Returns "" for missing timestamps (older saves that
// predate this field) so the UI just omits the line rather than showing junk.
function formatStartedAt(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}
let activeScreen = "home";

// ---------------------------------------------------------------------------
// Focus / D-pad navigation
// Strategy: track focus as the nearest focusable in the intended direction,
// using on-screen geometry (getBoundingClientRect) so any layout just works.
// ---------------------------------------------------------------------------
let focusedEl = null;
// When a modal (the exit dialog) is open it captures all D-pad focus, so
// navigation is scoped to it instead of the underlying screen. null = no modal.
let modalEl = null;
let modalReturnFocus = null; // element to re-focus when the modal closes

function setFocus(el) {
  if (!el) return;
  if (focusedEl) focusedEl.classList.remove("is-focused");
  focusedEl = el;
  focusedEl.classList.add("is-focused");
}

function focusablesInEl(el) {
  if (!el) return [];
  return Array.from(el.querySelectorAll(".focusable"))
    .filter((e) => e.offsetParent !== null); // visible only
}
function focusablesIn(screenId) { return focusablesInEl(document.getElementById(screenId)); }

// The element focus is currently scoped to: the open modal, else the screen.
function focusRoot() { return modalEl || document.getElementById(activeScreen); }

function focusFirstInEl(el) {
  const items = focusablesInEl(el);
  if (items.length) setFocus(items[0]);
  else focusedEl = null;
}
function focusFirstIn(screenId) { focusFirstInEl(document.getElementById(screenId)); }

// Horizontal wrap within a keyboard row: given the focused key's value and a
// direction, return the key Left/Right should land on, wrapping at the ends so
// the row is a loop (P⇄Q, L⇄A, ENTER⇄Z). Returns null when `key` isn't one of
// the keyboard keys, so the caller falls back to geometric navigation. Pure
// over KB_LAYOUT, so it's unit-tested without a DOM.
function nextKeyInRow(key, dir) {
  for (const rowKeys of KB_LAYOUT) {
    const i = rowKeys.indexOf(key);
    if (i === -1) continue;
    const n = rowKeys.length;
    const j = dir === "right" ? (i + 1) % n : (i - 1 + n) % n;
    return rowKeys[j];
  }
  return null;
}

function moveFocus(dir) {
  const items = focusablesInEl(focusRoot());
  if (!focusedEl || items.length === 0) { focusFirstInEl(focusRoot()); return; }

  // On the on-screen keyboard, Left/Right loop within the row so no key dead-ends
  // at a row edge — fewer D-pad presses to cross the board, and the remote's
  // left/right always does something predictable.
  if ((dir === "left" || dir === "right") &&
      focusedEl.dataset && focusedEl.dataset.navGroup === "keyboard") {
    const target = nextKeyInRow(focusedEl.dataset.key, dir);
    if (target != null) {
      const el = items.find((e) => e.dataset && e.dataset.key === target);
      if (el) { setFocus(el); return; }
    }
  }

  const best = pickInDirection(
    focusedEl.getBoundingClientRect(),
    items.filter((el) => el !== focusedEl)
         .map((el) => ({ el, rect: el.getBoundingClientRect() })),
    dir,
  );
  if (best) setFocus(best.el);
}

// Pure geometric focus decision: given the focused element's rect, the candidate
// {el, rect} pairs, and a direction, return the winning candidate (or null).
// Split out of moveFocus (which only supplies the DOM) so the D-pad's landing
// choice — the single most critical interaction — is unit-tested against real
// keyboard geometry, no browser needed. `rect` is any {left,top,width,height}.
function pickInDirection(cur, candidates, dir) {
  const curX = cur.left + cur.width / 2;
  const curY = cur.top + cur.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    const r = cand.rect;
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - curX;
    const dy = y - curY;

    // Reject candidates not in the requested direction.
    if (dir === "up" && dy >= -1) continue;
    if (dir === "down" && dy <= 1) continue;
    if (dir === "left" && dx >= -1) continue;
    if (dir === "right" && dx <= 1) continue;

    // Primary axis distance must dominate so the *nearest* row/column always wins:
    // an aligned element two rows away must never beat an offset element one row
    // away. (Keyboard rows have different key counts and are centered, so adjacent
    // rows are misaligned by up to ~half a key — weighting `along` heavily keeps
    // Down/Up from skipping the middle row toward a better-aligned far one.)
    const along = (dir === "up" || dir === "down") ? Math.abs(dy) : Math.abs(dx);
    const perp  = (dir === "up" || dir === "down") ? Math.abs(dx) : Math.abs(dy);
    const score = along * 3 + perp;

    if (score < bestScore) { bestScore = score; best = cand; }
  }

  return best;
}

function activateFocused() {
  if (focusedEl) focusedEl.click();
}

// ---------------------------------------------------------------------------
// Modal overlay (the exit-confirmation dialog). Captures D-pad focus while open.
// ---------------------------------------------------------------------------
function openModal(id, defaultFocusId) {
  const el = document.getElementById(id);
  if (!el) return;
  modalReturnFocus = focusedEl; // restore focus here on close
  modalEl = el;
  el.hidden = false;
  const def = defaultFocusId && document.getElementById(defaultFocusId);
  if (def) setFocus(def); else focusFirstInEl(el);
}

function closeModal() {
  if (!modalEl) return;
  modalEl.hidden = true;
  modalEl = null;
  // Return focus to wherever it was, if that element is still visible.
  if (modalReturnFocus && modalReturnFocus.offsetParent !== null) setFocus(modalReturnFocus);
  else focusFirstInEl(focusRoot());
  modalReturnFocus = null;
}

function isModalOpen() { return modalEl !== null; }
function getActiveScreen() { return activeScreen; }

// ---------------------------------------------------------------------------
// Global key handling — the remote contract
// ---------------------------------------------------------------------------
// Track the last input device. On a real TV there are no letter keys, so you
// navigate with the D-pad and press OK (Enter) on the on-screen ENTER key. When
// testing on a desktop keyboard you type letters directly — in that mode Enter
// should submit the guess, not "click" whatever happens to be focused (which
// starts on the Back button). This flag keeps the two input styles from fighting.
let inputMode = "dpad"; // "dpad" | "keyboard"

document.addEventListener("keydown", (e) => {
  // Ad screen swallows input until countdown finishes.
  if (activeScreen === "ad") { e.preventDefault(); return; }

  switch (e.key) {
    case "ArrowUp":    inputMode = "dpad"; moveFocus("up");    e.preventDefault(); break;
    case "ArrowDown":  inputMode = "dpad"; moveFocus("down");  e.preventDefault(); break;
    case "ArrowLeft":  inputMode = "dpad"; moveFocus("left");  e.preventDefault(); break;
    case "ArrowRight": inputMode = "dpad"; moveFocus("right"); e.preventDefault(); break;
    case "Enter":
      // OK / center-select: activate whatever key is focused (type a letter,
      // press ENTER/DEL). In desktop keyboard-typing mode, Enter submits.
      if (activeScreen === "game" && inputMode === "keyboard") onKeyPress("ENTER");
      else activateFocused();
      e.preventDefault();
      break;
    // Remote's Play / Play-Pause button is a dedicated SUBMIT shortcut while
    // solving — press it from anywhere on the board to enter the current guess,
    // no need to D-pad over to the ENTER key first (fewer clicks). Off the game
    // screen it falls back to acting as OK / Select.
    case "MediaPlay":
    case "MediaPlayPause":
      if (activeScreen === "game" && !game.finished) submitGuess();
      else activateFocused();
      e.preventDefault();
      break;
    // Remote's Rewind button is DELETE while solving: tap = one letter, hold =
    // wipe the whole row (see rewindPress/rewindRelease). Anywhere else it's a
    // no-op so it can't hijack navigation.
    case "MediaRewind":
    case "MediaTrackPrevious":
      if (activeScreen === "game" && !game.finished) rewindPress();
      e.preventDefault();
      break;
    case "Backspace":
    case "Escape":
      handleBack();
      e.preventDefault();
      break;
    default:
      // Convenience for desktop testing: physical letter keys type into game.
      if (activeScreen === "game" && /^[a-zA-Z]$/.test(e.key)) {
        inputMode = "keyboard";
        typeLetter(e.key.toUpperCase());
      }
  }
});

// Rewind is a press/hold gesture, so its action fires on release (keyup).
document.addEventListener("keyup", (e) => {
  if (e.key === "MediaRewind" || e.key === "MediaTrackPrevious") {
    if (activeScreen === "game") rewindRelease();
    e.preventDefault();
  }
});

function handleBack() {
  // A local Escape/Backspace on desktop mirrors the native BACK on a modal:
  // close it first rather than navigating underneath it.
  if (isModalOpen()) { closeModal(); return; }
  if (activeScreen === "game") {
    // Backspace deletes a typed letter; if there's nothing editable to remove,
    // go home. Locked greens don't count — Back from a greens-only row exits.
    const hasEditable = !game.finished &&
      game.cells.some((ch, i) => ch !== "" && !game.locked[i]);
    if (hasEditable) removeLetter();
    else showScreen("home");
  } else if (activeScreen === "howto" || activeScreen === "result") {
    showScreen("home");
  }
}

// ---------------------------------------------------------------------------
// Board + keyboard rendering
// ---------------------------------------------------------------------------
const KB_LAYOUT = [
  "QWERTYUIOP".split(""),
  "ASDFGHJKL".split(""),
  // DEL and ENTER both on the right (ENTER as a → arrow), like a phone keyboard.
  ["ZXCVBNM".split(""), "DEL", "ENTER"].flat(),
];

function buildBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "board-row";
    row.dataset.row = r;
    for (let c = 0; c < WORD_LEN; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.row = r;
      tile.dataset.col = c;
      row.appendChild(tile);
    }
    board.appendChild(row);
  }
}

// Transport icons for the ENTER/DEL keys, mirroring the physical remote's
// Play/pause and Rewind buttons. Inline SVG (not emoji) so they render
// identically across the Fire OS WebView, Vega, and desktop browsers — see the
// note in buildKeyboard(). `fill="currentColor"` inherits the key's text color;
// aria-hidden because the button carries its own aria-label.
const ICON_REWIND =
  '<svg class="key-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M11 6v12L3 12zM21 6v12l-8-6z"/></svg>';
const ICON_PLAY_PAUSE =
  '<svg class="key-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">' +
  '<path d="M3 6v12l8-6zM14 6h2.6v12H14zM18.4 6H21v12h-2.6z"/></svg>';

function buildKeyboard() {
  const kb = document.getElementById("keyboard");
  kb.innerHTML = "";
  for (const rowKeys of KB_LAYOUT) {
    const row = document.createElement("div");
    row.className = "kb-row";
    for (const k of rowKeys) {
      const key = document.createElement("button");
      key.className = "key focusable" + (k.length > 1 ? " key-wide" : "") +
        (k === "ENTER" ? " key-enter" : "") + (k === "DEL" ? " key-del" : "");
      key.dataset.navGroup = "keyboard";
      key.dataset.key = k;
      // ENTER/DEL are the two actions bound to remote media keys. Show the
      // matching remote glyph (ENTER = Play/pause, DEL = Rewind, same icons as
      // the physical Fire TV remote) AND a word caption underneath, so the
      // glyph teaches the remote mapping while the text removes any doubt about
      // what the button does. Letter keys stay plain text.
      //
      // The glyphs are INLINE SVG, not emoji (⏪/⏯). Emoji have no intrinsic
      // color or shape — every platform paints them with its own emoji font, so
      // the same characters came out blue/grey in the Fire OS WebView and orange
      // on Vega. SVG paths filled with currentColor render identically on every
      // platform and inherit the key's text color.
      if (k === "DEL" || k === "ENTER") {
        const glyph = k === "DEL" ? ICON_REWIND : ICON_PLAY_PAUSE;
        const caption = k === "DEL" ? "Erase" : "Enter";
        key.innerHTML =
          `<span class="key-glyph">${glyph}</span><span class="key-caption">${caption}</span>`;
        key.setAttribute("aria-label",
          k === "DEL" ? "Erase (remote Rewind)" : "Enter (remote Play/Pause)");
      } else {
        key.textContent = k;
      }
      key.addEventListener("click", () => onKeyPress(k));
      row.appendChild(key);
    }
    kb.appendChild(row);
  }
}

function onKeyPress(k) {
  if (game.finished) return;
  if (k === "ENTER") submitGuess();
  else if (k === "DEL") removeLetter();
  else typeLetter(k);
}

// ---------------------------------------------------------------------------
// Typing (positional: cells[] + locked[])
// ---------------------------------------------------------------------------

// Columns known to be correct from prior guesses in this round. Carried down so
// the player never re-types a pinned letter. Returns a per-column letter or "".
function knownGreens() {
  const greens = new Array(WORD_LEN).fill("");
  for (const guess of game.guesses) {
    for (let i = 0; i < WORD_LEN; i++) {
      if (guess[i] === game.answer[i]) greens[i] = game.answer[i];
    }
  }
  return greens;
}

// Seed a fresh input row: pre-fill and lock every known-green column.
function resetCurrentRow() {
  const greens = knownGreens();
  game.cells = greens.slice();
  game.locked = greens.map((g) => g !== "");
}

// The joined guess string (only complete once every column is filled).
function currentGuess() { return game.cells.join(""); }
function currentFilledCount() { return game.cells.filter((c) => c !== "").length; }

// First editable empty column — where the next typed letter lands and where the
// cursor shows. Returns -1 when the row is full.
function nextEditableCol() {
  for (let i = 0; i < WORD_LEN; i++) {
    if (!game.locked[i] && game.cells[i] === "") return i;
  }
  return -1;
}

function typeLetter(letter) {
  if (game.finished) return;
  const c = nextEditableCol();
  if (c === -1) return; // row full
  game.cells[c] = letter;
  renderCurrentRow();
}

function removeLetter() {
  if (game.finished) return;
  // Delete the last editable, filled column (never a locked green).
  for (let i = WORD_LEN - 1; i >= 0; i--) {
    if (!game.locked[i] && game.cells[i] !== "") { game.cells[i] = ""; break; }
  }
  renderCurrentRow();
}

// Clear the ENTIRE in-progress row, including carried-down greens — the payoff
// for holding the remote's Rewind button. Only affects the current edit; the
// greens are re-derived from game.guesses on the next row, so this doesn't erase
// history, it just lets the player abandon a pinned start and type freely.
function wipeCurrentRow() {
  if (game.finished) return;
  game.cells = new Array(WORD_LEN).fill("");
  game.locked = new Array(WORD_LEN).fill(false);
  renderCurrentRow();
}

// Rewind-button gesture: a quick tap deletes one letter; holding past
// CONFIG.holdToWipeMs wipes the whole row. Implemented as press/release so it
// works for a remote key (keydown/keyup) and is unit-testable without the DOM.
const rewindHold = { timer: null, wiped: false, holding: false };
function rewindPress() {
  if (rewindHold.holding) return; // ignore keydown auto-repeat while held
  rewindHold.holding = true;
  rewindHold.wiped = false;
  rewindHold.timer = setTimeout(() => {
    wipeCurrentRow();
    rewindHold.wiped = true;
    rewindHold.timer = null;
  }, CONFIG.holdToWipeMs);
}
function rewindRelease() {
  if (!rewindHold.holding) return;
  rewindHold.holding = false;
  if (rewindHold.timer) { clearTimeout(rewindHold.timer); rewindHold.timer = null; }
  if (!rewindHold.wiped) removeLetter(); // released before the wipe fired => a tap
  rewindHold.wiped = false;
}

function renderCurrentRow() {
  const r = game.guesses.length;
  const row = document.querySelector(`.board-row[data-row="${r}"]`);
  if (!row) return;
  const cursor = nextEditableCol();
  const tiles = row.querySelectorAll(".tile");
  tiles.forEach((tile, c) => {
    const ch = game.cells[c] || "";
    tile.textContent = ch;
    tile.classList.toggle("filled", !!ch && !game.locked[c]);
    tile.classList.toggle("locked", !!game.locked[c]);
    tile.classList.toggle("cursor", c === cursor);
  });
}

// ---------------------------------------------------------------------------
// Guess submission + scoring
// ---------------------------------------------------------------------------
function submitGuess() {
  if (currentFilledCount() < WORD_LEN) { shakeRow(); toast("Not enough letters"); return; }
  const guessed = currentGuess();
  if (!VALID_GUESSES.has(guessed)) { shakeRow(); toast("Not in word list"); return; }

  const scores = scoreGuess(guessed, game.answer);
  paintRow(game.guesses.length, guessed, scores);
  updateKeyStates(guessed, scores);

  game.guesses.push(guessed);
  game.hintReveal = null; // the reveal was for this row; clear it for the next guess
  renderHintReveal();
  resetCurrentRow(); // seed the next row with any (now larger) set of greens

  if (guessed === game.answer) {
    game.finished = true; game.won = true;
    pauseTimer(); // freeze solve time at the winning guess, before the reveal delay
    setTimeout(endRound, CONFIG.revealDelayMs);
  } else if (game.guesses.length >= MAX_GUESSES) {
    game.finished = true; game.won = false;
    pauseTimer();
    setTimeout(endRound, CONFIG.revealDelayMs);
  } else {
    renderCurrentRow(); // show carried-down greens + cursor on the new row
    refreshHintButton(); // new row => a fresh hint becomes available
  }
  saveProgress();
}

// Standard Wordle scoring with duplicate-letter handling.
function scoreGuess(guess, answer) {
  const scores = new Array(WORD_LEN).fill("absent");
  const counts = {};
  for (const ch of answer) counts[ch] = (counts[ch] || 0) + 1;

  // First pass: exact matches.
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === answer[i]) { scores[i] = "correct"; counts[guess[i]]--; }
  }
  // Second pass: present-but-misplaced.
  for (let i = 0; i < WORD_LEN; i++) {
    if (scores[i] === "correct") continue;
    const ch = guess[i];
    if (counts[ch] > 0) { scores[i] = "present"; counts[ch]--; }
  }
  return scores;
}

function paintRow(r, guess, scores) {
  const row = document.querySelector(`.board-row[data-row="${r}"]`);
  const tiles = row.querySelectorAll(".tile");
  tiles.forEach((tile, c) => {
    tile.textContent = guess[c];
    // Stagger the reveal for a satisfying flip feel.
    setTimeout(() => {
      tile.classList.remove("filled");
      tile.classList.add(scores[c]);
    }, c * 120);
  });
}

function updateKeyStates(guess, scores) {
  const rank = { absent: 0, present: 1, correct: 2 };
  for (let i = 0; i < WORD_LEN; i++) {
    const ch = guess[i];
    const s = scores[i];
    if (!keyStates[ch] || rank[s] > rank[keyStates[ch]]) keyStates[ch] = s;
  }
  document.querySelectorAll(".key").forEach((key) => {
    const k = key.dataset.key;
    if (keyStates[k]) {
      key.classList.remove("correct", "present", "absent");
      key.classList.add(keyStates[k]);
    }
  });
}

function shakeRow() {
  const r = game.guesses.length;
  const row = document.querySelector(`.board-row[data-row="${r}"]`);
  if (!row) return;
  row.classList.add("shake");
  setTimeout(() => row.classList.remove("shake"), 400);
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
function startRound(offset) {
  game.roundOffset = offset;
  game.answer = extraPuzzle(offset);
  keyStates = {};
  sessionAnswers.add(game.answer);

  buildBoard();
  buildKeyboard();

  // Resume any saved progress for this exact puzzle, so leaving and coming back
  // continues the same board instead of restarting it.
  const saved = store.data.progress[puzzleIndex(offset)];
  game.guesses = saved ? saved.guesses.slice() : [];
  game.finished = saved ? saved.finished : false;
  game.won = saved ? saved.won : false;
  game.hintsUsed = saved ? (saved.hintsUsed || 0) : 0;
  game.hintRow = saved && saved.hintRow != null ? saved.hintRow : -1;
  game.hintReveal = saved && saved.hintReveal ? saved.hintReveal : null;
  game.solveMs = saved ? (saved.solveMs || 0) : 0;
  // First-open device timestamp: keep the saved one on resume, else stamp now.
  game.startedAt = (saved && saved.startedAt) ? saved.startedAt : Date.now();
  game.timerStart = null; // showScreen("game") will resume it if unfinished
  replayGuesses();
  resetCurrentRow();       // carry down greens from any resumed guesses

  document.getElementById("puzzle-no").textContent = puzzleIndex(offset);
  renderHeaderStreak();

  // A puzzle that's already been completed goes straight to its result — no replay.
  if (game.finished) { renderResult(); showScreen("result"); return; }

  renderCurrentRow();      // paint carried-down greens + cursor before showing
  refreshHintButton();     // reflect one-per-row / last-letter rules for this board
  renderHintReveal();      // restore a persisted reveal (if the hint's still live)
  showScreen("game");
}

// Paint saved guesses back onto a fresh board (instant, no flip animation).
function replayGuesses() {
  game.guesses.forEach((guess, r) => {
    const scores = scoreGuess(guess, game.answer);
    const row = document.querySelector(`.board-row[data-row="${r}"]`);
    const tiles = row.querySelectorAll(".tile");
    tiles.forEach((tile, c) => {
      tile.textContent = guess[c];
      tile.classList.remove("filled");
      tile.classList.add(scores[c]);
    });
    updateKeyStates(guess, scores);
  });
}

function endRound() {
  // Update persisted stats. Streak logic only advances the daily puzzle once
  // per calendar day; "one more round" puzzles are for fun and don't inflate it.
  store.data.played += 1;
  if (game.won) store.data.wins += 1;

  const today = dayIndexToday();
  if (game.roundOffset === 0 && store.data.lastDay !== today) {
    if (game.won) {
      store.data.streak = (store.data.lastDay === today - 1 || store.data.streak === 0)
        ? store.data.streak + 1
        : 1;
    } else {
      store.data.streak = 0;
    }
    store.data.lastDay = today;
  }
  store.save();

  renderResult();
  showScreen("result");
}

function renderResult() {
  document.getElementById("result-title").textContent = game.won ? "Solved! 🎉" : "So close!";
  document.getElementById("result-word").innerHTML = game.won
    ? `You got it in ${game.guesses.length} ${game.guesses.length === 1 ? "guess" : "guesses"}.`
    : `The word was <strong>${game.answer}</strong>.`;
  document.getElementById("result-streak").textContent = store.data.streak;
  document.getElementById("result-guesses").textContent = game.won ? game.guesses.length : "—";
  document.getElementById("result-hints").textContent = game.hintsUsed;
  document.getElementById("result-time").textContent =
    game.won && game.solveMs > 0 ? formatDuration(game.solveMs) : "—";

  // Mini grid recap.
  const grid = document.getElementById("result-grid");
  grid.innerHTML = "";
  for (const g of game.guesses) {
    const scores = scoreGuess(g, game.answer);
    const row = document.createElement("div");
    row.className = "mini-row";
    for (const s of scores) {
      const cell = document.createElement("div");
      cell.className = "mini " + s;
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Ads — shown at natural breaks only (interstitial between rounds; opt-in
// rewarded video for the hint). Both funnel through playAd(); the only
// difference is placement (which VAST tag) and what onDone does.
//
// playAd is the single integration seam. When a real VAST tag is configured
// AND the Google IMA SDK is present it plays a real video ad; otherwise it
// falls back to a placeholder countdown so the browser demo and headless tests
// keep working with no ad infrastructure. Whatever happens — ad completes, is
// skipped, errors, doesn't fill, or the SDK never loads — onDone fires EXACTLY
// once. An ad must never strand the player.
// ---------------------------------------------------------------------------
let adPlaying = false;
function playAd(seconds, onDone, placement) {
  // Never start a second ad while one is showing. Without this guard, a stray
  // extra activation (double-click, Enter + click, a lingering timer) can stack
  // two ads — and on a real ad SDK, invoking it re-entrantly is undefined
  // behavior. This is the production-correct rule: one ad at a time.
  if (adPlaying) return;
  adPlaying = true;

  // Wrap onDone so it can only ever resume gameplay once, and always releases
  // the one-ad-at-a-time latch AND tears down the escape button. Every terminal
  // branch below (ad done, error, timeout, D-pad escape) calls resume().
  let resumed = false;
  const resume = () => {
    if (resumed) return;
    resumed = true;
    adPlaying = false;
    hideAdEscape();
    onDone();
  };

  showScreen("ad");
  armAdEscape(resume); // D-pad safety net in case an ad's own controls can't be reached

  const vastTag = CONFIG.vastTags && placement ? CONFIG.vastTags[placement] : null;
  if (vastTag && imaAvailable()) {
    playImaAd(vastTag, resume);
  } else {
    playPlaceholderAd(seconds, resume);
  }
}

// The ad screen's D-pad escape hatch. Hidden while an ad plays; after
// CONFIG.adEscapeAfterMs it appears, takes focus, and a press resumes play via
// the SAME resume() as every other terminal path — so a frozen/unreachable ad
// can never trap a remote-only player. Kept deliberately slow to reveal so it
// isn't an early-skip button on a legit non-skippable creative.
let adEscapeTimer = null;
function armAdEscape(resume) {
  const btn = document.getElementById("btn-ad-continue");
  if (!btn) return;
  btn.hidden = true;
  btn.onclick = resume;
  if (adEscapeTimer) { clearTimeout(adEscapeTimer); adEscapeTimer = null; }
  const delay = (CONFIG.adEscapeAfterMs > 0) ? CONFIG.adEscapeAfterMs : 32000;
  adEscapeTimer = setTimeout(() => {
    // Only surface it if we're still on the ad screen (ad hasn't already ended).
    if (getActiveScreen() !== "ad") return;
    btn.hidden = false;
    setFocus(btn);
  }, delay);
}
function hideAdEscape() {
  if (adEscapeTimer) { clearTimeout(adEscapeTimer); adEscapeTimer = null; }
  const btn = document.getElementById("btn-ad-continue");
  if (btn) { btn.hidden = true; btn.onclick = null; }
}

// Is the Google IMA HTML5 SDK loaded? (lazy-loaded by ensureImaSdk below;
// absent in the plain-browser demo and in the headless test sandbox.)
function imaAvailable() {
  return typeof google !== "undefined" && google.ima && google.ima.AdsLoader;
}

// Lazy-load the IMA SDK (~488 KB) instead of requesting it in index.html, so it
// never competes with the initial render on a cold TV start. Called on the first
// "Play" — long before the first ad can occur (an ad needs a finished round) —
// so the SDK is warm by the time playAd() looks for it.
//
// Deliberately fire-and-forget: nothing in the render path or playAd() awaits
// this. If it's slow, offline, blocked, or 404s, imaAvailable() simply stays
// false and playAd() runs the placeholder. No-ops when no VAST tag is configured
// (nothing to serve) and when the SDK is already present or in flight.
const IMA_SDK_URL = "https://imasdk.googleapis.com/js/sdkloader/ima3.js";
let imaSdkRequested = false;
function ensureImaSdk() {
  if (imaSdkRequested || imaAvailable()) return;
  if (typeof document === "undefined") return;
  const tags = CONFIG.vastTags || {};
  if (!tags.interstitial && !tags.rewarded) return; // no real ads configured
  imaSdkRequested = true;
  const s = document.createElement("script");
  s.src = IMA_SDK_URL;
  s.async = true;
  s.onerror = () => { imaSdkRequested = false; }; // allow a retry on a later Play
  document.head.appendChild(s);
}

// Fallback "ad": the original faux-video countdown. Used whenever real ads
// aren't wired (no VAST tag) or the SDK isn't present.
function playPlaceholderAd(seconds, resume) {
  const bar = document.getElementById("ad-bar");
  const count = document.getElementById("ad-count");
  let elapsed = 0;
  if (bar) bar.style.width = "0%";
  if (count) count.textContent = seconds;

  const tick = setInterval(() => {
    elapsed += 0.1;
    const pct = Math.min(100, (elapsed / seconds) * 100);
    if (bar) bar.style.width = pct + "%";
    if (count) count.textContent = Math.max(0, Math.ceil(seconds - elapsed));
    if (elapsed >= seconds) {
      clearInterval(tick);
      resume();
    }
  }, 100);
}

// Real video ad via the Google IMA HTML5 SDK. Requests the VAST tag, plays the
// ad inside #ad-box, and calls resume() on ANY terminal outcome — completion,
// skip, error, no-fill, or a load timeout. Defensive throughout: a thrown SDK
// error can't wedge the player because both the catch and the timeout resume.
function playImaAd(vastTag, resume) {
  const host = document.getElementById("ad-box");
  if (!host) { resume(); return; }

  // Backstop: if the SDK never starts an ad (slow network, no fill and no error
  // callback), resume anyway after the configured ceiling.
  const guardMs = (CONFIG.adLoadTimeoutMs > 0) ? CONFIG.adLoadTimeoutMs : 8000;
  let timeout = setTimeout(finish, guardMs);
  let adsManager = null;
  function finish() {
    if (timeout) { clearTimeout(timeout); timeout = null; }
    try { if (adsManager) adsManager.destroy(); } catch (e) { /* ignore */ }
    adsManager = null;
    resume();
  }

  try {
    // IMA renders over a content element; we have no content video, so a bare
    // container inside the ad box is enough for a standalone ad break.
    const adContainer = document.createElement("div");
    adContainer.className = "ima-ad-container";
    host.appendChild(adContainer);

    const adDisplayContainer = new google.ima.AdDisplayContainer(adContainer);
    // Must be called synchronously off a user gesture — the OK/Play press that
    // triggered this ad qualifies on CTV.
    adDisplayContainer.initialize();

    const adsLoader = new google.ima.AdsLoader(adDisplayContainer);
    adsLoader.addEventListener(
      google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      (e) => {
        // Cancel the load-timeout now that an ad is actually starting.
        if (timeout) { clearTimeout(timeout); timeout = null; }
        try {
          adsManager = e.getAdsManager(adContainer);
          const done = google.ima.AdEvent.Type;
          adsManager.addEventListener(done.ALL_ADS_COMPLETED, finish);
          adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, finish);
          const w = host.clientWidth || 1280;
          const h = host.clientHeight || 720;
          adsManager.init(w, h, google.ima.ViewMode.NORMAL);
          adsManager.start();
        } catch (err) { finish(); }
      },
      false
    );
    // Any loader error (bad tag, no fill, network) resumes play.
    adsLoader.addEventListener(
      google.ima.AdErrorEvent.Type.AD_ERROR, finish, false
    );

    const req = new google.ima.AdsRequest();
    req.adTagUrl = vastTag;
    req.linearAdSlotWidth = host.clientWidth || 1280;
    req.linearAdSlotHeight = host.clientHeight || 720;
    adsLoader.requestAds(req);
  } catch (err) {
    finish();
  }
}

// ---------------------------------------------------------------------------
// Hint — rewarded video pattern: opt-in, reveals one random unknown letter.
// Rules: one hint per row (resets when you submit and move to the next row);
// disabled once only a single unknown letter remains (revealing it would just
// hand over the answer); disabled when the row is already solved-by-greens.
// ---------------------------------------------------------------------------

// Columns whose correct letter hasn't surfaced as a green in any prior guess.
function unrevealedColumns() {
  const revealed = new Set();
  game.guesses.forEach((g) => {
    for (let i = 0; i < WORD_LEN; i++) if (g[i] === game.answer[i]) revealed.add(i);
  });
  const cols = [];
  for (let i = 0; i < WORD_LEN; i++) if (!revealed.has(i)) cols.push(i);
  return cols;
}

// A hint is offered only when: the puzzle's live, no hint spent on THIS row yet,
// and there are at least TWO unknown letters (never reveal the last one).
function hintAvailable() {
  return hintDisabledReason() === null;
}

// WHY a hint isn't available right now (or null if it is). Lets the button
// explain itself instead of just greying out — a dead-end control confuses.
//   "used"      -> already spent a hint on this row; comes back next guess
//   "last"      -> only one unknown letter left; revealing it = the answer
//   "finished"  -> the round's over
function hintDisabledReason() {
  if (game.finished) return "finished";
  if (game.hintRow === game.guesses.length) return "used";
  if (unrevealedColumns().length < 2) return "last";
  return null;
}

// Repaint the hint button to match its state. When available it invites a tap
// ("Reveal a Letter" + "Watch Ad"); when disabled it dims AND swaps in the
// reason so the player knows why (and, for the common case, that another hint
// returns next row). Stays focusable so D-pad focus never strands.
const HINT_COPY = {
  available: { text: "Reveal a Letter", badge: "Watch Ad" },
  used:      { text: "Next hint after your next guess", badge: "" },
  last:      { text: "Just one letter left!", badge: "" },
  finished:  { text: "Reveal a Letter", badge: "" },
};
function refreshHintButton() {
  const btn = document.getElementById("btn-hint");
  if (!btn) return;
  const reason = hintDisabledReason();
  const copy = HINT_COPY[reason || "available"];

  btn.classList.toggle("is-disabled", reason !== null);
  btn.setAttribute("aria-disabled", reason !== null ? "true" : "false");

  const textEl = btn.querySelector(".hint-text");
  const badgeEl = btn.querySelector(".hint-badge");
  if (textEl) textEl.textContent = copy.text;
  if (badgeEl) { badgeEl.textContent = copy.badge; badgeEl.hidden = !copy.badge; }

  btn.setAttribute("aria-label",
    reason === "used" ? "Your next hint unlocks after your next guess"
    : reason === "last" ? "No hint — only one letter left to find"
    : "Reveal a letter — watch an ad");
}

function useHint() {
  if (!hintAvailable()) return;
  const candidates = unrevealedColumns();
  const rowAtRequest = game.guesses.length; // pin the row the hint is spent on

  playAd(CONFIG.adSeconds.rewarded, () => {
    // Reward granted only after the ad's terminal callback (rewarded pattern).
    // Pick a RANDOM unknown column, not the left-most, so hints don't leak the
    // word left-to-right. Vary by a non-persisted draw (fine for a UX sprinkle).
    const pos = candidates[Math.floor(Math.random() * candidates.length)];
    game.hintsUsed += 1;
    game.hintRow = rowAtRequest; // burn the hint for this row
    game.hintReveal = { pos, letter: game.answer[pos] }; // persist under the button
    saveProgress();
    showScreen("game");
    refreshHintButton();
    renderHintReveal();
  }, "rewarded");
}

// Show the persisted reveal under the hint button. It stays put until the next
// guess is submitted (submitGuess clears game.hintReveal), so a player who
// glanced away doesn't lose it the way a 1.6s toast disappears.
function renderHintReveal() {
  const el = document.getElementById("hint-reveal");
  if (!el) return;
  const r = game.hintReveal;
  if (!r) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = `Letter ${r.pos + 1} is “${r.letter}”`;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastEl = null;
let toastTimer = null;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
}

// ---------------------------------------------------------------------------
// Home stats + wiring
// ---------------------------------------------------------------------------
// Game-header streak: hide it at 0 (a bare flame with 0 confuses more than it
// motivates), otherwise show the count + a "Streak" label with an aria summary.
function renderHeaderStreak() {
  const wrap = document.getElementById("header-streak");
  if (!wrap) return;
  const n = store.data.streak;
  wrap.hidden = n < 1;
  document.getElementById("game-streak").textContent = n;
  wrap.setAttribute("aria-label", `${n} day streak`);
}

function renderHomeStats() {
  document.getElementById("home-streak").textContent = store.data.streak;
  document.getElementById("home-played").textContent = store.data.played;
  const pct = store.data.played ? Math.round((store.data.wins / store.data.played) * 100) : 0;
  document.getElementById("home-winpct").textContent = pct + "%";

  const solvedToday = store.data.lastDay === dayIndexToday();
  document.getElementById("daily-note").textContent = solvedToday
    ? "You've played today's puzzle. Try one more round!"
    : "A fresh word is waiting.";
}

// ---------------------------------------------------------------------------
// History — a list of completed puzzles, most recent first, built from the same
// per-puzzle progress store used for resume. Shows result, guesses, and hints.
// ---------------------------------------------------------------------------
function renderHistory() {
  const entries = Object.entries(store.data.progress)
    .map(([idx, p]) => ({ idx: Number(idx), ...p }))
    .filter((p) => p.finished)
    .sort((a, b) => b.idx - a.idx);

  const summary = document.getElementById("history-summary");
  const solved = entries.filter((p) => p.won).length;
  const totalHints = entries.reduce((n, p) => n + (p.hintsUsed || 0), 0);
  const times = entries.filter((p) => p.won && p.solveMs > 0).map((p) => p.solveMs);
  const bestNote = times.length ? ` · best ⏱ ${formatDuration(Math.min(...times))}` : "";
  summary.textContent = entries.length
    ? `${solved}/${entries.length} solved · ${totalHints} hint${totalHints === 1 ? "" : "s"} used total${bestNote}`
    : "";

  const list = document.getElementById("history-list");
  list.innerHTML = "";
  if (!entries.length) {
    list.innerHTML = '<p class="history-empty">No puzzles completed yet. Play one to start your history.</p>';
    return;
  }

  for (const p of entries) {
    const answer = p.answer || "";
    const row = document.createElement("div");
    row.className = "history-row";

    // Mini-grid recap of the guesses.
    const grid = document.createElement("div");
    grid.className = "history-grid";
    for (const g of p.guesses) {
      const scores = answer ? scoreGuess(g, answer) : g.split("").map(() => "absent");
      const gr = document.createElement("div");
      gr.className = "mini-row";
      for (const s of scores) {
        const cell = document.createElement("div");
        cell.className = "mini " + s;
        gr.appendChild(cell);
      }
      grid.appendChild(gr);
    }

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const hintNote = p.hintsUsed ? ` · 💡 ${p.hintsUsed}` : "";
    const timeNote = p.won && p.solveMs > 0 ? ` · ⏱ ${formatDuration(p.solveMs)}` : "";
    const startedNote = formatStartedAt(p.startedAt);
    meta.innerHTML =
      `<div class="history-title">Puzzle #${p.idx}` +
      (answer ? ` <span class="history-word">${answer}</span>` : "") + `</div>` +
      `<div class="history-sub">${p.won ? `Solved in ${p.guesses.length}` : "Not solved"}${timeNote}${hintNote}</div>` +
      (startedNote ? `<div class="history-when">🗓 ${startedNote}</div>` : "");

    row.appendChild(meta);
    row.appendChild(grid);
    list.appendChild(row);
  }
}

function wire() {
  // Assign with .onclick (not addEventListener). Assignment REPLACES the handler,
  // so even if wire() somehow runs more than once — a bfcache restore, a soft
  // reload, or an old+new script briefly coexisting during a cache swap — a button
  // never ends up with two handlers. Stacked addEventListener handlers were what
  // made one "One More Round" click fire the ad twice (then thrice): each extra
  // handler called playAd again after the previous ad finished, so the same-stack
  // adPlaying guard never saw them.
  document.getElementById("btn-play").onclick = () => {
    ensureImaSdk(); // warm the ad SDK off the critical render path
    startRound(0);
  };
  document.getElementById("btn-history").onclick = () => { renderHistory(); showScreen("history"); };
  document.getElementById("btn-history-back").onclick = () => showScreen("home");
  document.getElementById("btn-howto").onclick = () => showScreen("howto");
  document.getElementById("btn-howto-back").onclick = () => showScreen("home");
  document.getElementById("btn-back").onclick = () => showScreen("home");
  document.getElementById("btn-hint").onclick = useHint;
  document.getElementById("btn-home").onclick = () => { renderHomeStats(); showScreen("home"); };

  // "One more round" — interstitial ad, then the next *unplayed* puzzle. We skip
  // over offsets already completed in an earlier session: without this, each of
  // those would open on its result screen (which also has a "One More Round"
  // button), so the player would ad-hop result→result→result until reaching a
  // fresh puzzle. Jump straight to the next unfinished one and play a single ad.
  document.getElementById("btn-next").onclick = () => {
    const nextOffset = nextUnplayedOffset(game.roundOffset);
    playAd(CONFIG.adSeconds.interstitial, () => startRound(nextOffset), "interstitial");
  };

  // Exit-confirmation dialog (raised by native BACK on the home screen).
  document.getElementById("btn-keep-playing").onclick = () => closeModal();
  document.getElementById("btn-end-fun").onclick = () => {
    closeModal();
    nativeBridge.send("exit"); // the user's answer, delivered after back-handled
  };
}

// ---------------------------------------------------------------------------
// Native TV wrapper bridge (Fire OS + Vega). No-op in a plain browser where the
// injected `window.WordsOnDemand` object is absent, so the SPA still runs there.
//
// BACK contract: the native app posts a `back` message and waits ~400ms for a
// reply before deciding whether to exit. We MUST answer `back-handled`
// SYNCHRONOUSLY in every case (even when a dialog is left on screen) so the app
// never exits out from under an open dialog. The dialog's outcome is reported
// separately: "End the Fun" sends `exit`, "Keep Playing" sends nothing.
// ---------------------------------------------------------------------------
const nativeBridge = {
  // Guards against a single physical BACK press being handled more than once.
  // The native app may deliver one press through BOTH inbound channels
  // (`onMessage` AND the `wod:message` event), and both fire in the same tick.
  // Without this, handleBack() runs twice per press: on a nested screen the 1st
  // call goes home and the 2nd immediately re-opens the exit dialog; on home the
  // 1st opens the dialog and the 2nd closes it (so BACK appears to do nothing).
  _backHandledThisTick: false,

  get api() {
    return (typeof window !== "undefined" && window.WordsOnDemand) || null;
  },
  // Send a typed message to the native host. Prefers the WordsOnDemand channel;
  // falls back to the ReactNativeWebView string channel if that's what's present.
  send(type) {
    const msg = { type };
    try {
      const api = this.api;
      if (api && typeof api.postMessage === "function") { api.postMessage(msg); return; }
      if (typeof window !== "undefined" && window.ReactNativeWebView &&
          typeof window.ReactNativeWebView.postMessage === "function") {
        window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }
    } catch (e) { /* bridge unavailable — behave as a normal web page */ }
  },

  // Handle an incoming BACK press. Returns nothing; replies synchronously.
  handleBack() {
    // 1) A modal is open → close it and we're done.
    if (isModalOpen()) {
      closeModal();
      this.send("back-handled");
      return;
    }
    // 2) Not on home → go back a screen (flat nav: everything returns to home).
    if (activeScreen !== "home") {
      showScreen("home");
      this.send("back-handled");
      return;
    }
    // 3) On home → confirm exit. Reply IMMEDIATELY (don't await the user), then
    //    raise the dialog. "End the Fun" will send `exit` later.
    this.send("back-handled");
    openModal("exit-modal", "btn-keep-playing");
  },

  onNativeMessage(msg) {
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "back":
        // Collapse duplicate deliveries of the SAME press. Both channels fire
        // synchronously in one tick, so a flag reset on the next tick lets a
        // genuinely separate later press through while ignoring the echo.
        if (this._backHandledThisTick) return;
        this._backHandledThisTick = true;
        setTimeout(() => { this._backHandledThisTick = false; }, 0);
        this.handleBack();
        break;
      case "pause":  pauseTimer(); break;   // freeze the solve clock while backgrounded
      case "resume": if (activeScreen === "game") resumeTimer(); break;
    }
  },

  // Register the two documented inbound channels and announce readiness.
  // The onMessage callback is (re)assigned each call, but the window event
  // listener is bound at most once — re-binding it would stack duplicate
  // handlers that each re-fire the same press.
  init() {
    if (!this.api) return; // plain browser: nothing to wire, stays a no-op
    this.api.onMessage = (msg) => this.onNativeMessage(msg);
    if (!this._eventBound && typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("wod:message", (e) => this.onNativeMessage(e && e.detail));
      this._eventBound = true;
    }
    this.send("ready");
  },
};

// First fresh puzzle BELOW `fromOffset`: extra rounds walk BACKWARD into past
// days, never forward. Walking forward would consume upcoming daily puzzles —
// a word solved in a "one more round" gets saved under its absolute puzzle
// number, so when that day arrives the daily puzzle opens already-finished and
// dumps the player straight onto the result screen. Going backward keeps offset
// 0 (today) and every future day pristine. Fresh = not finished in a past
// session and not already played this session (no repeated solution word). We
// scan a full pool's worth of offsets so every distinct word is considered
// before giving up; fall back to the very next offset down if all are exhausted
// (a replay beats a hang).
function nextUnplayedOffset(fromOffset) {
  const span = ANSWERS.length;
  for (let off = fromOffset - 1; off >= fromOffset - span; off--) {
    if (store.data.progress[puzzleIndex(off)]?.finished) continue;
    if (sessionAnswers.has(extraPuzzle(off))) continue;
    return off;
  }
  return fromOffset - 1;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Only auto-boot against the real page. When this file is loaded by the test
// harness (which has no #btn-play etc.), skip wiring so the logic can be
// exercised in isolation.
if (typeof document !== "undefined" && document.getElementById("btn-play")) {
  console.log("Words on Demand — build v38 (load perf: deferred scripts, lazy IMA SDK)");
  wire();
  renderHomeStats();
  showScreen("home");
  nativeBridge.init(); // announces `ready`; no-op in a plain browser
}

// Expose internals to the test harness (Node) without affecting the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { scoreGuess, nextUnplayedOffset, pruneForwardWalkArtifacts,
    formatDuration, formatStartedAt, CONFIG,
    getSessionAnswers: () => sessionAnswers,
    game, knownGreens, resetCurrentRow, nextEditableCol,
    typeLetter, removeLetter, currentGuess, wipeCurrentRow,
    rewindPress, rewindRelease,
    unrevealedColumns, hintAvailable, hintDisabledReason, nextKeyInRow,
    imaAvailable,
    nativeBridge, openModal, closeModal, isModalOpen,
    showScreen, getActiveScreen };
}
