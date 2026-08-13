import test from 'node:test';
import assert from 'node:assert/strict';

import { computeVerdict, roundOfMove } from '../src/core/verify.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

/**
 * Builds the smallest state the verdict needs.
 *
 * @param {object} me How my side finished.
 * @param {object} opponent How the opponent's side finished.
 * @returns {object} A state shaped object.
 */
function finished(me, opponent) {
  return {
    sides: {
      me: { firstExitMove: null, resigned: false, ...me },
      opponent: { firstExitMove: null, resigned: false, ...opponent },
    },
  };
}

const AFTER_EXIT_ON = { ...DEFAULT_SETTINGS, play_after_exit: 1 };
const AFTER_EXIT_OFF = { ...DEFAULT_SETTINGS, play_after_exit: 0 };

test('a round is a pair of moves', () => {
  assert.equal(roundOfMove(1), 1);
  assert.equal(roundOfMove(2), 1);
  assert.equal(roundOfMove(3), 2);
  assert.equal(roundOfMove(4), 2);
  assert.equal(roundOfMove(149), 75);
  assert.throws(() => roundOfMove(0), /positive integer/);
  assert.throws(() => roundOfMove(1.5), /positive integer/);
});

test('nobody reached the exit: a draw', () => {
  const verdict = computeVerdict(finished({}, {}), AFTER_EXIT_ON);
  assert.equal(verdict.outcome, 'DRAW');
  assert.equal(verdict.winner, null);
  assert.equal(verdict.reason, 'NO_EXIT_REACHED');
});

test('exactly one reached the exit: that one wins', () => {
  const mine = computeVerdict(finished({ firstExitMove: 7 }, {}), AFTER_EXIT_ON);
  assert.equal(mine.outcome, 'WIN');
  assert.equal(mine.winner, 'me');
  assert.equal(mine.loser, 'opponent');
  assert.equal(mine.reason, 'ONLY_ONE_REACHED_EXIT');

  const theirs = computeVerdict(finished({}, { firstExitMove: 7 }), AFTER_EXIT_ON);
  assert.equal(theirs.winner, 'opponent');
  assert.equal(theirs.reason, 'ONLY_ONE_REACHED_EXIT');
});

test('both reached it in the same round and play_after_exit is on: a draw', () => {
  const verdict = computeVerdict(
    finished({ firstExitMove: 3 }, { firstExitMove: 4 }),
    AFTER_EXIT_ON,
  );
  assert.equal(verdict.details.me.round, 2);
  assert.equal(verdict.details.opponent.round, 2);
  assert.equal(verdict.outcome, 'DRAW');
  assert.equal(verdict.reason, 'SAME_ROUND');
});

test('the same two moves with play_after_exit off: the smaller move wins', () => {
  const verdict = computeVerdict(
    finished({ firstExitMove: 3 }, { firstExitMove: 4 }),
    AFTER_EXIT_OFF,
  );
  assert.equal(verdict.outcome, 'WIN');
  assert.equal(verdict.winner, 'me');
  assert.equal(verdict.reason, 'EARLIER_MOVE');

  const other = computeVerdict(
    finished({ firstExitMove: 6 }, { firstExitMove: 5 }),
    AFTER_EXIT_OFF,
  );
  assert.equal(other.winner, 'opponent');
  assert.equal(other.reason, 'EARLIER_MOVE');
});

test('different rounds with play_after_exit on: the earlier round wins', () => {
  const verdict = computeVerdict(
    finished({ firstExitMove: 3 }, { firstExitMove: 6 }),
    AFTER_EXIT_ON,
  );
  assert.equal(verdict.winner, 'me');
  assert.equal(verdict.reason, 'EARLIER_ROUND');
  assert.equal(verdict.details.me.round, 2);
  assert.equal(verdict.details.opponent.round, 3);
});

test('a resignation beats reaching the exit', () => {
  const verdict = computeVerdict(
    finished({ firstExitMove: 3, resigned: true }, {}),
    AFTER_EXIT_ON,
  );
  assert.equal(verdict.outcome, 'WIN');
  assert.equal(verdict.winner, 'opponent');
  assert.equal(verdict.loser, 'me');
  assert.equal(verdict.reason, 'RESIGN');

  const both = computeVerdict(
    finished({ resigned: true }, { resigned: true }),
    AFTER_EXIT_ON,
  );
  assert.equal(both.outcome, 'BOTH_LOSE');
  assert.equal(both.reason, 'BOTH_RESIGNED');
});

test('a caught violation beats a resignation', () => {
  const verdict = computeVerdict(
    finished({ firstExitMove: 3, resigned: true }, { firstExitMove: 2 }),
    AFTER_EXIT_ON,
    { opponent: true },
  );
  assert.equal(verdict.outcome, 'WIN');
  assert.equal(verdict.winner, 'me');
  assert.equal(verdict.loser, 'opponent');
  assert.equal(verdict.reason, 'VIOLATION');

  const mine = computeVerdict(finished({}, { resigned: true }), AFTER_EXIT_ON, {
    me: ['ANSWER_MISMATCH'],
  });
  assert.equal(mine.winner, 'opponent');
  assert.equal(mine.reason, 'VIOLATION');

  const both = computeVerdict(finished({ firstExitMove: 1 }, {}), AFTER_EXIT_ON, {
    me: true,
    opponent: ['COMMIT_MISMATCH'],
  });
  assert.equal(both.outcome, 'BOTH_LOSE');
  assert.equal(both.reason, 'BOTH_VIOLATED');
  assert.equal(both.winner, null);
});

test('an empty violation list is not a violation', () => {
  const verdict = computeVerdict(finished({ firstExitMove: 5 }, {}), AFTER_EXIT_ON, {
    me: [],
    opponent: [],
  });
  assert.equal(verdict.winner, 'me');
  assert.equal(verdict.reason, 'ONLY_ONE_REACHED_EXIT');
});

test('the verdict reports the moves and rounds it used', () => {
  const verdict = computeVerdict(
    finished({ firstExitMove: 9 }, { firstExitMove: 12 }),
    AFTER_EXIT_ON,
  );
  assert.deepEqual(verdict.details, {
    me: { firstExitMove: 9, round: 5 },
    opponent: { firstExitMove: 12, round: 6 },
  });
});

test('computeVerdict guards its arguments', () => {
  assert.throws(() => computeVerdict(null, AFTER_EXIT_ON), /needs a game state/);
  assert.throws(() => computeVerdict({}, AFTER_EXIT_ON), /needs a game state/);
  assert.throws(() => computeVerdict(finished({}, {}), null), /settings must be an object/);
  assert.throws(
    () => computeVerdict(finished({}, {}), { play_after_exit: 2 }),
    /play_after_exit must be 0 or 1/,
  );
  assert.throws(
    () => computeVerdict(finished({ firstExitMove: 0 }, {}), AFTER_EXIT_ON),
    /firstExitMove must be a positive integer or null/,
  );
  assert.throws(
    () => computeVerdict(finished({ resigned: 'yes' }, {}), AFTER_EXIT_ON),
    /resigned must be a boolean/,
  );
  assert.throws(
    () => computeVerdict(finished({}, {}), AFTER_EXIT_ON, { me: 'sure' }),
    /violation flag must be a boolean or an array/,
  );
});
