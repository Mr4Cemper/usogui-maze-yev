/**
 * gameLog.js - the game is stored as a journal of actions, never as a
 * snapshot of the state.
 *
 * Three reasons, in order of weight:
 *
 *   1. The core state holds Sets and other things `JSON.stringify` cannot
 *      carry. Serialising them by hand would create a second description of
 *      the game state, and the two would drift apart the first time the core
 *      grows a field.
 *   2. Replaying the journal is the replay feature of Part 3, already built.
 *   3. The journal is the same thing `buildAnswerLog` hands to verification:
 *      one idea instead of two.
 *
 * Every action goes through {@link applyAction}, both when it happens live and
 * when it is replayed, so the two paths cannot diverge: they are the same
 * path.
 *
 * An undo is an ordinary entry. The journal only ever grows.
 *
 * Taking back a single step is the one thing the core does not do, and it does
 * not have to: `UNDO_STEP` is appended like everything else, and the replay
 * simply leaves the cancelled step out. That is the whole reason a journal was
 * chosen over a snapshot.
 */

import {
  DIRECTIONS,
  createGameState,
  endTurn,
  passTurn,
  resign,
  startTurn,
  tryStep,
  undoLastTurn,
} from '../core/game.js';

/** Everything that can happen in a game. */
export const ACTION_TYPES = Object.freeze([
  'START_TURN',
  'STEP',
  'UNDO_STEP',
  'END_TURN',
  'PASS',
  'UNDO',
  'RESIGN',
]);

const SIDES = Object.freeze(['me', 'opponent']);
const ANSWERS = Object.freeze(['pass', 'wall']);

/**
 * Validates one journal entry and returns a clean copy.
 *
 * @param {unknown} action Entry as it came from storage or from a click.
 * @returns {{type: string, side?: string, direction?: string, answer?: string}}
 *   The normalised entry.
 * @throws {Error} If the entry is not something the core could ever replay.
 */
export function assertAction(action) {
  if (action === null || typeof action !== 'object') {
    throw new Error(`a journal entry must be an object, got ${String(action)}`);
  }
  if (!ACTION_TYPES.includes(action.type)) {
    throw new Error(`unknown journal entry type ${JSON.stringify(action.type)}`);
  }
  if (action.type === 'STEP') {
    if (!SIDES.includes(action.side)) {
      throw new Error(`a step needs a side, got ${JSON.stringify(action.side)}`);
    }
    if (!Object.prototype.hasOwnProperty.call(DIRECTIONS, action.direction)) {
      throw new Error(`a step needs a direction, got ${JSON.stringify(action.direction)}`);
    }
    // Only the side walking the opponent's maze carries an answer; for the
    // other side the core derives it from the walls.
    if (action.side === 'me') {
      if (!ANSWERS.includes(action.answer)) {
        throw new Error(`my own step needs an answer, got ${JSON.stringify(action.answer)}`);
      }
      // `auto` records where the answer came from: true means it was read off
      // this device's own map of discovered edges instead of being asked of
      // the opponent again. It changes nothing for the core - the step is
      // replayed exactly the same way - but it is worth keeping, because a
      // repeated edge is answered once and used many times.
      return {
        type: 'STEP',
        side: 'me',
        direction: action.direction,
        answer: action.answer,
        auto: action.auto === true,
      };
    }
    if (action.answer !== undefined && action.answer !== null) {
      throw new Error('a step of the opponent must not carry an answer');
    }
    if (action.auto !== undefined) {
      // There is no one to ask on that board: my own walls answer, always.
      throw new Error('a step of the opponent must not carry an auto flag');
    }
    return { type: 'STEP', side: 'opponent', direction: action.direction };
  }
  if (action.type === 'RESIGN') {
    if (!SIDES.includes(action.side)) {
      throw new Error(`a resignation needs a side, got ${JSON.stringify(action.side)}`);
    }
    return { type: 'RESIGN', side: action.side };
  }
  return { type: action.type };
}

/**
 * Plays one journal entry into a game state.
 *
 * @param {object} state Core game state, changed in place.
 * @param {object} action Journal entry.
 * @returns {object} Whatever the core returned, so the live screen can show
 *   the hints of the very call that was recorded.
 * @throws {Error} If the entry is malformed or the core refuses it, which is
 *   how a damaged journal is caught.
 */
export function applyAction(state, action) {
  const checked = assertAction(action);
  switch (checked.type) {
    case 'START_TURN':
      return startTurn(state);
    case 'STEP':
      return checked.side === 'me'
        ? tryStep(state, 'me', checked.direction, checked.answer)
        : tryStep(state, 'opponent', checked.direction);
    case 'END_TURN':
      return endTurn(state);
    case 'PASS': {
      const result = passTurn(state);
      if (!result.ok) {
        // A recorded pass that the core now refuses means the journal does not
        // belong to this game.
        throw new Error('a recorded pass was refused: passing is not allowed in this game');
      }
      return result;
    }
    case 'UNDO':
      return undoLastTurn(state);
    case 'UNDO_STEP':
      // A cancelled step is left out when the journal is replayed; there is
      // nothing to hand to the core here.
      throw new Error('UNDO_STEP is resolved by the replay, never played into the core');
    default:
      if (state.sides[checked.side].resigned) {
        // Not refereeing: a resignation is one announcement, and a second one
        // would only put a duplicate into the archive and into the verdict.
        throw new Error('this side has already resigned; a resignation is announced once');
      }
      return resign(state, checked.side);
  }
}

/**
 * Works out which steps the journal cancels, without touching the core.
 *
 * `UNDO_STEP` takes back the last step of the turn that is still open. Once a
 * turn is closed its steps are part of the record and only the whole turn can
 * be taken back (SPEC 3.3).
 *
 * @param {Array<object>} actions The journal.
 * @returns {{cancelled: Set<number>, pairs: Array<{undoIndex: number, stepIndex: number}>}}
 *   Indices of the steps that never happened, and which undo cancelled which.
 * @throws {Error} If an entry is malformed or takes back a step that is not
 *   there.
 */
function planJournal(actions) {
  const cancelled = new Set();
  const pairs = [];
  let open = [];

  for (let index = 0; index < actions.length; index += 1) {
    let action;
    try {
      action = assertAction(actions[index]);
    } catch (error) {
      throw new Error(
        `journal entry ${index + 1} of ${actions.length} is unusable: ${error.message}`,
        { cause: error },
      );
    }
    if (action.type === 'STEP') {
      open.push(index);
      continue;
    }
    if (action.type === 'UNDO_STEP') {
      const stepIndex = open.pop();
      if (stepIndex === undefined) {
        throw new Error(
          `journal entry ${index + 1} of ${actions.length} takes back a step, ` +
            'but the open turn has none left to take back',
        );
      }
      cancelled.add(stepIndex);
      pairs.push({ undoIndex: index, stepIndex });
      continue;
    }
    // Anything else opens or closes a turn, and a closed turn keeps its steps.
    open = [];
  }

  return { cancelled, pairs };
}

/**
 * Tells whether the interface state carries everything a game needs.
 *
 * @param {object} uiState Application state.
 * @returns {boolean} True when a game can be built from it.
 */
export function isGameSetupComplete(uiState) {
  return (
    uiState.settings !== null &&
    uiState.myMaze.entrance !== null &&
    uiState.myMaze.exit !== null &&
    uiState.opponentEnds.entrance !== null &&
    uiState.opponentEnds.exit !== null
  );
}

/**
 * Builds a fresh game from the interface state.
 *
 * @param {object} uiState Application state.
 * @returns {object} A core game state at move 1.
 * @throws {Error} If the setup is incomplete or the core refuses it.
 */
export function createGameFromState(uiState) {
  if (!isGameSetupComplete(uiState)) {
    throw new Error('the game cannot start: settings, my maze or the announced ends are missing');
  }
  return createGameState({
    settings: uiState.settings,
    myMaze: uiState.myMaze,
    opponentEntrance: uiState.opponentEnds.entrance,
    opponentExit: uiState.opponentEnds.exit,
    myPlayer: uiState.myPlayer,
  });
}

/**
 * Rebuilds a game by replaying its journal from move one.
 *
 * @param {object} uiState Application state, which carries the frozen setup.
 * @param {Array<object>} actions The journal.
 * @returns {object} The game state after the last entry.
 * @throws {Error} If the setup is incomplete or an entry cannot be replayed.
 *   The message names the entry, so the screen can say what went wrong instead
 *   of showing an empty page.
 */
export function replayGame(uiState, actions) {
  return runJournal(uiState, actions).state;
}

/**
 * Replays a journal and also reports the corrections it contains.
 *
 * A cancelled step never reaches the core, so the game state cannot describe
 * it. The correction records what was taken back and where it belonged, so the
 * history can show it: the archive says what was announced and that it was
 * taken back, rather than quietly forgetting it (SPEC 3.3).
 *
 * @param {object} uiState Application state, which carries the frozen setup.
 * @param {Array<object>} actions The journal.
 * @returns {{state: object, corrections: Array<{move: number, side: string, from: object, to: object, at: number}>}}
 *   The game and the correction lines, each with the history position it
 *   belongs after.
 * @throws {Error} If the setup is incomplete or an entry cannot be replayed.
 *   The message names the entry.
 */
export function runJournal(uiState, actions) {
  if (!Array.isArray(actions)) {
    throw new Error(`a journal must be an array, got ${String(actions)}`);
  }
  const plan = planJournal(actions);
  const state = createGameFromState(uiState);
  const corrections = [];

  for (let i = 0; i < actions.length; i += 1) {
    const action = assertAction(actions[i]);

    if (action.type === 'UNDO_STEP') {
      const pair = plan.pairs.find((item) => item.undoIndex === i);
      const step = assertAction(actions[pair.stepIndex]);
      const side = state.current;
      // The step was never played, so the pawn still stands where it started.
      const from = { ...state.sides[side].pos };
      const delta = DIRECTIONS[step.direction];
      corrections.push({
        move: state.globalMove,
        side,
        from,
        to: { r: from.r + delta.dr, c: from.c + delta.dc },
        at: state.history.length,
      });
      continue;
    }

    if (plan.cancelled.has(i)) {
      continue;
    }

    try {
      applyAction(state, action);
    } catch (error) {
      throw new Error(
        `journal entry ${i + 1} of ${actions.length} could not be replayed: ${error.message}`,
        { cause: error },
      );
    }
  }

  return { state, corrections };
}
