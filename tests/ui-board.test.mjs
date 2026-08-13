/**
 * The pure half of the board component: the model it draws from and the
 * geometry of the hit zones. No DOM is created here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_GEOMETRY,
  boardModelFromState,
  edgeGeometry,
  gameBoardModel,
  normalizeBoardModel,
  passageGeometry,
} from '../src/ui/board.js';
import { createDefaultState } from '../src/ui/store.js';
import { EDGE_ORDER, cellToIndex } from '../src/core/edges.js';
import { replayGame } from '../src/ui/gameLog.js';
import { normalizeSettings } from '../src/core/settings.js';

test('an empty model draws nothing', () => {
  const model = normalizeBoardModel();
  assert.equal(model.walls.size, 0);
  assert.equal(model.entrance, null);
  assert.equal(model.exit, null);
  assert.deepEqual(model.tokens, { me: null, opponent: null });
  assert.equal(model.hiddenCells.size, 0);
});

test('cells are accepted as coordinates or as indices', () => {
  const model = normalizeBoardModel({
    entrance: { r: 2, c: 2 },
    exit: cellToIndex(5, 5),
    tokens: { me: { r: 0, c: 1 }, opponent: 7 },
    visitedCells: [0, { r: 1, c: 0 }],
    highlight: { cells: [{ r: 3, c: 3 }], edges: ['V0,0'] },
  });
  assert.equal(model.entrance, cellToIndex(2, 2));
  assert.equal(model.exit, 35);
  assert.equal(model.tokens.me, 1);
  assert.equal(model.tokens.opponent, 7);
  assert.deepEqual([...model.visitedCells].sort((a, b) => a - b), [0, 6]);
  assert.deepEqual([...model.highlight.cells], [cellToIndex(3, 3)]);
  assert.deepEqual([...model.highlight.edges], ['V0,0']);
});

test('a malformed model is refused rather than half drawn', () => {
  assert.throws(() => normalizeBoardModel({ walls: ['Q9,9'] }), /edge id/);
  assert.throws(() => normalizeBoardModel({ entrance: { r: 9, c: 0 } }), /must be \{r, c\}/);
  assert.throws(() => normalizeBoardModel({ exit: 36 }), /cell index must be in 0\.\.35/);
});

test('the model of my board carries my walls and my ends', () => {
  const state = {
    ...createDefaultState(),
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,0', 'H2,3'] },
    opponentEnds: { entrance: { r: 1, c: 1 }, exit: { r: 4, c: 4 } },
  };
  const mine = boardModelFromState(state, 'mine');
  assert.deepEqual([...mine.walls].sort(), ['H2,3', 'V0,0']);
  assert.equal(mine.entrance, cellToIndex(0, 0));
  assert.equal(mine.exit, cellToIndex(5, 5));
});

test("the model of the opponent's board carries the ends and no walls", () => {
  const state = {
    ...createDefaultState(),
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,0'] },
    opponentEnds: { entrance: { r: 1, c: 1 }, exit: { r: 4, c: 4 } },
  };
  const theirs = boardModelFromState(state, 'opponent');
  assert.equal(theirs.walls.size, 0, 'their walls are unknown until the reveal');
  assert.equal(theirs.entrance, cellToIndex(1, 1));
  assert.equal(theirs.exit, cellToIndex(4, 4));
  assert.throws(() => boardModelFromState(state, 'left'), /must be "mine" or "opponent"/);
});

test('an edge is drawn on the border between its two cells', () => {
  const { CELL, MARGIN } = BOARD_GEOMETRY;
  const vertical = edgeGeometry('V0,0');
  assert.deepEqual(vertical.line, {
    x1: MARGIN + CELL,
    y1: MARGIN,
    x2: MARGIN + CELL,
    y2: MARGIN + CELL,
  });

  const horizontal = edgeGeometry('H0,0');
  assert.deepEqual(horizontal.line, {
    x1: MARGIN,
    y1: MARGIN + CELL,
    x2: MARGIN + CELL,
    y2: MARGIN + CELL,
  });
});

test('a hit zone is wide across and short along the edge', () => {
  const { EDGE_HIT_ACROSS, EDGE_HIT_ALONG, CELL } = BOARD_GEOMETRY;
  assert.equal(EDGE_HIT_ACROSS, 30, 'a finger has to reach it on a phone');
  assert.equal(EDGE_HIT_ALONG, 70, 'and it must stop short of the corners');

  for (const id of EDGE_ORDER) {
    const { line, hit } = edgeGeometry(id);
    const vertical = line.x1 === line.x2;
    assert.equal(vertical ? hit.width : hit.height, EDGE_HIT_ACROSS, id);
    assert.equal(vertical ? hit.height : hit.width, EDGE_HIT_ALONG, id);

    // Centred on the edge in both directions.
    assert.equal(hit.x + hit.width / 2, (line.x1 + line.x2) / 2, id);
    assert.equal(hit.y + hit.height / 2, (line.y1 + line.y2) / 2, id);
    assert.equal(CELL - (vertical ? hit.height : hit.width), 30, id);
  }
});

test('an open passage is drawn between the centres of the two cells', () => {
  const { CELL, MARGIN } = BOARD_GEOMETRY;
  const centre = (r, c) => ({ x: MARGIN + c * CELL + CELL / 2, y: MARGIN + r * CELL + CELL / 2 });

  const vertical = passageGeometry('V0,0');
  assert.deepEqual(vertical, {
    x1: centre(0, 0).x,
    y1: centre(0, 0).y,
    x2: centre(0, 1).x,
    y2: centre(0, 1).y,
  });

  const horizontal = passageGeometry('H2,3');
  assert.deepEqual(horizontal, {
    x1: centre(2, 3).x,
    y1: centre(2, 3).y,
    x2: centre(3, 3).x,
    y2: centre(3, 3).y,
  });
});

test('during a game each board shows only what its side may see', () => {
  const uiState = {
    ...createDefaultState(),
    settings: normalizeSettings({}),
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: ['V0,0', 'H1,1', 'H0,0'] },
    opponentEnds: { entrance: { r: 0, c: 0 }, exit: { r: 0, c: 2 } },
  };
  const game = replayGame(uiState, [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'right', answer: 'pass' },
    { type: 'STEP', side: 'me', direction: 'down', answer: 'wall' },
    { type: 'END_TURN' },
  ]);

  const mine = gameBoardModel(game, 'opponent');
  assert.deepEqual([...mine.walls].sort(), ['H0,0', 'H1,1', 'V0,0'], 'I know my own maze');
  assert.equal(mine.tokens.opponent, cellToIndex(0, 0));
  assert.equal(mine.tokens.me, null);

  const theirs = gameBoardModel(game, 'me', { available: [{ r: 0, c: 0 }] });
  assert.equal(theirs.walls.size, 0, 'their walls are never handed to the view');
  assert.deepEqual([...theirs.knownWalls], ['H0,1'], 'only the wall that was announced');
  assert.deepEqual([...theirs.knownPassages], ['V0,0'], 'and the passage that was walked');
  assert.deepEqual([...theirs.visitedCells].sort((a, b) => a - b), [
    cellToIndex(0, 0),
    cellToIndex(0, 1),
  ]);
  assert.equal(theirs.tokens.me, cellToIndex(0, 1));
  assert.deepEqual([...theirs.highlight.cells], [cellToIndex(0, 0)]);

  assert.throws(() => gameBoardModel(game, 'left'), /must be "me" or "opponent"/);
});

test('no two hit zones overlap, so a click is never ambiguous', () => {
  const zones = EDGE_ORDER.map((id) => ({ id, ...edgeGeometry(id).hit }));
  const overlaps = [];
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const a = zones[i];
      const b = zones[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > 0 && overlapY > 0) {
        overlaps.push(`${a.id} and ${b.id}`);
      }
    }
  }
  assert.deepEqual(overlaps, [], 'zones of two edges must never share an area');
});
