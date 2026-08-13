import test from 'node:test';
import assert from 'node:assert/strict';

import { VERIFY_CHECKS, verifyReveal } from '../src/core/verify.js';
import {
  buildPayload,
  computeCommit,
  encodeCommitCode,
  encodeReveal,
  generateSalt,
} from '../src/core/commit.js';
import { createMaze, hasWall } from '../src/core/maze.js';
import { DEFAULT_SETTINGS, packSettings } from '../src/core/settings.js';
import {
  DIRECTIONS,
  buildAnswerLog,
  createGameState,
  endTurn,
  startTurn,
  tryStep,
} from '../src/core/game.js';

const SETTINGS = { ...DEFAULT_SETTINGS, game_nonce: 0x1234 };
const SETTINGS_BLOCK = packSettings(SETTINGS);

/** The maze the opponent built and I walk through during the game. */
const OPPONENT_MAZE = createMaze({
  entrance: { r: 0, c: 0 },
  exit: { r: 0, c: 2 },
  walls: ['V0,1', 'H0,0'],
});

/** My own maze, which the opponent walks. */
const MY_MAZE = createMaze({
  entrance: { r: 5, c: 5 },
  exit: { r: 5, c: 0 },
  walls: ['H4,5'],
});

/**
 * Makes one step on my side and answers it truthfully from the real maze.
 *
 * @param {object} state Game state.
 * @param {object} maze The maze the answers come from.
 * @param {'up'|'down'|'left'|'right'} direction Where to step.
 * @returns {object} What tryStep returned.
 */
function honestStep(state, maze, direction) {
  const { r, c } = state.sides.me.pos;
  const { dr, dc } = DIRECTIONS[direction];
  const answer = hasWall(maze, r, c, r + dr, c + dc) ? 'wall' : 'pass';
  return tryStep(state, 'me', direction, answer);
}

/**
 * Plays a short honest game and returns everything the verification needs.
 *
 * @returns {Promise<object>} Game state, log, commit and reveal string.
 */
async function playHonestGame() {
  const state = createGameState({
    settings: SETTINGS,
    myMaze: MY_MAZE,
    opponentEntrance: OPPONENT_MAZE.entrance,
    opponentExit: OPPONENT_MAZE.exit,
    myPlayer: 1,
  });

  startTurn(state);
  honestStep(state, OPPONENT_MAZE, 'right'); // A1 -> A2, open
  honestStep(state, OPPONENT_MAZE, 'right'); // wall V0,1
  honestStep(state, OPPONENT_MAZE, 'down'); // A2 -> B2, open
  endTurn(state);

  startTurn(state);
  tryStep(state, 'opponent', 'left'); // the opponent walks my maze
  endTurn(state);

  startTurn(state);
  honestStep(state, OPPONENT_MAZE, 'right'); // B2 -> B3
  honestStep(state, OPPONENT_MAZE, 'up'); // B3 -> A3, the exit
  endTurn(state);

  const payload = buildPayload(SETTINGS_BLOCK, OPPONENT_MAZE);
  const salt = generateSalt();
  const commitHex = await computeCommit(payload, salt);
  return {
    state,
    log: buildAnswerLog(state, 'me'),
    payload,
    salt,
    commitHex,
    commitCode: await encodeCommitCode(commitHex),
    reveal: await encodeReveal(payload, salt),
  };
}

test('an honest game passes every check', async () => {
  const game = await playHonestGame();
  assert.equal(game.state.sides.me.firstExitMove, 3, 'the exit was reached on move 3');

  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: game.reveal,
    opponentAnswerLog: game.log,
    gameState: game.state,
  });

  assert.equal(report.ok, true);
  assert.equal(report.violated, false);
  assert.equal(report.steps.length, 7);
  assert.deepEqual(report.steps.map((step) => step.step), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(report.steps.map((step) => step.code), [...VERIFY_CHECKS]);
  assert.deepEqual(report.steps.map((step) => step.status), Array(7).fill('ok'));
  assert.deepEqual(report.mismatches, []);
  assert.equal(report.steps[5].details.checked, game.log.length);
  assert.equal(report.verdict.winner, 'me');
  assert.equal(report.verdict.reason, 'ONLY_ONE_REACHED_EXIT');
});

test('without a game state the verdict line is skipped, the rest still passes', async () => {
  const game = await playHonestGame();
  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: game.reveal,
    opponentAnswerLog: game.log,
  });
  assert.equal(report.ok, true);
  assert.equal(report.verdict, null);
  assert.equal(report.steps[6].status, 'skipped');
  assert.equal(report.steps[6].details.reason, 'GAME_STATE_NOT_PROVIDED');
});

test('a substituted maze fails check 2 and checks 3 to 6 are skipped', async () => {
  const game = await playHonestGame();
  const otherMaze = createMaze({
    entrance: OPPONENT_MAZE.entrance,
    exit: OPPONENT_MAZE.exit,
    walls: ['V0,1'], // one wall fewer than what was committed to
  });
  const salt = generateSalt();
  const substituted = await encodeReveal(buildPayload(SETTINGS_BLOCK, otherMaze), salt);

  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: substituted,
    opponentAnswerLog: game.log,
    gameState: game.state,
  });

  assert.equal(report.ok, false);
  assert.equal(report.violated, true);
  assert.equal(report.steps[0].status, 'ok', 'the code itself is intact');
  assert.equal(report.steps[1].status, 'fail');
  assert.equal(report.steps[1].details.reason, 'COMMIT_MISMATCH');
  assert.equal(report.steps[1].details.expected, game.commitHex);
  for (const step of report.steps.slice(2, 6)) {
    assert.equal(step.status, 'skipped');
    assert.equal(step.details.reason, 'COMMIT_MISMATCH');
  }
  assert.equal(report.verdict.winner, 'me');
  assert.equal(report.verdict.reason, 'VIOLATION');
});

test('one dishonest answer fails check 6 and names the move and the edge', async () => {
  const game = await playHonestGame();
  const tampered = game.log.map((record, index) =>
    index === 2 ? { ...record, answer: record.answer === 'wall' ? 'pass' : 'wall' } : record,
  );

  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: game.reveal,
    opponentAnswerLog: tampered,
    gameState: game.state,
  });

  assert.equal(report.ok, false);
  assert.equal(report.violated, true);
  assert.deepEqual(report.steps.slice(0, 5).map((step) => step.status), Array(5).fill('ok'));
  assert.equal(report.steps[5].status, 'fail');
  assert.equal(report.steps[5].details.reason, 'ANSWER_MISMATCH');
  assert.equal(report.mismatches.length, 1);
  assert.deepEqual(report.mismatches[0], {
    move: 1,
    edge: 'H0,1',
    from: 'A2',
    to: 'B2',
    declared: 'wall',
    actual: 'pass',
  });
  assert.equal(report.verdict.reason, 'VIOLATION');
  assert.equal(report.verdict.winner, 'me');
});

test('a damaged code fails check 1 and is not an accusation', async () => {
  const game = await playHonestGame();
  const damaged = `${game.reveal.slice(0, 6)}${game.reveal[6] === 'A' ? 'B' : 'A'}${game.reveal.slice(7)}`;

  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: damaged,
    opponentAnswerLog: game.log,
    gameState: game.state,
  });

  assert.equal(report.ok, false);
  assert.equal(report.violated, false, 'a copying error is not cheating');
  assert.equal(report.steps[0].status, 'fail');
  assert.equal(report.steps[0].details.reason, 'CHECKSUM_MISMATCH');
  for (const step of report.steps.slice(1)) {
    assert.equal(step.status, 'skipped');
    assert.equal(step.details.reason, 'PREVIOUS_CHECK_FAILED');
  }
  assert.equal(report.verdict, null);
});

test('a code of the wrong kind fails check 1 as a format problem', async () => {
  const game = await playHonestGame();
  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: 'YM1-AAAAAAAAAAAAAAA-00',
    opponentAnswerLog: game.log,
  });
  assert.equal(report.steps[0].details.reason, 'MALFORMED_CODE');
  assert.equal(report.violated, false);
  assert.equal(report.revealed, null);
});

test('settings that were played under different rules fail check 3', async () => {
  const game = await playHonestGame();
  const otherSettings = packSettings({ ...SETTINGS, game_nonce: 0x9999 });

  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: otherSettings,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: game.reveal,
    opponentAnswerLog: game.log,
  });

  assert.equal(report.steps[1].status, 'ok', 'the commit still covers the revealed payload');
  assert.equal(report.steps[2].status, 'fail');
  assert.equal(report.steps[2].details.reason, 'SETTINGS_MISMATCH');
  assert.equal(report.steps[3].status, 'ok', 'the other checks still run');
  assert.equal(report.violated, true);
});

test('ends that were announced differently fail check 4', async () => {
  const game = await playHonestGame();
  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: { r: 5, c: 5 },
    revealString: game.reveal,
    opponentAnswerLog: game.log,
  });
  assert.equal(report.steps[3].status, 'fail');
  assert.equal(report.steps[3].details.reason, 'ENDPOINTS_MISMATCH');
  assert.equal(report.steps[3].details.declaredExit, 'F6');
  assert.equal(report.steps[3].details.revealedExit, 'A3');
});

test('a maze that was never valid fails check 5', async () => {
  const sealed = createMaze({
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: ['V0,0', 'H0,0'],
  });
  const payload = buildPayload(SETTINGS_BLOCK, sealed);
  const salt = generateSalt();

  const report = await verifyReveal({
    expectedCommit: await encodeCommitCode(await computeCommit(payload, salt)),
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: sealed.entrance,
    declaredExit: sealed.exit,
    revealString: await encodeReveal(payload, salt),
    opponentAnswerLog: [],
  });

  assert.equal(report.steps[4].status, 'fail');
  assert.equal(report.steps[4].details.reason, 'MAZE_INVALID');
  assert.deepEqual(report.steps[4].details.problems, ['ENTRANCE_SEALED', 'NO_PATH']);
  assert.equal(report.violated, true);
});

test('a log record may name a direction instead of a target cell', async () => {
  const game = await playHonestGame();
  const byDirection = [
    { move: 1, from: { r: 0, c: 0 }, direction: 'right', answer: 'pass' },
    { move: 1, from: { r: 0, c: 1 }, direction: 'right', answer: 'wall' },
  ];
  const report = await verifyReveal({
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: game.reveal,
    opponentAnswerLog: byDirection,
  });
  assert.equal(report.steps[5].status, 'ok');
  assert.equal(report.steps[5].details.checked, 2);
});

test('the commit is only accepted inside its wrapper', async () => {
  const game = await playHonestGame();
  const base = {
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: game.reveal,
    opponentAnswerLog: game.log,
  };

  const bare = await verifyReveal({ ...base, expectedCommit: game.commitHex }).then(
    () => null,
    (error) => error,
  );
  assert.equal(bare.code, 'BAD_FORMAT', 'a commit without its checksum is not accepted');

  const damaged = `${game.commitCode.slice(0, 70)}${game.commitCode.slice(70) === '0000' ? '1111' : '0000'}`;
  const mistyped = await verifyReveal({ ...base, expectedCommit: damaged }).then(
    () => null,
    (error) => error,
  );
  assert.equal(
    mistyped.code,
    'BAD_CHECKSUM',
    'a mistyped commit is caught as a typo, never reported as a substituted maze',
  );

  // The wrapper is only transport: the digest inside it is what is compared.
  const report = await verifyReveal({ ...base, expectedCommit: game.commitCode });
  assert.equal(report.steps[1].details.commit, game.commitHex);
});

test('verifyReveal guards its arguments', async () => {
  const game = await playHonestGame();
  const base = {
    expectedCommit: game.commitCode,
    agreedSettings: SETTINGS_BLOCK,
    declaredEntrance: OPPONENT_MAZE.entrance,
    declaredExit: OPPONENT_MAZE.exit,
    revealString: game.reveal,
    opponentAnswerLog: [],
  };

  await assert.rejects(() => verifyReveal(null), /needs an object/);
  await assert.rejects(() => verifyReveal({ ...base, expectedCommit: 'abc' }), /must start with "YMC1-"/);
  await assert.rejects(() => verifyReveal({ ...base, expectedCommit: undefined }), /must be a string/);
  await assert.rejects(() => verifyReveal({ ...base, agreedSettings: undefined }), /agreedSettings is required/);
  await assert.rejects(() => verifyReveal({ ...base, revealString: 42 }), /must be a string/);
  await assert.rejects(() => verifyReveal({ ...base, declaredExit: 'A3' }), /must be an object/);
  await assert.rejects(() => verifyReveal({ ...base, declaredExit: { r: 9, c: 0 } }), /row r must be in 0\.\.5/);
  await assert.rejects(() => verifyReveal({ ...base, opponentAnswerLog: 'nope' }), /must be an array/);
  await assert.rejects(
    () => verifyReveal({ ...base, opponentAnswerLog: [{ move: 1, from: { r: 0, c: 0 }, to: { r: 3, c: 3 }, answer: 'pass' }] }),
    /not adjacent/,
  );
  await assert.rejects(
    () => verifyReveal({ ...base, opponentAnswerLog: [{ move: 1, from: { r: 0, c: 0 }, direction: 'right', answer: 'maybe' }] }),
    /answer must be "pass" or "wall"/,
  );
  await assert.rejects(
    () => verifyReveal({ ...base, opponentAnswerLog: [{ from: { r: 0, c: 0 }, direction: 'right', answer: 'pass' }] }),
    /move must be a positive integer/,
  );
  await assert.rejects(
    () => verifyReveal({ ...base, opponentAnswerLog: [{ move: 1, from: { r: 0, c: 0 }, answer: 'pass' }] }),
    /needs either a "to" cell or a "direction"/,
  );
});
