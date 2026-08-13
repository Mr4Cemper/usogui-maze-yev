/**
 * The drawings over the boards (SPEC 5.7).
 *
 * Two things decide whether this feature is safe to leave in a browser tab for
 * a week: the thinning, which keeps a two second scribble from becoming two
 * thousand points, and the cap, which keeps a bored player from filling the
 * storage the game itself needs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRUSH_WIDTHS,
  DEFAULT_BRUSH,
  MAX_INK_POINTS,
  MAX_STROKE_POINTS,
  MIN_POINT_DISTANCE,
  addPoint,
  appendStroke,
  brushFor,
  hasRoom,
  inkPoints,
  keepsPoint,
  readBrush,
  readInk,
  strokePath,
  strokesOf,
  withoutLastStroke,
} from '../src/ui/ink.js';
import { createDefaultState, deserializeState, resetState, serializeState } from '../src/ui/store.js';

/**
 * A stroke of `count` points along a line.
 *
 * @param {string} side Which board.
 * @param {number} count How many points.
 * @returns {object} The stroke.
 */
function stroke(side, count) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    points.push(i * 10, 0);
  }
  return { side, colour: '#ff9d6b', width: 6, points };
}

test('points closer together than the threshold are dropped', () => {
  let points = [];
  points = addPoint(points, 100, 100);
  assert.deepEqual(points, [100, 100], 'the first point is always kept');

  // A pointer moving one unit at a time: a hundred events, one point.
  for (let i = 1; i <= 100; i += 1) {
    points = addPoint(points, 100 + i * 0.1, 100);
  }
  assert.equal(points.length / 2 < 10, true, `kept ${points.length / 2} points of 101`);

  // A real move records.
  points = addPoint(points, 200, 100);
  assert.equal(points.slice(-2).join(), '200,100');
  assert.equal(keepsPoint([0, 0], MIN_POINT_DISTANCE, 0), true);
  assert.equal(keepsPoint([0, 0], MIN_POINT_DISTANCE - 1, 0), false);
});

test('coordinates are whole units: the invisible half costs storage', () => {
  assert.deepEqual(addPoint([], 10.4, 20.6), [10, 21]);
});

test('one stroke stops growing at its own ceiling', () => {
  let points = [];
  for (let i = 0; i < MAX_STROKE_POINTS + 50; i += 1) {
    points = addPoint(points, i * 10, 0);
  }
  assert.equal(points.length / 2, MAX_STROKE_POINTS);
});

test('the drawings as a whole stop at the cap', () => {
  const strokes = [];
  for (let i = 0; i < 20; i += 1) {
    strokes.push(stroke('me', 300));
  }
  assert.equal(inkPoints(strokes), 6000);
  assert.equal(hasRoom(strokes), false);
  assert.equal(hasRoom(strokes.slice(0, 19)), true);

  // A stroke that would cross the cap is kept as far as there was room.
  const full = appendStroke({ ink: strokes.slice(0, 19) }, stroke('me', 400));
  assert.equal(inkPoints(full), MAX_INK_POINTS);
  // And once there is no room at all, nothing is added.
  assert.equal(appendStroke({ ink: strokes }, stroke('me', 10)).length, strokes.length);
});

test('a stroke becomes a polyline, and a tap becomes a dot', () => {
  assert.equal(strokePath([10, 20, 30, 40]), 'M 10 20 L 30 40');
  assert.equal(strokePath([10, 20]), 'M 10 20 L 10 20');
  assert.equal(strokePath([]), '');
  assert.equal(strokePath(null), '');
});

test('the two boards keep their own drawings', () => {
  const strokes = [stroke('me', 3), stroke('opponent', 3), stroke('me', 3)];
  assert.equal(strokesOf(strokes, 'me').length, 2);
  assert.equal(strokesOf(strokes, 'opponent').length, 1);
  // Taking one back takes the last one drawn, whichever board it was on.
  assert.equal(withoutLastStroke(strokes).length, 2);
  assert.equal(strokesOf(withoutLastStroke(strokes), 'me').length, 1);
  assert.equal(withoutLastStroke([]).length, 0);
});

test('nothing that is not a drawing survives storage', () => {
  const good = stroke('me', 3);
  assert.deepEqual(readInk([good]), [good]);
  assert.deepEqual(readInk('scribble'), []);
  assert.deepEqual(readInk([{ ...good, side: 'nobody' }]), []);
  assert.deepEqual(readInk([{ ...good, colour: 'red' }]), [], 'a colour goes into the DOM');
  assert.deepEqual(readInk([{ ...good, colour: '#fff; x: y' }]), []);
  assert.deepEqual(readInk([{ ...good, width: 0 }]), []);
  assert.deepEqual(readInk([{ ...good, width: 500 }]), []);
  assert.deepEqual(readInk([{ ...good, points: [1, 2, 3] }]), [], 'points come in pairs');
  assert.deepEqual(readInk([{ ...good, points: [1, 'x'] }]), []);
  // The cap holds on the way in as well.
  const many = Array.from({ length: 30 }, () => stroke('me', 300));
  assert.equal(inkPoints(readInk(many)) <= MAX_INK_POINTS, true);
});

test('a brush is a colour and one of the offered widths', () => {
  assert.deepEqual(readBrush(null), DEFAULT_BRUSH);
  assert.deepEqual(readBrush({ colour: '#00ff00', width: BRUSH_WIDTHS[0] }), {
    colour: '#00ff00',
    width: BRUSH_WIDTHS[0],
  });
  assert.equal(readBrush({ colour: 'green' }).colour, DEFAULT_BRUSH.colour);
  assert.equal(readBrush({ width: 999 }).width, DEFAULT_BRUSH.width);
});

test('a board is handed a brush only while drawing is on', () => {
  const state = { ...createDefaultState(), drawingOn: false };
  assert.equal(brushFor(state, 'me', () => {}), null);
  const on = brushFor({ ...state, drawingOn: true }, 'me', () => {});
  assert.equal(on.side, 'me');
  assert.equal(on.colour, DEFAULT_BRUSH.colour);
  assert.equal(on.canDraw(), true);
  assert.equal(brushFor({ ...state, drawingOn: true, ink: Array.from({ length: 20 }, () => stroke('me', 300)) }, 'me', () => {}).canDraw(), false);
});

test('drawings outlive a reload and are erased by Refresh fields', () => {
  const drawn = [stroke('me', 4), stroke('opponent', 2)];
  const state = { ...createDefaultState(), ink: drawn, brush: { colour: '#00ff00', width: 10 } };

  const restored = deserializeState(serializeState(state));
  assert.deepEqual(restored.ink, drawn, 'a drawing survives a reload (SPEC 5.7)');
  assert.deepEqual(restored.brush, { colour: '#00ff00', width: 10 });

  const cleared = resetState(state);
  assert.deepEqual(cleared.ink, [], 'and is erased with the game it was drawn over (SPEC 5.8)');
  assert.deepEqual(cleared.brush, { colour: '#00ff00', width: 10 }, 'the brush is a preference');

  // Drawing mode itself never comes back from storage.
  assert.equal(deserializeState({ ...serializeState(state), drawingOn: true }).drawingOn, false);
});
