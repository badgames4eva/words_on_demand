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
  // Tests are queued and run sequentially (they share the global `game`/bridge
  // state, so they must not interleave). A test fn may be async — the runner
  // awaits it — which lets the native-BACK tests advance a real tick between
  // simulated presses (see `tick()` below).
  const queue = [];
  function test(name, fn) { queue.push({ name, fn }); }
  // A macrotask boundary. The bridge clears its per-press dedup flag on the next
  // tick, so awaiting this between simulated presses models two *separate*
  // presses; NOT awaiting models one press arriving twice within a single tick.
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  function eq(actual, expected, note) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Error(`${note || ""} expected ${b}, got ${a}`);
  }
  function ok(cond, note) { if (!cond) throw new Error(note || "expected truthy"); }

  // Pull the functions under test from wherever they live (global in browser,
  // passed in by the Node runner).
  const G = root.WOD_UNDER_TEST || root;
  const { scoreGuess, puzzleForDay, dayIndexToday, extraPuzzle,
          nextUnplayedOffset, pruneForwardWalkArtifacts,
          formatDuration, formatStartedAt } = G;
  const ANSWERS = G.ANSWERS, VALID_GUESSES = G.VALID_GUESSES, store = G.store,
        puzzleIndex = G.puzzleIndex, DENYLIST = G.DENYLIST,
        sessionAnswers = G.sessionAnswers, CONFIG = G.CONFIG;
  const game = G.game, knownGreens = G.knownGreens, resetCurrentRow = G.resetCurrentRow,
        nextEditableCol = G.nextEditableCol, typeLetter = G.typeLetter,
        removeLetter = G.removeLetter, currentGuess = G.currentGuess,
        wipeCurrentRow = G.wipeCurrentRow, rewindPress = G.rewindPress,
        rewindRelease = G.rewindRelease, unrevealedColumns = G.unrevealedColumns,
        hintAvailable = G.hintAvailable, hintDisabledReason = G.hintDisabledReason,
        nextKeyInRow = G.nextKeyInRow;
  const nativeBridge = G.nativeBridge, closeModal = G.closeModal,
        isModalOpen = G.isModalOpen, showScreen = G.showScreen,
        getActiveScreen = G.getActiveScreen;

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
  // The scramble must be a perfect bijection: one full cycle of consecutive days
  // visits every answer exactly once (this is the "~3 years, no repeats"
  // guarantee). If the pool size stops being coprime to SCRAMBLE_A, this fails.
  test("puzzleForDay: one full cycle hits every answer exactly once (bijection)", () => {
    const seen = new Set();
    for (let d = 0; d < ANSWERS.length; d++) seen.add(puzzleForDay(d));
    eq(seen.size, ANSWERS.length, "every answer appears once per cycle");
  });
  // The bug this fixes: consecutive days were alphabetical neighbors (STOMP,
  // STOOL, STOOP, STORE). Assert back-to-back days land far apart in the
  // alphabetically-sorted pool, so a run of plays never marches through the ABCs.
  test("puzzleForDay: consecutive days are NOT adjacent in the sorted pool", () => {
    const pos = (w) => ANSWERS.indexOf(w);
    let minGap = Infinity;
    for (let d = 0; d < 200; d++) {
      const gap = Math.abs(pos(puzzleForDay(d + 1)) - pos(puzzleForDay(d)));
      if (gap < minGap) minGap = gap;
    }
    // Direct indexing would make this gap exactly 1 every day. Demand real spread.
    ok(minGap > ANSWERS.length / 20,
       `neighboring days too close in the alphabet (min gap ${minGap})`);
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

  // ---- nextUnplayedOffset: One More Round walks BACKWARD past finished -----
  // Extra rounds go into PAST days (negative offsets) so they never consume an
  // upcoming daily puzzle. Stateful: swap store.data.progress, then restore.
  test("nextUnplayedOffset: walks backward, skipping finished past puzzles", () => {
    const saved = store.data.progress;
    try {
      store.data.progress = {};
      // Mark offsets -1,-2,-3 finished; -4 is fresh.
      for (let off = -1; off >= -3; off--) {
        store.data.progress[puzzleIndex(off)] = { finished: true };
      }
      eq(nextUnplayedOffset(0), -4, "should jump past -1,-2,-3 to -4");
    } finally { store.data.progress = saved; }
  });
  test("nextUnplayedOffset: never returns a future/today offset", () => {
    const saved = store.data.progress;
    const savedSession = new Set(sessionAnswers);
    try {
      store.data.progress = {};
      sessionAnswers.clear();
      ok(nextUnplayedOffset(0) < 0, "from today, next extra round is a past day");
      ok(nextUnplayedOffset(-5) < -5, "always strictly below the current offset");
    } finally {
      store.data.progress = saved;
      sessionAnswers.clear(); savedSession.forEach((w) => sessionAnswers.add(w));
    }
  });
  test("nextUnplayedOffset: returns the immediately-previous offset when nothing finished", () => {
    const saved = store.data.progress;
    const savedSession = new Set(sessionAnswers);
    try {
      store.data.progress = {};
      sessionAnswers.clear();
      eq(nextUnplayedOffset(-5), -6);
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
      // Pretend the immediately-previous offset's word was already solved this session.
      sessionAnswers.add(extraPuzzle(-6));
      const off = nextUnplayedOffset(-5);
      ok(off !== -6, "should not hand back offset -6 (its word is played)");
      ok(!sessionAnswers.has(extraPuzzle(off)), "chosen word is unplayed this session");
    } finally {
      store.data.progress = saved;
      sessionAnswers.clear(); savedSession.forEach((w) => sessionAnswers.add(w));
    }
  });

  // ---- prune forward-walk artifacts (migration off the old forward walk) --
  test("prune: drops finished puzzles saved under future day indices", () => {
    const today = dayIndexToday();
    const p = {
      [today + 1]: { finished: true, startedAt: 1 },
      [today + 5]: { finished: true, startedAt: 1 },
    };
    pruneForwardWalkArtifacts(p);
    eq(Object.keys(p).length, 0, "all future-index artifacts removed");
  });
  test("prune: drops today's entry if it was finished before today began", () => {
    const today = dayIndexToday();
    const beforeMidnight = new Date(); beforeMidnight.setHours(0, 0, 0, 0);
    const p = { [today]: { finished: true, startedAt: beforeMidnight.getTime() - 1000 } };
    pruneForwardWalkArtifacts(p);
    ok(!(today in p), "stale today-artifact from a prior forward-walk is removed");
  });
  test("prune: keeps today's entry when genuinely played today", () => {
    const today = dayIndexToday();
    const afterMidnight = new Date(); afterMidnight.setHours(0, 0, 0, 0);
    const p = { [today]: { finished: true, startedAt: afterMidnight.getTime() + 60000 } };
    pruneForwardWalkArtifacts(p);
    ok(today in p, "a board actually started today is preserved");
  });
  test("prune: never touches past-day puzzles (legit extra rounds)", () => {
    const today = dayIndexToday();
    const p = {
      [today - 1]: { finished: true, startedAt: 1 },
      [today - 30]: { finished: true, startedAt: 1 },
    };
    pruneForwardWalkArtifacts(p);
    eq(Object.keys(p).length, 2, "past-day history is left intact");
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

  // ---- Rewind-button delete: tap = one letter, hold = wipe whole row -------
  // The hold fires on a real timer (CONFIG.holdToWipeMs), so these await a delay
  // shorter/longer than the threshold to model a tap vs. a hold. wipeCurrentRow
  // is also tested directly (deterministic, no timer).
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Like withRound, but keeps the round state alive across awaits (the tap/hold
  // timer resolves after fn's first synchronous chunk) — restores when fn's
  // promise settles instead of the moment it returns.
  async function withRoundAsync(answer, guesses, fn) {
    const snap = { answer: game.answer, guesses: game.guesses,
                   cells: game.cells, locked: game.locked, finished: game.finished };
    try {
      game.answer = answer; game.guesses = guesses.slice(); game.finished = false;
      resetCurrentRow();
      await fn();
    } finally { Object.assign(game, snap); }
  }
  test("wipe: clears the entire row including locked greens", () => {
    withRound("PLATE", ["PLANE"], () => {
      typeLetter("T");                 // -> PLATE, greens P/L/A/E locked
      wipeCurrentRow();
      eq(game.cells, ["", "", "", "", ""], "all cells cleared");
      eq(game.locked, [false, false, false, false, false], "greens unlocked too");
      eq(nextEditableCol(), 0, "cursor back to column 0");
    });
  });
  test("rewind: a quick tap deletes exactly one letter (greens survive)", async () => {
    await withRoundAsync("PLATE", ["PLANE"], async () => {
      typeLetter("T");                 // -> PLATE
      rewindPress();
      await delay(50);                 // release before the hold threshold => tap
      rewindRelease();
      eq(game.cells, ["P", "L", "A", "", "E"], "one letter removed, greens kept");
    });
  });
  test("rewind: holding past the threshold wipes the whole row", async () => {
    await withRoundAsync("PLATE", ["PLANE"], async () => {
      typeLetter("T");                 // -> PLATE
      rewindPress();
      await delay(620);                // past CONFIG.holdToWipeMs (500ms) => wipe
      rewindRelease();
      eq(game.cells, ["", "", "", "", ""], "row wiped by the hold");
      eq(game.locked, [false, false, false, false, false], "greens cleared");
    });
  });

  // ---- hint rules: random unknown letter, one per row, never the last ------
  // unrevealedColumns/hintAvailable are pure over game state, so poke it with
  // withRound and read back. game.hintRow is the one-per-row latch; it equals
  // game.guesses.length once a hint is spent on the current row.
  function withHintState(answer, guesses, hintRow, fn) {
    const snap = { hintRow: game.hintRow };
    withRound(answer, guesses, () => {
      game.hintRow = hintRow;
      fn();
    });
    game.hintRow = snap.hintRow;
  }
  test("hint: unrevealedColumns lists only columns with no prior green", () => {
    // answer PLATE; guessed PLANE -> greens at 0,1,2,4; only col 3 is unknown.
    withRound("PLATE", ["PLANE"], () => {
      eq(unrevealedColumns(), [3], "col 3 is the only un-greened column");
    });
  });
  test("hint: fresh row with >=2 unknowns offers a hint", () => {
    withHintState("PLATE", [], -1, () => {
      eq(unrevealedColumns().length, 5, "nothing revealed yet");
      ok(hintAvailable(), "hint available on a fresh 5-unknown row");
    });
  });
  test("hint: disabled when only one unknown letter remains", () => {
    // PLANE reveals all but col 3 -> a single unknown -> revealing it = the answer
    withHintState("PLATE", ["PLANE"], -1, () => {
      eq(unrevealedColumns().length, 1, "one unknown left");
      ok(!hintAvailable(), "no hint when it would hand over the last letter");
    });
  });
  test("hint: one per row — spent on this row disables until next row", () => {
    // Two unknowns (cols 3,4 via a guess that greens 0,1,2), but hintRow already
    // equals guesses.length => the hint for THIS row is spent.
    withHintState("PLANK", ["PLAID"], 1, () => {
      ok(unrevealedColumns().length >= 2, "still >=2 unknowns");
      eq(game.guesses.length, 1, "on row index 1");
      ok(!hintAvailable(), "hint already burned for this row");
    });
  });
  test("hint: a stale hintRow from an earlier row doesn't block the new row", () => {
    // Spent a hint on row 0 (hintRow=0) but we're now on row 1 -> available again.
    withHintState("PLANK", ["PLAID"], 0, () => {
      eq(game.guesses.length, 1, "advanced to row 1");
      ok(hintAvailable(), "new row => fresh hint");
    });
  });
  test("hint: never offered once the puzzle is finished", () => {
    withHintState("PLATE", [], -1, () => {
      game.finished = true;
      ok(!hintAvailable(), "no hint after the round ends");
    });
  });
  // hintDisabledReason drives the button's explanatory copy ("Hint used /
  // Next row" etc.), so each disabled state must map to the right reason.
  test("hint: reason is null when a hint is available", () => {
    withHintState("PLATE", [], -1, () => {
      eq(hintDisabledReason(), null, "available => no reason");
    });
  });
  test("hint: reason 'used' when spent on the current row", () => {
    withHintState("PLANK", ["PLAID"], 1, () => {
      eq(hintDisabledReason(), "used", "burned this row => 'used'");
    });
  });
  test("hint: reason 'last' when only one unknown letter remains", () => {
    withHintState("PLATE", ["PLANE"], -1, () => {
      eq(hintDisabledReason(), "last", "one unknown => 'last'");
    });
  });
  test("hint: reason 'finished' after the round ends", () => {
    withHintState("PLATE", [], -1, () => {
      game.finished = true;
      eq(hintDisabledReason(), "finished", "over => 'finished'");
    });
  });

  // ---- keyboard row-wrap navigation (fewer D-pad presses on a remote) -----
  // Left/Right loop within each keyboard row. nextKeyInRow is pure over the
  // layout, so it's tested without a DOM.
  test("kb-wrap: Right from P wraps to Q; Left from Q wraps to P", () => {
    eq(nextKeyInRow("P", "right"), "Q", "end of row 1 wraps to its start");
    eq(nextKeyInRow("Q", "left"), "P", "start of row 1 wraps to its end");
  });
  test("kb-wrap: Right from L wraps to A; Left from A wraps to L", () => {
    eq(nextKeyInRow("L", "right"), "A", "end of row 2 wraps to its start");
    eq(nextKeyInRow("A", "left"), "L", "start of row 2 wraps to its end");
  });
  test("kb-wrap: Right from ENTER wraps to Z; Left from Z wraps to ENTER", () => {
    // Row 3 is Z X C V B N M DEL ENTER — ENTER is the last key, Z the first.
    eq(nextKeyInRow("ENTER", "right"), "Z", "last key wraps to first");
    eq(nextKeyInRow("Z", "left"), "ENTER", "first key wraps to last");
  });
  test("kb-wrap: mid-row steps are ordinary neighbors (no wrap)", () => {
    eq(nextKeyInRow("A", "right"), "S");
    eq(nextKeyInRow("S", "left"), "A");
    eq(nextKeyInRow("DEL", "right"), "ENTER", "DEL -> ENTER within row 3");
  });
  test("kb-wrap: a non-keyboard key returns null (falls back to geometry)", () => {
    eq(nextKeyInRow("nope", "right"), null);
    eq(nextKeyInRow(undefined, "left"), null);
  });

  // ---- native BACK contract ----------------------------------------------
  // Capture what the bridge posts to native by swapping in a recording API.
  // Skipped automatically if the headless harness didn't expose the bridge.
  function withBridge(fn) {
    if (!nativeBridge) throw new Error("nativeBridge not exposed by harness");
    const sent = [];
    const realApi = (typeof window !== "undefined") ? window.WordsOnDemand : undefined;
    if (typeof window !== "undefined") {
      window.WordsOnDemand = { postMessage: (m) => sent.push(m), onMessage: null };
    }
    // Wire the bridge exactly as it is in production: both inbound channels.
    // This is what makes the double-delivery reproducible in tests.
    nativeBridge.init();
    // A press as native REALLY delivers it: through both channels in one tick.
    // Channel A: the injected onMessage callback. Channel B: the wod:message
    // event. `dispatchEvent` needs a real Event in a browser but takes a plain
    // object in the Node stub — build a CustomEvent when the constructor exists.
    const api = (typeof window !== "undefined") ? window.WordsOnDemand : null;
    const fireOnMessage = (msg) => { if (api && typeof api.onMessage === "function") api.onMessage(msg); };
    const fireEvent = (msg) => {
      if (typeof window === "undefined" || !window.dispatchEvent) return;
      const evt = (typeof CustomEvent === "function")
        ? new CustomEvent("wod:message", { detail: msg })
        : { type: "wod:message", detail: msg };
      window.dispatchEvent(evt);
    };
    // Simulate ONE physical back press: fire both channels synchronously (same
    // tick), just like the native host does. The dedup guard must collapse them.
    const pressBack = () => {
      fireOnMessage({ type: "back" });
      fireEvent({ type: "back" });
    };
    // Make sure we start from a clean slate: home screen, no modal, and no
    // leftover per-press dedup flag from a prior sync test (its reset tick may
    // not have fired yet).
    nativeBridge._backHandledThisTick = false;
    if (isModalOpen()) closeModal();
    showScreen("home");
    sent.length = 0; // drop the `ready` from init(); tests assert on press output
    const done = fn(sent, pressBack);
    const cleanup = () => {
      if (isModalOpen()) closeModal();
      if (typeof window !== "undefined") window.WordsOnDemand = realApi;
    };
    // Support both sync and async test bodies.
    if (done && typeof done.then === "function") return done.finally(cleanup);
    cleanup();
    return undefined;
  }

  test("back: on home raises the exit dialog and replies back-handled first", () => {
    withBridge((sent, pressBack) => {
      pressBack();
      // Must reply synchronously so native doesn't exit under the dialog...
      ok(sent.some((m) => m.type === "back-handled"), "sent back-handled");
      // ...and must NOT have sent exit merely by opening the dialog.
      ok(!sent.some((m) => m.type === "exit"), "no premature exit");
      ok(isModalOpen(), "exit dialog is open");
    });
  });

  // The on-device regression: ONE press must be handled ONCE even though the
  // native host delivers it through both inbound channels in the same tick.
  test("back: a single press delivered via BOTH channels is handled once", () => {
    withBridge((sent, pressBack) => {
      pressBack(); // fires onMessage + wod:message together (one physical press)
      eq(sent.filter((m) => m.type === "back-handled").length, 1,
         "exactly one back-handled for one press");
      ok(isModalOpen(), "dialog opened once, not opened-then-closed");
    });
  });

  // The exact flow the user typed:
  //   Nested > Back > Home (no dialog) > Back > Exit dialog.
  test("back: nested→home shows NO dialog; only a second press on home exits", async () => {
    await withBridge(async (sent, pressBack) => {
      showScreen("howto");
      sent.length = 0;
      pressBack();                                  // press #1: nested → home
      eq(getActiveScreen(), "home", "first back lands on home");
      ok(!isModalOpen(), "NO dialog after landing on home (the bug was a dialog here)");
      eq(sent.filter((m) => m.type === "back-handled").length, 1, "one reply for press #1");
      await tick();                                 // separate physical press = later tick
      sent.length = 0;
      pressBack();                                  // press #2: on home → exit dialog
      ok(isModalOpen(), "second back on home raises the exit dialog");
      eq(sent.filter((m) => m.type === "back-handled").length, 1, "one reply for press #2");
    });
  });

  test("back: on home, then a later press closes the dialog (not a no-op)", async () => {
    await withBridge(async (sent, pressBack) => {
      pressBack();                                  // press #1: opens dialog on home
      ok(isModalOpen(), "dialog open");
      await tick();
      sent.length = 0;
      pressBack();                                  // press #2: closes the dialog
      ok(!isModalOpen(), "dialog closed by the next press");
      eq(sent.filter((m) => m.type === "back-handled").length, 1, "one reply");
      ok(!sent.some((m) => m.type === "exit"), "closing the dialog is not an exit");
    });
  });

  test("back: unknown/malformed native messages are ignored", () => {
    withBridge((sent) => {
      nativeBridge.onNativeMessage(null);
      nativeBridge.onNativeMessage({});
      nativeBridge.onNativeMessage({ type: "nope" });
      eq(sent.length, 0, "nothing sent for junk messages");
    });
  });
  test("bridge: no-op in a plain browser (no window.WordsOnDemand)", () => {
    const realApi = (typeof window !== "undefined") ? window.WordsOnDemand : undefined;
    try {
      if (typeof window !== "undefined") window.WordsOnDemand = undefined;
      // Neither of these should throw when the native bridge is absent.
      nativeBridge.init();
      nativeBridge.send("ready");
      ok(true, "init/send are safe no-ops without a native host");
    } finally {
      if (typeof window !== "undefined") window.WordsOnDemand = realApi;
    }
  });

  // ---- formatDuration ----------------------------------------------------
  test("formatDuration: sub-minute shows seconds", () => { eq(formatDuration(5000), "5s"); });
  test("formatDuration: rounds to nearest second", () => { eq(formatDuration(5400), "5s"); });
  test("formatDuration: minutes:seconds with zero-pad", () => { eq(formatDuration(72000), "1:12"); });
  test("formatDuration: exact minute", () => { eq(formatDuration(60000), "1:00"); });

  // ---- formatStartedAt: device-time stamp for history --------------------
  test("formatStartedAt: missing/zero timestamp -> empty (old saves omit it)", () => {
    eq(formatStartedAt(0), "");
    eq(formatStartedAt(null), "");
    eq(formatStartedAt(undefined), "");
  });
  test("formatStartedAt: NaN/garbage -> empty, never 'Invalid Date'", () => {
    eq(formatStartedAt(NaN), "");
  });
  test("formatStartedAt: a real timestamp renders a non-empty date · time", () => {
    const s = formatStartedAt(Date.UTC(2026, 6, 24, 15, 7)); // Jul 24 2026
    ok(typeof s === "string" && s.length > 0, "produced a stamp");
    ok(s.includes("·"), "has the date · time separator");
    ok(/2026/.test(s), "includes the year");
  });

  // Drain the queue sequentially, awaiting async tests. Exposes a promise so the
  // runners (Node + tests.html) can wait for completion before reporting.
  async function run() {
    for (const { name, fn } of queue) {
      try { await fn(); results.push({ name, ok: true }); }
      catch (e) { results.push({ name, ok: false, msg: e.message }); }
    }
    root.WOD_TEST_RESULTS = results;
    return results;
  }
  root.WOD_TEST_DONE = run();
  return root.WOD_TEST_DONE;
})(typeof globalThis !== "undefined" ? globalThis : this);
