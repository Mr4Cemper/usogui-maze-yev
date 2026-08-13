/**
 * The colour panels. Everything here ends up in `style.setProperty()`, so the
 * first test is about what is allowed to get that far: the check is ours, not
 * the browser's. A value the browser merely ignores is a value already sitting
 * in the state, ready to be written again on the next load.
 *
 * The rest is about the two things a player can do to themselves with these
 * panels and should be told about: a colour nobody can see on the board, and
 * two kinds of wall that stopped looking different.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALIKE_DISTANCE,
  BOARD_TOKENS,
  boardWarnings,
  colourDistance,
  isColourValue,
  normalizeColour,
  readColourMap,
} from '../src/ui/colours.js';
import { toInputColour } from '../src/ui/components/colourPanel.js';
import { createDefaultState, deserializeState, resetState, serializeState } from '../src/ui/store.js';
import { applyTheme } from '../src/ui/theme.js';

test('a colour is three shapes and nothing else', () => {
  for (const good of ['#abc', '#ABC', '#a1b2c3', '#a1b2c3ff', ' #fff ']) {
    assert.equal(isColourValue(good), true, good);
  }
  for (const bad of [
    '',
    'red',
    '#12',
    '#12345',
    '#1234567',
    '#gggggg',
    'rgb(0,0,0)',
    'var(--bg)',
    '#fff; background: url(x)',
    'url("x")',
    '#fff)',
    'expression(alert(1))',
    null,
    undefined,
    42,
    {},
    ['#fff'],
  ]) {
    assert.equal(isColourValue(bad), false, JSON.stringify(bad));
    assert.equal(normalizeColour(bad), null, JSON.stringify(bad));
  }
  assert.equal(normalizeColour(' #AABBCC '), '#aabbcc');
});

test('storage cannot smuggle in a token or a value of its own', () => {
  const kept = readColourMap(
    {
      '--board-wall': '#ff0000',
      '--board-exit': 'red',
      '--board-bg': '#000',
      '--anything-else': '#ffffff',
      '--board-wall-found; x': '#ffffff',
    },
    BOARD_TOKENS,
  );
  assert.deepEqual(kept, { '--board-wall': '#ff0000', '--board-bg': '#000' });
  assert.deepEqual(readColourMap(null, BOARD_TOKENS), {});
  assert.deepEqual(readColourMap('#fff', BOARD_TOKENS), {});
  assert.deepEqual(readColourMap(['#fff'], BOARD_TOKENS), {});
});

test('what the colour input can show', () => {
  assert.equal(toInputColour('#00e5ff'), '#00e5ff');
  assert.equal(toInputColour('rgba(0, 10, 18, 0.55)'), '#000a12');
  assert.equal(toInputColour('#abc'), '#aabbcc');
  // Something unreadable must still produce a value the input accepts.
  assert.equal(toInputColour('var(--bg)'), '#000000');
});

test('a colour nobody can see on the board is worth saying out loud', () => {
  const base = {
    '--board-bg': '#000a12',
    '--board-entrance': '#00e5ff',
    '--board-exit': '#cfe9f2',
    '--board-token-me': '#00e5ff',
    '--board-token-opponent': '#ffc857',
    '--board-wall': '#00e5ff',
    '--board-wall-found': '#ff9d6b',
    '--board-passage': '#7fb4c4',
    '--board-grid': '#003b46',
    '--board-label': '#007a99',
  };
  assert.deepEqual(boardWarnings(base), [], 'the shipped palette warns about nothing');

  const dim = boardWarnings({ ...base, '--board-wall': '#001820' });
  assert.equal(dim.length, 1);
  assert.equal(dim[0].code, 'LOW_CONTRAST');
  assert.equal(dim[0].token, '--board-wall');
  assert.equal(dim[0].value < 3, true);

  // The grid is meant to be nearly invisible; warning about it would be
  // warning about the design (SPEC 5.13).
  assert.deepEqual(boardWarnings({ ...base, '--board-grid': '#000b13' }), []);
});

test('two kinds of wall that stopped looking different', () => {
  const base = {
    '--board-bg': '#000a12',
    '--board-entrance': '#00e5ff',
    '--board-exit': '#cfe9f2',
    '--board-token-me': '#00e5ff',
    '--board-token-opponent': '#ffc857',
    '--board-wall': '#ff8a4c',
    '--board-wall-found': '#ff9d6b',
    '--board-passage': '#7fb4c4',
    '--board-grid': '#003b46',
    '--board-label': '#007a99',
  };
  const alike = boardWarnings(base);
  assert.equal(alike.some((warning) => warning.code === 'WALLS_ALIKE'), true);

  // Far apart in hue but close in luminance: contrast alone would call these
  // identical, which is why the check is distance.
  const apart = boardWarnings({ ...base, '--board-wall': '#00e5ff' });
  assert.equal(apart.some((warning) => warning.code === 'WALLS_ALIKE'), false);
  assert.equal(colourDistance('#00e5ff', '#ff9d6b') > ALIKE_DISTANCE, true);
  assert.equal(colourDistance('#ff8a4c', '#ff9d6b') < ALIKE_DISTANCE, true);
  assert.equal(colourDistance('var(--bg)', '#fff'), null);
});

test('the colours of the board outlive a theme, a reload and a reset', () => {
  const chosen = { '--board-wall': '#ff8a4c', '--board-exit': '#ffffff' };
  const state = { ...createDefaultState(), boardColours: chosen };

  // A theme is the look; these are the player's. Switching one must not touch
  // the other (SPEC 5.6).
  assert.deepEqual(applyTheme(state, 'light').boardColours, chosen);
  assert.deepEqual(deserializeState(serializeState(state)).boardColours, chosen);
  assert.deepEqual(resetState(state).boardColours, chosen);

  // And the copy is a copy: editing the state must not reach back into it.
  const restored = deserializeState(serializeState(state));
  restored.boardColours['--board-wall'] = '#000000';
  assert.equal(chosen['--board-wall'], '#ff8a4c');
});

test('a stored override that is not a colour never reaches the state', () => {
  const snapshot = {
    ...serializeState(createDefaultState()),
    boardColours: { '--board-wall': 'red', '--board-exit': '#00ff00' },
  };
  assert.deepEqual(deserializeState(snapshot).boardColours, { '--board-exit': '#00ff00' });
});

test('the two panels never claim the same token', async () => {
  // The board panel owns --board-*, and nothing else may (SPEC 5.5, 5.6).
  for (const token of BOARD_TOKENS) {
    assert.equal(token.startsWith('--board-'), true, token);
  }
  const { THEME_TOKENS } = await import('../src/ui/theme.js');
  const board = new Set(BOARD_TOKENS);
  const missing = BOARD_TOKENS.filter((token) => !THEME_TOKENS.includes(token));
  assert.deepEqual(missing, [], 'every board colour is still a token a theme declares');
  assert.equal(board.size, BOARD_TOKENS.length, 'no token is listed twice');
});
