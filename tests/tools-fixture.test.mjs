/**
 * `tools/make-fixture.mjs` is a development tool, and a development tool that
 * quietly produces a state the application refuses is worse than none: the
 * hour it was meant to save goes into debugging the tool instead.
 *
 * So it is checked like anything else: the state it prints has to survive
 * `deserializeState`, its journal has to replay, and the dishonest variant has
 * to be actually dishonest.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFixture, parseArgs } from '../tools/make-fixture.mjs';
import { deserializeState } from '../src/ui/store.js';
import { runJournal } from '../src/ui/gameLog.js';
import { buildAnswerLog } from '../src/core/game.js';
import { verifyReveal } from '../src/core/verify.js';

test('the arguments are read, and nonsense is refused', () => {
  assert.deepEqual(parseArgs([]), {
    moves: 6,
    cheat: false,
    resign: null,
    screen: 'play',
    json: false,
  });
  assert.equal(parseArgs(['--moves=12']).moves, 12);
  assert.equal(parseArgs(['--cheat']).cheat, true);
  assert.equal(parseArgs(['--resign=opponent']).resign, 'opponent');
  assert.equal(parseArgs(['--screen=verify']).screen, 'verify');
  assert.throws(() => parseArgs(['--moves=half']), /whole number/);
  assert.throws(() => parseArgs(['--resign=nobody']), /me or opponent/);
  assert.throws(() => parseArgs(['--screen=rules']), /setup, build, play or verify/);
  assert.throws(() => parseArgs(['--sideways']), /unknown argument/);
});

test('the state it builds is one the application accepts', async () => {
  const fixture = await buildFixture(parseArgs(['--moves=8']));
  const restored = deserializeState(fixture.snapshot.data);

  assert.equal(restored.screen, 'play');
  assert.equal(restored.gameStarted, true);
  assert.equal(restored.settingsLocked, true);
  assert.equal(restored.revealSaved, true);
  assert.notEqual(restored.settings, null);
  assert.notEqual(restored.commit, null);
  assert.notEqual(restored.opponentCommit, null);
  // Nothing was dropped on the way in: a snapshot that loses half the journal
  // still loads, and that is exactly what makes it a bad fixture.
  assert.deepEqual(restored.gameActions, fixture.snapshot.data.gameActions);
  assert.equal(restored.gameLoadError, null);

  const replayed = runJournal(restored, restored.gameActions);
  assert.equal(replayed.state.globalMove > 1, true);
});

test('the snapshot travels through JSON unchanged', async () => {
  const fixture = await buildFixture(parseArgs(['--moves=4', '--screen=verify']));
  const restored = deserializeState(JSON.parse(JSON.stringify(fixture.snapshot)).data);
  assert.equal(restored.screen, 'verify');
  assert.deepEqual(restored.gameActions, fixture.snapshot.data.gameActions);
});

test('a resignation is recorded as the journal entry it is', async () => {
  const fixture = await buildFixture(parseArgs(['--moves=4', '--resign=opponent']));
  const last = fixture.state.gameActions.at(-1);
  assert.deepEqual(last, { type: 'RESIGN', side: 'opponent' });
  const replayed = runJournal(fixture.state, fixture.state.gameActions);
  assert.equal(replayed.state.sides.opponent.resigned, true);
});

test('an honest game passes the check it was built for', async () => {
  const fixture = await buildFixture(parseArgs(['--moves=10']));
  assert.equal(fixture.lie, null);
  const game = runJournal(fixture.state, fixture.state.gameActions).state;
  const report = await verifyReveal({
    expectedCommit: fixture.state.opponentCommit.code,
    agreedSettings: fixture.state.settings,
    declaredEntrance: fixture.state.opponentEnds.entrance,
    declaredExit: fixture.state.opponentEnds.exit,
    revealString: fixture.theirReveal,
    opponentAnswerLog: buildAnswerLog(game, 'me'),
    gameState: game,
  });
  assert.equal(report.ok, true);
  assert.equal(report.mismatches.length, 0);
});

test('the dishonest game really is caught, on the edge it names', async () => {
  const fixture = await buildFixture(parseArgs(['--moves=10', '--cheat']));
  assert.notEqual(fixture.lie, null);
  const game = runJournal(fixture.state, fixture.state.gameActions).state;
  const report = await verifyReveal({
    expectedCommit: fixture.state.opponentCommit.code,
    agreedSettings: fixture.state.settings,
    declaredEntrance: fixture.state.opponentEnds.entrance,
    declaredExit: fixture.state.opponentEnds.exit,
    revealString: fixture.theirReveal,
    opponentAnswerLog: buildAnswerLog(game, 'me'),
    gameState: game,
  });
  assert.equal(report.violated, true);
  assert.deepEqual(
    report.mismatches.map((item) => item.edge),
    [fixture.lie.edge],
  );
});
