/**
 * verify.js - the verification report and the verdict (SPEC 4.7, 2.5).
 *
 * Everything here runs after the game, on the reveal string the opponent sent.
 * Both the report and the verdict speak in codes; the interface layer turns
 * them into words.
 */

import { assertCell, cellToLabel, edgeBetween, isOnBoard } from './edges.js';
import { hasWall, validateMaze } from './maze.js';
import { computeCommit, decodeCommitCode, decodeReveal, parsePayload } from './commit.js';
import { SETTINGS_BYTES, packSettings, unpackSettings } from './settings.js';
import { DIRECTIONS } from './game.js';
import { bytesToHex } from './sha256.js';

/** The seven checks of SPEC 4.7, in order. */
export const VERIFY_CHECKS = Object.freeze([
  'CODE_INTEGRITY',
  'COMMIT_MATCH',
  'SETTINGS_MATCH',
  'ENDPOINTS_MATCH',
  'MAZE_VALID',
  'LOG_REPLAY',
  'VERDICT',
]);

/**
 * Validates and copies a cell given as `{r, c}`.
 *
 * @param {unknown} cell Cell to normalise.
 * @param {string} name Name used in the error message.
 * @returns {{r: number, c: number}} A fresh cell object.
 * @throws {Error} If the value is not an object with valid board coordinates.
 */
function toCell(cell, name) {
  if (typeof cell === 'string') {
    throw new Error(
      `${name} must be an object {r, c}, got the string ${JSON.stringify(cell)}; use labelToCell() first`,
    );
  }
  if (cell === null || typeof cell !== 'object') {
    throw new Error(`${name} must be an object {r, c}, got ${String(cell)}`);
  }
  assertCell(cell.r, cell.c);
  return { r: cell.r, c: cell.c };
}

/**
 * Validates one record of the opponent's answer log and fills in the target
 * cell when only a direction was given.
 *
 * @param {unknown} entry Record to normalise.
 * @param {number} index Position in the log, used in error messages.
 * @returns {{move: number, from: {r: number, c: number}, to: {r: number, c: number}, answer: 'pass'|'wall'}}
 *   The normalised record.
 * @throws {Error} If the record is malformed, the cells are not adjacent, or
 *   the answer is not 'pass' or 'wall'.
 */
function normaliseLogEntry(entry, index) {
  const where = `opponentAnswerLog[${index}]`;
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`${where} must be an object, got ${String(entry)}`);
  }
  if (!Number.isInteger(entry.move) || entry.move < 1) {
    throw new Error(`${where}.move must be a positive integer, got ${String(entry.move)}`);
  }
  const from = toCell(entry.from, `${where}.from`);

  let to;
  if (entry.to !== undefined && entry.to !== null) {
    to = toCell(entry.to, `${where}.to`);
  } else if (typeof entry.direction === 'string') {
    const delta = Object.prototype.hasOwnProperty.call(DIRECTIONS, entry.direction)
      ? DIRECTIONS[entry.direction]
      : undefined;
    if (delta === undefined) {
      throw new Error(
        `${where}.direction must be one of ${Object.keys(DIRECTIONS).join(', ')}, got ${String(entry.direction)}`,
      );
    }
    to = { r: from.r + delta.dr, c: from.c + delta.dc };
    if (!isOnBoard(to.r, to.c)) {
      throw new Error(`${where} steps off the board`);
    }
  } else {
    throw new Error(`${where} needs either a "to" cell or a "direction"`);
  }

  if (edgeBetween(from.r, from.c, to.r, to.c) === null) {
    throw new Error(
      `${where} joins ${cellToLabel(from.r, from.c)} and ${cellToLabel(to.r, to.c)}, which are not adjacent`,
    );
  }
  if (entry.answer !== 'pass' && entry.answer !== 'wall') {
    throw new Error(`${where}.answer must be "pass" or "wall", got ${String(entry.answer)}`);
  }
  return { move: entry.move, from, to, answer: entry.answer };
}

/**
 * Validates the whole argument of {@link verifyReveal}.
 *
 * @param {object} input Raw argument.
 * @returns {Promise<object>} Normalised input.
 * @throws {Error} If any field is missing or malformed. The commit code is
 *   checked here and not reported as a step: it was pasted before the game and
 *   the interface must have checked it then (SPEC 4.7 step 6).
 */
async function assertVerifyInput(input) {
  if (input === null || typeof input !== 'object') {
    throw new Error(`verifyReveal needs an object, got ${String(input)}`);
  }
  const {
    expectedCommit,
    agreedSettings,
    declaredEntrance,
    declaredExit,
    revealString,
    opponentAnswerLog = [],
    gameState = null,
    myViolation = false,
  } = input;

  // The commit only travels in its wrapper: bare hex has no checksum, and a
  // mistyped commit would surface here as "the maze was substituted".
  const commit = await decodeCommitCode(expectedCommit);
  if (typeof revealString !== 'string') {
    throw new Error(`revealString must be a string, got ${String(revealString)}`);
  }
  if (agreedSettings === undefined || agreedSettings === null) {
    throw new Error('agreedSettings is required: pass the block both players agreed on');
  }
  const agreedBytes =
    agreedSettings instanceof Uint8Array ? agreedSettings : packSettings(agreedSettings);
  if (agreedBytes.length !== SETTINGS_BYTES) {
    throw new Error(`agreedSettings must pack into ${SETTINGS_BYTES} bytes`);
  }
  const agreedObject = unpackSettings(agreedBytes);
  if (!Array.isArray(opponentAnswerLog)) {
    throw new Error(`opponentAnswerLog must be an array, got ${String(opponentAnswerLog)}`);
  }
  if (typeof myViolation !== 'boolean') {
    throw new Error(`myViolation must be a boolean, got ${String(myViolation)}`);
  }

  return {
    expectedCommit: commit,
    agreedBytes,
    agreedObject,
    declaredEntrance: toCell(declaredEntrance, 'declaredEntrance'),
    declaredExit: toCell(declaredExit, 'declaredExit'),
    revealString,
    log: opponentAnswerLog.map(normaliseLogEntry),
    gameState,
    myViolation,
  };
}

/**
 * Compares two byte blocks.
 *
 * @param {Uint8Array} a First block.
 * @param {Uint8Array} b Second block.
 * @returns {boolean} True when both blocks hold the same bytes.
 */
function sameBytes(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Runs the seven checks of SPEC 4.7 over the reveal the opponent sent.
 *
 * Check 1 failing means the code was damaged or the wrong thing was pasted,
 * which is not an accusation: `violated` stays false and the opponent is asked
 * to send it again. Checks 2 to 6 failing means the reveal contradicts what
 * was committed to or what was announced during the game, which is a
 * violation. When check 2 fails, checks 3 to 6 are skipped: replaying a log
 * against a substituted maze proves nothing.
 *
 * @param {object} input Everything the check needs.
 * @param {string} input.expectedCommit The commit received before the game, in
 *   its transport wrapper `YMC1-<64 hex>-<4 hex>`. Bare hex is refused.
 * @param {Uint8Array|object} input.agreedSettings The settings both players
 *   agreed on, packed or as an object.
 * @param {{r: number, c: number}} input.declaredEntrance Entrance the opponent
 *   announced before the game.
 * @param {{r: number, c: number}} input.declaredExit Exit the opponent
 *   announced before the game.
 * @param {string} input.revealString The reveal string the opponent sent.
 * @param {Array<object>} [input.opponentAnswerLog=[]] Every answer the
 *   opponent gave, as `{move, from, to | direction, answer}`.
 * @param {object|null} [input.gameState=null] The finished game state. Without
 *   it check 7 is reported as skipped.
 * @param {boolean} [input.myViolation=false] Whether my own reveal failed the
 *   opponent's check, which the verdict needs to call a double forfeit.
 * @returns {Promise<{ok: boolean, violated: boolean, steps: Array<{step: number, status: 'ok'|'fail'|'skipped', code: string, details: object}>, revealed: object|null, mismatches: Array<object>, verdict: object|null}>}
 *   The report.
 * @throws {Error} If the argument is malformed: a commit code that fails its
 *   own format or checksum (`code = 'BAD_FORMAT'` or `'BAD_CHECKSUM'`),
 *   malformed coordinates, a log record that is not a step between adjacent
 *   cells.
 */
export async function verifyReveal(input) {
  const checked = await assertVerifyInput(input);
  const steps = [];

  /**
   * Appends one report line.
   *
   * @param {number} number Check number, 1..7.
   * @param {'ok'|'fail'|'skipped'} status Outcome.
   * @param {object} [details={}] Anything the interface may want to show.
   * @returns {void}
   */
  const report = (number, status, details = {}) => {
    steps.push({ step: number, status, code: VERIFY_CHECKS[number - 1], details });
  };

  /**
   * Marks a range of checks as skipped.
   *
   * @param {number} from First check number.
   * @param {number} to Last check number.
   * @param {string} reason Why they were skipped.
   * @returns {void}
   */
  const skip = (from, to, reason) => {
    for (let number = from; number <= to; number += 1) {
      report(number, 'skipped', { reason });
    }
  };

  // 1. The reveal string itself.
  let payload;
  let salt;
  let parsed;
  try {
    const decoded = await decodeReveal(checked.revealString);
    payload = decoded.payload;
    salt = decoded.salt;
    parsed = parsePayload(payload);
    report(1, 'ok', { bytes: payload.length + salt.length });
  } catch (error) {
    const reason = error.code === 'BAD_CHECKSUM' ? 'CHECKSUM_MISMATCH' : 'MALFORMED_CODE';
    report(1, 'fail', { reason, message: error.message });
    skip(2, 7, 'PREVIOUS_CHECK_FAILED');
    return { ok: false, violated: false, steps, revealed: null, mismatches: [], verdict: null };
  }

  const revealed = {
    payload,
    salt,
    settings: parsed.settings,
    settingsObject: null,
    maze: parsed.maze,
  };
  let settingsProblem = null;
  try {
    revealed.settingsObject = unpackSettings(parsed.settings);
  } catch (error) {
    // A settings block that cannot be read is reported by check 3 below.
    settingsProblem = error.message;
  }

  // 2. The commit.
  const actualCommit = await computeCommit(payload, salt);
  if (actualCommit !== checked.expectedCommit) {
    report(2, 'fail', {
      reason: 'COMMIT_MISMATCH',
      expected: checked.expectedCommit,
      actual: actualCommit,
    });
    skip(3, 6, 'COMMIT_MISMATCH');
    const verdict = finishWithVerdict(report, checked, true);
    return { ok: false, violated: true, steps, revealed, mismatches: [], verdict };
  }
  report(2, 'ok', { commit: actualCommit });

  let violated = false;

  // 3. The settings block, game nonce included.
  if (sameBytes(parsed.settings, checked.agreedBytes)) {
    report(3, 'ok', {});
  } else {
    violated = true;
    report(3, 'fail', {
      reason: settingsProblem === null ? 'SETTINGS_MISMATCH' : 'SETTINGS_UNREADABLE',
      expected: bytesToHex(checked.agreedBytes),
      actual: bytesToHex(parsed.settings),
      message: settingsProblem ?? undefined,
    });
  }

  // 4. The entrance and the exit.
  const endpointsMatch =
    parsed.maze.entrance.r === checked.declaredEntrance.r &&
    parsed.maze.entrance.c === checked.declaredEntrance.c &&
    parsed.maze.exit.r === checked.declaredExit.r &&
    parsed.maze.exit.c === checked.declaredExit.c;
  if (endpointsMatch) {
    report(4, 'ok', {});
  } else {
    violated = true;
    report(4, 'fail', {
      reason: 'ENDPOINTS_MISMATCH',
      declaredEntrance: cellToLabel(checked.declaredEntrance.r, checked.declaredEntrance.c),
      declaredExit: cellToLabel(checked.declaredExit.r, checked.declaredExit.c),
      revealedEntrance: cellToLabel(parsed.maze.entrance.r, parsed.maze.entrance.c),
      revealedExit: cellToLabel(parsed.maze.exit.r, parsed.maze.exit.c),
    });
  }

  // 5. The five validity conditions of SPEC 1.5.
  const settingsForValidation = revealed.settingsObject ?? checked.agreedObject;
  const validity = validateMaze(parsed.maze, settingsForValidation);
  if (validity.ok) {
    report(5, 'ok', { walls: parsed.maze.walls.size });
  } else {
    violated = true;
    report(5, 'fail', { reason: 'MAZE_INVALID', problems: validity.problems });
  }

  // 6. Every answer the opponent gave, replayed against the revealed maze.
  const mismatches = [];
  for (const record of checked.log) {
    const edge = /** @type {string} */ (
      edgeBetween(record.from.r, record.from.c, record.to.r, record.to.c)
    );
    const actual = hasWall(parsed.maze, record.from.r, record.from.c, record.to.r, record.to.c)
      ? 'wall'
      : 'pass';
    if (actual !== record.answer) {
      mismatches.push({
        move: record.move,
        edge,
        from: cellToLabel(record.from.r, record.from.c),
        to: cellToLabel(record.to.r, record.to.c),
        declared: record.answer,
        actual,
      });
    }
  }
  if (mismatches.length === 0) {
    report(6, 'ok', { checked: checked.log.length });
  } else {
    violated = true;
    report(6, 'fail', {
      reason: 'ANSWER_MISMATCH',
      checked: checked.log.length,
      mismatches,
    });
  }

  const verdict = finishWithVerdict(report, checked, violated);
  const ok = steps.every((entry) => entry.status === 'ok' || entry.step === 7);
  return { ok, violated, steps, revealed, mismatches, verdict };
}

/**
 * Writes the last report line: the verdict, when a finished game state was
 * supplied.
 *
 * @param {(number: number, status: 'ok'|'fail'|'skipped', details?: object) => void} report
 *   Report writer.
 * @param {object} checked Normalised input of {@link verifyReveal}.
 * @param {boolean} opponentViolation Whether checks 2 to 6 caught the opponent.
 * @returns {object|null} The verdict, or null when it could not be computed.
 */
function finishWithVerdict(report, checked, opponentViolation) {
  if (checked.gameState === null) {
    report(7, 'skipped', { reason: 'GAME_STATE_NOT_PROVIDED' });
    return null;
  }
  const verdict = computeVerdict(checked.gameState, checked.gameState.settings, {
    me: checked.myViolation,
    opponent: opponentViolation,
  });
  report(7, 'ok', verdict);
  return verdict;
}

/**
 * Reads a violation flag that may be a boolean or a list of codes.
 *
 * @param {unknown} value Flag to read.
 * @returns {boolean} True when the side is considered a violator.
 * @throws {Error} If the value is neither a boolean, an array nor undefined.
 */
function isViolation(value) {
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  throw new Error(`violation flag must be a boolean or an array, got ${String(value)}`);
}

/**
 * The round a global move belongs to: a round is a pair of moves (SPEC 2.5).
 *
 * @param {number} globalMove Global move number, 1 or greater.
 * @returns {number} Round number.
 * @throws {Error} If the argument is not a positive integer.
 */
export function roundOfMove(globalMove) {
  if (!Number.isInteger(globalMove) || globalMove < 1) {
    throw new Error(`globalMove must be a positive integer, got ${String(globalMove)}`);
  }
  return Math.ceil(globalMove / 2);
}

/**
 * Reads one side of a game state for the verdict.
 *
 * @param {unknown} side Side state.
 * @param {string} name Name used in the error message.
 * @returns {{firstExitMove: number|null, resigned: boolean}} The two fields the
 *   verdict needs.
 * @throws {Error} If the side is malformed.
 */
function readSide(side, name) {
  if (side === null || typeof side !== 'object') {
    throw new Error(`${name} must be an object, got ${String(side)}`);
  }
  const { firstExitMove = null, resigned = false } = /** @type {any} */ (side);
  if (firstExitMove !== null && (!Number.isInteger(firstExitMove) || firstExitMove < 1)) {
    throw new Error(`${name}.firstExitMove must be a positive integer or null`);
  }
  if (typeof resigned !== 'boolean') {
    throw new Error(`${name}.resigned must be a boolean`);
  }
  return { firstExitMove, resigned };
}

/**
 * Decides the game exactly as SPEC 2.5 prescribes: a caught violation beats a
 * resignation, a resignation beats anything that happened on the board.
 *
 * @param {object} state Finished game state, or any object carrying
 *   `sides.me` and `sides.opponent` with `firstExitMove` and `resigned`.
 * @param {{play_after_exit: number}} settings Settings the game was played
 *   under.
 * @param {{me?: boolean|string[], opponent?: boolean|string[]}} [violations={}]
 *   Which sides failed verification.
 * @returns {{outcome: 'WIN'|'DRAW'|'BOTH_LOSE', winner: 'me'|'opponent'|null, loser: 'me'|'opponent'|null, reason: string, details: object}}
 *   The verdict, in codes.
 * @throws {Error} If the state, the settings or the violation flags are
 *   malformed.
 */
export function computeVerdict(state, settings, violations = {}) {
  if (state === null || typeof state !== 'object' || state.sides === null || typeof state.sides !== 'object') {
    throw new Error('computeVerdict needs a game state with a sides object');
  }
  if (settings === null || typeof settings !== 'object') {
    throw new Error(`settings must be an object, got ${String(settings)}`);
  }
  const playAfterExit = settings.play_after_exit;
  if (playAfterExit !== 0 && playAfterExit !== 1) {
    throw new Error(`settings.play_after_exit must be 0 or 1, got ${String(playAfterExit)}`);
  }
  if (violations === null || typeof violations !== 'object') {
    throw new Error(`violations must be an object, got ${String(violations)}`);
  }

  const me = readSide(state.sides.me, 'state.sides.me');
  const opponent = readSide(state.sides.opponent, 'state.sides.opponent');
  const meViolated = isViolation(violations.me);
  const opponentViolated = isViolation(violations.opponent);

  const details = {
    me: {
      firstExitMove: me.firstExitMove,
      round: me.firstExitMove === null ? null : roundOfMove(me.firstExitMove),
    },
    opponent: {
      firstExitMove: opponent.firstExitMove,
      round: opponent.firstExitMove === null ? null : roundOfMove(opponent.firstExitMove),
    },
  };

  // 1. A caught violation is a technical defeat and stops the count.
  if (meViolated && opponentViolated) {
    return { outcome: 'BOTH_LOSE', winner: null, loser: null, reason: 'BOTH_VIOLATED', details };
  }
  if (meViolated) {
    return { outcome: 'WIN', winner: 'opponent', loser: 'me', reason: 'VIOLATION', details };
  }
  if (opponentViolated) {
    return { outcome: 'WIN', winner: 'me', loser: 'opponent', reason: 'VIOLATION', details };
  }

  // 2. A resignation.
  if (me.resigned && opponent.resigned) {
    return { outcome: 'BOTH_LOSE', winner: null, loser: null, reason: 'BOTH_RESIGNED', details };
  }
  if (me.resigned) {
    return { outcome: 'WIN', winner: 'opponent', loser: 'me', reason: 'RESIGN', details };
  }
  if (opponent.resigned) {
    return { outcome: 'WIN', winner: 'me', loser: 'opponent', reason: 'RESIGN', details };
  }

  // 3. Nobody reached the exit.
  if (me.firstExitMove === null && opponent.firstExitMove === null) {
    return { outcome: 'DRAW', winner: null, loser: null, reason: 'NO_EXIT_REACHED', details };
  }

  // 4. Exactly one reached it.
  if (opponent.firstExitMove === null) {
    return { outcome: 'WIN', winner: 'me', loser: 'opponent', reason: 'ONLY_ONE_REACHED_EXIT', details };
  }
  if (me.firstExitMove === null) {
    return { outcome: 'WIN', winner: 'opponent', loser: 'me', reason: 'ONLY_ONE_REACHED_EXIT', details };
  }

  // 5. Both reached it.
  if (playAfterExit === 1) {
    if (details.me.round === details.opponent.round) {
      return { outcome: 'DRAW', winner: null, loser: null, reason: 'SAME_ROUND', details };
    }
    const winner = details.me.round < details.opponent.round ? 'me' : 'opponent';
    return { outcome: 'WIN', winner, loser: winner === 'me' ? 'opponent' : 'me', reason: 'EARLIER_ROUND', details };
  }
  const winner = me.firstExitMove < opponent.firstExitMove ? 'me' : 'opponent';
  return { outcome: 'WIN', winner, loser: winner === 'me' ? 'opponent' : 'me', reason: 'EARLIER_MOVE', details };
}
