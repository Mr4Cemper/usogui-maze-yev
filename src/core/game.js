/**
 * game.js - the state of one game as a single device sees it (SPEC 2, 3).
 *
 * Two boards are tracked at once:
 *   side 'me'       - I walk the opponent's maze. Its walls are unknown here,
 *                     so every step needs the answer the opponent gave.
 *   side 'opponent' - the opponent walks my maze. I hold that maze, so the
 *                     answer is derived from it.
 * In the interface of SPEC 2.4 side 'opponent' is the left field and side 'me'
 * is the right one.
 *
 * The core is a helper, not a judge (SPEC 1.1). It never blocks a move and it
 * never ends the game; it returns hint codes and lets the interface decide
 * what to say. The single exception is a step off the board, which is not a
 * rule but a physical impossibility.
 *
 * Every function takes the state as an argument and mutates that object in
 * place. There is no module level game state.
 */

import {
  assertCell,
  cellToIndex,
  cellToLabel,
  edgeBetween,
  isOnBoard,
} from './edges.js';
import { createMaze, hasWall } from './maze.js';
import { normalizeSettings } from './settings.js';

/** The two sides of a game as this device sees them. */
export const SIDES = Object.freeze(['me', 'opponent']);

/** Step directions and their coordinate deltas. */
export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ dr: -1, dc: 0 }),
  down: Object.freeze({ dr: 1, dc: 0 }),
  left: Object.freeze({ dr: 0, dc: -1 }),
  right: Object.freeze({ dr: 0, dc: 1 }),
});

/**
 * Every hint code the core can produce. Hints are codes, never text: the
 * interface layer owns the translations (SPEC 5.4).
 */
export const HINTS = Object.freeze([
  'TURN_OVER_WALL',
  'TURN_OVER_NEW_CELLS',
  'REACHED_EXIT',
  'KNOWN_WALL_WARNING',
  'MOVE_LIMIT_REACHED',
  'PASS_NOT_ALLOWED',
  'EMPTY_TURN_WARNING',
]);

/**
 * Returns the other side.
 *
 * @param {'me'|'opponent'} side One side.
 * @returns {'me'|'opponent'} The other one.
 * @throws {Error} If the argument is not a side name.
 */
export function otherSide(side) {
  assertSideName(side);
  return side === 'me' ? 'opponent' : 'me';
}

/**
 * Throws unless the value is a side name.
 *
 * @param {unknown} side Value to check.
 * @returns {'me'|'opponent'} The side name itself.
 * @throws {Error} If the value is not 'me' or 'opponent'.
 */
function assertSideName(side) {
  if (side !== 'me' && side !== 'opponent') {
    throw new Error(`side must be "me" or "opponent", got ${String(side)}`);
  }
  return side;
}

/**
 * Throws unless the value looks like a game state built here.
 *
 * @param {unknown} state Value to check.
 * @returns {object} The state itself.
 * @throws {Error} If the value is not a game state.
 */
function assertState(state) {
  if (state === null || typeof state !== 'object') {
    throw new Error(`state must be an object, got ${String(state)}`);
  }
  const { sides, settings, globalMove, current } = /** @type {any} */ (state);
  if (sides === null || typeof sides !== 'object' || !sides.me || !sides.opponent) {
    throw new Error('state.sides must hold both "me" and "opponent"');
  }
  if (settings === null || typeof settings !== 'object') {
    throw new Error('state.settings must be a settings object');
  }
  if (!Number.isInteger(globalMove) || globalMove < 1) {
    throw new Error(`state.globalMove must be a positive integer, got ${String(globalMove)}`);
  }
  assertSideName(current);
  return /** @type {any} */ (state);
}

/**
 * Builds the per side board state.
 *
 * @param {object} params Board parameters.
 * @param {boolean} params.known True when this device holds the maze this side
 *   walks and can answer for it.
 * @param {object|null} params.maze The maze itself when it is known.
 * @param {{r: number, c: number}} params.entrance Entrance of that maze.
 * @param {{r: number, c: number}} params.exit Exit of that maze.
 * @returns {object} Fresh board state.
 */
function createSideState({ known, maze, entrance, exit }) {
  return {
    known,
    maze,
    entrance: { ...entrance },
    exit: { ...exit },
    pos: { ...entrance },
    visited: new Set([cellToIndex(entrance.r, entrance.c)]),
    knownWalls: new Set(),
    knownOpen: new Set(),
    moves: 0,
    firstExitMove: null,
    resigned: false,
    newCellsThisTurn: 0,
    turnSteps: [],
  };
}

/**
 * Builds the state of a fresh game.
 *
 * @param {object} init Everything the game needs to start.
 * @param {object} init.settings Settings object; missing fields fall back to
 *   the defaults.
 * @param {object} init.myMaze My own maze, the one the opponent walks. Both
 *   ends must be placed.
 * @param {{r: number, c: number}} init.opponentEntrance Entrance of the
 *   opponent's maze, as the opponent announced it (SPEC 2.1).
 * @param {{r: number, c: number}} init.opponentExit Exit of the opponent's
 *   maze, as the opponent announced it.
 * @param {1|2} [init.myPlayer=1] Whether this device belongs to player 1 or
 *   player 2; together with `first_move` it decides who starts.
 * @returns {object} The game state.
 * @throws {Error} If a setting leaves its range, the maze is malformed or has
 *   no ends, the announced coordinates are invalid, or myPlayer is not 1 or 2.
 */
export function createGameState(init) {
  if (init === null || typeof init !== 'object') {
    throw new Error(`createGameState needs an object, got ${String(init)}`);
  }
  const settings = normalizeSettings(init.settings ?? {});
  const myMaze = createMaze(init.myMaze);
  if (myMaze.entrance === null || myMaze.exit === null) {
    throw new Error('myMaze needs both an entrance and an exit before the game starts');
  }
  const opponentEntrance = init.opponentEntrance;
  const opponentExit = init.opponentExit;
  if (!opponentEntrance || !opponentExit) {
    throw new Error('opponentEntrance and opponentExit are required');
  }
  assertCell(opponentEntrance.r, opponentEntrance.c);
  assertCell(opponentExit.r, opponentExit.c);

  const myPlayer = init.myPlayer ?? 1;
  if (myPlayer !== 1 && myPlayer !== 2) {
    throw new Error(`myPlayer must be 1 or 2, got ${String(myPlayer)}`);
  }

  const startingPlayer = settings.first_move === 0 ? 1 : 2;

  return {
    settings,
    myPlayer,
    globalMove: 1,
    current: startingPlayer === myPlayer ? 'me' : 'opponent',
    turnActive: false,
    turnSnapshot: null,
    history: [],
    undoStack: [],
    sides: {
      me: createSideState({
        known: false,
        maze: null,
        entrance: opponentEntrance,
        exit: opponentExit,
      }),
      opponent: createSideState({
        known: true,
        maze: myMaze,
        entrance: myMaze.entrance,
        exit: myMaze.exit,
      }),
    },
  };
}

/**
 * Total number of finished turns on both sides, the number the game move limit
 * is compared against (SPEC 2.5).
 *
 * @param {object} state Game state.
 * @returns {number} Sum of both move counters.
 * @throws {Error} If the state is malformed.
 */
export function totalMoves(state) {
  assertState(state);
  return state.sides.me.moves + state.sides.opponent.moves;
}

/**
 * Returns the move limit hint when the game limit has been reached.
 *
 * @param {object} state Game state.
 * @returns {string[]} Either an empty array or `['MOVE_LIMIT_REACHED']`.
 */
function moveLimitHints(state) {
  const limit = state.settings.move_limit_total;
  return limit !== 0 && totalMoves(state) >= limit ? ['MOVE_LIMIT_REACHED'] : [];
}

/**
 * Copies everything a turn can change on one side, so that the turn can be
 * undone later.
 *
 * @param {object} state Game state.
 * @param {'me'|'opponent'} sideName Side that is about to move.
 * @returns {object} A snapshot.
 */
function takeSnapshot(state, sideName) {
  const side = state.sides[sideName];
  return {
    side: sideName,
    globalMove: state.globalMove,
    pos: { ...side.pos },
    visited: new Set(side.visited),
    knownWalls: new Set(side.knownWalls),
    knownOpen: new Set(side.knownOpen),
    moves: side.moves,
    firstExitMove: side.firstExitMove,
  };
}

/**
 * Renders a history entry in English, for debugging, examples and tests.
 *
 * This is deliberately a function and not a field of the entry: an entry that
 * carried ready made English text would be copied straight into the interface
 * and the Russian and Ukrainian versions would never be written (SPEC 3.1).
 * The interface builds its own line, in its own language, from the structure.
 *
 * @param {{move: number, type: string, steps: Array<object>}} entry History
 *   entry as stored in `state.history`.
 * @returns {string} A line such as `12. C3-C4; C4-C5; wall C5-C6`.
 * @throws {Error} If the entry is not a history entry.
 */
export function renderLogEntryEn(entry) {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`entry must be an object, got ${String(entry)}`);
  }
  if (!Number.isInteger(entry.move) || !Array.isArray(entry.steps)) {
    throw new Error('entry must carry a move number and a steps array');
  }
  if (entry.type !== 'MOVE') {
    return `${entry.move}. ${entry.type}`;
  }
  const parts = entry.steps.map((step) => {
    const from = cellToLabel(step.from.r, step.from.c);
    const to = cellToLabel(step.to.r, step.to.c);
    return step.result === 'wall' ? `wall ${from}-${to}` : `${from}-${to}`;
  });
  return parts.length === 0 ? `${entry.move}.` : `${entry.move}. ${parts.join('; ')}`;
}

/**
 * Opens the turn of the side whose turn it is.
 *
 * @param {object} state Game state, mutated in place.
 * @returns {{side: 'me'|'opponent', globalMove: number, hints: string[]}} Who
 *   moves, the global move number and any hints that already apply.
 * @throws {Error} If the state is malformed or a turn is already open.
 */
export function startTurn(state) {
  assertState(state);
  if (state.turnActive) {
    throw new Error('a turn is already in progress: call endTurn() or passTurn() first');
  }
  const sideName = state.current;
  const side = state.sides[sideName];
  side.newCellsThisTurn = 0;
  side.turnSteps = [];
  state.turnSnapshot = takeSnapshot(state, sideName);
  state.turnActive = true;
  return { side: sideName, globalMove: state.globalMove, hints: moveLimitHints(state) };
}

/**
 * Attempts one step onto a neighbouring cell (SPEC 2.2).
 *
 * A step into a wall ends the turn technically: the pawn stays where it is and
 * the new cell allowance is not spent. A step into a cell that was visited
 * before does not spend the allowance either. The core only hints; it never
 * refuses a further step.
 *
 * @param {object} state Game state, mutated in place.
 * @param {'me'|'opponent'} side Which board the step is made on.
 * @param {'up'|'down'|'left'|'right'} direction Where the pawn tries to go.
 * @param {'pass'|'wall'|null} [answer=null] What the opponent answered. It is
 *   required for side 'me', whose maze this device does not hold, and must be
 *   omitted for side 'opponent', whose maze answers for itself.
 * @returns {{result: 'pass'|'wall', isNewCell: boolean, hints: string[], edge: string, from: {r: number, c: number}, to: {r: number, c: number}}}
 *   What happened, plus the edge and the two cells involved.
 * @throws {Error} If the state is malformed, no turn is open, the wrong side
 *   is moving, the direction is unknown, the step would leave the board, or
 *   the answer is missing, wrong or given when it must not be.
 */
export function tryStep(state, side, direction, answer = null) {
  assertState(state);
  assertSideName(side);
  if (!state.turnActive) {
    throw new Error('no turn is open: call startTurn() before tryStep()');
  }
  if (side !== state.current) {
    throw new Error(`it is the turn of side "${state.current}", not "${side}"`);
  }
  const delta = Object.prototype.hasOwnProperty.call(DIRECTIONS, direction)
    ? DIRECTIONS[direction]
    : undefined;
  if (delta === undefined) {
    throw new Error(
      `direction must be one of ${Object.keys(DIRECTIONS).join(', ')}, got ${String(direction)}`,
    );
  }

  const board = state.sides[side];
  const from = { ...board.pos };
  const to = { r: from.r + delta.dr, c: from.c + delta.dc };
  if (!isOnBoard(to.r, to.c)) {
    throw new Error(
      `step ${direction} from ${cellToLabel(from.r, from.c)} would leave the board`,
    );
  }
  const edge = /** @type {string} */ (edgeBetween(from.r, from.c, to.r, to.c));

  const hints = [];
  if (board.knownWalls.has(edge)) {
    hints.push('KNOWN_WALL_WARNING');
  }

  let result;
  if (board.known) {
    if (answer !== null && answer !== undefined) {
      throw new Error(
        `side "${side}" walks a maze this device holds, so no answer may be supplied`,
      );
    }
    result = hasWall(board.maze, from.r, from.c, to.r, to.c) ? 'wall' : 'pass';
  } else {
    if (answer !== 'pass' && answer !== 'wall') {
      throw new Error(
        `side "${side}" walks the opponent's maze, so answer must be "pass" or "wall", got ${String(answer)}`,
      );
    }
    result = answer;
  }

  let isNewCell = false;
  if (result === 'wall') {
    board.knownWalls.add(edge);
    hints.push('TURN_OVER_WALL');
  } else {
    board.knownOpen.add(edge);
    board.pos = to;
    const index = cellToIndex(to.r, to.c);
    if (!board.visited.has(index)) {
      isNewCell = true;
      board.visited.add(index);
      board.newCellsThisTurn += 1;
    }
    if (to.r === board.exit.r && to.c === board.exit.c) {
      hints.push('REACHED_EXIT');
      if (board.firstExitMove === null) {
        board.firstExitMove = state.globalMove;
      }
    }
    if (isNewCell && board.newCellsThisTurn >= state.settings.new_cells_per_turn) {
      hints.push('TURN_OVER_NEW_CELLS');
    }
  }

  board.turnSteps.push({ from, to, edge, result, isNewCell });
  return { result, isNewCell, hints, edge, from, to };
}

/**
 * Closes the open turn: writes the history entry, adds one to the counter of
 * the side that moved and hands the move over (SPEC 2.2).
 *
 * Closing a turn without a single step is possible but breaks the rules, so it
 * comes back with `EMPTY_TURN_WARNING`. The entry is written all the same and
 * nothing is blocked: warning the player is the interface's job.
 *
 * @param {object} state Game state, mutated in place.
 * @returns {{entry: object, hints: string[]}} The history entry and any hints.
 * @throws {Error} If the state is malformed or no turn is open.
 */
export function endTurn(state) {
  assertState(state);
  if (!state.turnActive) {
    throw new Error('no turn is open: call startTurn() before endTurn()');
  }
  const sideName = state.current;
  const board = state.sides[sideName];
  const steps = board.turnSteps;
  const wallStep = steps.find((step) => step.result === 'wall') ?? null;
  const wasEmpty = steps.length === 0;

  const entry = {
    move: state.globalMove,
    side: sideName,
    type: 'MOVE',
    steps,
    wall: wallStep === null ? null : wallStep.edge,
  };
  const closed = closeTurn(state, entry);
  return wasEmpty
    ? { entry: closed.entry, hints: ['EMPTY_TURN_WARNING', ...closed.hints] }
    : closed;
}

/**
 * Passes the turn (SPEC 2.2). Allowed only when `allow_pass` is 1. A pass
 * counts as a move: it grows the counter of the player and the game total.
 *
 * @param {object} state Game state, mutated in place.
 * @returns {{ok: boolean, entry: object|null, hints: string[]}} Whether the
 *   pass happened, the history entry and any hints. When passing is switched
 *   off nothing changes and the hint is `PASS_NOT_ALLOWED`.
 * @throws {Error} If the state is malformed or steps have already been made in
 *   the open turn.
 */
export function passTurn(state) {
  assertState(state);
  if (state.settings.allow_pass !== 1) {
    return { ok: false, entry: null, hints: ['PASS_NOT_ALLOWED'] };
  }
  const sideName = state.current;
  const board = state.sides[sideName];
  if (state.turnActive && board.turnSteps.length > 0) {
    throw new Error('a turn with steps already made cannot be passed');
  }
  if (!state.turnActive) {
    startTurn(state);
  }
  const entry = {
    move: state.globalMove,
    side: sideName,
    type: 'PASS',
    steps: [],
    wall: null,
  };
  const closed = closeTurn(state, entry);
  return { ok: true, entry: closed.entry, hints: closed.hints };
}

/**
 * Shared tail of {@link endTurn} and {@link passTurn}.
 *
 * @param {object} state Game state, mutated in place.
 * @param {object} entry History entry to append.
 * @returns {{entry: object, hints: string[]}} The entry and any hints.
 */
function closeTurn(state, entry) {
  const sideName = state.current;
  const board = state.sides[sideName];

  state.history.push(entry);
  // The snapshot was taken when the turn opened, before anything changed.
  state.undoStack.push(state.turnSnapshot);
  state.turnSnapshot = null;
  board.moves += 1;
  state.turnActive = false;
  board.turnSteps = [];
  board.newCellsThisTurn = 0;
  state.globalMove += 1;
  state.current = otherSide(sideName);

  return { entry, hints: moveLimitHints(state) };
}

/**
 * Undoes the last finished turn (SPEC 3). The original history line stays
 * where it is and a correction line is appended, so the archive keeps telling
 * the truth about what was announced.
 *
 * @param {object} state Game state, mutated in place.
 * @returns {object} The correction entry that was appended.
 * @throws {Error} If the state is malformed, a turn is currently open, or
 *   there is no finished turn left to undo.
 */
export function undoLastTurn(state) {
  assertState(state);
  if (state.turnActive) {
    throw new Error('finish the open turn before undoing the previous one');
  }
  if (state.undoStack.length === 0) {
    throw new Error('there is no finished turn to undo');
  }
  const snapshot = state.undoStack.pop();
  const board = state.sides[snapshot.side];

  board.pos = { ...snapshot.pos };
  board.visited = new Set(snapshot.visited);
  board.knownWalls = new Set(snapshot.knownWalls);
  board.knownOpen = new Set(snapshot.knownOpen);
  board.moves = snapshot.moves;
  board.firstExitMove = snapshot.firstExitMove;
  board.turnSteps = [];
  board.newCellsThisTurn = 0;

  state.globalMove = snapshot.globalMove;
  state.current = snapshot.side;

  const entry = {
    move: snapshot.globalMove,
    side: snapshot.side,
    type: 'UNDO',
    steps: [],
    wall: null,
  };
  state.history.push(entry);
  return entry;
}

/**
 * Records a resignation (SPEC 2.5). It is not a turn: no counter grows and the
 * move does not change hands. The verdict is still computed only at the
 * verification stage.
 *
 * @param {object} state Game state, mutated in place.
 * @param {'me'|'opponent'} side Who resigned.
 * @returns {object} The history entry that was appended.
 * @throws {Error} If the state is malformed or the side name is unknown.
 */
export function resign(state, side) {
  assertState(state);
  assertSideName(side);
  state.sides[side].resigned = true;
  const entry = {
    move: state.globalMove,
    side,
    type: 'RESIGN',
    steps: [],
    wall: null,
  };
  state.history.push(entry);
  return entry;
}

/**
 * Collects the answers one side received, in the shape the verification stage
 * replays them (SPEC 4.7 check 6). Undone turns are skipped: their steps were
 * taken back.
 *
 * @param {object} state Game state.
 * @param {'me'|'opponent'} side Whose walk to collect. Side 'me' produces the
 *   log of the opponent's answers, which is the one that gets verified.
 * @returns {Array<{move: number, from: {r: number, c: number}, to: {r: number, c: number}, answer: 'pass'|'wall'}>}
 *   One record per step, in order.
 * @throws {Error} If the state is malformed or the side name is unknown.
 */
export function buildAnswerLog(state, side) {
  assertState(state);
  assertSideName(side);
  // An undo line cancels the most recent turn of the same side with the same
  // number. Both lines stay in the history; only the cancelled turn drops out
  // of the log that gets replayed.
  const surviving = [];
  for (const entry of state.history) {
    if (entry.type === 'UNDO') {
      for (let i = surviving.length - 1; i >= 0; i -= 1) {
        if (surviving[i].side === entry.side && surviving[i].move === entry.move) {
          surviving.splice(i, 1);
          break;
        }
      }
      continue;
    }
    if (entry.type === 'MOVE' || entry.type === 'PASS') {
      surviving.push(entry);
    }
  }

  const log = [];
  for (const entry of surviving) {
    if (entry.side !== side || entry.type !== 'MOVE') {
      continue;
    }
    for (const step of entry.steps) {
      log.push({
        move: entry.move,
        from: { ...step.from },
        to: { ...step.to },
        answer: step.result,
      });
    }
  }
  return log;
}
