import test from 'node:test';
import assert from 'node:assert/strict';

import { createMaze, findPath, hasWall, neighbours, openSides, validateMaze } from '../src/core/maze.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const SETTINGS = { ...DEFAULT_SETTINGS };

/**
 * Builds a maze with the given walls, entrance A1 and exit F6.
 *
 * @param {string[]} walls Edge ids.
 * @returns {object} The maze.
 */
function mazeWith(walls) {
  return createMaze({ entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls });
}

/**
 * A serpentine corridor: 25 walls, every cell still reachable.
 *
 * @returns {string[]} Edge ids.
 */
function serpentineWalls() {
  const walls = [];
  for (let r = 0; r <= 4; r += 1) {
    for (let c = 0; c <= 5; c += 1) {
      const gap = r % 2 === 0 ? 5 : 0;
      if (c !== gap) {
        walls.push(`H${r},${c}`);
      }
    }
  }
  return walls;
}

test('a maze with no walls at all is valid', () => {
  const result = validateMaze(mazeWith([]), SETTINGS);
  assert.deepEqual(result, { ok: true, problems: [] });
});

test('hasWall reads the shared edge from both directions', () => {
  const maze = mazeWith(['V2,3', 'H1,0']);
  assert.equal(hasWall(maze, 2, 3, 2, 4), true);
  assert.equal(hasWall(maze, 2, 4, 2, 3), true);
  assert.equal(hasWall(maze, 1, 0, 2, 0), true);
  assert.equal(hasWall(maze, 0, 0, 0, 1), false);
  assert.throws(() => hasWall(maze, 0, 0, 1, 1), /not orthogonally adjacent/);
  assert.throws(() => hasWall(maze, 0, 0, 0, 6), /column c must be in 0\.\.5/);
  assert.throws(() => hasWall({ walls: [] }, 0, 0, 0, 1), /must be a Set/);
});

test('openSides counts the border of the board as a wall', () => {
  const empty = mazeWith([]);
  assert.equal(openSides(empty, 0, 0), 2, 'a corner has two sides');
  assert.equal(openSides(empty, 0, 3), 3, 'an edge cell has three');
  assert.equal(openSides(empty, 2, 2), 4, 'an inner cell has four');

  const boxed = mazeWith(['V2,1', 'V2,2', 'H1,2', 'H2,2']);
  assert.equal(openSides(boxed, 2, 2), 0);
});

test('findPath walks from the entrance to the exit', () => {
  const path = findPath(mazeWith([]));
  assert.equal(path[0].r === 0 && path[0].c === 0, true);
  assert.equal(path[path.length - 1].r === 5 && path[path.length - 1].c === 5, true);
  assert.equal(path.length, 11, 'the shortest way across 6x6 is ten steps');

  const split = mazeWith(['V0,2', 'V1,2', 'V2,2', 'V3,2', 'V4,2', 'V5,2']);
  assert.equal(findPath(split), null);

  assert.throws(
    () => findPath(createMaze({ entrance: { r: 0, c: 0 }, walls: [] })),
    /both an entrance and an exit/,
  );
});

test('check 1: a missing entrance, a missing exit and coinciding ends', () => {
  const noEnds = createMaze({ walls: [] });
  assert.deepEqual(validateMaze(noEnds, SETTINGS).problems, ['ENTRANCE_MISSING', 'EXIT_MISSING']);

  const noExit = createMaze({ entrance: { r: 0, c: 0 }, walls: [] });
  assert.deepEqual(validateMaze(noExit, SETTINGS).problems, ['EXIT_MISSING']);

  const same = createMaze({ entrance: { r: 2, c: 2 }, exit: { r: 2, c: 2 }, walls: [] });
  assert.deepEqual(validateMaze(same, SETTINGS).problems, ['ENTRANCE_EQUALS_EXIT']);
});

test('check 2: too many walls, and nothing else', () => {
  const walls = serpentineWalls();
  assert.equal(walls.length, 25);
  assert.deepEqual(validateMaze(mazeWith(walls), { wall_limit: 20 }).problems, [
    'WALL_LIMIT_EXCEEDED',
  ]);
  assert.deepEqual(validateMaze(mazeWith(walls), { wall_limit: 25 }), { ok: true, problems: [] });
});

test('check 3, check 4 and check 5 give three different answers', () => {
  const sealedEntrance = validateMaze(mazeWith(['V0,0', 'H0,0']), SETTINGS).problems;
  const sealedExit = validateMaze(mazeWith(['V5,4', 'H4,5']), SETTINGS).problems;
  const noPath = validateMaze(
    mazeWith(['V0,2', 'V1,2', 'V2,2', 'V3,2', 'V4,2', 'V5,2']),
    SETTINGS,
  ).problems;

  assert.equal(sealedEntrance.includes('ENTRANCE_SEALED'), true);
  assert.equal(sealedEntrance.includes('EXIT_SEALED'), false);

  assert.equal(sealedExit.includes('EXIT_SEALED'), true);
  assert.equal(sealedExit.includes('ENTRANCE_SEALED'), false);

  assert.deepEqual(noPath, ['NO_PATH'], 'a wall across the board only breaks the path');

  const distinct = new Set([
    sealedEntrance.join('+'),
    sealedExit.join('+'),
    noPath.join('+'),
  ]);
  assert.equal(distinct.size, 3, 'the three cases must not read the same');
});

test('every problem is reported at once, not just the first', () => {
  const maze = mazeWith(['V0,0', 'H0,0', 'V5,4', 'H4,5']);
  const result = validateMaze(maze, { wall_limit: 2 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, [
    'WALL_LIMIT_EXCEEDED',
    'ENTRANCE_SEALED',
    'EXIT_SEALED',
    'NO_PATH',
  ]);
});

test('createMaze copies what it is given and refuses junk', () => {
  const walls = new Set(['V0,0']);
  const maze = createMaze({ entrance: { r: 0, c: 0 }, exit: { r: 1, c: 1 }, walls });
  walls.add('V0,1');
  assert.equal(maze.walls.size, 1, 'the maze must not share the caller Set');

  assert.throws(() => createMaze(null), /must be an object/);
  assert.throws(() => createMaze({ walls: 'V0,0' }), /must be a Set or an array/);
  assert.throws(() => createMaze({ walls: ['Q0,0'] }), /must look like/);
  assert.throws(() => createMaze({ entrance: { r: -1, c: 0 }, walls: [] }), /not a valid cell/);
  assert.throws(() => createMaze({ entrance: { r: 0 }, walls: [] }), /not a valid cell/);
});

test('validateMaze checks the settings block it is handed', () => {
  assert.throws(() => validateMaze(mazeWith([]), null), /settings must be an object/);
  assert.throws(() => validateMaze(mazeWith([]), {}), /wall_limit must be a non negative integer/);
  assert.throws(() => validateMaze(mazeWith([]), { wall_limit: -1 }), /non negative integer/);
});

test('neighbours stops at the border', () => {
  assert.equal(neighbours(0, 0).length, 2);
  assert.equal(neighbours(0, 3).length, 3);
  assert.equal(neighbours(2, 2).length, 4);
  assert.throws(() => neighbours(6, 0), /row r must be in 0\.\.5/);
});
