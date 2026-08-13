/**
 * edges.js - coordinates, edge identifiers, the canonical edge order and
 * cell <-> index conversions (SPEC 1.2, 1.3, 4.2).
 *
 * The board is fixed at 6x6 in v1 (SPEC 7 puts other sizes out of scope).
 * Rows are letters A..F top to bottom (r = 0..5), columns are digits 1..6
 * left to right (c = 0..5). The payload cell index is `i = r * 6 + c`.
 *
 * ONLY 6x6 IS SUPPORTED HERE.
 *
 * The settings block of SPEC 4.3 can carry `grid_w` and `grid_h` up to 15,
 * because the format was made wide enough for later versions. This module is
 * not. Two things break the moment the board grows past ten cells a side:
 *
 *   - `EDGE_PATTERN` accepts a single digit per index, so an edge such as
 *     "V10,3" would stop parsing;
 *   - row letters run A..F only, so `cellToLabel` would run off the alphabet.
 *
 * A silent format break is the worst kind of break in this project, so
 * `tests/edges.test.mjs` holds a guard that fails as soon as GRID_SIZE moves.
 * Everything else here is written in terms of GRID_SIZE and needs no edit.
 *
 * Nothing in this module knows about the DOM or about human languages.
 */

/** Board side length. Changing it is not enough - read the note above. */
export const GRID_SIZE = 6;

/** Number of cells on the board. */
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

/** Number of vertical edges, which the wall mask lists first (SPEC 4.2). */
export const VERTICAL_EDGE_COUNT = GRID_SIZE * (GRID_SIZE - 1);

/** Number of internal edges on the board: 30 vertical + 30 horizontal. */
export const EDGE_COUNT = VERTICAL_EDGE_COUNT * 2;

const ROW_LETTERS = 'ABCDEF';
const LABEL_PATTERN = /^([A-F])([1-6])$/;
// One digit per index: good for a board up to ten cells a side, no further.
const EDGE_PATTERN = /^([VH])([0-9]),([0-9])$/;

/**
 * Throws unless the value is a plain integer number.
 *
 * @param {unknown} value Value to check.
 * @param {string} name Name used in the error message.
 * @returns {number} The value itself.
 * @throws {Error} If the value is not an integer number.
 */
function assertInt(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, got ${String(value)}`);
  }
  return value;
}

/**
 * Validates a pair of cell coordinates.
 *
 * @param {number} r Row index, 0..5.
 * @param {number} c Column index, 0..5.
 * @returns {void}
 * @throws {Error} If r or c is not an integer or points outside the board.
 */
export function assertCell(r, c) {
  assertInt(r, 'r');
  assertInt(c, 'c');
  if (r < 0 || r >= GRID_SIZE) {
    throw new Error(`row r must be in 0..${GRID_SIZE - 1}, got ${r}`);
  }
  if (c < 0 || c >= GRID_SIZE) {
    throw new Error(`column c must be in 0..${GRID_SIZE - 1}, got ${c}`);
  }
}

/**
 * Tells whether the coordinates point at a cell of the board.
 * Never throws - use it to test candidate coordinates.
 *
 * @param {unknown} r Row index candidate.
 * @param {unknown} c Column index candidate.
 * @returns {boolean} True when both are integers inside the board.
 */
export function isOnBoard(r, c) {
  return (
    Number.isInteger(r) && Number.isInteger(c) &&
    r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE
  );
}

/**
 * Converts cell coordinates to the payload cell index.
 *
 * @param {number} r Row index, 0..5.
 * @param {number} c Column index, 0..5.
 * @returns {number} Index `r * 6 + c`, 0..35.
 * @throws {Error} If the coordinates are invalid or off the board.
 */
export function cellToIndex(r, c) {
  assertCell(r, c);
  return r * GRID_SIZE + c;
}

/**
 * Converts a payload cell index back to coordinates.
 *
 * @param {number} i Cell index, 0..35.
 * @returns {{r: number, c: number}} Cell coordinates.
 * @throws {Error} If the index is not an integer in 0..35.
 */
export function indexToCell(i) {
  assertInt(i, 'i');
  if (i < 0 || i >= CELL_COUNT) {
    throw new Error(`cell index must be in 0..${CELL_COUNT - 1}, got ${i}`);
  }
  return { r: Math.floor(i / GRID_SIZE), c: i % GRID_SIZE };
}

/**
 * Converts cell coordinates to a human label such as "C3".
 *
 * @param {number} r Row index, 0..5.
 * @param {number} c Column index, 0..5.
 * @returns {string} Label: row letter A..F followed by column digit 1..6.
 * @throws {Error} If the coordinates are invalid or off the board.
 */
export function cellToLabel(r, c) {
  assertCell(r, c);
  return `${ROW_LETTERS[r]}${c + 1}`;
}

/**
 * Parses a human label such as "C3" into coordinates.
 * Case is ignored and surrounding whitespace is trimmed.
 *
 * @param {string} label Cell label.
 * @returns {{r: number, c: number}} Cell coordinates.
 * @throws {Error} If the argument is not a string or does not look like a label.
 */
export function labelToCell(label) {
  if (typeof label !== 'string') {
    throw new Error(`cell label must be a string, got ${String(label)}`);
  }
  const match = LABEL_PATTERN.exec(label.trim().toUpperCase());
  if (match === null) {
    throw new Error(`cell label must look like "C3", got ${JSON.stringify(label)}`);
  }
  return { r: ROW_LETTERS.indexOf(match[1]), c: Number(match[2]) - 1 };
}

/**
 * Returns the identifier of the internal edge shared by two cells.
 *
 * @param {number} r Row of the first cell, 0..5.
 * @param {number} c Column of the first cell, 0..5.
 * @param {number} nr Row of the second cell, 0..5.
 * @param {number} nc Column of the second cell, 0..5.
 * @returns {string|null} Edge id such as "V2,3" or "H1,0", or null when the
 *   cells are not orthogonally adjacent (same cell and diagonals included).
 * @throws {Error} If either coordinate pair is invalid or off the board.
 */
export function edgeBetween(r, c, nr, nc) {
  assertCell(r, c);
  assertCell(nr, nc);
  if (r === nr && Math.abs(c - nc) === 1) {
    return `V${r},${Math.min(c, nc)}`;
  }
  if (c === nc && Math.abs(r - nr) === 1) {
    return `H${Math.min(r, nr)},${c}`;
  }
  return null;
}

/**
 * Splits an edge id into its parts.
 *
 * @param {string} id Edge id such as "V2,3" or "H1,0".
 * @returns {{type: 'V'|'H', r: number, c: number}} Parsed edge.
 * @throws {Error} If the id is not a string, is malformed, or its indices are
 *   outside the ranges of SPEC 1.3.
 */
export function parseEdgeId(id) {
  if (typeof id !== 'string') {
    throw new Error(`edge id must be a string, got ${String(id)}`);
  }
  const match = EDGE_PATTERN.exec(id);
  if (match === null) {
    throw new Error(`edge id must look like "V2,3" or "H1,0", got ${JSON.stringify(id)}`);
  }
  const type = /** @type {'V'|'H'} */ (match[1]);
  const r = Number(match[2]);
  const c = Number(match[3]);
  if (type === 'V' && (r > GRID_SIZE - 1 || c > GRID_SIZE - 2)) {
    throw new Error(`vertical edge id out of range: ${id}`);
  }
  if (type === 'H' && (r > GRID_SIZE - 2 || c > GRID_SIZE - 1)) {
    throw new Error(`horizontal edge id out of range: ${id}`);
  }
  return { type, r, c };
}

/**
 * Returns the two cells separated by an edge.
 *
 * @param {string} id Edge id such as "V2,3" or "H1,0".
 * @returns {[{r: number, c: number}, {r: number, c: number}]} The two cells.
 * @throws {Error} If the id is malformed or out of range.
 */
export function edgeCells(id) {
  const { type, r, c } = parseEdgeId(id);
  return type === 'V'
    ? [{ r, c }, { r, c: c + 1 }]
    : [{ r, c }, { r: r + 1, c }];
}

/**
 * Builds the canonical edge order of SPEC 4.2.
 * Indices 0..29 are vertical edges (r 0..5, then c 0..4),
 * indices 30..59 are horizontal edges (r 0..4, then c 0..5).
 *
 * @returns {string[]} 60 edge ids in canonical order.
 */
function buildEdgeOrder() {
  const order = [];
  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE - 1; c += 1) {
      order.push(`V${r},${c}`);
    }
  }
  for (let r = 0; r < GRID_SIZE - 1; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      order.push(`H${r},${c}`);
    }
  }
  return order;
}

/**
 * The canonical order of all 60 internal edges (SPEC 4.2).
 *
 * This array is the foundation of the wall bitmask and therefore of every
 * commit hash ever produced. The order must never change: a different order
 * turns honest players into apparent cheaters.
 *
 * @type {readonly string[]}
 */
export const EDGE_ORDER = Object.freeze(buildEdgeOrder());

/**
 * Returns the bit index of an edge inside the 60 bit wall mask (SPEC 4.2).
 *
 * @param {string} id Edge id such as "V2,3" or "H1,0".
 * @returns {number} Bit index, 0..59.
 * @throws {Error} If the id is malformed or out of range.
 */
export function edgeToBitIndex(id) {
  const { type, r, c } = parseEdgeId(id);
  return type === 'V'
    ? r * (GRID_SIZE - 1) + c
    : VERTICAL_EDGE_COUNT + r * GRID_SIZE + c;
}

/**
 * Returns the edge that owns a bit of the wall mask (SPEC 4.2).
 *
 * @param {number} i Bit index, 0..59.
 * @returns {string} Edge id such as "V2,3" or "H1,0".
 * @throws {Error} If the index is not an integer in 0..59.
 */
export function bitIndexToEdge(i) {
  assertInt(i, 'bit index');
  if (i < 0 || i >= EDGE_COUNT) {
    throw new Error(`bit index must be in 0..${EDGE_COUNT - 1}, got ${i}`);
  }
  return EDGE_ORDER[i];
}
