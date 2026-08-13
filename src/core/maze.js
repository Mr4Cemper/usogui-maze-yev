/**
 * maze.js - the maze model, the path search and the five validity checks
 * (SPEC 1.3, 1.4, 1.5).
 *
 * A maze is a plain object:
 *   {
 *     entrance: {r, c} | null,
 *     exit:     {r, c} | null,
 *     walls:    Set<string>   // canonical edge ids, see edges.js
 *   }
 *
 * The outer border of the board is impassable by definition and is never
 * stored as a wall.
 */

import {
  GRID_SIZE,
  assertCell,
  cellToIndex,
  edgeBetween,
  indexToCell,
  isOnBoard,
  parseEdgeId,
} from './edges.js';

/** Every problem code {@link validateMaze} can report. */
export const MAZE_PROBLEMS = Object.freeze([
  'ENTRANCE_MISSING',
  'EXIT_MISSING',
  'ENTRANCE_EQUALS_EXIT',
  'WALL_LIMIT_EXCEEDED',
  'ENTRANCE_SEALED',
  'EXIT_SEALED',
  'NO_PATH',
]);

const NEIGHBOUR_DELTAS = Object.freeze([
  Object.freeze({ dr: -1, dc: 0 }),
  Object.freeze({ dr: 1, dc: 0 }),
  Object.freeze({ dr: 0, dc: -1 }),
  Object.freeze({ dr: 0, dc: 1 }),
]);

/**
 * Validates and copies a cell, or passes null through.
 *
 * @param {unknown} cell Cell to normalise, `{r, c}` or null or undefined.
 * @param {string} name Name used in the error message.
 * @returns {{r: number, c: number}|null} A fresh cell object, or null.
 * @throws {Error} If the value is neither empty nor a valid cell.
 */
function normaliseCell(cell, name) {
  if (cell === null || cell === undefined) {
    return null;
  }
  if (typeof cell !== 'object') {
    throw new Error(`${name} must be an object {r, c} or null, got ${String(cell)}`);
  }
  const { r, c } = /** @type {{r: unknown, c: unknown}} */ (cell);
  try {
    assertCell(/** @type {number} */ (r), /** @type {number} */ (c));
  } catch (error) {
    throw new Error(`${name} is not a valid cell: ${error.message}`);
  }
  return { r: /** @type {number} */ (r), c: /** @type {number} */ (c) };
}

/**
 * Validates a maze shaped object and returns a normalised copy.
 * Entrance and exit may be missing while the maze is still being built.
 *
 * @param {{entrance?: unknown, exit?: unknown, walls?: unknown}} maze Maze
 *   description. `walls` may be a Set, an array or missing.
 * @returns {{entrance: {r: number, c: number}|null, exit: {r: number, c: number}|null, walls: Set<string>}}
 *   A normalised maze that never shares mutable state with the argument.
 * @throws {Error} If the argument is not an object, a coordinate is invalid,
 *   or a wall is not a valid edge id.
 */
export function createMaze(maze) {
  if (maze === null || typeof maze !== 'object') {
    throw new Error(`maze must be an object, got ${String(maze)}`);
  }
  const source = maze.walls ?? [];
  if (!(source instanceof Set) && !Array.isArray(source)) {
    throw new Error(`maze.walls must be a Set or an array, got ${String(maze.walls)}`);
  }
  const walls = new Set();
  for (const id of source) {
    parseEdgeId(id);
    walls.add(id);
  }
  return {
    entrance: normaliseCell(maze.entrance, 'maze.entrance'),
    exit: normaliseCell(maze.exit, 'maze.exit'),
    walls,
  };
}

/**
 * Throws unless the value is a usable maze object.
 *
 * @param {unknown} maze Value to check.
 * @returns {{entrance: {r: number, c: number}|null, exit: {r: number, c: number}|null, walls: Set<string>}}
 *   The maze itself.
 * @throws {Error} If the value is not a maze object with a walls Set.
 */
function assertMaze(maze) {
  if (maze === null || typeof maze !== 'object') {
    throw new Error(`maze must be an object, got ${String(maze)}`);
  }
  if (!(maze.walls instanceof Set)) {
    throw new Error('maze.walls must be a Set of edge ids');
  }
  return /** @type {any} */ (maze);
}

/**
 * Tells whether a wall stands between two adjacent cells.
 *
 * @param {object} maze Maze to inspect.
 * @param {number} r Row of the first cell, 0..5.
 * @param {number} c Column of the first cell, 0..5.
 * @param {number} nr Row of the second cell, 0..5.
 * @param {number} nc Column of the second cell, 0..5.
 * @returns {boolean} True when the shared edge carries a wall.
 * @throws {Error} If the maze is malformed, a coordinate is off the board, or
 *   the two cells are not orthogonally adjacent.
 */
export function hasWall(maze, r, c, nr, nc) {
  assertMaze(maze);
  const edge = edgeBetween(r, c, nr, nc);
  if (edge === null) {
    throw new Error(
      `cells (${r},${c}) and (${nr},${nc}) are not orthogonally adjacent, they share no edge`,
    );
  }
  return maze.walls.has(edge);
}

/**
 * Counts the sides of a cell a pawn could step through. The outer border of
 * the board counts as a wall (SPEC 1.2).
 *
 * @param {object} maze Maze to inspect.
 * @param {number} r Row index, 0..5.
 * @param {number} c Column index, 0..5.
 * @returns {number} How many of the four sides are open, 0..4.
 * @throws {Error} If the maze is malformed or the coordinates are off board.
 */
export function openSides(maze, r, c) {
  assertMaze(maze);
  assertCell(r, c);
  let open = 0;
  for (const { dr, dc } of NEIGHBOUR_DELTAS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!isOnBoard(nr, nc)) {
      continue;
    }
    if (!hasWall(maze, r, c, nr, nc)) {
      open += 1;
    }
  }
  return open;
}

/**
 * Breadth first search from the entrance to the exit (SPEC 1.4).
 *
 * @param {object} maze Maze with both an entrance and an exit.
 * @returns {Array<{r: number, c: number}>|null} The shortest path including
 *   both ends, or null when the exit cannot be reached.
 * @throws {Error} If the maze is malformed or has no entrance or no exit.
 */
export function findPath(maze) {
  assertMaze(maze);
  if (!maze.entrance || !maze.exit) {
    throw new Error('findPath needs a maze with both an entrance and an exit');
  }
  const start = cellToIndex(maze.entrance.r, maze.entrance.c);
  const goal = cellToIndex(maze.exit.r, maze.exit.c);
  const cameFrom = new Map([[start, -1]]);
  const queue = [start];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current === goal) {
      const path = [];
      for (let node = current; node !== -1; node = cameFrom.get(node)) {
        path.push(indexToCell(node));
      }
      return path.reverse();
    }
    const { r, c } = indexToCell(current);
    for (const { dr, dc } of NEIGHBOUR_DELTAS) {
      const nr = r + dr;
      const nc = c + dc;
      if (!isOnBoard(nr, nc) || hasWall(maze, r, c, nr, nc)) {
        continue;
      }
      const next = cellToIndex(nr, nc);
      if (!cameFrom.has(next)) {
        cameFrom.set(next, current);
        queue.push(next);
      }
    }
  }
  return null;
}

/**
 * Reads the wall limit out of a settings object.
 *
 * @param {{wall_limit?: unknown}} settings Settings block.
 * @returns {number} The wall limit.
 * @throws {Error} If settings is not an object or wall_limit is not a
 *   non negative integer.
 */
function readWallLimit(settings) {
  if (settings === null || typeof settings !== 'object') {
    throw new Error(`settings must be an object, got ${String(settings)}`);
  }
  const limit = settings.wall_limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    throw new Error(`settings.wall_limit must be a non negative integer, got ${String(limit)}`);
  }
  return limit;
}

/**
 * Runs all five validity checks of SPEC 1.5. Every check runs independently so
 * that the caller learns about all problems at once instead of only the first.
 *
 * Dead ends and isolated islands are allowed and are not checked.
 *
 * @param {object} maze Maze to check.
 * @param {{wall_limit: number}} settings Settings block that carries the wall
 *   limit.
 * @returns {{ok: boolean, problems: string[]}} Verdict and the list of problem
 *   codes, see {@link MAZE_PROBLEMS}. Codes, not text: translation belongs to
 *   the interface layer.
 * @throws {Error} If the maze or the settings block is malformed.
 */
export function validateMaze(maze, settings) {
  const checked = createMaze(maze);
  const wallLimit = readWallLimit(settings);
  const problems = [];

  // 1. Entrance and exit are both placed and differ.
  if (checked.entrance === null) {
    problems.push('ENTRANCE_MISSING');
  }
  if (checked.exit === null) {
    problems.push('EXIT_MISSING');
  }
  const bothPlaced = checked.entrance !== null && checked.exit !== null;
  const samePlace =
    bothPlaced &&
    checked.entrance.r === checked.exit.r &&
    checked.entrance.c === checked.exit.c;
  if (samePlace) {
    problems.push('ENTRANCE_EQUALS_EXIT');
  }

  // 2. The wall count fits the limit.
  if (checked.walls.size > wallLimit) {
    problems.push('WALL_LIMIT_EXCEEDED');
  }

  // 3. The entrance has an open side.
  if (checked.entrance !== null && openSides(checked, checked.entrance.r, checked.entrance.c) === 0) {
    problems.push('ENTRANCE_SEALED');
  }

  // 4. The exit has an open side.
  if (checked.exit !== null && openSides(checked, checked.exit.r, checked.exit.c) === 0) {
    problems.push('EXIT_SEALED');
  }

  // 5. A path from the entrance to the exit exists.
  if (bothPlaced && findPath(checked) === null) {
    problems.push('NO_PATH');
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Lists the four orthogonal neighbours of a cell that lie on the board.
 *
 * @param {number} r Row index, 0..5.
 * @param {number} c Column index, 0..5.
 * @returns {Array<{r: number, c: number}>} Neighbouring cells, walls ignored.
 * @throws {Error} If the coordinates are off the board.
 */
export function neighbours(r, c) {
  assertCell(r, c);
  const result = [];
  for (const { dr, dc } of NEIGHBOUR_DELTAS) {
    if (isOnBoard(r + dr, c + dc)) {
      result.push({ r: r + dr, c: c + dc });
    }
  }
  return result;
}

/** Board side length, re exported so callers do not need two imports. */
export { GRID_SIZE };
