/**
 * The verification screen and the automatic hand-over of a turn, tested where
 * they are pure: grouping the mismatches, colouring the verdict, winding the
 * replay, and deciding whether a turn hands itself over.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkText,
  groupMismatches,
  verdictHeadline,
  verdictTone,
} from '../src/ui/components/reportPanel.js';
import { shouldAutoEnd } from '../src/ui/screens/play.js';
import { classifyCode, readOpponentReveal, shortCode } from '../src/ui/screens/verify.js';
import { describeCodeError } from '../src/ui/components/codeField.js';
import { nextGameState } from '../src/ui/store.js';
import {
  buildPayload,
  computeCommit,
  encodeCommitCode,
  encodeReveal,
  generateSalt,
} from '../src/core/commit.js';
import { createGameSettings, encodeSettingsCode } from '../src/core/settings.js';
import { createMaze } from '../src/core/maze.js';
import { replayGame, runJournal } from '../src/ui/gameLog.js';
import { createDefaultState } from '../src/ui/store.js';
import { normalizeSettings } from '../src/core/settings.js';
import { t } from '../src/i18n/index.js';

/**
 * The interface state a game is built from.
 *
 * @returns {object} A complete setup.
 */
function setupState() {
  return {
    ...createDefaultState(),
    settings: normalizeSettings({ allow_pass: 1 }),
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,0'] },
    opponentEnds: { entrance: { r: 0, c: 0 }, exit: { r: 0, c: 2 } },
  };
}

test('three mismatches on one edge become one line that says three', () => {
  const grouped = groupMismatches([
    { move: 3, edge: 'V0,0', from: 'A1', to: 'A2', declared: 'wall', actual: 'pass' },
    { move: 5, edge: 'V0,0', from: 'A1', to: 'A2', declared: 'wall', actual: 'pass' },
    { move: 9, edge: 'V0,0', from: 'A1', to: 'A2', declared: 'wall', actual: 'pass' },
    { move: 7, edge: 'H1,1', from: 'B2', to: 'C2', declared: 'pass', actual: 'wall' },
  ]);

  assert.equal(grouped.length, 2, 'two edges went wrong, however many times');
  assert.deepEqual(grouped[0], {
    edge: 'V0,0',
    from: 'A1',
    to: 'A2',
    declared: 'wall',
    actual: 'pass',
    count: 3,
    moves: [3, 5, 9],
  });
  assert.equal(grouped[1].count, 1);
  assert.deepEqual(groupMismatches([]), []);
});

test('the same move counted twice is still one move in the list', () => {
  const grouped = groupMismatches([
    { move: 4, edge: 'V2,2', from: 'C3', to: 'C4', declared: 'pass', actual: 'wall' },
    { move: 4, edge: 'V2,2', from: 'C3', to: 'C4', declared: 'pass', actual: 'wall' },
  ]);
  assert.equal(grouped[0].count, 2, 'both answers are counted');
  assert.deepEqual(grouped[0].moves, [4], 'but the move is named once');
});

test('the verdict line takes its colour from the outcome, not from a status', () => {
  assert.equal(verdictTone({ outcome: 'WIN', winner: 'me' }), 'win');
  assert.equal(verdictTone({ outcome: 'WIN', winner: 'opponent' }), 'loss');
  assert.equal(verdictTone({ outcome: 'DRAW', winner: null }), 'draw');
  assert.equal(verdictTone({ outcome: 'BOTH_LOSE', winner: null }), 'both-lose');
  assert.equal(verdictTone(null), 'none');

  // Step 7 is reported as ok even when check 6 failed, so a screen that
  // painted it by status would call a loss a success.
  const lost = { outcome: 'WIN', winner: 'opponent', reason: 'VIOLATION' };
  assert.equal(verdictTone(lost), 'loss');
  assert.equal(verdictHeadline(lost), t('verdict.loss'));
  assert.notEqual(verdictHeadline(lost), verdictHeadline({ outcome: 'WIN', winner: 'me' }));
});

test('a failed check never reads as an accusation', () => {
  const damaged = checkText({
    step: 1,
    status: 'fail',
    code: 'CODE_INTEGRITY',
    details: { reason: 'CHECKSUM_MISMATCH' },
  });
  const commit = checkText({ step: 2, status: 'fail', code: 'COMMIT_MATCH', details: {} });
  const skipped = checkText({
    step: 3,
    status: 'skipped',
    code: 'SETTINGS_MATCH',
    details: { reason: 'COMMIT_MISMATCH' },
  });

  assert.match(damaged, /damaged while copying/);
  assert.match(commit, /entered with a mistake/);
  assert.match(skipped, /Skipped/);
  for (const text of [damaged, commit, skipped]) {
    assert.equal(/cheat|liar|lying/i.test(text), false, `an accusation slipped into: ${text}`);
  }
  assert.notEqual(damaged, commit, 'the two failures do not read the same');
});

test('the replay of N actions is the game after N actions', () => {
  const uiState = setupState();
  const journal = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'wall' },
    { type: 'END_TURN' },
    { type: 'START_TURN' },
    { type: 'STEP', side: 'opponent', direction: 'down' },
    { type: 'END_TURN' },
  ];

  for (let at = 0; at <= journal.length; at += 1) {
    const wound = runJournal(uiState, journal.slice(0, at)).state;
    const played = replayGame(uiState, journal.slice(0, at));
    assert.deepEqual(
      {
        move: wound.globalMove,
        current: wound.current,
        pos: wound.sides.me.pos,
        history: wound.history.length,
      },
      {
        move: played.globalMove,
        current: played.current,
        pos: played.sides.me.pos,
        history: played.history.length,
      },
      `wound to ${at}`,
    );
  }

  // And winding back does not disturb the finished game.
  const whole = replayGame(uiState, journal);
  assert.equal(whole.globalMove, 3);
  assert.equal(runJournal(uiState, journal.slice(0, 2)).state.globalMove, 1);
  assert.equal(whole.globalMove, 3, 'the finished game is untouched by the replay');
});

test('the turn hands itself over only when the player asked for it', () => {
  const wall = ['TURN_OVER_WALL'];
  const cells = ['TURN_OVER_NEW_CELLS'];
  const nothing = ['REACHED_EXIT'];

  assert.equal(shouldAutoEnd(wall, { autoEndTurn: true, pending: false }), true);
  assert.equal(shouldAutoEnd(cells, { autoEndTurn: true, pending: false }), true);
  assert.equal(shouldAutoEnd(nothing, { autoEndTurn: true, pending: false }), false);
  assert.equal(shouldAutoEnd([], { autoEndTurn: true, pending: false }), false);

  assert.equal(shouldAutoEnd(wall, { autoEndTurn: false, pending: false }), false);
  assert.equal(shouldAutoEnd(cells, { autoEndTurn: false, pending: false }), false);

  // A step that is still waiting for the opponent's answer is not a finished
  // step, so nothing is handed over.
  assert.equal(shouldAutoEnd(wall, { autoEndTurn: true, pending: true }), false);
  assert.equal(shouldAutoEnd(cells, { autoEndTurn: true, pending: true }), false);
});

test('my own reveal pasted into the opponent field is recognised and stops there', async () => {
  const settings = createGameSettings({});
  const maze = createMaze({
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: ['V0,0', 'H1,1'],
  });
  const payload = buildPayload(settings, maze);
  const salt = generateSalt();
  const mine = await encodeReveal(payload, salt);
  const myCommit = await computeCommit(payload, salt);

  // The same string, retyped with different spacing and case: the commits are
  // compared, not the text, so it is still recognised as mine.
  const disguised = `  ${mine.toLowerCase().replace('-', '-')}  `;

  for (const value of [mine, disguised]) {
    const error = await readOpponentReveal(value, myCommit).then(() => null, (thrown) => thrown);
    assert.notEqual(error, null, 'my own reveal must never reach the report');
    assert.equal(error.code, 'OWN_REVEAL');
    assert.match(describeCodeError(error), /your own reveal/);
    assert.equal(/cheat|substitut|does not match/i.test(describeCodeError(error)), false);
  }

  // Somebody else's reveal goes through untouched.
  const otherSalt = generateSalt();
  const theirs = await encodeReveal(payload, otherSalt);
  const read = await readOpponentReveal(theirs, myCommit);
  assert.equal(read.commit, await computeCommit(payload, otherSalt));
});

test('a code of another kind is named, not called a bad format', async () => {
  const settingsCode = await encodeSettingsCode({});
  const commitCode = await encodeCommitCode('a'.repeat(64));

  assert.equal(classifyCode(settingsCode), 'settings');
  assert.equal(classifyCode(commitCode), 'commit');
  assert.equal(classifyCode('YMR1-whatever'), 'reveal');
  assert.equal(classifyCode('hello'), 'unknown');
  assert.equal(classifyCode(null), 'unknown');
  assert.equal(classifyCode('  ymc1-abc  '), 'commit', 'case and spacing do not matter');

  const settingsError = await readOpponentReveal(settingsCode, null).then(() => null, (e) => e);
  assert.equal(settingsError.code, 'WRONG_KIND_SETTINGS');
  assert.match(describeCodeError(settingsError), /settings code/);

  const commitError = await readOpponentReveal(commitCode, null).then(() => null, (e) => e);
  assert.equal(commitError.code, 'WRONG_KIND_COMMIT');
  assert.match(describeCodeError(commitError), /commit code/);

  // The three messages stay three different messages.
  assert.equal(
    new Set([
      describeCodeError(settingsError),
      describeCodeError(commitError),
      describeCodeError({ code: 'BAD_FORMAT' }),
    ]).size,
    3,
  );
});

test('a shortened code still shows both of its ends', () => {
  const long = `YMC1-${'a'.repeat(64)}-1234`;
  const short = shortCode(long);
  assert.equal(short.startsWith('YMC1-aaaaaaaa'), true);
  assert.equal(short.endsWith('a-1234'), true);
  assert.equal(short.length < long.length, true);
  assert.equal(shortCode('YM1-SHORT'), 'YM1-SHORT', 'short codes are left alone');
});

test('a new game under the same rules keeps the rules and drops the game', async () => {
  const settings = createGameSettings({ allow_pass: 1, wall_limit: 25 });
  const played = {
    ...setupState(),
    settings,
    settingsCode: await encodeSettingsCode(settings),
    settingsOrigin: 'created',
    myPlayer: 2,
    rainOn: false,
    autoEndTurn: true,
    commit: {
      commit: 'a'.repeat(64),
      commitCode: `YMC1-${'a'.repeat(64)}-1234`,
      saltHex: '0'.repeat(32),
    },
    opponentCommit: { code: `YMC1-${'b'.repeat(64)}-5678`, commit: 'b'.repeat(64) },
    revealSaved: true,
    gameStarted: true,
    gameActions: [{ type: 'START_TURN' }, { type: 'PASS' }],
  };

  const { game_nonce: _old, ...values } = settings;
  const freshSettings = createGameSettings(values);
  const freshCode = await encodeSettingsCode(freshSettings);
  const next = nextGameState(played, freshSettings, freshCode);

  // Kept: the agreed values and the local preferences.
  assert.equal(next.settings.allow_pass, 1);
  assert.equal(next.settings.wall_limit, 25);
  assert.equal(next.myPlayer, 2);
  assert.equal(next.rainOn, false);
  assert.equal(next.autoEndTurn, true);

  // A new game number, and therefore a new code to send.
  assert.notEqual(next.settings.game_nonce, settings.game_nonce);
  assert.notEqual(next.settingsCode, played.settingsCode);
  assert.equal(next.settingsCode, freshCode);

  // Gone: both mazes, the commits, the salt, the journal, the saved flag.
  assert.deepEqual(next.myMaze, { entrance: null, exit: null, walls: [] });
  assert.deepEqual(next.opponentEnds, { entrance: null, exit: null });
  assert.equal(next.commit, null);
  assert.equal(next.opponentCommit, null);
  assert.equal(next.revealSaved, false);
  assert.equal(next.gameStarted, false);
  assert.deepEqual(next.gameActions, []);
  assert.equal(next.screen, 'setup', 'the new code has to be sent before anything else');
});

test('a resignation is recorded for the side that resigned, once', () => {
  const uiState = setupState();

  const theirs = replayGame(uiState, [{ type: 'RESIGN', side: 'opponent' }]);
  assert.equal(theirs.sides.opponent.resigned, true);
  assert.equal(theirs.sides.me.resigned, false, 'my side is untouched');
  assert.equal(theirs.history.at(-1).side, 'opponent');
  assert.equal(theirs.history.at(-1).type, 'RESIGN');

  assert.throws(
    () =>
      replayGame(uiState, [
        { type: 'RESIGN', side: 'opponent' },
        { type: 'RESIGN', side: 'opponent' },
      ]),
    /already resigned/,
  );

  // Each side still has its own single announcement.
  const both = replayGame(uiState, [
    { type: 'RESIGN', side: 'opponent' },
    { type: 'RESIGN', side: 'me' },
  ]);
  assert.equal(both.sides.me.resigned, true);
  assert.equal(both.sides.opponent.resigned, true);
});
