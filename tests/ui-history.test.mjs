/**
 * History lines are built by the interface from the structure the core keeps,
 * one line per entry type (SPEC 3.1, 3.2).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatHistoryEntry, mergeHistory } from '../src/ui/components/historyPanel.js';
import { hintText } from '../src/ui/screens/play.js';
import { HINTS } from '../src/core/game.js';
import { t } from '../src/i18n/index.js';

/**
 * Builds a step the way the core stores one.
 *
 * @param {object} from Starting cell.
 * @param {object} to Target cell.
 * @param {'pass'|'wall'} result What happened.
 * @returns {object} A step.
 */
function step(from, to, result) {
  return { from, to, edge: 'V0,0', result, isNewCell: result === 'pass' };
}

test('a move renders its steps, with the wall named', () => {
  const entry = {
    move: 12,
    side: 'me',
    type: 'MOVE',
    wall: 'V2,2',
    steps: [
      step({ r: 2, c: 2 }, { r: 2, c: 3 }, 'pass'),
      step({ r: 2, c: 3 }, { r: 2, c: 4 }, 'pass'),
      step({ r: 2, c: 4 }, { r: 2, c: 5 }, 'wall'),
    ],
  };
  assert.equal(formatHistoryEntry(entry), '12. C3-C4; C4-C5; wall C5-C6');
});

test('a pass, an undo and a resignation each get their own line', () => {
  const base = { move: 7, side: 'me', steps: [], wall: null };
  assert.equal(formatHistoryEntry({ ...base, type: 'PASS' }), `7. ${t('history.pass')}`);
  assert.equal(formatHistoryEntry({ ...base, type: 'UNDO' }), `7. ${t('history.undo')}`);
  assert.equal(formatHistoryEntry({ ...base, type: 'RESIGN' }), `7. ${t('history.resign')}`);

  const lines = ['PASS', 'UNDO', 'RESIGN'].map((type) =>
    formatHistoryEntry({ ...base, type }),
  );
  assert.equal(new Set(lines).size, 3, 'three kinds of entry, three different lines');
});

test('a turn closed without a single step still gets a line', () => {
  const entry = { move: 3, side: 'opponent', type: 'MOVE', steps: [], wall: null };
  assert.equal(formatHistoryEntry(entry), `3. ${t('history.noSteps')}`);
});

test('a step taken back gets a correction line of its own', () => {
  const entry = {
    move: 5,
    side: 'me',
    type: 'UNDO_STEP',
    wall: null,
    steps: [step({ r: 2, c: 4 }, { r: 3, c: 4 }, 'pass')],
  };
  assert.equal(formatHistoryEntry(entry), '5. STEP TAKEN BACK: C5-D5');
});

test('corrections are woven into the history where they happened', () => {
  const entries = [
    { move: 1, side: 'me', type: 'MOVE', wall: null, steps: [step({ r: 0, c: 0 }, { r: 0, c: 1 }, 'pass')] },
    { move: 2, side: 'opponent', type: 'MOVE', wall: null, steps: [] },
  ];
  const corrections = [
    { move: 3, side: 'me', from: { r: 0, c: 1 }, to: { r: 1, c: 1 }, at: 2 },
    { move: 1, side: 'me', from: { r: 0, c: 0 }, to: { r: 1, c: 0 }, at: 0 },
  ];

  const merged = mergeHistory(entries, corrections);
  assert.deepEqual(merged.map((entry) => `${entry.type}:${entry.move}`), [
    'UNDO_STEP:1',
    'MOVE:1',
    'MOVE:2',
    'UNDO_STEP:3',
  ]);
  assert.deepEqual(mergeHistory(entries, []), entries, 'without corrections nothing moves');
});

test('formatHistoryEntry guards its argument', () => {
  assert.throws(() => formatHistoryEntry(null), /must be an object/);
  assert.throws(() => formatHistoryEntry({ move: 1 }), /move number and a steps array/);
  assert.throws(() => formatHistoryEntry({ steps: [] }), /move number and a steps array/);
});

test('every hint code of SPEC 6.1 has a line of its own', () => {
  const seen = new Set();
  for (const code of HINTS) {
    const text = hintText(code);
    assert.equal(text.startsWith('«'), false, `${code} has no dictionary entry`);
    assert.equal(text, t(`hint.${code}`), `${code} must use its own key`);
    seen.add(text);
  }
  assert.equal(seen.size, HINTS.length, 'no two hints may read the same');
  assert.equal(hintText('SOMETHING_NEW'), t('hint.UNKNOWN'));
});
