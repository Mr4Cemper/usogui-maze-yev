/**
 * The interface state, saved and restored. No DOM involved: these are the
 * pure halves of store.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultState,
  createStore,
  deserializeState,
  resetState,
  serializeState,
} from '../src/ui/store.js';
import { DEFAULT_SETTINGS, createGameSettings } from '../src/core/settings.js';

/**
 * A state with something in every field worth saving.
 *
 * @returns {object} The state.
 */
function filledState() {
  return {
    ...createDefaultState(),
    screen: 'build',
    myPlayer: 2,
    settings: { ...DEFAULT_SETTINGS, game_nonce: 4242, wall_limit: 25 },
    settingsCode: 'YM1-CS8S5HX5GY04Q88-4CCE',
    settingsOrigin: 'imported',
    settingsLocked: true,
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,0', 'H1,2'] },
    opponentEnds: { entrance: { r: 1, c: 1 }, exit: { r: 4, c: 4 } },
    commit: {
      commit: 'a'.repeat(64),
      commitCode: `YMC1-${'a'.repeat(64)}-1F2E`,
      saltHex: '0'.repeat(32),
    },
    revealSaved: true,
    opponentCommit: { code: `YMC1-${'b'.repeat(64)}-ABCD`, commit: 'b'.repeat(64) },
  };
}

test('a full state survives being saved and restored', () => {
  const state = filledState();
  const restored = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
  assert.deepEqual(restored, state);
});

test('a fresh state survives the round trip too', () => {
  const state = createDefaultState();
  assert.deepEqual(deserializeState(serializeState(state)), state);
});

test('settings drawn by the core survive unchanged', () => {
  const settings = createGameSettings({ allow_pass: 1 });
  const state = { ...createDefaultState(), settings };
  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored.settings, settings);
  assert.equal(restored.settings.game_nonce, settings.game_nonce);
});

test('junk from a shared file:// storage is dropped field by field', () => {
  const restored = deserializeState({
    screen: 'verify',
    myPlayer: 7,
    settings: { wall_limit: 999 },
    settingsCode: 'not a code',
    settingsOrigin: 'stolen',
    settingsLocked: true,
    myMaze: { entrance: { r: 9, c: 9 }, exit: 'F6', walls: ['V0,0', 'Q9,9', 42, 'V0,0'] },
    opponentEnds: { entrance: null, exit: { r: -1, c: 0 } },
    commit: { commit: 'short', commitCode: 'nope', saltHex: '00' },
    revealSaved: true,
    opponentCommit: 'yes',
  });

  assert.equal(restored.screen, 'setup');
  assert.equal(restored.myPlayer, 1);
  assert.equal(restored.settings, null, 'settings outside their range are refused by the core');
  assert.equal(restored.settingsCode, null);
  assert.equal(restored.settingsOrigin, null);
  assert.equal(restored.settingsLocked, false);
  assert.equal(restored.myMaze.entrance, null);
  assert.equal(restored.myMaze.exit, null);
  assert.deepEqual(restored.myMaze.walls, ['V0,0'], 'only real edge ids are kept, once each');
  assert.deepEqual(restored.opponentEnds, { entrance: null, exit: null });
  assert.equal(restored.commit, null);
  assert.equal(restored.revealSaved, false, 'without a commit there is no reveal file to trust');
  assert.equal(restored.opponentCommit, null);
});

test('nothing at all restores to a fresh state', () => {
  assert.deepEqual(deserializeState(null), createDefaultState());
  assert.deepEqual(deserializeState(undefined), createDefaultState());
  assert.deepEqual(deserializeState('garbage'), createDefaultState());
  assert.deepEqual(deserializeState(42), createDefaultState());
});

test('a saved screen that needs settings falls back to the setup screen', () => {
  const restored = deserializeState({ ...serializeState(createDefaultState()), screen: 'build' });
  assert.equal(restored.screen, 'setup');
});

test('a reveal flag without its commit is not trusted', () => {
  const state = filledState();
  const snapshot = serializeState(state);
  snapshot.commit = null;
  assert.equal(deserializeState(snapshot).revealSaved, false);
});

test('refreshing the fields erases the game and keeps the preferences', () => {
  const state = {
    ...filledState(),
    rainOn: false,
    gameStarted: true,
    gameActions: [{ type: 'START_TURN' }, { type: 'PASS' }],
  };
  const fresh = resetState(state);

  // Erased (SPEC 5.8).
  assert.deepEqual(fresh.myMaze, { entrance: null, exit: null, walls: [] });
  assert.deepEqual(fresh.opponentEnds, { entrance: null, exit: null });
  assert.deepEqual(fresh.gameActions, []);
  assert.equal(fresh.gameStarted, false);
  assert.equal(fresh.commit, null, 'the commit and the salt go together');
  assert.equal(fresh.revealSaved, false);
  assert.equal(fresh.opponentCommit, null);
  assert.equal(fresh.settings, null, 'a new game needs a new game number');
  assert.equal(fresh.settingsCode, null);
  assert.equal(fresh.settingsOrigin, null);
  assert.equal(fresh.settingsLocked, false);

  // Kept.
  assert.equal(fresh.myPlayer, state.myPlayer);
  assert.equal(fresh.rainOn, false);

  // And nothing of the old game survives a save and load either.
  const restored = deserializeState(serializeState(fresh));
  assert.deepEqual(restored.gameActions, []);
  assert.equal(restored.screen, 'setup');
});

test('the store notifies subscribers and hands out the new state', () => {
  const store = createStore(createDefaultState());
  const seen = [];
  const unsubscribe = store.subscribe((state) => seen.push(state.screen));

  store.setState({ screen: 'build' });
  assert.equal(store.getState().screen, 'build');
  store.setState((state) => ({ ...state, myPlayer: 2 }));
  assert.equal(store.getState().myPlayer, 2);

  unsubscribe();
  store.setState({ screen: 'setup' });
  assert.deepEqual(seen, ['build', 'build'], 'no notification after unsubscribing');

  assert.throws(() => store.subscribe('nope'), /must be a function/);
  assert.throws(() => store.setState(() => null), /must produce an object/);
});
