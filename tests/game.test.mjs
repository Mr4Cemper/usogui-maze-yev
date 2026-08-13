import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HINTS,
  buildAnswerLog,
  createGameState,
  endTurn,
  passTurn,
  renderLogEntryEn,
  resign,
  startTurn,
  totalMoves,
  tryStep,
  undoLastTurn,
} from '../src/core/game.js';
import { createMaze } from '../src/core/maze.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

/**
 * Builds a game where this device is player 1 and moves first.
 *
 * @param {object} [options={}] Overrides.
 * @param {object} [options.settings={}] Settings overrides.
 * @param {object} [options.myMaze] The maze the opponent walks.
 * @param {{r: number, c: number}} [options.opponentEntrance] Announced entrance.
 * @param {{r: number, c: number}} [options.opponentExit] Announced exit.
 * @returns {object} A fresh game state.
 */
function makeGame(options = {}) {
  return createGameState({
    settings: { ...DEFAULT_SETTINGS, ...(options.settings ?? {}) },
    myMaze: options.myMaze ?? createMaze({
      entrance: { r: 0, c: 0 },
      exit: { r: 5, c: 5 },
      walls: ['V0,0'],
    }),
    opponentEntrance: options.opponentEntrance ?? { r: 0, c: 0 },
    opponentExit: options.opponentExit ?? { r: 5, c: 5 },
    myPlayer: 1,
  });
}

test('a fresh game starts with the pawns on the entrances', () => {
  const state = makeGame();
  assert.equal(state.globalMove, 1);
  assert.equal(state.current, 'me');
  assert.deepEqual(state.sides.me.pos, { r: 0, c: 0 });
  assert.deepEqual(state.sides.opponent.pos, { r: 0, c: 0 });
  assert.equal(state.sides.me.visited.size, 1, 'the entrance counts as visited');
  assert.equal(totalMoves(state), 0);
  assert.deepEqual(state.history, []);
});

test('first_move and myPlayer decide who opens', () => {
  assert.equal(makeGame({ settings: { first_move: 0 } }).current, 'me');
  assert.equal(makeGame({ settings: { first_move: 1 } }).current, 'opponent');

  const asPlayerTwo = createGameState({
    settings: { ...DEFAULT_SETTINGS, first_move: 1 },
    myMaze: createMaze({ entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: [] }),
    opponentEntrance: { r: 0, c: 0 },
    opponentExit: { r: 5, c: 5 },
    myPlayer: 2,
  });
  assert.equal(asPlayerTwo.current, 'me');
});

test('a wall ends the turn and spends nothing, revisits spend nothing, the third new cell hints', () => {
  const state = makeGame();
  startTurn(state);

  const intoWall = tryStep(state, 'me', 'down', 'wall');
  assert.equal(intoWall.result, 'wall');
  assert.equal(intoWall.isNewCell, false);
  assert.equal(intoWall.hints.includes('TURN_OVER_WALL'), true);
  assert.deepEqual(state.sides.me.pos, { r: 0, c: 0 }, 'the pawn stays where it was');
  assert.equal(state.sides.me.newCellsThisTurn, 0, 'a wall does not spend the allowance');

  const first = tryStep(state, 'me', 'right', 'pass');
  assert.equal(first.isNewCell, true);
  assert.equal(state.sides.me.newCellsThisTurn, 1);
  assert.deepEqual(first.hints, []);

  const back = tryStep(state, 'me', 'left', 'pass');
  assert.equal(back.isNewCell, false, 'A1 was visited already');
  assert.equal(state.sides.me.newCellsThisTurn, 1);

  const again = tryStep(state, 'me', 'right', 'pass');
  assert.equal(again.isNewCell, false, 'A2 was visited already');
  assert.equal(state.sides.me.newCellsThisTurn, 1);

  const second = tryStep(state, 'me', 'right', 'pass');
  assert.equal(second.isNewCell, true);
  assert.equal(second.hints.includes('TURN_OVER_NEW_CELLS'), false, 'only two so far');

  const third = tryStep(state, 'me', 'right', 'pass');
  assert.equal(third.isNewCell, true);
  assert.equal(state.sides.me.newCellsThisTurn, 3);
  assert.equal(third.hints.includes('TURN_OVER_NEW_CELLS'), true);

  // The core hints, it does not block: a fourth new cell is still allowed.
  const fourth = tryStep(state, 'me', 'right', 'pass');
  assert.equal(fourth.result, 'pass');
  assert.equal(state.sides.me.newCellsThisTurn, 4);
});

test('a wall that is already known is flagged before the step is answered', () => {
  const state = makeGame();
  startTurn(state);
  tryStep(state, 'me', 'down', 'wall');
  const second = tryStep(state, 'me', 'down', 'wall');
  assert.equal(second.hints.includes('KNOWN_WALL_WARNING'), true);
  assert.equal(second.hints.includes('TURN_OVER_WALL'), true);
});

test('the side whose maze this device holds answers for itself', () => {
  const state = makeGame({ settings: { first_move: 1 } });
  assert.equal(state.current, 'opponent');
  startTurn(state);

  const intoWall = tryStep(state, 'opponent', 'right');
  assert.equal(intoWall.result, 'wall', 'V0,0 is a wall of my own maze');
  assert.equal(intoWall.edge, 'V0,0');

  const through = tryStep(state, 'opponent', 'down');
  assert.equal(through.result, 'pass');
  assert.deepEqual(state.sides.opponent.pos, { r: 1, c: 0 });

  assert.throws(() => tryStep(state, 'opponent', 'down', 'pass'), /no answer may be supplied/);
});

test('the side walking the other maze needs the answer that was given', () => {
  const state = makeGame();
  startTurn(state);
  assert.throws(() => tryStep(state, 'me', 'right'), /answer must be "pass" or "wall"/);
  assert.throws(() => tryStep(state, 'me', 'right', 'maybe'), /answer must be "pass" or "wall"/);
});

test('the exit is remembered by the move it was first reached on', () => {
  const state = makeGame({ opponentExit: { r: 0, c: 1 } });
  startTurn(state);
  const reached = tryStep(state, 'me', 'right', 'pass');
  assert.equal(reached.hints.includes('REACHED_EXIT'), true);
  assert.equal(state.sides.me.firstExitMove, 1);
  endTurn(state);

  startTurn(state);
  tryStep(state, 'opponent', 'down');
  endTurn(state);

  assert.equal(state.globalMove, 3);
  startTurn(state);
  tryStep(state, 'me', 'left', 'pass');
  const secondVisit = tryStep(state, 'me', 'right', 'pass');
  assert.equal(secondVisit.hints.includes('REACHED_EXIT'), true);
  assert.equal(state.sides.me.firstExitMove, 1, 'coming back later changes nothing');
});

test('ending a turn writes the history line and hands the move over', () => {
  const state = makeGame();
  startTurn(state);
  tryStep(state, 'me', 'right', 'pass');
  tryStep(state, 'me', 'right', 'pass');
  tryStep(state, 'me', 'right', 'wall');
  const { entry } = endTurn(state);

  assert.deepEqual(Object.keys(entry).sort(), ['move', 'side', 'steps', 'type', 'wall']);
  assert.equal('text' in entry, false, 'the core never hands out ready made text');
  assert.equal(renderLogEntryEn(entry), '1. A1-A2; A2-A3; wall A3-A4');
  assert.equal(entry.move, 1);
  assert.equal(entry.side, 'me');
  assert.equal(entry.type, 'MOVE');
  assert.equal(entry.wall, 'V0,2');
  assert.equal(state.sides.me.moves, 1);
  assert.equal(totalMoves(state), 1);
  assert.equal(state.globalMove, 2);
  assert.equal(state.current, 'opponent');
  assert.equal(state.turnActive, false);
});

test('passing is refused while allow_pass is off, and counts as a move when it is on', () => {
  const off = makeGame({ settings: { allow_pass: 0 } });
  const refused = passTurn(off);
  assert.deepEqual(refused, { ok: false, entry: null, hints: ['PASS_NOT_ALLOWED'] });
  assert.equal(off.sides.me.moves, 0);
  assert.equal(totalMoves(off), 0);
  assert.equal(off.globalMove, 1);
  assert.deepEqual(off.history, []);
  assert.equal(off.current, 'me');

  const on = makeGame({ settings: { allow_pass: 1 } });
  const passed = passTurn(on);
  assert.equal(passed.ok, true);
  assert.equal(passed.entry.type, 'PASS');
  assert.deepEqual(passed.entry.steps, []);
  assert.equal(renderLogEntryEn(passed.entry), '1. PASS');
  assert.equal(on.sides.me.moves, 1, 'a pass grows the counter of the player');
  assert.equal(totalMoves(on), 1, 'and the game total');
  assert.equal(on.globalMove, 2);
  assert.equal(on.current, 'opponent');
  assert.equal(on.history.length, 1);
});

test('a turn that has already moved cannot be turned into a pass', () => {
  const state = makeGame({ settings: { allow_pass: 1 } });
  startTurn(state);
  tryStep(state, 'me', 'right', 'pass');
  assert.throws(() => passTurn(state), /cannot be passed/);
});

test('undo puts the board back and writes a correction line', () => {
  const state = makeGame();
  startTurn(state);
  tryStep(state, 'me', 'right', 'pass');
  tryStep(state, 'me', 'right', 'wall');
  endTurn(state);

  assert.equal(state.sides.me.visited.size, 2);
  const undoEntry = undoLastTurn(state);

  assert.equal(undoEntry.type, 'UNDO');
  assert.equal(renderLogEntryEn(undoEntry), '1. UNDO');
  assert.equal(state.history.length, 2, 'the original line stays in the archive');
  assert.equal(renderLogEntryEn(state.history[0]), '1. A1-A2; wall A2-A3');
  assert.deepEqual(state.sides.me.pos, { r: 0, c: 0 });
  assert.equal(state.sides.me.visited.size, 1);
  assert.equal(state.sides.me.knownWalls.size, 0);
  assert.equal(state.sides.me.knownOpen.size, 0);
  assert.equal(state.sides.me.moves, 0);
  assert.equal(state.globalMove, 1);
  assert.equal(state.current, 'me');
  assert.throws(() => undoLastTurn(state), /no finished turn to undo/);
});

test('undo forgets an exit that was reached during the undone turn', () => {
  const state = makeGame({ opponentExit: { r: 0, c: 1 } });
  startTurn(state);
  tryStep(state, 'me', 'right', 'pass');
  endTurn(state);
  assert.equal(state.sides.me.firstExitMove, 1);
  undoLastTurn(state);
  assert.equal(state.sides.me.firstExitMove, null);
});

test('the game move limit is a hint, never a stop', () => {
  const state = makeGame({ settings: { allow_pass: 1, move_limit_total: 2 } });
  assert.deepEqual(passTurn(state).hints, []);
  assert.deepEqual(passTurn(state).hints, ['MOVE_LIMIT_REACHED']);
  const afterLimit = passTurn(state);
  assert.equal(afterLimit.ok, true, 'the core does not end the game by itself');
  assert.equal(totalMoves(state), 3);
});

test('a limit of zero means no limit', () => {
  const state = makeGame({ settings: { allow_pass: 1, move_limit_total: 0 } });
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(passTurn(state).hints, []);
  }
});

test('closing a turn without a single step warns but is still recorded', () => {
  const state = makeGame();
  startTurn(state);
  const { entry, hints } = endTurn(state);

  assert.equal(hints.includes('EMPTY_TURN_WARNING'), true);
  assert.equal(entry.type, 'MOVE');
  assert.deepEqual(entry.steps, []);
  assert.equal(entry.wall, null);
  assert.equal(renderLogEntryEn(entry), '1.');
  assert.equal(state.sides.me.moves, 1, 'the turn still counts');
  assert.equal(state.globalMove, 2, 'and the move still changes hands');
  assert.equal(state.current, 'opponent');

  // A turn with a step does not warn.
  startTurn(state);
  assert.equal(endTurn(state).hints.includes('EMPTY_TURN_WARNING'), true);
  startTurn(state);
  tryStep(state, 'me', 'right', 'pass');
  assert.deepEqual(endTurn(state).hints, []);
});

test('the hint codes are exactly the ones of SPEC 6.1', () => {
  assert.deepEqual([...HINTS].sort(), [
    'EMPTY_TURN_WARNING',
    'KNOWN_WALL_WARNING',
    'MOVE_LIMIT_REACHED',
    'PASS_NOT_ALLOWED',
    'REACHED_EXIT',
    'TURN_OVER_NEW_CELLS',
    'TURN_OVER_WALL',
  ]);
});

test('renderLogEntryEn is a function, and it guards its argument', () => {
  assert.throws(() => renderLogEntryEn(null), /must be an object/);
  assert.throws(() => renderLogEntryEn({}), /move number and a steps array/);
  assert.equal(renderLogEntryEn({ move: 7, type: 'RESIGN', steps: [] }), '7. RESIGN');
});

test('resigning is recorded without spending a move', () => {
  const state = makeGame();
  const entry = resign(state, 'me');
  assert.equal(entry.type, 'RESIGN');
  assert.equal(renderLogEntryEn(entry), '1. RESIGN');
  assert.equal(state.sides.me.resigned, true);
  assert.equal(totalMoves(state), 0);
  assert.equal(state.current, 'me');
});

test('the answer log lists every step in order and drops undone turns', () => {
  const state = makeGame();
  startTurn(state);
  tryStep(state, 'me', 'right', 'pass');
  tryStep(state, 'me', 'down', 'wall');
  endTurn(state);

  startTurn(state);
  tryStep(state, 'opponent', 'down');
  endTurn(state);

  startTurn(state);
  tryStep(state, 'me', 'right', 'pass');
  endTurn(state);
  undoLastTurn(state);

  const log = buildAnswerLog(state, 'me');
  assert.deepEqual(log, [
    { move: 1, from: { r: 0, c: 0 }, to: { r: 0, c: 1 }, answer: 'pass' },
    { move: 1, from: { r: 0, c: 1 }, to: { r: 1, c: 1 }, answer: 'wall' },
  ]);
});

test('the turn protocol and the arguments are guarded', () => {
  const state = makeGame();
  assert.throws(() => tryStep(state, 'me', 'right', 'pass'), /no turn is open/);
  assert.throws(() => endTurn(state), /no turn is open/);

  startTurn(state);
  assert.throws(() => startTurn(state), /already in progress/);
  assert.throws(() => tryStep(state, 'opponent', 'down'), /it is the turn of side "me"/);
  assert.throws(() => tryStep(state, 'nobody', 'down', 'pass'), /side must be/);
  assert.throws(() => tryStep(state, 'me', 'sideways', 'pass'), /direction must be one of/);
  assert.throws(() => tryStep(state, 'me', 'up', 'pass'), /would leave the board/);
  assert.throws(() => tryStep(state, 'me', 'left', 'pass'), /would leave the board/);
  assert.throws(() => undoLastTurn(state), /finish the open turn/);
  assert.throws(() => tryStep(null, 'me', 'up', 'pass'), /state must be an object/);
});

test('createGameState guards its arguments', () => {
  assert.throws(() => createGameState(null), /needs an object/);
  assert.throws(
    () => createGameState({ myMaze: { entrance: { r: 0, c: 0 }, walls: [] }, opponentEntrance: { r: 0, c: 0 }, opponentExit: { r: 1, c: 1 } }),
    /both an entrance and an exit/,
  );
  assert.throws(
    () => createGameState({ myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 1, c: 1 }, walls: [] } }),
    /opponentEntrance and opponentExit are required/,
  );
  assert.throws(
    () => createGameState({
      myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 1, c: 1 }, walls: [] },
      opponentEntrance: { r: -1, c: 0 },
      opponentExit: { r: 1, c: 1 },
    }),
    /row r must be in 0\.\.5/,
  );
  assert.throws(
    () => createGameState({
      settings: { new_cells_per_turn: 0 },
      myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 1, c: 1 }, walls: [] },
      opponentEntrance: { r: 0, c: 0 },
      opponentExit: { r: 1, c: 1 },
    }),
    /new_cells_per_turn" must be in 1\.\.7/,
  );
});
