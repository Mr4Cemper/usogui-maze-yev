/**
 * board.js - the board component, drawn as SVG.
 *
 * The same component serves the build screen, the game screen, the replay and
 * the PNG export, so it is deliberately free of any screen knowledge: it draws
 * the model it is handed and decides nothing. Validity, wall limits and whose
 * turn it is all live in the core.
 *
 * SVG rather than canvas: every cell and every edge has to be a separate
 * clickable, focusable element, the colours have to come from CSS variables so
 * that Part 4 can retheme without touching this file, and Part 5 needs a clean
 * conversion to PNG.
 *
 * Everything that glows is drawn twice: a wide translucent stroke underneath
 * and a thin bright one on top. `filter: drop-shadow` would be one line of CSS
 * instead, and it would also make a board of ~260 nodes crawl on a phone
 * (SPEC 5.13).
 *
 * Units: one cell is 100 units wide, the viewBox scales to whatever width the
 * container has. Row letters sit to the left of the play square and column
 * digits above it, outside the playing area.
 */

import {
  EDGE_ORDER,
  GRID_SIZE,
  cellToIndex,
  cellToLabel,
  edgeCells,
  indexToCell,
  isOnBoard,
  parseEdgeId,
} from '../core/edges.js';
import { clear, svgEl, toggleClass } from './dom.js';
import { addPoint, strokePath, strokesOf } from './ink.js';
import { t } from '../i18n/index.js';

/** Board geometry in board units. */
export const BOARD_GEOMETRY = Object.freeze({
  CELL: 100,
  /** Gutter on the left and on top that carries the labels. */
  MARGIN: 46,
  /** Breathing room on the right and at the bottom. */
  PAD: 14,
  /** Across the edge: wide enough for a finger on a phone. */
  EDGE_HIT_ACROSS: 30,
  /** Along the edge: short of the corners on purpose, see below. */
  EDGE_HIT_ALONG: 70,
});

const { CELL, MARGIN, PAD, EDGE_HIT_ACROSS, EDGE_HIT_ALONG } = BOARD_GEOMETRY;
const PLAY_SIZE = GRID_SIZE * CELL;
const VIEW_SIZE = MARGIN + PLAY_SIZE + PAD;

/** Modes the component understands. */
export const BOARD_MODES = Object.freeze(['build', 'readonly', 'play']);

/**
 * Left edge of a column in board units.
 *
 * @param {number} c Column index.
 * @returns {number} X coordinate.
 */
function columnX(c) {
  return MARGIN + c * CELL;
}

/**
 * Top edge of a row in board units.
 *
 * @param {number} r Row index.
 * @returns {number} Y coordinate.
 */
function rowY(r) {
  return MARGIN + r * CELL;
}

/**
 * Where an edge is drawn and where it can be clicked.
 *
 * The hit zone is about 30 units across so that a finger reaches it, and about
 * 70 units along out of 100, centred. The shortening is required, not an
 * optimisation: at the point where four cells meet, full length zones of two
 * perpendicular edges would overlap and a click there would be ambiguous.
 *
 * @param {string} id Edge id such as "V2,3".
 * @returns {{line: {x1: number, y1: number, x2: number, y2: number}, hit: {x: number, y: number, width: number, height: number}}}
 *   Line coordinates and the hit rectangle.
 * @throws {Error} If the edge id is malformed.
 */
export function edgeGeometry(id) {
  const { type, r, c } = parseEdgeId(id);
  const inset = (CELL - EDGE_HIT_ALONG) / 2;
  if (type === 'V') {
    const x = columnX(c + 1);
    const y = rowY(r);
    return {
      line: { x1: x, y1: y, x2: x, y2: y + CELL },
      hit: {
        x: x - EDGE_HIT_ACROSS / 2,
        y: y + inset,
        width: EDGE_HIT_ACROSS,
        height: EDGE_HIT_ALONG,
      },
    };
  }
  const y = rowY(r + 1);
  const x = columnX(c);
  return {
    line: { x1: x, y1: y, x2: x + CELL, y2: y },
    hit: {
      x: x + inset,
      y: y - EDGE_HIT_ACROSS / 2,
      width: EDGE_HIT_ALONG,
      height: EDGE_HIT_ACROSS,
    },
  };
}

/**
 * Where an open passage is drawn: from the centre of one cell to the centre of
 * the next, crossing the edge. It doubles as the trail the pawn left behind,
 * which is how the prototype drew it.
 *
 * @param {string} id Edge id such as "V2,3".
 * @returns {{x1: number, y1: number, x2: number, y2: number}} Line ends.
 * @throws {Error} If the edge id is malformed.
 */
export function passageGeometry(id) {
  const [from, to] = edgeCells(id);
  return {
    x1: columnX(from.c) + CELL / 2,
    y1: rowY(from.r) + CELL / 2,
    x2: columnX(to.c) + CELL / 2,
    y2: rowY(to.r) + CELL / 2,
  };
}

/**
 * Accepts a cell as `{r, c}` or as a cell index and returns the index.
 *
 * @param {unknown} cell Candidate.
 * @returns {number|null} Cell index, or null when the value is empty.
 * @throws {Error} If the value is neither empty nor a cell.
 */
function toCellIndex(cell) {
  if (cell === null || cell === undefined) {
    return null;
  }
  if (typeof cell === 'number') {
    indexToCell(cell);
    return cell;
  }
  if (typeof cell === 'object' && isOnBoard(cell.r, cell.c)) {
    return cellToIndex(cell.r, cell.c);
  }
  throw new Error(`a board model cell must be {r, c} or a cell index, got ${String(cell)}`);
}

/**
 * Turns a list of cells into a set of indices.
 *
 * @param {Iterable<unknown>} [cells] Cells in either accepted shape.
 * @returns {Set<number>} Cell indices.
 * @throws {Error} If a member is not a cell.
 */
function toCellSet(cells) {
  const set = new Set();
  for (const cell of cells ?? []) {
    const index = toCellIndex(cell);
    if (index !== null) {
      set.add(index);
    }
  }
  return set;
}

/**
 * Turns a list of edge ids into a validated set.
 *
 * @param {Iterable<string>} [edges] Edge ids.
 * @returns {Set<string>} The ids.
 * @throws {Error} If a member is not a valid edge id.
 */
function toEdgeSet(edges) {
  const set = new Set();
  for (const id of edges ?? []) {
    parseEdgeId(id);
    set.add(id);
  }
  return set;
}

/**
 * Brings a board model to its canonical shape. Pure, so the screens can be
 * tested without a DOM.
 *
 * @param {object} [model={}] What to draw: `walls`, `knownWalls`,
 *   `knownPassages`, `entrance`, `exit`, `tokens`, `visitedCells`,
 *   `hiddenCells`, `highlight`.
 * @returns {{walls: Set<string>, knownWalls: Set<string>, knownPassages: Set<string>, entrance: number|null, exit: number|null, tokens: {me: number|null, opponent: number|null}, visitedCells: Set<number>, hiddenCells: Set<number>, highlight: {cells: Set<number>, edges: Set<string>}}}
 *   The normalised model, cells as indices.
 * @throws {Error} If a cell or an edge id is malformed.
 */
export function normalizeBoardModel(model = {}) {
  const tokens = model.tokens ?? {};
  const highlight = model.highlight ?? {};
  return {
    walls: toEdgeSet(model.walls),
    knownWalls: toEdgeSet(model.knownWalls),
    knownPassages: toEdgeSet(model.knownPassages),
    entrance: toCellIndex(model.entrance ?? null),
    exit: toCellIndex(model.exit ?? null),
    tokens: {
      me: toCellIndex(tokens.me ?? null),
      opponent: toCellIndex(tokens.opponent ?? null),
    },
    visitedCells: toCellSet(model.visitedCells),
    hiddenCells: toCellSet(model.hiddenCells),
    highlight: {
      cells: toCellSet(highlight.cells),
      edges: toEdgeSet(highlight.edges),
    },
  };
}

/**
 * Derives what a board should show from the interface state. Pure.
 *
 * @param {object} state Application state.
 * @param {'mine'|'opponent'} which Which of the two boards.
 * @returns {object} A normalised board model.
 * @throws {Error} If the side name is unknown or the state holds a bad cell.
 */
export function boardModelFromState(state, which) {
  if (which === 'mine') {
    return normalizeBoardModel({
      walls: state.myMaze.walls,
      entrance: state.myMaze.entrance,
      exit: state.myMaze.exit,
    });
  }
  if (which === 'opponent') {
    // Only the ends are known before the game: the opponent announced them out
    // loud, the walls stay hidden until the reveal.
    return normalizeBoardModel({
      entrance: state.opponentEnds.entrance,
      exit: state.opponentEnds.exit,
    });
  }
  throw new Error(`board must be "mine" or "opponent", got ${String(which)}`);
}

/**
 * Derives what a board shows during a game. Pure, so the screen can be tested
 * without a DOM.
 *
 * The two boards are not symmetric, and that asymmetry is the whole game: the
 * maze I built is shown with every wall, because I know them all, while the
 * maze I am walking through shows only what has been discovered (SPEC 2.4).
 *
 * @param {object} gameState Core game state.
 * @param {'me'|'opponent'} side Whose walk to draw. 'opponent' is the left
 *   board - my own maze - and 'me' is the right one.
 * @param {object} [options={}] Extra hints for the view.
 * @param {Array<object>} [options.available=[]] Cells the pawn may step onto.
 * @returns {object} A normalised board model.
 * @throws {Error} If the side name is unknown.
 */
export function gameBoardModel(gameState, side, options = {}) {
  const board = gameState?.sides?.[side];
  if (board === undefined) {
    throw new Error(`a game board must be "me" or "opponent", got ${String(side)}`);
  }
  return normalizeBoardModel({
    // Only the side whose maze this device holds may show every wall.
    walls: board.known ? [...board.maze.walls] : [],
    knownWalls: [...board.knownWalls],
    knownPassages: [...board.knownOpen],
    entrance: board.entrance,
    exit: board.exit,
    visitedCells: [...board.visited],
    tokens: side === 'me' ? { me: board.pos } : { opponent: board.pos },
    highlight: { cells: options.available ?? [] },
  });
}

/**
 * Builds the static part of the board once.
 *
 * @param {string} label Accessible name for the whole board.
 * @returns {object} The root svg and every element `render` may touch.
 */
function buildSkeleton(label) {
  // Catches the pointer while drawing, and lets every click through when not.
  const inkSurface = svgEl('rect', {
    class: 'board__ink-surface',
    attrs: { x: 0, y: 0, width: VIEW_SIZE, height: VIEW_SIZE, fill: 'transparent' },
  });
  const layers = {
    background: svgEl('g'),
    cells: svgEl('g'),
    grid: svgEl('g'),
    passages: svgEl('g'),
    wallGlows: svgEl('g'),
    walls: svgEl('g'),
    marks: svgEl('g'),
    tokens: svgEl('g'),
    available: svgEl('g'),
    cellHits: svgEl('g'),
    edgeHits: svgEl('g'),
    labels: svgEl('g'),
    // Drawings sit above the game and take no part in it (SPEC 5.7).
    ink: svgEl('g', { class: 'board__ink' }),
  };

  const root = svgEl(
    'svg',
    {
      class: 'board',
      attrs: {
        viewBox: `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`,
        role: 'group',
        'aria-label': label,
        xmlns: 'http://www.w3.org/2000/svg',
      },
    },
    // Bottom to top: background, cells, grid, passages, the glow underlay,
    // walls, marks, tokens, then the hit zones, cells first and edges above.
    [
      layers.background,
      layers.cells,
      layers.grid,
      layers.labels,
      layers.passages,
      layers.wallGlows,
      layers.walls,
      layers.marks,
      layers.tokens,
      layers.available,
      layers.cellHits,
      layers.edgeHits,
      layers.ink,
      inkSurface,
    ],
  );

  layers.background.appendChild(
    svgEl('rect', {
      class: 'board__bg',
      attrs: { x: MARGIN, y: MARGIN, width: PLAY_SIZE, height: PLAY_SIZE },
    }),
  );

  const cellRects = [];
  const cellDots = [];
  const cellRings = [];
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    const { r, c } = indexToCell(index);
    const rect = svgEl('rect', {
      class: 'board__cell',
      attrs: { x: columnX(c), y: rowY(r), width: CELL, height: CELL },
    });
    cellRects.push(rect);
    layers.cells.appendChild(rect);

    // A dot marks a cell the pawn has stood on, the way the prototype marked
    // its trail. It also carries the trail into cells no passage reaches yet.
    const dot = svgEl('circle', {
      class: 'board__dot',
      attrs: { cx: columnX(c) + CELL / 2, cy: rowY(r) + CELL / 2, r: 6 },
    });
    cellDots.push(dot);
    layers.passages.appendChild(dot);

    // The "you may step here" ring is drawn above the entrance and the exit:
    // a cell that holds the big exit cross must still show that it is a legal
    // target.
    const ring = svgEl('rect', {
      class: 'board__available',
      attrs: {
        x: columnX(c) + 8,
        y: rowY(r) + 8,
        width: CELL - 16,
        height: CELL - 16,
      },
    });
    cellRings.push(ring);
    layers.available.appendChild(ring);
  }

  for (let i = 1; i < GRID_SIZE; i += 1) {
    layers.grid.appendChild(
      svgEl('line', {
        class: 'board__grid-line',
        attrs: { x1: columnX(i), y1: MARGIN, x2: columnX(i), y2: MARGIN + PLAY_SIZE },
      }),
    );
    layers.grid.appendChild(
      svgEl('line', {
        class: 'board__grid-line',
        attrs: { x1: MARGIN, y1: rowY(i), x2: MARGIN + PLAY_SIZE, y2: rowY(i) },
      }),
    );
  }
  // The frame glows: wide dim rectangle first, crisp bright one over it.
  for (const className of ['board__frame-glow', 'board__frame']) {
    layers.grid.appendChild(
      svgEl('rect', {
        class: className,
        attrs: { x: MARGIN, y: MARGIN, width: PLAY_SIZE, height: PLAY_SIZE },
      }),
    );
  }

  for (let i = 0; i < GRID_SIZE; i += 1) {
    // Row letters come from the core label, so the two never drift apart.
    layers.labels.appendChild(
      svgEl('text', {
        class: 'board__label',
        text: cellToLabel(i, 0).slice(0, 1),
        attrs: { x: MARGIN / 2, y: rowY(i) + CELL / 2 },
      }),
    );
    layers.labels.appendChild(
      svgEl('text', {
        class: 'board__label',
        text: cellToLabel(0, i).slice(1),
        attrs: { x: columnX(i) + CELL / 2, y: MARGIN / 2 },
      }),
    );
  }

  const passages = new Map();
  const walls = new Map();
  const wallGlows = new Map();
  const edgeHits = new Map();
  for (const id of EDGE_ORDER) {
    const geometry = edgeGeometry(id);
    const passage = svgEl('line', { class: 'board__passage', attrs: passageGeometry(id) });
    passages.set(id, passage);
    layers.passages.appendChild(passage);

    const glow = svgEl('line', { class: 'board__wall-glow', attrs: geometry.line });
    wallGlows.set(id, glow);
    layers.wallGlows.appendChild(glow);

    const wall = svgEl('line', { class: 'board__wall', attrs: geometry.line });
    walls.set(id, wall);
    layers.walls.appendChild(wall);
  }

  // Entrance is a ring, exit is a cross, both far larger than a token so that
  // a token standing on them stays visible (SPEC 5.6).
  const entranceGlow = svgEl('circle', {
    class: 'board__entrance-glow',
    attrs: { cx: 0, cy: 0, r: 33 },
  });
  const entrance = svgEl('circle', { class: 'board__entrance', attrs: { cx: 0, cy: 0, r: 33 } });
  const exitArms = () => [
    svgEl('line', { attrs: { x1: -30, y1: -30, x2: 30, y2: 30 } }),
    svgEl('line', { attrs: { x1: -30, y1: 30, x2: 30, y2: -30 } }),
  ];
  const exitGlow = svgEl('g', { class: 'board__exit-glow' }, exitArms());
  const exitGroup = svgEl('g', { class: 'board__exit' }, exitArms());
  layers.marks.appendChild(entranceGlow);
  layers.marks.appendChild(exitGlow);
  layers.marks.appendChild(entrance);
  layers.marks.appendChild(exitGroup);

  const tokens = {
    me: svgEl('circle', { class: 'board__token board__token--me', attrs: { cx: 0, cy: 0, r: 19 } }),
    opponent: svgEl('circle', {
      class: 'board__token board__token--opponent',
      attrs: { cx: 0, cy: 0, r: 19 },
    }),
  };
  const tokenGlows = {
    me: svgEl('circle', {
      class: 'board__token-glow board__token-glow--me',
      attrs: { cx: 0, cy: 0, r: 29 },
    }),
    opponent: svgEl('circle', {
      class: 'board__token-glow board__token-glow--opponent',
      attrs: { cx: 0, cy: 0, r: 29 },
    }),
  };
  layers.tokens.appendChild(tokenGlows.me);
  layers.tokens.appendChild(tokenGlows.opponent);
  layers.tokens.appendChild(tokens.me);
  layers.tokens.appendChild(tokens.opponent);

  const cellHits = [];
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    const { r, c } = indexToCell(index);
    const hit = svgEl('rect', {
      class: 'board__hit board__hit--cell',
      dataset: { cell: String(index) },
      attrs: {
        x: columnX(c),
        y: rowY(r),
        width: CELL,
        height: CELL,
        role: 'button',
        'aria-label': t('board.cellLabel', { cell: cellToLabel(r, c) }),
      },
    });
    cellHits.push(hit);
    layers.cellHits.appendChild(hit);
  }

  for (const id of EDGE_ORDER) {
    const geometry = edgeGeometry(id);
    const { type, r, c } = parseEdgeId(id);
    const first = cellToLabel(r, c);
    const second = type === 'V' ? cellToLabel(r, c + 1) : cellToLabel(r + 1, c);
    const hit = svgEl('rect', {
      class: 'board__hit board__hit--edge',
      dataset: { edge: id },
      attrs: {
        x: geometry.hit.x,
        y: geometry.hit.y,
        width: geometry.hit.width,
        height: geometry.hit.height,
        role: 'button',
        'aria-label': t('board.edgeLabel', { from: first, to: second }),
      },
    });
    edgeHits.set(id, hit);
    layers.edgeHits.appendChild(hit);
  }

  return {
    root,
    cellRects,
    cellDots,
    cellRings,
    passages,
    walls,
    wallGlows,
    entrance: [entranceGlow, entrance],
    exit: [exitGlow, exitGroup],
    tokens: {
      me: [tokenGlows.me, tokens.me],
      opponent: [tokenGlows.opponent, tokens.opponent],
    },
    cellHits,
    edgeHits,
    ink: layers.ink,
    inkSurface,
  };
}

/**
 * Creates a board inside a container.
 *
 * The DOM is built once; `render` only changes attributes and classes on the
 * elements that already exist, so the 96 hit zones are never rebuilt.
 *
 * @param {Element} container Element the board is appended to.
 * @param {object} [options={}] Component options.
 * @param {'build'|'readonly'|'play'} [options.mode='readonly'] Whether clicks
 *   are listened to at all. 'readonly' and 'play' both accept a model and stay
 *   silent.
 * @param {(edgeId: string) => void} [options.onEdgeClick] Called in build mode
 *   when an edge is chosen. Leaving it out disables the edge zones.
 * @param {(cell: {r: number, c: number}, index: number) => void} [options.onCellClick]
 *   Called in build mode when a cell is chosen. Leaving it out disables the
 *   cell zones.
 * @param {string} [options.label] Accessible name of the board.
 * @returns {{render: (model: object) => void, setMode: (mode: string) => void, destroy: () => void}}
 *   `render` draws a model, `setMode` switches interactivity (the build screen
 *   locks the board once the maze is committed to), `destroy` removes it all.
 * @throws {Error} If the container is missing or the mode is unknown.
 */
export function createBoard(container, options = {}) {
  if (container === null || typeof container !== 'object') {
    throw new Error('createBoard needs a container element');
  }
  const { onEdgeClick = null, onCellClick = null, label = t('board.label') } = options;
  let mode = options.mode ?? 'readonly';
  if (!BOARD_MODES.includes(mode)) {
    throw new Error(`board mode must be one of ${BOARD_MODES.join(', ')}, got ${String(mode)}`);
  }

  const parts = buildSkeleton(label);
  const { root } = parts;

  /**
   * Sends a click on a hit zone to the right handler.
   *
   * @param {Element} target Element that was hit.
   * @returns {void}
   */
  function activate(target) {
    if (mode === 'readonly') {
      return;
    }
    const edge = target.dataset?.edge;
    if (edge !== undefined && onEdgeClick !== null && mode === 'build') {
      onEdgeClick(edge);
      return;
    }
    const cell = target.dataset?.cell;
    if (cell !== undefined && onCellClick !== null) {
      const index = Number(cell);
      onCellClick(indexToCell(index), index);
    }
  }

  /**
   * @param {MouseEvent} event Click on the board.
   * @returns {void}
   */
  function handleClick(event) {
    activate(event.target);
  }

  /**
   * @param {KeyboardEvent} event Key pressed on a focused hit zone.
   * @returns {void}
   */
  function handleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const target = event.target;
    if (target?.dataset?.edge === undefined && target?.dataset?.cell === undefined) {
      return;
    }
    event.preventDefault();
    activate(target);
  }

  /**
   * Lights the edge under the pointer, or the focused one, instead of filling
   * its rectangle: the player has to see which edge will take the wall, and a
   * filled box hides the very line it is about to draw (SPEC 5.13).
   *
   * @param {Event} event Pointer or focus event.
   * @param {boolean} on Whether the edge lights up.
   * @returns {void}
   */
  function highlightEdge(event, on) {
    const id = event.target?.dataset?.edge;
    if (id === undefined || mode !== 'build' || onEdgeClick === null) {
      return;
    }
    for (const node of [parts.walls.get(id), parts.wallGlows.get(id)]) {
      toggleClass(node, 'is-hovered', on);
    }
  }

  /** @param {Event} event Pointer entering a hit zone. @returns {void} */
  const handleOver = (event) => highlightEdge(event, true);
  /** @param {Event} event Pointer leaving a hit zone. @returns {void} */
  const handleOut = (event) => highlightEdge(event, false);

  root.addEventListener('click', handleClick);
  root.addEventListener('keydown', handleKeydown);
  root.addEventListener('pointerover', handleOver);
  root.addEventListener('pointerout', handleOut);
  root.addEventListener('focusin', handleOver);
  root.addEventListener('focusout', handleOut);

  /**
   * Applies the interactivity of the current mode.
   *
   * @returns {void}
   */
  function applyMode() {
    for (const name of BOARD_MODES) {
      toggleClass(root, `board--${name}`, name === mode);
    }
    // Edges are placed only while building. Cells are chosen while building
    // and while playing, where a click on a neighbour is how a step is made.
    const edgesLive = mode === 'build' && onEdgeClick !== null;
    const cellsLive = (mode === 'build' || mode === 'play') && onCellClick !== null;
    // A board that stops listening must not keep a lit edge behind.
    for (const id of EDGE_ORDER) {
      toggleClass(parts.walls.get(id), 'is-hovered', false);
      toggleClass(parts.wallGlows.get(id), 'is-hovered', false);
    }
    toggleClass(root, 'board--cells-only', mode === 'build' && !edgesLive);
    toggleClass(root, 'board--edges-only', mode === 'build' && !cellsLive);
    for (const hit of parts.edgeHits.values()) {
      setFocusable(hit, edgesLive);
    }
    for (const hit of parts.cellHits) {
      setFocusable(hit, cellsLive);
    }
  }

  /**
   * @param {Element} node Hit zone.
   * @param {boolean} focusable Whether it takes keyboard focus.
   * @returns {void}
   */
  function setFocusable(node, focusable) {
    if (focusable) {
      node.setAttribute('tabindex', '0');
    } else {
      node.removeAttribute('tabindex');
    }
  }

  // ------------------------------------------------------------------ ink

  /** What the board is drawing with, or null while drawing is off. */
  let brush = null;
  /** The stroke being drawn, and the path showing it as it grows. */
  let live = null;
  let livePath = null;

  /**
   * Turns a pointer event into a point in board units.
   *
   * The board scales with the window, so screen pixels mean nothing here; the
   * matrix the browser already keeps is the exact way back (SPEC 5.7).
   *
   * @param {PointerEvent} event The event.
   * @returns {{x: number, y: number}|null} The point, or null off the board.
   */
  function boardPoint(event) {
    const matrix = root.getScreenCTM();
    if (matrix === null) {
      return null;
    }
    const point = root.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const inside = point.matrixTransform(matrix.inverse());
    return { x: inside.x, y: inside.y };
  }

  /**
   * @param {PointerEvent} event Pointer going down on the surface.
   * @returns {void}
   */
  function handleInkDown(event) {
    if (brush === null || !brush.canDraw()) {
      return;
    }
    const point = boardPoint(event);
    if (point === null) {
      return;
    }
    event.preventDefault();
    // The stroke follows the finger even when it leaves the board. A pointer
    // that is already gone cannot be captured, and that is not a reason to
    // lose the stroke.
    try {
      parts.inkSurface.setPointerCapture(event.pointerId);
    } catch {
      // Nothing to capture; the stroke still records.
    }
    live = { side: brush.side, colour: brush.colour, width: brush.width, points: [] };
    live.points = addPoint(live.points, point.x, point.y);
    livePath = svgEl('path', {
      class: 'board__stroke',
      attrs: { d: strokePath(live.points), stroke: brush.colour, 'stroke-width': String(brush.width) },
    });
    parts.ink.appendChild(livePath);
  }

  /**
   * @param {PointerEvent} event Pointer moving.
   * @returns {void}
   */
  function handleInkMove(event) {
    if (live === null) {
      return;
    }
    const point = boardPoint(event);
    if (point === null) {
      return;
    }
    event.preventDefault();
    const before = live.points.length;
    live.points = addPoint(live.points, point.x, point.y);
    if (live.points.length !== before) {
      livePath.setAttribute('d', strokePath(live.points));
    }
  }

  /**
   * @param {PointerEvent} event Pointer coming up, or lost.
   * @returns {void}
   */
  function handleInkUp(event) {
    if (live === null) {
      return;
    }
    if (parts.inkSurface.hasPointerCapture?.(event.pointerId)) {
      parts.inkSurface.releasePointerCapture(event.pointerId);
    }
    const finished = live;
    live = null;
    livePath = null;
    // The live path is thrown away: the state comes back through `renderInk`,
    // so there is one drawing on screen, not two.
    brush?.onStroke(finished);
  }

  parts.inkSurface.addEventListener('pointerdown', handleInkDown);
  parts.inkSurface.addEventListener('pointermove', handleInkMove);
  parts.inkSurface.addEventListener('pointerup', handleInkUp);
  parts.inkSurface.addEventListener('pointercancel', handleInkUp);

  applyMode();
  container.appendChild(root);

  return {
    // The element itself, so that the export can take a copy of it.
    root,

    render(model) {
      const view = normalizeBoardModel(model);

      for (let index = 0; index < parts.cellRects.length; index += 1) {
        const rect = parts.cellRects[index];
        toggleClass(rect, 'is-visited', view.visitedCells.has(index));
        toggleClass(rect, 'is-hidden', view.hiddenCells.has(index));
        toggleClass(rect, 'is-highlighted', view.highlight.cells.has(index));
        toggleClass(parts.cellDots[index], 'is-visited', view.visitedCells.has(index));
        // A highlighted cell is one the pawn may step onto, so its hit zone is
        // the only one that behaves like a target while playing, and its ring
        // is drawn above everything else on the cell.
        toggleClass(parts.cellHits[index], 'is-available', view.highlight.cells.has(index));
        toggleClass(parts.cellRings[index], 'is-available', view.highlight.cells.has(index));
      }

      for (const id of EDGE_ORDER) {
        const isWall = view.walls.has(id) || view.knownWalls.has(id);
        const highlighted = view.highlight.edges.has(id);
        for (const node of [parts.walls.get(id), parts.wallGlows.get(id)]) {
          toggleClass(node, 'is-wall', isWall);
          toggleClass(node, 'is-known', view.knownWalls.has(id));
          toggleClass(node, 'is-highlighted', highlighted);
        }
        toggleClass(parts.passages.get(id), 'is-open', view.knownPassages.has(id));
      }

      placeMark(parts.entrance, view.entrance, placeByCentre);
      placeMark(parts.exit, view.exit, placeByTransform);
      placeMark(parts.tokens.me, view.tokens.me, placeByCentre);
      placeMark(parts.tokens.opponent, view.tokens.opponent, placeByCentre);
    },

    /**
     * Draws the strokes of this board.
     *
     * @param {Array<object>} strokes Every stroke of the game.
     * @param {string} side Which board this is.
     * @returns {void}
     */
    renderInk(strokes, side) {
      clear(parts.ink);
      for (const stroke of strokesOf(strokes, side)) {
        parts.ink.appendChild(
          svgEl('path', {
            class: 'board__stroke',
            attrs: {
              d: strokePath(stroke.points),
              stroke: stroke.colour,
              'stroke-width': String(stroke.width),
            },
          }),
        );
      }
      live = null;
      livePath = null;
    },

    /**
     * Switches drawing on or off (SPEC 5.7).
     *
     * While it is on the surface takes every pointer, so the game underneath
     * hears nothing - which is the point: a line drawn across the board must
     * not also be a move.
     *
     * @param {object|null} config Brush and callback, or null to switch off.
     * @returns {void}
     */
    setDrawing(config) {
      brush = config === null ? null : { canDraw: () => true, ...config };
      toggleClass(root, 'board--drawing', brush !== null);
      if (brush === null) {
        live = null;
        livePath = null;
      }
    },

    setMode(next) {
      if (!BOARD_MODES.includes(next)) {
        throw new Error(`board mode must be one of ${BOARD_MODES.join(', ')}, got ${String(next)}`);
      }
      mode = next;
      applyMode();
    },

    destroy() {
      root.removeEventListener('click', handleClick);
      root.removeEventListener('keydown', handleKeydown);
      root.removeEventListener('pointerover', handleOver);
      root.removeEventListener('pointerout', handleOut);
      root.removeEventListener('focusin', handleOver);
      root.removeEventListener('focusout', handleOut);
      root.remove();
    },
  };
}

/**
 * Positions a shape by its centre point.
 *
 * @param {Element} node Shape with cx and cy.
 * @param {number} x Centre x.
 * @param {number} y Centre y.
 * @returns {void}
 */
function placeByCentre(node, x, y) {
  node.setAttribute('cx', String(x));
  node.setAttribute('cy', String(y));
}

/**
 * Positions a group by translating it.
 *
 * @param {Element} node Group drawn around the origin.
 * @param {number} x Centre x.
 * @param {number} y Centre y.
 * @returns {void}
 */
function placeByTransform(node, x, y) {
  node.setAttribute('transform', `translate(${x} ${y})`);
}

/**
 * Moves a marker and its glow underlay to a cell, or hides them when there is
 * no cell.
 *
 * @param {Element[]} nodes Marker elements, glow first.
 * @param {number|null} index Cell index or null.
 * @param {(node: Element, x: number, y: number) => void} place How to position
 *   this particular marker.
 * @returns {void}
 */
function placeMark(nodes, index, place) {
  if (index === null) {
    for (const node of nodes) {
      node.classList.remove('is-placed');
    }
    return;
  }
  const { r, c } = indexToCell(index);
  for (const node of nodes) {
    place(node, columnX(c) + CELL / 2, rowY(r) + CELL / 2);
    node.classList.add('is-placed');
  }
}
