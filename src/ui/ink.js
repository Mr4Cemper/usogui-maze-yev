/**
 * ink.js - the drawings that live over the boards (SPEC 5.7).
 *
 * A stroke is a list of points in the coordinate space of the board, not of
 * the screen: the board is an SVG with a `viewBox` that scales to whatever
 * width the window happens to have, so a drawing kept in pixels would slide
 * off the moment the window is resized - and would not line up in the export
 * either. In board units it scales with the board for free.
 *
 * Nothing here touches the DOM. The board draws what these functions produce,
 * the store keeps it, and both can be tested in Node.
 */

import { normalizeColour } from './colours.js';

/** Sides a stroke can belong to; the two boards never share a layer. */
export const INK_SIDES = Object.freeze(['me', 'opponent']);

/**
 * How close two recorded points may be, in board units. One cell is 100, so
 * six units is about a sixteenth of a cell: fine enough for a signature, far
 * coarser than the hundreds of events a fast drag produces.
 */
export const MIN_POINT_DISTANCE = 6;

/** A single stroke stops growing here. */
export const MAX_STROKE_POINTS = 400;

/**
 * Everything drawn on both boards stops growing here.
 *
 * Six thousand points is about 60 kB of JSON once the coordinates are rounded
 * to whole units - roughly a hundredth of what a browser gives a page. The cap
 * exists so that a child scribbling for ten minutes cannot quietly fill the
 * storage the game itself needs.
 */
export const MAX_INK_POINTS = 6000;

/** What a brush starts as: mid weight, and the colour of a found wall. */
export const DEFAULT_BRUSH = Object.freeze({ colour: '#ff9d6b', width: 6 });

/** Brush widths the panel offers, in board units. */
export const BRUSH_WIDTHS = Object.freeze([2, 4, 6, 10, 16]);

/**
 * Rounds a coordinate to a whole board unit.
 *
 * Sub-unit precision is invisible - one unit is a hundredth of a cell - and
 * doubles the length of every number in storage.
 *
 * @param {number} value Coordinate.
 * @returns {number} The rounded coordinate.
 */
function round(value) {
  return Math.round(value);
}

/**
 * Decides whether a point is worth keeping.
 *
 * @param {number[]} points Flat list, x and y alternating.
 * @param {number} x Candidate x.
 * @param {number} y Candidate y.
 * @param {number} [minDistance=MIN_POINT_DISTANCE] How far apart points must be.
 * @returns {boolean} True when the point should be recorded.
 */
export function keepsPoint(points, x, y, minDistance = MIN_POINT_DISTANCE) {
  if (!Array.isArray(points) || points.length < 2) {
    return true;
  }
  if (points.length >= MAX_STROKE_POINTS * 2) {
    return false;
  }
  const lastX = points[points.length - 2];
  const lastY = points[points.length - 1];
  return Math.hypot(round(x) - lastX, round(y) - lastY) >= minDistance;
}

/**
 * Adds a point to a stroke, thinning as it goes.
 *
 * @param {number[]} points Flat list of coordinates.
 * @param {number} x New x, in board units.
 * @param {number} y New y, in board units.
 * @returns {number[]} The list, extended or unchanged.
 */
export function addPoint(points, x, y) {
  const list = Array.isArray(points) ? points : [];
  if (!keepsPoint(list, x, y)) {
    return list;
  }
  return [...list, round(x), round(y)];
}

/**
 * How many points a set of strokes holds.
 *
 * @param {Array<object>} strokes The drawings.
 * @returns {number} Total points.
 */
export function inkPoints(strokes) {
  return (Array.isArray(strokes) ? strokes : []).reduce(
    (total, stroke) => total + (Array.isArray(stroke.points) ? stroke.points.length / 2 : 0),
    0,
  );
}

/**
 * Whether there is room for another point.
 *
 * @param {Array<object>} strokes Everything drawn so far.
 * @returns {boolean} True while under the cap.
 */
export function hasRoom(strokes) {
  return inkPoints(strokes) < MAX_INK_POINTS;
}

/**
 * The `d` of a stroke: a polyline through its points.
 *
 * Straight segments, not curves. The points are already thinned to a distance
 * where a curve would change nothing anybody can see, and a polyline is one
 * number per coordinate in the file.
 *
 * @param {number[]} points Flat list of coordinates.
 * @returns {string} The path data, or an empty string when there is nothing.
 */
export function strokePath(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return '';
  }
  if (points.length === 2) {
    // A tap is a dot: a zero length line with a round cap draws one.
    return `M ${points[0]} ${points[1]} L ${points[0]} ${points[1]}`;
  }
  const parts = [`M ${points[0]} ${points[1]}`];
  for (let i = 2; i < points.length; i += 2) {
    parts.push(`L ${points[i]} ${points[i + 1]}`);
  }
  return parts.join(' ');
}

/**
 * Validates one stroke that came from storage.
 *
 * @param {unknown} stroke Candidate.
 * @returns {object|null} A clean stroke, or null when it is not one.
 */
function readStroke(stroke) {
  if (stroke === null || typeof stroke !== 'object') {
    return null;
  }
  if (!INK_SIDES.includes(stroke.side)) {
    return null;
  }
  const colour = normalizeColour(stroke.colour);
  if (colour === null) {
    return null;
  }
  const width = Number(stroke.width);
  if (!Number.isFinite(width) || width <= 0 || width > 64) {
    return null;
  }
  if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length % 2 !== 0) {
    return null;
  }
  const points = [];
  for (const value of stroke.points) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    points.push(round(number));
  }
  return { side: stroke.side, colour, width, points: points.slice(0, MAX_STROKE_POINTS * 2) };
}

/**
 * Reads the drawings out of storage, dropping whatever is not a drawing.
 *
 * Storage is untrusted (SPEC 5.2), and a stroke carries a colour that goes
 * into the DOM, so every field is checked rather than assumed.
 *
 * @param {unknown} raw Whatever was stored.
 * @returns {Array<object>} The strokes that survived, within the cap.
 */
export function readInk(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const kept = [];
  let points = 0;
  for (const candidate of raw) {
    const stroke = readStroke(candidate);
    if (stroke === null) {
      continue;
    }
    if (points + stroke.points.length / 2 > MAX_INK_POINTS) {
      break;
    }
    points += stroke.points.length / 2;
    kept.push(stroke);
  }
  return kept;
}

/**
 * The strokes of one board.
 *
 * @param {Array<object>} strokes Everything drawn.
 * @param {string} side Which board.
 * @returns {Array<object>} Its strokes, in the order they were drawn.
 */
export function strokesOf(strokes, side) {
  return (Array.isArray(strokes) ? strokes : []).filter((stroke) => stroke.side === side);
}

/**
 * Everything except the last stroke.
 *
 * The list is ordered, so taking one back is taking off the end - no matter
 * which of the two boards it was drawn on.
 *
 * @param {Array<object>} strokes The drawings.
 * @returns {Array<object>} One shorter, or the same when there was nothing.
 */
export function withoutLastStroke(strokes) {
  const list = Array.isArray(strokes) ? strokes : [];
  return list.length === 0 ? list : list.slice(0, -1);
}

/**
 * Adds a finished stroke, within the cap.
 *
 * A stroke that would cross the cap is kept as far as there is room rather
 * than dropped: the line the player saw appearing stops where the room ran
 * out, which is at least visible. Nothing is ever silently discarded whole.
 *
 * @param {object} state Application state.
 * @param {object} stroke The finished stroke.
 * @returns {Array<object>} The new list of strokes.
 */
export function appendStroke(state, stroke) {
  const strokes = Array.isArray(state.ink) ? state.ink : [];
  if (!Array.isArray(stroke?.points) || stroke.points.length < 2) {
    return strokes;
  }
  const room = MAX_INK_POINTS - inkPoints(strokes);
  if (room <= 0) {
    return strokes;
  }
  const points = stroke.points.slice(0, Math.min(stroke.points.length, room * 2));
  return [...strokes, { ...stroke, points }];
}

/**
 * What a board should draw with right now, or null when drawing is off.
 *
 * @param {object} state Application state.
 * @param {string} side Which board is asking.
 * @param {(stroke: object) => void} onStroke Called with a finished stroke.
 * @returns {object|null} The brush for the board.
 */
export function brushFor(state, side, onStroke) {
  if (state.drawingOn !== true) {
    return null;
  }
  return {
    side,
    colour: state.brush.colour,
    width: state.brush.width,
    canDraw: () => hasRoom(state.ink),
    onStroke,
  };
}

/**
 * A brush that is safe to draw with.
 *
 * @param {unknown} raw Candidate.
 * @returns {{colour: string, width: number}} The brush, falling back field by
 *   field to the default.
 */
export function readBrush(raw) {
  const source = raw === null || typeof raw !== 'object' ? {} : raw;
  const colour = normalizeColour(source.colour);
  const width = Number(source.width);
  return {
    colour: colour ?? DEFAULT_BRUSH.colour,
    width: BRUSH_WIDTHS.includes(width) ? width : DEFAULT_BRUSH.width,
  };
}
