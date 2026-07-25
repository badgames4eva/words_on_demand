#!/usr/bin/env node
/* Headless test runner. Loads the REAL words.js + game.js + tests.js in one
   sandbox with a minimal DOM stub, then prints pass/fail and exits non-zero on
   any failure (so it can gate a push / CI). No dependencies. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const DIR = __dirname;

// Minimal DOM: enough for game.js to load without auto-booting. It intentionally
// returns null for getElementById so the boot guard (needs #btn-play) stays off.
const noop = () => {};
const documentStub = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ classList: { add: noop, remove: noop, toggle: noop },
    appendChild: noop, setAttribute: noop, style: {}, dataset: {} }),
  addEventListener: noop,
  body: { appendChild: noop },
};
const localStorageStub = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
})();

const sandbox = {
  document: documentStub,
  localStorage: localStorageStub,
  console,
  Date, Math, JSON, Set, Array, Object,
  setTimeout: noop, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const load = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
// Expose the internals tests.js expects onto the sandbox global.
const exposer = `
  globalThis.WOD_UNDER_TEST = {
    scoreGuess, puzzleForDay, dayIndexToday, extraPuzzle,
    nextUnplayedOffset, formatDuration,
    ANSWERS, VALID_GUESSES, store, puzzleIndex, DENYLIST,
  };`;

vm.createContext(sandbox);
try {
  vm.runInContext(load("words.js") + "\n" + load("game.js") + "\n" + exposer,
    sandbox, { filename: "app.js" });
  vm.runInContext(load("tests.js"), sandbox, { filename: "tests.js" });
} catch (e) {
  console.error("Harness error:", e.stack || e.message);
  process.exit(2);
}

const results = sandbox.WOD_TEST_RESULTS || [];
let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.name}`);
  else { failed++; console.log(`  ✗ ${r.name}\n      ${r.msg}`); }
}
console.log(`\n${results.length - failed}/${results.length} passed` +
  (failed ? ` — ${failed} FAILED` : " — all green"));
process.exit(failed ? 1 : 0);
