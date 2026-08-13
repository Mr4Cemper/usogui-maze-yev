/**
 * Saving a finished game (SPEC 5.9).
 *
 * The picture has one failure mode worth a test of its own: a detached SVG
 * cannot resolve a custom property, so any `var(--x)` that survives
 * serialisation turns the export into a black rectangle. The guard is checked
 * here; the inlining that makes it pass is checked by eye in a browser,
 * because it needs a browser to compute anything.
 *
 * The archive is a pure function and is checked properly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHIVE_VERSION,
  PAINT_PROPERTIES,
  assertNoVariables,
  buildArchive,
  exportFileName,
} from '../src/ui/export.js';
import { createDefaultState } from '../src/ui/store.js';
import { createGameSettings } from '../src/core/settings.js';
import { createMaze } from '../src/core/maze.js';
import { runJournal } from '../src/ui/gameLog.js';

/**
 * A state with a game in it.
 *
 * @returns {object} The state.
 */
function playedState() {
  return {
    ...createDefaultState(),
    settings: createGameSettings({}),
    settingsCode: 'YM1-CS8S5HD5HD0CK3R-A2FF',
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,1', 'H1,0'] },
    opponentEnds: { entrance: { r: 0, c: 5 }, exit: { r: 5, c: 0 } },
    commit: { commit: 'a'.repeat(64), commitCode: `YMC1-${'a'.repeat(64)}-1F2E`, saltHex: '0'.repeat(32) },
    opponentCommit: { code: `YMC1-${'b'.repeat(64)}-ABCD`, commit: 'b'.repeat(64) },
    gameStarted: true,
    gameActions: [
      { type: 'START_TURN' },
      { type: 'STEP', side: 'me', direction: 'left', answer: 'pass', auto: false },
      { type: 'END_TURN' },
      { type: 'START_TURN' },
      { type: 'STEP', side: 'opponent', direction: 'down' },
      { type: 'END_TURN' },
    ],
  };
}

test('a token that survived serialisation is refused, not exported', () => {
  // This is the whole point: without the guard the file is written, opens as a
  // black rectangle, and looks like a broken viewer rather than a bug here.
  assert.throws(
    () => assertNoVariables('<svg><rect fill="var(--bg)"/></svg>'),
    /black rectangle/,
  );
  assert.throws(() => assertNoVariables('<svg><line stroke="var( --board-wall )"/></svg>'), /var\(/);
  const clean = '<svg><rect fill="#000a12"/><line stroke="rgb(0, 229, 255)"/></svg>';
  assert.equal(assertNoVariables(clean), clean);
});

test('the properties that are baked in cover paint and text', () => {
  for (const required of ['fill', 'stroke', 'stroke-width', 'font-family', 'visibility']) {
    assert.equal(PAINT_PROPERTIES.includes(required), true, `${required} has to travel with the copy`);
  }
  // Nothing about layout: an SVG has none, and copying it would only add noise.
  for (const wrong of ['margin', 'padding', 'position', 'width']) {
    assert.equal(PAINT_PROPERTIES.includes(wrong), false, wrong);
  }
});

test('the file name says what it is and when it was made', () => {
  const name = exportFileName('png', new Date(2026, 7, 13, 4, 5));
  assert.equal(name, 'usogui-maze-2026-08-13-0405.png');
  assert.match(exportFileName('json'), /^usogui-maze-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
});

test('the archive carries a version and says it is not for loading back', () => {
  const state = playedState();
  const archive = buildArchive({ state, game: runJournal(state, state.gameActions).state });
  assert.equal(archive.version, ARCHIVE_VERSION);
  assert.equal(archive.format, 'usogui-maze-archive');
  assert.match(archive.note, /never loads it back/i);
  assert.match(archive.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  // And it survives the trip through JSON it is going to make.
  assert.deepEqual(JSON.parse(JSON.stringify(archive)), archive);
});

test('the archive holds the game, in cells a person can read', () => {
  const state = playedState();
  const game = runJournal(state, state.gameActions).state;
  const archive = buildArchive({ state, game });

  assert.equal(archive.myMaze.entrance, 'A1');
  assert.equal(archive.myMaze.exit, 'F6');
  assert.deepEqual(archive.myMaze.walls, ['H1,0', 'V0,1']);
  assert.equal(archive.opponentEnds.entrance, 'A6');
  assert.equal(archive.moves > 1, true);
  assert.equal(archive.history.length, 2);
  assert.equal(archive.history[0].steps[0].from, 'A6');
  assert.equal(typeof archive.history[0].text, 'string');
  assert.equal(archive.journal.length, state.gameActions.length);
  assert.notEqual(archive.settings, null);
});

test('without a reveal the archive says so, in a field of its own', () => {
  const state = playedState();
  const archive = buildArchive({ state, game: runJournal(state, state.gameActions).state });

  // Not a missing key: a reader must not have to guess whether the maze is
  // absent or lost (SPEC 5.9).
  assert.equal(Object.prototype.hasOwnProperty.call(archive, 'opponentMaze'), true);
  assert.equal(archive.opponentMaze, null);
  assert.equal(archive.opponentMazeKnown, false);
  assert.match(archive.opponentMazeMissingReason, /never/);
  assert.equal(archive.report, null);
  assert.equal(archive.verdict, null);
});

test('with a reveal the opponent maze is in it and the flag flips', () => {
  const state = playedState();
  const revealed = {
    maze: createMaze({ entrance: { r: 0, c: 5 }, exit: { r: 5, c: 0 }, walls: ['V2,2'] }),
  };
  const report = {
    ok: true,
    violated: false,
    steps: [{ step: 1, code: 'CODE_INTEGRITY', status: 'ok', details: null }],
    mismatches: [],
    verdict: { outcome: 'WIN', reason: 'EARLIER_MOVE' },
  };
  const archive = buildArchive({
    state,
    game: runJournal(state, state.gameActions).state,
    report,
    revealed,
  });

  assert.equal(archive.opponentMazeKnown, true);
  assert.equal(archive.opponentMazeMissingReason, null);
  assert.equal(archive.opponentMaze.entrance, 'A6');
  assert.deepEqual(archive.opponentMaze.walls, ['V2,2']);
  assert.deepEqual(archive.verdict, { outcome: 'WIN', reason: 'EARLIER_MOVE' });
  assert.equal(archive.report.steps[0].code, 'CODE_INTEGRITY');
});

test('an archive can be made of a game that never started', () => {
  const archive = buildArchive({ state: createDefaultState(), game: null });
  assert.equal(archive.moves, 0);
  assert.deepEqual(archive.history, []);
  assert.equal(archive.opponentMazeKnown, false);
});
