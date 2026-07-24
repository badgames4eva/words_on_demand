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
    if (raw) return JSON.parse(raw);
  } catch (e) { /* fall through to defaults */ }
  return { streak: 0, played: 0, wins: 0, lastDay: null };
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
  // Focus first focusable in the new screen.
  focusFirstIn(id);
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
document.addEventListener("keydown", (e) => {
  // Ad screen swallows input until countdown finishes.
  if (activeScreen === "ad") { e.preventDefault(); return; }

  switch (e.key) {
    case "ArrowUp":    moveFocus("up");    e.preventDefault(); break;
    case "ArrowDown":  moveFocus("down");  e.preventDefault(); break;
    case "ArrowLeft":  moveFocus("left");  e.preventDefault(); break;
    case "ArrowRight": moveFocus("right"); e.preventDefault(); break;
    case "Enter":      activateFocused();  e.preventDefault(); break;
    case "Backspace":
    case "Escape":
      handleBack();
      e.preventDefault();
      break;
    default:
      // Convenience for desktop testing: physical letter keys type into game.
      if (activeScreen === "game" && /^[a-zA-Z]$/.test(e.key)) {
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
    setTimeout(endRound, 700);
  } else if (game.guesses.length >= MAX_GUESSES) {
    game.finished = true; game.won = false;
    setTimeout(endRound, 700);
  }
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
  game.guesses = [];
  game.current = "";
  game.finished = false;
  game.won = false;
  game.hintsUsed = 0;
  keyStates = {};

  buildBoard();
  buildKeyboard();

  document.getElementById("puzzle-no").textContent = dayIndexToday() + offset;
  document.getElementById("game-streak").textContent = store.data.streak;

  showScreen("game");
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
function playAd(seconds, onDone) {
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

function wire() {
  document.getElementById("btn-play").addEventListener("click", () => startRound(0));
  document.getElementById("btn-howto").addEventListener("click", () => showScreen("howto"));
  document.getElementById("btn-howto-back").addEventListener("click", () => showScreen("home"));
  document.getElementById("btn-back").addEventListener("click", () => showScreen("home"));
  document.getElementById("btn-hint").addEventListener("click", useHint);
  document.getElementById("btn-home").addEventListener("click", () => { renderHomeStats(); showScreen("home"); });

  // "One more round" — interstitial ad, then the next puzzle (the retention loop).
  document.getElementById("btn-next").addEventListener("click", () => {
    const nextOffset = game.roundOffset + 1;
    playAd(5, () => startRound(nextOffset));
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
wire();
renderHomeStats();
showScreen("home");
