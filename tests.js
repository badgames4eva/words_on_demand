/* ============================================================
   Words on Demand — logic tests (no framework, no build step)

   Runs in two places, same assertions:
   - Browser: open tests.html (loads words.js, game.js, then this file).
   - Node:    node run-tests.js  (headless, for a quick pre-push check / CI).

   Scope on purpose: only the pure logic that's easy to get subtly wrong and
   painful to verify by clicking — scoring, day-of puzzle math, dictionary
   integrity, "one more round" skip, time formatting. Visual/feel is left to
   eyeballing in the real page.
   ============================================================ */
(function (root) {
  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, msg: e.message }); }
  }
  function eq(actual, expected, note) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${note || ""} expected ${b}, got ${a}`);
  }
  function ok(cond, note) { if (!cond) throw new Error(note || "expected truthy"); }

  // Pull the functions under test from wherever they live (global in browser,
  // passed in by the Node runner).
  const G = root.WOD_UNDER_TEST || root;
  const { scoreGuess, puzzleForDay, dayIndexToday, extraPuzzle,
          nextUnplayedOffset, formatDuration } = G;
  const ANSWERS = G.ANSWERS, VALID_GUESSES = G.VALID_GUESSES, store = G.store,
        puzzleIndex = G.puzzleIndex, DENYLIST = G.DENYLIST,
        sessionAnswers = G.sessionAnswers, CONFIG = G.CONFIG;
  const game = G.game, knownGreens = G.knownGreens, resetCurrentRow = G.resetCurrentRow,
        nextEditableCol = G.nextEditableCol, typeLetter = G.typeLetter,
        removeLetter = G.removeLetter, currentGuess = G.currentGuess;

  // ---- scoreGuess: the classic duplicate-letter minefield ----------------
  test("scoreGuess: all correct", () => {
    eq(scoreGuess("PLANE", "PLANE"),
       ["correct", "correct", "correct", "correct", "correct"]);
  });
  test("scoreGuess: all absent", () => {
    eq(scoreGuess("FUZZY", "PLANE").filter((s) => s !== "absent").length, 0);
  });
  test("scoreGuess: simple present (misplaced)", () => {
    // A is in CIGAR but not at index 0.
    eq(scoreGuess("APPLE", "CIGAR")[0], "present");
  });
  test("scoreGuess: duplicate in guess, single in answer -> only one marked", () => {
    // Guess LLAMA vs answer HELLO: answer has exactly one L (index 2, wait HELLO
    // has two L's). Use a cleaner case: guess "EERIE" vs answer "PLANE".
    // PLANE has one E (last). Guess EERIE has three E's; exactly one should be
    // credited (as present), the rest absent — never over-count.
    const s = scoreGuess("EERIE", "PLANE");
    const credited = s.filter((x) => x === "present" || x === "correct").length;
    eq(credited, 1, "only one E may be credited");
  });
  test("scoreGuess: correct takes priority over present for duplicates", () => {
    // answer ALLOY (two L's at 1,2). guess LLLLL: positions 1,2 correct, rest absent.
    const s = scoreGuess("LLLLL", "ALLOY");
    eq(s, ["absent", "correct", "correct", "absent", "absent"]);
  });
  test("scoreGuess: never mutates its inputs", () => {
    const g = "PLANE", a = "CRANE";
    scoreGuess(g, a);
    eq([g, a], ["PLANE", "CRANE"]);
  });

  // ---- puzzleForDay: deterministic + wraps safely -----------------------
  test("puzzleForDay: deterministic for a given day", () => {
    eq(puzzleForDay(42), puzzleForDay(42));
  });
  test("puzzleForDay: wraps over the pool length", () => {
    eq(puzzleForDay(0), puzzleForDay(ANSWERS.length));
  });
  test("puzzleForDay: negative indices are handled (no crash, valid word)", () => {
    const w = puzzleForDay(-1);
    ok(typeof w === "string" && w.length === 5, "got a 5-letter word for -1");
    ok(ANSWERS.includes(w), "-1 maps into the answer pool");
  });

  // ---- dictionary integrity: every answer must be an accepted guess ------
  test("integrity: every ANSWER is in VALID_GUESSES", () => {
    const missing = ANSWERS.filter((w) => !VALID_GUESSES.has(w));
    eq(missing, [], "answers not accepted as guesses");
  });
  test("integrity: every ANSWER is exactly 5 letters, A-Z uppercase", () => {
    const bad = ANSWERS.filter((w) => !/^[A-Z]{5}$/.test(w));
    eq(bad, [], "malformed answers");
  });
  test("integrity: no duplicate answers in the pool", () => {
    eq(new Set(ANSWERS).size, ANSWERS.length, "duplicate answer words");
  });

  // ---- denylist: offensive terms removed from accepted guesses -----------
  test("denylist: every denied word is absent from VALID_GUESSES", () => {
    const leaked = [...DENYLIST].filter((w) => VALID_GUESSES.has(w));
    eq(leaked, [], "denied words still accepted");
  });
  test("denylist: representative slurs/vulgarity are rejected", () => {
    ["KIKES", "PUSSY", "WHORE", "RAPES"].forEach((w) =>
      ok(!VALID_GUESSES.has(w), `${w} should be rejected`));
  });
  test("denylist: innocent everyday words are still accepted", () => {
    // Deliberately kept despite a coarse secondary meaning — real vocabulary.
    ["CRACK", "BALLS", "SPEED", "BLUNT", "ERECT", "STASH"].forEach((w) =>
      ok(VALID_GUESSES.has(w), `${w} should stay valid`));
  });
  test("denylist: does not remove any curated answer", () => {
    const clobbered = ANSWERS.filter((w) => DENYLIST.has(w));
    eq(clobbered, [], "a denied word is also a daily answer");
  });

  // ---- nextUnplayedOffset: One More Round skips finished puzzles ---------
  // Stateful: swap store.data.progress, then restore, so we never touch real stats.
  test("nextUnplayedOffset: skips consecutively-finished puzzles", () => {
    const saved = store.data.progress;
    try {
      store.data.progress = {};
      // Mark offsets 0,1,2 finished; 3 is fresh.
      for (let off = 0; off <= 2; off++) {
        store.data.progress[puzzleIndex(off)] = { finished: true };
      }
      eq(nextUnplayedOffset(0), 3, "should jump past 0,1,2 to 3");
    } finally { store.data.progress = saved; }
  });
  test("nextUnplayedOffset: returns very next offset when nothing finished", () => {
    const saved = store.data.progress;
    const savedSession = new Set(sessionAnswers);
    try {
      store.data.progress = {};
      sessionAnswers.clear();
      eq(nextUnplayedOffset(5), 6);
    } finally {
      store.data.progress = saved;
      sessionAnswers.clear(); savedSession.forEach((w) => sessionAnswers.add(w));
    }
  });
  test("nextUnplayedOffset: skips a word already played this session (no repeat)", () => {
    const saved = store.data.progress;
    const savedSession = new Set(sessionAnswers);
    try {
      store.data.progress = {};
      sessionAnswers.clear();
      // Pretend the very next offset's word was already solved this session.
      sessionAnswers.add(extraPuzzle(6));
      const off = nextUnplayedOffset(5);
      ok(off !== 6, "should not hand back offset 6 (its word is played)");
      ok(!sessionAnswers.has(extraPuzzle(off)), "chosen word is unplayed this session");
    } finally {
      store.data.progress = saved;
      sessionAnswers.clear(); savedSession.forEach((w) => sessionAnswers.add(w));
    }
  });

  // ---- CONFIG seam: tunables consolidated & sane -------------------------
  test("config: board matches a 5-letter, 6-guess Wordle", () => {
    eq(CONFIG.wordLength, 5);
    eq(CONFIG.maxGuesses, 6);
    // Every curated answer must fit the configured word length.
    eq(ANSWERS.filter((w) => w.length !== CONFIG.wordLength), [], "answer wrong length");
  });
  test("config: ad durations are positive numbers", () => {
    ok(CONFIG.adSeconds.interstitial > 0, "interstitial seconds");
    ok(CONFIG.adSeconds.rewarded > 0, "rewarded seconds");
    ok(CONFIG.revealDelayMs >= 0, "reveal delay");
  });

  // ---- carry-down greens: don't make the player re-type known letters ----
  // These poke the shared `game` object, so snapshot & restore around each.
  function withRound(answer, guesses, fn) {
    const snap = { answer: game.answer, guesses: game.guesses,
                   cells: game.cells, locked: game.locked, finished: game.finished };
    try {
      game.answer = answer; game.guesses = guesses.slice(); game.finished = false;
      resetCurrentRow();
      fn();
    } finally { Object.assign(game, snap); }
  }
  test("carry-down: greens from a prior guess are pinned by column", () => {
    // answer PLATE; guessed PLANE -> P,L,A,_,E correct (index 3 'N' wrong).
    withRound("PLATE", ["PLANE"], () => {
      eq(knownGreens(), ["P", "L", "A", "", "E"]);
      eq(game.locked, [true, true, true, false, true]);
      eq(game.cells, ["P", "L", "A", "", "E"]);
    });
  });
  test("carry-down: cursor/typing lands in the first editable empty column", () => {
    withRound("PLATE", ["PLANE"], () => {
      eq(nextEditableCol(), 3, "only col 3 is empty & editable");
      typeLetter("T");
      eq(currentGuess(), "PLATE");
      eq(nextEditableCol(), -1, "row is now full");
    });
  });
  test("carry-down: typing never overwrites a locked green", () => {
    withRound("PLATE", ["PLANE"], () => {
      typeLetter("Z"); // should fill col 3 only, not touch P/L/A/E
      eq(game.cells, ["P", "L", "A", "Z", "E"]);
    });
  });
  test("carry-down: DEL removes a typed letter but not a locked green", () => {
    withRound("PLATE", ["PLANE"], () => {
      typeLetter("T");            // -> PLATE
      removeLetter();             // removes the typed T (col 3)
      eq(game.cells, ["P", "L", "A", "", "E"]);
      removeLetter();             // nothing editable left to remove
      eq(game.cells, ["P", "L", "A", "", "E"], "locked greens survive DEL");
    });
  });
  test("carry-down: no greens yet -> empty editable row, cursor at 0", () => {
    withRound("PLATE", [], () => {
      eq(game.locked, [false, false, false, false, false]);
      eq(nextEditableCol(), 0);
    });
  });

  // ---- formatDuration ----------------------------------------------------
  test("formatDuration: sub-minute shows seconds", () => { eq(formatDuration(5000), "5s"); });
  test("formatDuration: rounds to nearest second", () => { eq(formatDuration(5400), "5s"); });
  test("formatDuration: minutes:seconds with zero-pad", () => { eq(formatDuration(72000), "1:12"); });
  test("formatDuration: exact minute", () => { eq(formatDuration(60000), "1:00"); });

  root.WOD_TEST_RESULTS = results;
  return results;
})(typeof globalThis !== "undefined" ? globalThis : this);
