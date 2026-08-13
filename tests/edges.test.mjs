import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_COUNT,
  EDGE_COUNT,
  EDGE_ORDER,
  GRID_SIZE,
  VERTICAL_EDGE_COUNT,
  bitIndexToEdge,
  cellToIndex,
  cellToLabel,
  edgeBetween,
  edgeCells,
  edgeToBitIndex,
  indexToCell,
  isOnBoard,
  labelToCell,
  parseEdgeId,
} from '../src/core/edges.js';

test('the 6x6 assumption of edges.js is still true', () => {
  // This test exists to make a change of board size loud instead of silent.
  // The settings block of SPEC 4.3 allows grid_w and grid_h up to 15, but this
  // module does not: edge ids are parsed with one digit per index and rows are
  // labelled A..F. A 12x12 board would quietly stop parsing "V10,3".
  assert.equal(
    GRID_SIZE,
    6,
    'edges.js assumes single digit indices and a 6x6 board: if the size changes, ' +
    'update EDGE_PATTERN, the A..F row letters and review edgeToBitIndex, then update this test',
  );
  assert.equal(CELL_COUNT, 36);
  assert.equal(VERTICAL_EDGE_COUNT, 30);
  assert.equal(EDGE_COUNT, 60);
  // Nothing is allowed to hard code 30 or 60 any more: both follow the size.
  assert.equal(VERTICAL_EDGE_COUNT, GRID_SIZE * (GRID_SIZE - 1));
  assert.equal(EDGE_COUNT, 2 * GRID_SIZE * (GRID_SIZE - 1));
  assert.equal(edgeToBitIndex('H0,0'), VERTICAL_EDGE_COUNT);
});

test('EDGE_ORDER holds exactly 60 unique edge ids', () => {
  assert.equal(EDGE_ORDER.length, EDGE_COUNT);
  assert.equal(new Set(EDGE_ORDER).size, EDGE_COUNT);
});

test('EDGE_ORDER follows the order written down in SPEC 4.2', () => {
  // Rebuilt here on purpose, independently of the implementation.
  const expected = [];
  for (let r = 0; r <= 5; r += 1) {
    for (let c = 0; c <= 4; c += 1) {
      expected.push(`V${r},${c}`);
    }
  }
  for (let r = 0; r <= 4; r += 1) {
    for (let c = 0; c <= 5; c += 1) {
      expected.push(`H${r},${c}`);
    }
  }
  assert.deepEqual([...EDGE_ORDER], expected);

  assert.equal(EDGE_ORDER[0], 'V0,0');
  assert.equal(EDGE_ORDER[29], 'V5,4');
  assert.equal(EDGE_ORDER[30], 'H0,0');
  assert.equal(EDGE_ORDER[59], 'H4,5');
});

test('EDGE_ORDER matches the index formulas of SPEC 4.2', () => {
  for (let r = 0; r <= 5; r += 1) {
    for (let c = 0; c <= 4; c += 1) {
      assert.equal(edgeToBitIndex(`V${r},${c}`), r * 5 + c);
    }
  }
  for (let r = 0; r <= 4; r += 1) {
    for (let c = 0; c <= 5; c += 1) {
      assert.equal(edgeToBitIndex(`H${r},${c}`), 30 + r * 6 + c);
    }
  }
});

test('edgeToBitIndex and bitIndexToEdge are inverse on all 60 edges', () => {
  for (let i = 0; i < EDGE_COUNT; i += 1) {
    assert.equal(edgeToBitIndex(bitIndexToEdge(i)), i);
  }
  for (const id of EDGE_ORDER) {
    assert.equal(bitIndexToEdge(edgeToBitIndex(id)), id);
  }
});

test('EDGE_ORDER is frozen so nobody can reorder it by accident', () => {
  assert.equal(Object.isFrozen(EDGE_ORDER), true);
  assert.throws(() => {
    EDGE_ORDER[0] = 'H0,0';
  });
});

test('cellToIndex and indexToCell are inverse on all 36 cells', () => {
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const { r, c } = indexToCell(i);
    assert.equal(cellToIndex(r, c), i);
    assert.equal(i, r * GRID_SIZE + c);
  }
});

test('labels follow the row letter and column digit scheme', () => {
  assert.equal(cellToLabel(2, 2), 'C3');
  assert.equal(cellToLabel(0, 0), 'A1');
  assert.equal(cellToLabel(5, 5), 'F6');
  assert.deepEqual(labelToCell('C3'), { r: 2, c: 2 });
  assert.deepEqual(labelToCell(' f6 '), { r: 5, c: 5 });
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const { r, c } = indexToCell(i);
    assert.deepEqual(labelToCell(cellToLabel(r, c)), { r, c });
  }
});

test('edgeBetween names the shared edge and refuses everything else', () => {
  assert.equal(edgeBetween(2, 3, 2, 4), 'V2,3');
  assert.equal(edgeBetween(2, 4, 2, 3), 'V2,3');
  assert.equal(edgeBetween(1, 0, 2, 0), 'H1,0');
  assert.equal(edgeBetween(2, 0, 1, 0), 'H1,0');

  assert.equal(edgeBetween(0, 0, 0, 0), null, 'a cell shares no edge with itself');
  assert.equal(edgeBetween(0, 0, 1, 1), null, 'diagonals share no edge');
  assert.equal(edgeBetween(0, 0, 0, 2), null, 'distant cells share no edge');
});

test('edgeCells names the two cells an edge separates', () => {
  assert.deepEqual(edgeCells('V2,3'), [{ r: 2, c: 3 }, { r: 2, c: 4 }]);
  assert.deepEqual(edgeCells('H1,0'), [{ r: 1, c: 0 }, { r: 2, c: 0 }]);
});

test('isOnBoard answers without throwing', () => {
  assert.equal(isOnBoard(0, 0), true);
  assert.equal(isOnBoard(5, 5), true);
  assert.equal(isOnBoard(-1, 0), false);
  assert.equal(isOnBoard(0, 6), false);
  assert.equal(isOnBoard(1.5, 0), false);
  assert.equal(isOnBoard(undefined, undefined), false);
});

test('coordinate helpers reject junk with a readable message', () => {
  assert.throws(() => cellToIndex(-1, 0), /row r must be in 0\.\.5/);
  assert.throws(() => cellToIndex(0, 6), /column c must be in 0\.\.5/);
  assert.throws(() => cellToIndex(1.5, 0), /must be an integer/);
  assert.throws(() => cellToIndex(undefined, 0), /must be an integer/);
  assert.throws(() => indexToCell(36), /cell index must be in 0\.\.35/);
  assert.throws(() => labelToCell('G7'), /must look like "C3"/);
  assert.throws(() => labelToCell(''), /must look like "C3"/);
  assert.throws(() => labelToCell(null), /must be a string/);
  assert.throws(() => edgeBetween(0, 0, -1, 0), /row r must be in 0\.\.5/);
});

test('edge ids are parsed strictly', () => {
  assert.deepEqual(parseEdgeId('V2,3'), { type: 'V', r: 2, c: 3 });
  assert.deepEqual(parseEdgeId('H0,5'), { type: 'H', r: 0, c: 5 });
  assert.throws(() => parseEdgeId('V0,5'), /vertical edge id out of range/);
  assert.throws(() => parseEdgeId('H5,0'), /horizontal edge id out of range/);
  assert.throws(() => parseEdgeId('X0,0'), /must look like/);
  assert.throws(() => parseEdgeId('V0'), /must look like/);
  assert.throws(() => parseEdgeId('v0,0'), /must look like/);
  assert.throws(() => parseEdgeId(42), /must be a string/);
  assert.throws(() => bitIndexToEdge(60), /bit index must be in 0\.\.59/);
});
