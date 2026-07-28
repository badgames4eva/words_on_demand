#!/usr/bin/env node
/* Headless test runner. Loads the REAL words.js + game.js + tests.js in one
   sandbox with a minimal DOM stub, then prints pass/fail and exits non-zero on
   any failure (so it can gate a push / CI). No dependencies. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const DIR = __dirname;

// Minimal DOM. getElementById returns null for the boot sentinel (#btn-play) so
// the auto-boot guard stays off, but serves lightweight stub elements for every
// OTHER id on demand — enough for showScreen/openModal/closeModal to run headless
// (needed by the native-bridge tests). querySelectorAll(".focusable") returns [],
// which the focus helpers handle gracefully.
const noop = () => {};
function makeEl(id) {
  return {
    id, hidden: false,
    offsetParent: {}, // truthy => "visible" for focus filters
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    querySelectorAll: () => [], querySelector: () => null,
    appendChild: noop, setAttribute: noop, click: noop, style: {}, dataset: {},
  };
}
const elCache = new Map();
const documentStub = {
  getElementById: (id) => {
    if (id === "btn-play") return null; // keep auto-boot disabled
    if (!elCache.has(id)) elCache.set(id, makeEl(id));
    return elCache.get(id);
  },
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => makeEl("_created"),
  addEventListener: noop,
  body: { appendChild: noop },
};
const localStorageStub = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
})();

// A real (tiny) event system on window. The native-bridge tests rely on the
// `wod:message` listener actually firing so they can reproduce a single press
// arriving through BOTH inbound channels — a noop here would silently hide the
// very bug the tests exist to catch.
const listeners = new Map(); // type -> [fn]
const eventApi = {
  addEventListener: (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  },
  removeEventListener: (type, fn) => {
    const arr = listeners.get(type);
    if (arr) listeners.set(type, arr.filter((f) => f !== fn));
  },
  dispatchEvent: (evt) => {
    (listeners.get(evt && evt.type) || []).forEach((fn) => fn(evt));
    return true;
  },
};

const sandbox = {
  document: documentStub,
  localStorage: localStorageStub,
  console,
  Date, Math, JSON, Set, Array, Object, Promise,
  // Real timers (bound to Node's) so the bridge's per-press dedup flag actually
  // resets on the next tick and the tests' `tick()` helper resolves.
  setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
  setInterval: () => 0, clearInterval: noop,
  addEventListener: eventApi.addEventListener,
  removeEventListener: eventApi.removeEventListener,
  dispatchEvent: eventApi.dispatchEvent,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const load = (f) => fs.readFileSync(path.join(DIR, f), "utf8");

// Raw text of the files that carry duplicated policy copy. There is no build
// step to include the policy once, so the three copies can silently drift — this
// hands them to tests.js so a mismatch fails the pre-push check instead of
// reaching a store reviewer who reads both. Node-only: the browser runner has no
// filesystem, so tests.html skips that one assertion (it says so when it does).
const POLICY_FILES = {
  "PRIVACY.md": load("PRIVACY.md"),
  "privacy.html": load("privacy.html"),
  "index.html": load("index.html"),
};
// Expose the internals tests.js expects onto the sandbox global.
const exposer = `
  globalThis.WOD_UNDER_TEST = {
    scoreGuess, puzzleForDay, dayIndexToday, extraPuzzle,
    nextUnplayedOffset, pruneForwardWalkArtifacts, formatDuration, formatStartedAt,
    ANSWERS, VALID_GUESSES, store, puzzleIndex, DENYLIST,
    sessionAnswers, CONFIG,
    game, knownGreens, resetCurrentRow, nextEditableCol,
    typeLetter, removeLetter, currentGuess, wipeCurrentRow,
    rewindPress, rewindRelease,
    unrevealedColumns, hintAvailable, hintDisabledReason, nextKeyInRow, pickInDirection,
    imaAvailable,
    showPolicy, scrollPolicy, refreshPolicyHint, resetPrivacyNote,
    POLICY_SCROLL_FRACTION,
    renderRowWipeNote,
    nativeBridge, openModal, closeModal, isModalOpen,
    showScreen, getActiveScreen,
    POLICY_FILES: globalThis.WOD_POLICY_FILES,
  };`;

// Handed over as a real object, NOT interpolated into the exposer source — a
// backtick or a ${ sequence in any policy file would otherwise corrupt it.
sandbox.WOD_POLICY_FILES = POLICY_FILES;

vm.createContext(sandbox);
try {
  vm.runInContext(load("words.js") + "\n" + load("game.js") + "\n" + exposer,
    sandbox, { filename: "app.js" });
  vm.runInContext(load("tests.js"), sandbox, { filename: "tests.js" });
} catch (e) {
  console.error("Harness error:", e.stack || e.message);
  process.exit(2);
}

// tests.js now runs its queue asynchronously (some native-BACK tests await a
// real tick between simulated presses). Wait for the completion promise.
Promise.resolve(sandbox.WOD_TEST_DONE).then((results) => {
  results = results || sandbox.WOD_TEST_RESULTS || [];
  let failed = 0;
  for (const r of results) {
    if (r.ok) console.log(`  ✓ ${r.name}`);
    else { failed++; console.log(`  ✗ ${r.name}\n      ${r.msg}`); }
  }
  console.log(`\n${results.length - failed}/${results.length} passed` +
    (failed ? ` — ${failed} FAILED` : " — all green"));
  process.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error("Harness error:", e.stack || e.message);
  process.exit(2);
});
