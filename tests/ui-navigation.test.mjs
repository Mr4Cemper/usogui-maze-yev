/**
 * The stage strip. It is the only way off the game screen (SPEC 5.3), so a
 * step that does not lead anywhere locks a player inside a game.
 *
 * These are the pure halves of app.js: which stage may be opened, and what
 * opening it does to the state. No DOM involved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { canOpen, closeRules, openRules, openStage } from '../src/ui/app.js';
import { createDefaultState } from '../src/ui/store.js';
import { createGameSettings } from '../src/core/settings.js';

const STAGES = ['setup', 'build', 'play', 'verify'];

/**
 * A game that is under way: nobody resigned, nobody reached anything, and the
 * journal is exactly what the game screen would have written.
 *
 * @returns {object} The state.
 */
function gameInProgress() {
  return {
    ...createDefaultState(),
    screen: 'play',
    settings: createGameSettings({}),
    settingsCode: 'YM1-CS8S5HD5HD0CK3R-A2FF',
    settingsOrigin: 'created',
    settingsLocked: true,
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,0', 'H1,1'] },
    opponentEnds: { entrance: { r: 0, c: 5 }, exit: { r: 5, c: 0 } },
    commit: {
      commit: 'a'.repeat(64),
      commitCode: `YMC1-${'a'.repeat(64)}-1F2E`,
      saltHex: '0'.repeat(32),
    },
    revealSaved: true,
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

/**
 * The same game, closed by a resignation.
 *
 * @returns {object} The state.
 */
function resignedGame() {
  const state = gameInProgress();
  return { ...state, gameActions: [...state.gameActions, { type: 'RESIGN', side: 'me' }] };
}

test('verification opens from a game that is still being played', () => {
  // The reason this test exists: the game screen has no "to verification"
  // button while a game runs, so this step is the only way there. A player who
  // played to the exit without resigning must not be locked in.
  const state = gameInProgress();
  assert.equal(canOpen('verify', state), true);
  assert.equal(openStage(state, 'verify').screen, 'verify');
});

test('and it opens from a game that ended in a resignation', () => {
  const state = resignedGame();
  assert.equal(canOpen('verify', state), true);
  assert.equal(openStage(state, 'verify').screen, 'verify');
});

test('every step of a running game leads to its screen, both ways', () => {
  const state = gameInProgress();
  for (const from of STAGES) {
    for (const to of STAGES) {
      const at = openStage(state, from);
      assert.equal(at.screen, from, `could not stand on ${from}`);
      assert.equal(openStage(at, to).screen, to, `${from} -> ${to} did not move`);
    }
  }
});

test('a stage that has not been reached stays closed and changes nothing', () => {
  const fresh = createDefaultState();
  assert.equal(canOpen('build', fresh), false);
  assert.equal(canOpen('play', fresh), false);
  assert.equal(openStage(fresh, 'build'), fresh);
  assert.equal(openStage(fresh, 'play'), fresh);
});

test('the building screen opens as soon as the settings exist', () => {
  const state = { ...createDefaultState(), settings: createGameSettings({}) };
  assert.equal(canOpen('build', state), true);
  assert.equal(canOpen('play', state), false);
  assert.equal(openStage(state, 'build').screen, 'build');
});

test('settings and verification are open at every point', () => {
  for (const state of [createDefaultState(), gameInProgress(), resignedGame()]) {
    assert.equal(canOpen('setup', state), true);
    assert.equal(canOpen('verify', state), true);
  }
});

test('the game screen opens only once a game has been started', () => {
  const state = gameInProgress();
  assert.equal(canOpen('play', state), true);
  assert.equal(canOpen('play', { ...state, gameStarted: false }), false);
});

test('navigation moves the screen and touches nothing else', () => {
  const state = gameInProgress();
  const moved = openStage(state, 'verify');
  assert.notEqual(moved, state);
  // The journal is handed over as it stands: navigating is not an action of
  // the game (SPEC 5.3).
  assert.equal(moved.gameActions, state.gameActions);
  assert.deepEqual({ ...moved, screen: null }, { ...state, screen: null });
});

test('an unknown stage is a mistake in the caller, not a silent no-op', () => {
  assert.throws(() => openStage(gameInProgress(), 'report'), /unknown stage/);
});

test('the rules open from every screen and give it back on closing', () => {
  for (const screen of STAGES) {
    const at = { ...gameInProgress(), screen };
    const reading = openRules(at);
    assert.equal(reading.rulesOpen, true);
    // The screen does not change while the rules are open: that is what makes
    // going back a matter of one flag instead of a remembered route.
    assert.equal(reading.screen, screen);
    const back = closeRules(reading);
    assert.equal(back.rulesOpen, false);
    assert.equal(back.screen, screen);
    assert.deepEqual(back, at);
  }
});

test('the rules open in the middle of a game and change nothing about it', () => {
  const state = gameInProgress();
  const reading = openRules(state);
  assert.equal(reading.gameActions, state.gameActions);
  assert.deepEqual({ ...reading, rulesOpen: null }, { ...state, rulesOpen: null });
});

test('opening or closing twice is not a change', () => {
  const state = gameInProgress();
  assert.equal(closeRules(state), state);
  const reading = openRules(state);
  assert.equal(openRules(reading), reading);
});

test('the rules are not a stage: the strip does not know the name', () => {
  assert.throws(() => openStage(gameInProgress(), 'rules'), /unknown stage/);
});
