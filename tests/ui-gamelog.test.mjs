/**
 * The game is stored as a journal of actions and rebuilt by replaying it
 * through the core. The test that matters here is the one that proves the two
 * paths - playing live and replaying a journal - end in the same game.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_TYPES,
  applyAction,
  assertAction,
  createGameFromState,
  isGameSetupComplete,
  replayGame,
  runJournal,
} from '../src/ui/gameLog.js';
import { createDefaultState, deserializeState, serializeState } from '../src/ui/store.js';
import {
  buildAnswerLog,
  createGameState,
  endTurn,
  passTurn,
  renderLogEntryEn,
  resign,
  startTurn,
  tryStep,
  undoLastTurn,
} from '../src/core/game.js';
import { normalizeSettings } from '../src/core/settings.js';
import { resolveStep } from '../src/ui/screens/play.js';

/**
 * The interface state a game is built from.
 *
 * @returns {object} A complete setup.
 */
function setupState() {
  return {
    ...createDefaultState(),
    myPlayer: 1,
    settings: normalizeSettings({ allow_pass: 1, new_cells_per_turn: 3 }),
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,0', 'H1,1'] },
    opponentEnds: { entrance: { r: 0, c: 0 }, exit: { r: 0, c: 2 } },
  };
}

/** A game that uses every kind of action there is. */
const JOURNAL = Object.freeze([
  { type: 'START_TURN' },
  { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
  { type: 'STEP', side: 'me', direction: 'right', answer: 'wall' },
  { type: 'END_TURN' },
  { type: 'START_TURN' },
  { type: 'STEP', side: 'opponent', direction: 'down' },
  { type: 'END_TURN' },
  { type: 'START_TURN' },
  { type: 'STEP', side: 'me', direction: 'down', answer: 'pass' },
  { type: 'END_TURN' },
  { type: 'PASS' },
  { type: 'START_TURN' },
  { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
  { type: 'END_TURN' },
  { type: 'UNDO' },
  { type: 'RESIGN', side: 'me' },
]);

/**
 * Plays the same game by calling the core directly.
 *
 * @param {object} uiState Setup.
 * @returns {object} The finished game state.
 */
function playByHand(uiState) {
  const game = createGameState({
    settings: uiState.settings,
    myMaze: uiState.myMaze,
    opponentEntrance: uiState.opponentEnds.entrance,
    opponentExit: uiState.opponentEnds.exit,
    myPlayer: uiState.myPlayer,
  });

  startTurn(game);
  tryStep(game, 'me', 'right', 'pass');
  tryStep(game, 'me', 'right', 'wall');
  endTurn(game);

  startTurn(game);
  tryStep(game, 'opponent', 'down');
  endTurn(game);

  startTurn(game);
  tryStep(game, 'me', 'down', 'pass');
  endTurn(game);

  passTurn(game);

  startTurn(game);
  tryStep(game, 'me', 'right', 'pass');
  endTurn(game);

  undoLastTurn(game);
  resign(game, 'me');
  return game;
}

/**
 * Everything about a game that has to survive a reload, in a shape assert can
 * compare.
 *
 * @param {object} game Core game state.
 * @returns {object} A plain description.
 */
function describe(game) {
  const side = (name) => {
    const board = game.sides[name];
    return {
      pos: board.pos,
      visited: [...board.visited].sort((a, b) => a - b),
      knownWalls: [...board.knownWalls].sort(),
      knownOpen: [...board.knownOpen].sort(),
      moves: board.moves,
      firstExitMove: board.firstExitMove,
      resigned: board.resigned,
      newCellsThisTurn: board.newCellsThisTurn,
    };
  };
  return {
    globalMove: game.globalMove,
    current: game.current,
    turnActive: game.turnActive,
    undoDepth: game.undoStack.length,
    me: side('me'),
    opponent: side('opponent'),
    history: game.history.map((entry) => `${entry.side}|${renderLogEntryEn(entry)}`),
  };
}

test('every action type is known to the journal', () => {
  assert.deepEqual([...ACTION_TYPES].sort(), [
    'END_TURN',
    'PASS',
    'RESIGN',
    'START_TURN',
    'STEP',
    'UNDO',
    'UNDO_STEP',
  ]);
});

test('a step taken back leaves the game exactly as if it never happened', () => {
  const uiState = setupState();
  const withUndo = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'down', answer: 'pass' },
    { type: 'UNDO_STEP' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'END_TURN' },
  ];
  const without = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'END_TURN' },
  ];

  assert.deepEqual(describe(replayGame(uiState, withUndo)), describe(replayGame(uiState, without)));
  assert.equal(
    renderLogEntryEn(replayGame(uiState, withUndo).history[0]),
    '1. A1-A2; A2-A3',
    'the closed turn shows no trace of the cancelled step',
  );
});

test('two steps can be taken back one after the other', () => {
  const uiState = setupState();
  const journal = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'down', answer: 'pass' },
    { type: 'UNDO_STEP' },
    { type: 'UNDO_STEP' },
  ];
  const game = replayGame(uiState, journal);
  assert.deepEqual(game.sides.me.pos, { r: 0, c: 0 }, 'the pawn is back at the entrance');
  assert.equal(game.sides.me.turnSteps.length, 0);
  assert.equal(game.turnActive, true, 'the turn is still open');
});

test('the correction says which step was taken back, and where', () => {
  const uiState = setupState();
  const { corrections } = runJournal(uiState, [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'down', answer: 'wall' },
    { type: 'UNDO_STEP' },
  ]);
  assert.equal(corrections.length, 1);
  assert.deepEqual(corrections[0].from, { r: 0, c: 1 }, 'the pawn never moved, so it is still here');
  assert.deepEqual(corrections[0].to, { r: 1, c: 1 });
  assert.equal(corrections[0].move, 1);
  assert.equal(corrections[0].side, 'me');
  assert.equal(corrections[0].at, 0, 'it belongs before the turn line that is not written yet');
});

test('a step cannot be taken back once the turn is closed', () => {
  const uiState = setupState();
  assert.throws(
    () =>
      replayGame(uiState, [
        { type: 'START_TURN' },
        { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
        { type: 'END_TURN' },
        { type: 'UNDO_STEP' },
      ]),
    /takes back a step, but the open turn has none left/,
  );
  assert.throws(() => replayGame(uiState, [{ type: 'UNDO_STEP' }]), /none left to take back/);
  assert.throws(
    () => replayGame(uiState, [{ type: 'START_TURN' }, { type: 'UNDO_STEP' }]),
    /none left to take back/,
  );
});

test('a step taken back never reaches the log that goes to verification', () => {
  const uiState = setupState();
  const game = replayGame(uiState, [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'down', answer: 'wall' },
    { type: 'UNDO_STEP' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'wall' },
    { type: 'END_TURN' },
  ]);
  const log = buildAnswerLog(game, 'me');
  assert.deepEqual(log.map((record) => `${record.answer} ${record.from.r},${record.from.c}`), [
    'pass 0,0',
    'wall 0,1',
  ]);
  assert.equal(
    log.some((record) => record.to.r === 1),
    false,
    'the cancelled step is nowhere in the log',
  );
});

test('a second resignation is refused', () => {
  const uiState = setupState();
  assert.throws(
    () => replayGame(uiState, [{ type: 'RESIGN', side: 'me' }, { type: 'RESIGN', side: 'me' }]),
    /already resigned/,
  );

  const game = replayGame(uiState, [{ type: 'RESIGN', side: 'me' }]);
  assert.equal(game.sides.me.resigned, true);
  assert.equal(
    game.history.filter((entry) => entry.type === 'RESIGN').length,
    1,
    'one announcement, one line',
  );
  // Each side may still resign once.
  assert.equal(
    replayGame(uiState, [{ type: 'RESIGN', side: 'me' }, { type: 'RESIGN', side: 'opponent' }])
      .sides.opponent.resigned,
    true,
  );
});

test('an edge that was already walked is answered from the map, not asked again', () => {
  const uiState = setupState();
  // Walk right, then back left, then right again over the same edge.
  const game = replayGame(uiState, [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'END_TURN' },
    { type: 'START_TURN' },
    { type: 'STEP', side: 'opponent', direction: 'down' },
    { type: 'END_TURN' },
    { type: 'START_TURN' },
  ]);

  const known = resolveStep(game, 'me', 'left');
  assert.equal(known.mode, 'auto', 'the edge behind the pawn is known to be open');
  assert.equal(known.answer, 'pass');

  const unknown = resolveStep(game, 'me', 'down');
  assert.equal(unknown.mode, 'ask', 'an edge nobody spoke about is still a question');
  assert.equal(unknown.answer, null);

  const border = resolveStep(game, 'me', 'up');
  assert.equal(border.mode, 'off-board');

  const theirs = resolveStep(game, 'opponent', 'right');
  assert.equal(theirs.mode, 'own-maze', 'my own walls answer for the other board');
});

test('a known wall is never answered automatically', () => {
  const uiState = setupState();
  const game = replayGame(uiState, [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'down', answer: 'wall' },
  ]);
  const known = resolveStep(game, 'me', 'down');
  assert.equal(known.mode, 'confirm-wall', 'it is offered for confirmation, not assumed');
  assert.equal(known.answer, 'wall');
});

test('an automatic step spends none of the per turn allowance', () => {
  const uiState = setupState();
  const journal = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'left', answer: 'pass', auto: true },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass', auto: true },
  ];
  const game = replayGame(uiState, journal);
  assert.equal(
    game.sides.me.newCellsThisTurn,
    1,
    'only the first step opened a cell nobody had been in',
  );
  assert.deepEqual(game.sides.me.pos, { r: 0, c: 1 });
  assert.equal(game.sides.me.turnSteps.every((step) => step.result === 'pass'), true);
});

test('the auto flag is carried in the journal and changes nothing for the core', () => {
  const uiState = setupState();
  const withFlag = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass', auto: true },
    { type: 'END_TURN' },
  ];
  const withoutFlag = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'END_TURN' },
  ];
  assert.deepEqual(describe(replayGame(uiState, withFlag)), describe(replayGame(uiState, withoutFlag)));
  assert.equal(assertAction(withFlag[1]).auto, true);
  assert.equal(assertAction(withoutFlag[1]).auto, false);
  // The flag belongs to my own walk only; the other board has no voice to ask.
  assert.throws(
    () => assertAction({ type: 'STEP', side: 'opponent', direction: 'up', auto: true }),
    /must not carry an answer|auto/,
  );
});

test('UNDO_STEP is never handed to the core', () => {
  const uiState = setupState();
  const game = createGameFromState(uiState);
  assert.throws(() => applyAction(game, { type: 'UNDO_STEP' }), /resolved by the replay/);
});

test('replaying the journal lands on exactly the game that was played', () => {
  const uiState = setupState();
  const byHand = playByHand(uiState);
  const replayed = replayGame(uiState, JOURNAL);

  assert.deepEqual(describe(replayed), describe(byHand));
  assert.equal(replayed.history.length, 7, 'four turns, a pass, an undo line and a resignation');
  assert.equal(replayed.sides.me.resigned, true);
});

test('replaying twice from the same journal gives the same game', () => {
  const uiState = setupState();
  assert.deepEqual(
    describe(replayGame(uiState, JOURNAL)),
    describe(replayGame(uiState, JOURNAL)),
  );
});

test('the journal survives storage as it is', () => {
  const uiState = { ...setupState(), gameActions: [...JOURNAL] };
  const restored = deserializeState(JSON.parse(JSON.stringify(serializeState(uiState))));
  // Storage normalises the entries, which is where `auto: false` appears.
  assert.deepEqual(restored.gameActions, JOURNAL.map((action) => assertAction(action)));
  assert.equal(restored.gameLoadError, null);
  assert.deepEqual(
    describe(replayGame(restored, restored.gameActions)),
    describe(replayGame(uiState, JOURNAL)),
  );
});

test('a damaged journal is refused with a message that names the entry', () => {
  const uiState = setupState();

  for (const [journal, pattern] of [
    [[{ type: 'END_TURN' }], /entry 1 of 1/],
    [[{ type: 'START_TURN' }, { type: 'START_TURN' }], /entry 2 of 2/],
    [[{ type: 'NONSENSE' }], /unknown journal entry type/],
    [[{ type: 'STEP', side: 'me', direction: 'right' }], /needs an answer/],
    [[{ type: 'STEP', side: 'opponent', direction: 'up', answer: 'pass' }], /must not carry an answer/],
    [[{ type: 'START_TURN' }, { type: 'STEP', side: 'opponent', direction: 'down' }], /it is the turn of side "me"/],
  ]) {
    let thrown = null;
    try {
      replayGame(uiState, journal);
    } catch (error) {
      thrown = error;
    }
    assert.notEqual(thrown, null, `${JSON.stringify(journal)} should not replay`);
    assert.match(thrown.message, pattern);
  }
});

test('a pass that the settings do not allow cannot be replayed', () => {
  const uiState = { ...setupState(), settings: normalizeSettings({ allow_pass: 0 }) };
  assert.throws(() => replayGame(uiState, [{ type: 'PASS' }]), /passing is not allowed/);
});

test('a journal with one bad entry is dropped whole, not half applied', () => {
  const uiState = { ...setupState(), gameActions: [...JOURNAL] };
  const snapshot = serializeState(uiState);
  snapshot.gameActions = [...JOURNAL.slice(0, 3), { type: 'FLY' }, ...JOURNAL.slice(3)];

  const restored = deserializeState(snapshot);
  assert.deepEqual(restored.gameActions, []);
  assert.equal(restored.gameLoadError, 'CORRUPT_JOURNAL');
  // And the setup is untouched, so the game can simply start again.
  assert.equal(isGameSetupComplete(restored), true);
  assert.equal(createGameFromState(restored).globalMove, 1);
});

test('a journal that is not even an array is dropped', () => {
  const snapshot = serializeState({ ...setupState(), gameActions: [] });
  snapshot.gameActions = 'nonsense';
  const restored = deserializeState(snapshot);
  assert.deepEqual(restored.gameActions, []);
  assert.equal(restored.gameLoadError, 'CORRUPT_JOURNAL');
});

test('an incomplete setup refuses to start a game instead of crashing', () => {
  const withoutEnds = { ...setupState(), opponentEnds: { entrance: null, exit: null } };
  assert.equal(isGameSetupComplete(withoutEnds), false);
  assert.throws(() => createGameFromState(withoutEnds), /the game cannot start/);
  assert.throws(() => replayGame(withoutEnds, []), /the game cannot start/);
});

test('actions are normalised and junk is refused', () => {
  assert.deepEqual(assertAction({ type: 'START_TURN', extra: 1 }), { type: 'START_TURN' });
  assert.deepEqual(assertAction({ type: 'STEP', side: 'opponent', direction: 'up' }), {
    type: 'STEP',
    side: 'opponent',
    direction: 'up',
  });
  assert.deepEqual(assertAction({ type: 'RESIGN', side: 'me' }), { type: 'RESIGN', side: 'me' });

  assert.throws(() => assertAction(null), /must be an object/);
  assert.throws(() => assertAction({}), /unknown journal entry type/);
  assert.throws(() => assertAction({ type: 'STEP', side: 'nobody', direction: 'up' }), /needs a side/);
  assert.throws(() => assertAction({ type: 'STEP', side: 'me', direction: 'sideways', answer: 'pass' }), /needs a direction/);
  assert.throws(() => assertAction({ type: 'STEP', side: 'me', direction: 'up', answer: 'maybe' }), /needs an answer/);
  assert.throws(() => assertAction({ type: 'RESIGN' }), /needs a side/);
});

test('applyAction hands the core result back, hints included', () => {
  const uiState = setupState();
  const game = createGameFromState(uiState);
  applyAction(game, { type: 'START_TURN' });
  const step = applyAction(game, { type: 'STEP', side: 'me', direction: 'down', answer: 'wall' });
  assert.equal(step.result, 'wall');
  assert.equal(step.hints.includes('TURN_OVER_WALL'), true);
  const closed = applyAction(game, { type: 'END_TURN' });
  assert.equal(closed.entry.type, 'MOVE');
});
