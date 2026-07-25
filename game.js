/* ============================================================
   Words on Demand game logic
   - Remote-first: arrow keys = D-pad, Enter = OK, Backspace/Esc = Back
   - Spatial focus navigation across a 2D grid of .focusable elements
   - Interstitial ad only at natural break points (never mid-solve)
   ============================================================ */

const WORD_LEN = 5;
const MAX_GUESSES = 6;
const STORAGE_KEY = "wordsondemand.v1";

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
      return d;
    }
  } catch (e) { /* fall through to defaults */ }
  return { streak: 0, played: 0, wins: 0, lastDay: null, progress: {} };
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
    solveMs: game.solveMs, // active solve time (timer pauses off the game screen)
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
  current: "",       // in-progress guess
  finished: false,
  won: false,
  hintsUsed: 0,
  solveMs: 0,        // active solve time; the timer pauses off the game screen
  timerStart: null,  // Date.now() when the timer last resumed; null while paused
  roundOffset: 0,    // 0 = today's puzzle; grows with "one more round"
};

// keyStates: letter -> "correct" | "present" | "absent"
let keyStates = {};

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
  // Focus first focusable in the new screen.
  focusFirstIn(id);
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
let activeScreen = "home";

// ---------------------------------------------------------------------------
// Focus / D-pad navigation
// Strategy: track focus as the nearest focusable in the intended direction,
// using on-screen geometry (getBoundingClientRect) so any layout just works.
// ---------------------------------------------------------------------------
let focusedEl = null;

function setFocus(el) {
  if (!el) return;
  if (focusedEl) focusedEl.classList.remove("is-focused");
  focusedEl = el;
  focusedEl.classList.add("is-focused");
}

function focusablesIn(screenId) {
  return Array.from(
    document.getElementById(screenId).querySelectorAll(".focusable")
  ).filter((el) => el.offsetParent !== null); // visible only
}

function focusFirstIn(screenId) {
  const items = focusablesIn(screenId);
  if (items.length) setFocus(items[0]);
  else focusedEl = null;
}

function moveFocus(dir) {
  const items = focusablesIn(activeScreen);
  if (!focusedEl || items.length === 0) { focusFirstIn(activeScreen); return; }

  const cur = focusedEl.getBoundingClientRect();
  const curX = cur.left + cur.width / 2;
  const curY = cur.top + cur.height / 2;

  let best = null;
  let bestScore = Infinity;

  for (const el of items) {
    if (el === focusedEl) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const dx = x - curX;
    const dy = y - curY;

    // Reject candidates not in the requested direction.
    if (dir === "up" && dy >= -1) continue;
    if (dir === "down" && dy <= 1) continue;
    if (dir === "left" && dx >= -1) continue;
    if (dir === "right" && dx <= 1) continue;

    // Primary axis distance dominates; perpendicular offset is penalized.
    const along = (dir === "up" || dir === "down") ? Math.abs(dy) : Math.abs(dx);
    const perp  = (dir === "up" || dir === "down") ? Math.abs(dx) : Math.abs(dy);
    const score = along + perp * 2;

    if (score < bestScore) { bestScore = score; best = el; }
  }

  if (best) setFocus(best);
}

function activateFocused() {
  if (focusedEl) focusedEl.click();
}

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
      // Keyboard-typing mode in the game: Enter submits the guess.
      if (activeScreen === "game" && inputMode === "keyboard") onKeyPress("ENTER");
      else activateFocused();
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

function handleBack() {
  if (activeScreen === "game") {
    // Backspace deletes a letter; if empty, go home.
    if (game.current.length > 0 && !game.finished) removeLetter();
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

function buildKeyboard() {
  const kb = document.getElementById("keyboard");
  kb.innerHTML = "";
  for (const rowKeys of KB_LAYOUT) {
    const row = document.createElement("div");
    row.className = "kb-row";
    for (const k of rowKeys) {
      const key = document.createElement("button");
      key.className = "key focusable" + (k.length > 1 ? " key-wide" : "") +
        (k === "ENTER" ? " key-enter" : "");
      key.dataset.navGroup = "keyboard";
      key.dataset.key = k;
      key.textContent = k === "DEL" ? "⌫" : k === "ENTER" ? "→" : k;
      if (k === "ENTER") key.setAttribute("aria-label", "Enter");
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
// Typing
// ---------------------------------------------------------------------------
function typeLetter(letter) {
  if (game.finished || game.current.length >= WORD_LEN) return;
  game.current += letter;
  renderCurrentRow();
}

function removeLetter() {
  if (game.finished || game.current.length === 0) return;
  game.current = game.current.slice(0, -1);
  renderCurrentRow();
}

function renderCurrentRow() {
  const r = game.guesses.length;
  const row = document.querySelector(`.board-row[data-row="${r}"]`);
  if (!row) return;
  const tiles = row.querySelectorAll(".tile");
  tiles.forEach((tile, c) => {
    const ch = game.current[c] || "";
    tile.textContent = ch;
    tile.classList.toggle("filled", !!ch);
  });
}

// ---------------------------------------------------------------------------
// Guess submission + scoring
// ---------------------------------------------------------------------------
function submitGuess() {
  if (game.current.length < WORD_LEN) { shakeRow(); toast("Not enough letters"); return; }
  if (!VALID_GUESSES.has(game.current)) { shakeRow(); toast("Not in word list"); return; }

  const scores = scoreGuess(game.current, game.answer);
  paintRow(game.guesses.length, game.current, scores);
  updateKeyStates(game.current, scores);

  game.guesses.push(game.current);
  const guessed = game.current;
  game.current = "";

  if (guessed === game.answer) {
    game.finished = true; game.won = true;
    pauseTimer(); // freeze solve time at the winning guess, before the reveal delay
    setTimeout(endRound, 700);
  } else if (game.guesses.length >= MAX_GUESSES) {
    game.finished = true; game.won = false;
    pauseTimer();
    setTimeout(endRound, 700);
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
  game.current = "";
  keyStates = {};

  buildBoard();
  buildKeyboard();

  // Resume any saved progress for this exact puzzle, so leaving and coming back
  // continues the same board instead of restarting it.
  const saved = store.data.progress[puzzleIndex(offset)];
  game.guesses = saved ? saved.guesses.slice() : [];
  game.finished = saved ? saved.finished : false;
  game.won = saved ? saved.won : false;
  game.hintsUsed = saved ? (saved.hintsUsed || 0) : 0;
  game.solveMs = saved ? (saved.solveMs || 0) : 0;
  game.timerStart = null; // showScreen("game") will resume it if unfinished
  replayGuesses();

  document.getElementById("puzzle-no").textContent = puzzleIndex(offset);
  document.getElementById("game-streak").textContent = store.data.streak;

  // A puzzle that's already been completed goes straight to its result — no replay.
  if (game.finished) { renderResult(); showScreen("result"); return; }

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
// Interstitial ad — shown between rounds only (respects the doc's UX rule).
// ---------------------------------------------------------------------------
let adPlaying = false;
function playAd(seconds, onDone) {
  // Never start a second ad while one is showing. Without this guard, a stray
  // extra activation (double-click, Enter + click, a lingering timer) can stack
  // two ads — and on a real ad SDK, invoking it re-entrantly is undefined
  // behavior. This is the production-correct rule: one ad at a time.
  if (adPlaying) return;
  adPlaying = true;

  showScreen("ad");
  const bar = document.getElementById("ad-bar");
  const count = document.getElementById("ad-count");
  let elapsed = 0;
  bar.style.width = "0%";
  count.textContent = seconds;

  const tick = setInterval(() => {
    elapsed += 0.1;
    const pct = Math.min(100, (elapsed / seconds) * 100);
    bar.style.width = pct + "%";
    count.textContent = Math.max(0, Math.ceil(seconds - elapsed));
    if (elapsed >= seconds) {
      clearInterval(tick);
      adPlaying = false;
      onDone();
    }
  }, 100);
}

// ---------------------------------------------------------------------------
// Hint — rewarded video pattern: opt-in, reveals one correct letter.
// ---------------------------------------------------------------------------
function useHint() {
  if (game.finished) return;
  // Find a position not yet revealed as correct in the current guess.
  const revealed = new Set();
  game.guesses.forEach((g) => {
    for (let i = 0; i < WORD_LEN; i++) if (g[i] === game.answer[i]) revealed.add(i);
  });
  const candidates = [];
  for (let i = 0; i < WORD_LEN; i++) if (!revealed.has(i)) candidates.push(i);
  if (candidates.length === 0) { toast("All letters already revealed!"); return; }

  playAd(5, () => {
    const pos = candidates[0];
    game.hintsUsed += 1;
    saveProgress();
    showScreen("game");
    toast(`Letter ${pos + 1} is “${game.answer[pos]}”`);
  });
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
    meta.innerHTML =
      `<div class="history-title">Puzzle #${p.idx}` +
      (answer ? ` <span class="history-word">${answer}</span>` : "") + `</div>` +
      `<div class="history-sub">${p.won ? `Solved in ${p.guesses.length}` : "Not solved"}${timeNote}${hintNote}</div>`;

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
  document.getElementById("btn-play").onclick = () => startRound(0);
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
    playAd(5, () => startRound(nextOffset));
  };
}

// First offset after `fromOffset` whose puzzle hasn't been finished yet.
// Bounded so a fully-completed streak can't loop forever — falls back to the
// very next offset (a replay is better than a hang).
function nextUnplayedOffset(fromOffset) {
  for (let off = fromOffset + 1; off <= fromOffset + 366; off++) {
    if (!store.data.progress[puzzleIndex(off)]?.finished) return off;
  }
  return fromOffset + 1;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
// Only auto-boot against the real page. When this file is loaded by the test
// harness (which has no #btn-play etc.), skip wiring so the logic can be
// exercised in isolation.
if (typeof document !== "undefined" && document.getElementById("btn-play")) {
  console.log("Words on Demand — build v6 (solve timer, pauses off game screen)");
  wire();
  renderHomeStats();
  showScreen("home");
}

// Expose internals to the test harness (Node) without affecting the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { scoreGuess, nextUnplayedOffset, formatDuration };
}
