/**
 * export.js - the two things a finished game can be saved as (SPEC 5.9).
 *
 * PNG is both boards in one picture. The path is the usual one - serialise the
 * SVG, put it in a Blob, load it into an Image, draw it on a canvas, ask the
 * canvas for a PNG - and it has one trap that makes the difference between a
 * picture and a black rectangle:
 *
 *   **a detached SVG has no `:root`.** Every colour in this project comes from
 *   a token, and the tokens live on the document. The moment the markup is
 *   serialised it is outside the document, every `var(--x)` resolves to
 *   nothing, and the browser paints the lot black - or nothing at all. So the
 *   clone carries no CSS: each element is given the values the browser had
 *   already computed for it, as attributes. {@link assertNoVariables} then
 *   refuses to serialise anything that still mentions a variable, because that
 *   is a bug that produces a file rather than an error.
 *
 * Two smaller traps, both handled here: an SVG has no background of its own, so
 * the theme's background is painted under it; and the font is not inherited
 * from a page that is no longer there, so it is written onto the root.
 *
 * JSON is the archive of a game. It is for reading, never for loading back
 * (SPEC 5.9): reading a game record supplied by somebody else would be taking
 * untrusted input for no gain at all.
 */

import { downloadBlob, downloadText } from './download.js';
import { totalMoves } from '../core/game.js';
import { cellToLabel } from '../core/edges.js';
import { renderLogEntryEn } from '../core/game.js';

/** Version of the archive format. Bumped when a field changes meaning. */
export const ARCHIVE_VERSION = 1;

/**
 * Properties copied onto every element of the clone.
 *
 * Everything that decides how a shape is painted, and nothing else: geometry
 * is already in the attributes, and layout does not exist inside an SVG.
 */
export const PAINT_PROPERTIES = Object.freeze([
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'visibility',
  'display',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
]);

/**
 * Refuses markup that still mentions a custom property.
 *
 * Called before anything is serialised. A `var()` that reaches this point
 * would not throw in the browser - it would quietly paint black, and the
 * player would get a file that looks like a bug in their viewer.
 *
 * @param {string} markup Serialised SVG.
 * @returns {string} The same markup.
 * @throws {Error} If a variable survived.
 */
export function assertNoVariables(markup) {
  const found = /var\(\s*--[\w-]+/.exec(markup);
  if (found !== null) {
    throw new Error(
      `the picture still refers to ${found[0]}): a detached SVG cannot resolve tokens, ` +
        'so this would export as a black rectangle',
    );
  }
  return markup;
}

/**
 * The name a saved file gets: what it is, and when it was made.
 *
 * @param {string} extension File extension without the dot.
 * @param {Date} [now=new Date()] When it is being saved.
 * @returns {string} The file name.
 */
export function exportFileName(extension, now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `usogui-maze-${stamp}.${extension}`;
}

/**
 * A maze as the archive records it.
 *
 * @param {object} maze Entrance, exit and walls.
 * @returns {object} Plain, readable description.
 */
function archiveMaze(maze) {
  return {
    entrance: maze.entrance === null ? null : cellToLabel(maze.entrance.r, maze.entrance.c),
    exit: maze.exit === null ? null : cellToLabel(maze.exit.r, maze.exit.c),
    walls: [...maze.walls].sort(),
  };
}

/**
 * Builds the archive of a game.
 *
 * The opponent's maze is only in it when the reveal has actually been checked.
 * When it has not, the archive says so in a field of its own rather than
 * leaving the key out: somebody reading the file should not have to guess
 * whether the maze is absent or lost.
 *
 * @param {object} options What to archive.
 * @param {object} options.state Application state.
 * @param {object|null} options.game Core game state, replayed from the journal.
 * @param {object|null} [options.report] Report of `verifyReveal`, if it ran.
 * @param {object|null} [options.revealed] The revealed maze, if it was checked.
 * @param {Date} [options.now] When the archive is made.
 * @returns {object} The archive, ready for `JSON.stringify`.
 */
export function buildArchive({ state, game, report = null, revealed = null, now = new Date() }) {
  const opponentKnown = revealed !== null && revealed !== undefined;
  return {
    format: 'usogui-maze-archive',
    version: ARCHIVE_VERSION,
    // Said in the file itself, so that nobody writes an importer for it.
    note: 'A record of a finished game, for reading. This application never loads it back.',
    savedAt: now.toISOString(),
    settings: state.settings === null ? null : { ...state.settings },
    settingsCode: state.settingsCode,
    myPlayer: state.myPlayer,
    commit: state.commit === null ? null : state.commit.commitCode,
    opponentCommit: state.opponentCommit === null ? null : state.opponentCommit.code,
    myMaze: archiveMaze(state.myMaze),
    // Either the maze, or the reason it is not here. Never a missing key.
    opponentMaze: opponentKnown ? archiveMaze(revealed.maze) : null,
    opponentMazeKnown: opponentKnown,
    opponentMazeMissingReason: opponentKnown
      ? null
      : 'the reveal was never received or never checked, so this device has never seen that maze',
    opponentEnds: {
      entrance:
        state.opponentEnds.entrance === null
          ? null
          : cellToLabel(state.opponentEnds.entrance.r, state.opponentEnds.entrance.c),
      exit:
        state.opponentEnds.exit === null
          ? null
          : cellToLabel(state.opponentEnds.exit.r, state.opponentEnds.exit.c),
    },
    moves: game === null ? 0 : totalMoves(game),
    history:
      game === null
        ? []
        : game.history.map((entry) => ({
            move: entry.move,
            side: entry.side,
            type: entry.type,
            steps: (entry.steps ?? []).map((step) => ({
              from: cellToLabel(step.from.r, step.from.c),
              to: cellToLabel(step.to.r, step.to.c),
              answer: step.answer ?? null,
              auto: step.auto === true,
            })),
            wall: entry.wall ?? null,
            text: renderLogEntryEn(entry),
          })),
    journal: state.gameActions.map((action) => ({ ...action })),
    report:
      report === null
        ? null
        : {
            ok: report.ok,
            violated: report.violated,
            steps: report.steps.map((step) => ({
              step: step.step,
              code: step.code,
              status: step.status,
            })),
            mismatches: report.mismatches.map((item) => ({ ...item })),
          },
    verdict: report === null || report.verdict === null ? null : { ...report.verdict },
  };
}

/**
 * Copies the computed paint of one element onto its clone.
 *
 * @param {Element} source Element in the document.
 * @param {Element} clone The copy that will be serialised.
 * @param {(node: Element) => CSSStyleDeclaration} getStyle Style reader.
 * @returns {void}
 */
function inlinePaint(source, clone, getStyle) {
  const computed = getStyle(source);
  for (const property of PAINT_PROPERTIES) {
    const value = computed.getPropertyValue(property);
    if (value !== '' && value !== 'auto' && !value.includes('var(')) {
      clone.setAttribute(property, value.trim());
    }
  }
}

/**
 * Clones a board and bakes every colour into it.
 *
 * @param {SVGElement} board The board on screen.
 * @param {(node: Element) => CSSStyleDeclaration} getStyle Style reader.
 * @returns {SVGElement} A clone that needs no stylesheet.
 */
export function bakeBoard(board, getStyle) {
  const clone = board.cloneNode(true);
  const sources = [board, ...board.querySelectorAll('*')];
  const clones = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < sources.length; i += 1) {
    inlinePaint(sources[i], clones[i], getStyle);
    clones[i].removeAttribute('class');
  }
  return clone;
}

/**
 * Builds the whole picture: two boards side by side, each with its caption,
 * on the background of the theme.
 *
 * @param {object} options What to draw.
 * @param {Array<{board: SVGElement, caption: string}>} options.panels The two
 *   boards, in the order they are shown on screen.
 * @param {string} options.background Colour under everything.
 * @param {string} options.ink Colour of the captions.
 * @param {string} options.font Font stack, written onto the root.
 * @param {(node: Element) => CSSStyleDeclaration} options.getStyle Style reader.
 * @returns {SVGElement} The picture, ready to serialise.
 */
export function composePicture({ panels, background, ink, font, getStyle }) {
  const SIZE = 680;
  const PAD = 40;
  const CAPTION = 56;
  const width = PAD + panels.length * SIZE + (panels.length - 1) * PAD + PAD;
  const height = PAD + CAPTION + SIZE + PAD;
  const ns = 'http://www.w3.org/2000/svg';

  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('xmlns', ns);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('viewBox', `0 0 ${width} ${height}`);
  // The page it came from is gone; the font has to travel with the picture.
  root.setAttribute('font-family', font);

  // An SVG is transparent, and a transparent picture on a white viewer is a
  // picture of nothing.
  const sheet = document.createElementNS(ns, 'rect');
  sheet.setAttribute('x', '0');
  sheet.setAttribute('y', '0');
  sheet.setAttribute('width', String(width));
  sheet.setAttribute('height', String(height));
  sheet.setAttribute('fill', background);
  root.appendChild(sheet);

  panels.forEach((panel, index) => {
    const x = PAD + index * (SIZE + PAD);
    const caption = document.createElementNS(ns, 'text');
    caption.setAttribute('x', String(x));
    caption.setAttribute('y', String(PAD + 28));
    caption.setAttribute('fill', ink);
    caption.setAttribute('font-size', '26');
    caption.setAttribute('font-family', font);
    caption.textContent = panel.caption;
    root.appendChild(caption);

    const group = document.createElementNS(ns, 'g');
    group.setAttribute('transform', `translate(${x} ${PAD + CAPTION})`);
    const baked = bakeBoard(panel.board, getStyle);
    baked.setAttribute('width', String(SIZE));
    baked.setAttribute('height', String(SIZE));
    baked.removeAttribute('style');
    group.appendChild(baked);
    root.appendChild(group);
  });

  return root;
}

/**
 * Turns the picture into a PNG.
 *
 * @param {SVGElement} picture What {@link composePicture} built.
 * @param {number} [scale=2] How many pixels per unit of the picture.
 * @returns {Promise<Blob>} The PNG.
 * @throws {Error} If a token survived, or the browser refuses to draw it.
 */
export async function pictureToPng(picture, scale = 2) {
  const markup = assertNoVariables(new XMLSerializer().serializeToString(picture));
  const width = Number(picture.getAttribute('width'));
  const height = Number(picture.getAttribute('height'));
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.addEventListener('load', () => resolve(element));
      element.addEventListener('error', () => reject(new Error('the picture could not be drawn')));
      element.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) {
          reject(new Error('the canvas produced no image'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Makes the picture of both boards and saves it.
 *
 * The one call the screens make: they know which boards and what to call
 * them, and nothing else about how a picture is built.
 *
 * @param {Array<{board: SVGElement, caption: string}>} panels The two boards.
 * @param {Date} [now=new Date()] For the file name.
 * @returns {Promise<boolean>} True when the browser was asked to save.
 * @throws {Error} If the picture cannot be made; the caller says so on screen.
 */
export async function saveBoardsPng(panels, now = new Date()) {
  const computed = getComputedStyle(document.documentElement);
  const token = (name) => computed.getPropertyValue(name).trim();
  const picture = composePicture({
    panels,
    background: token('--bg'),
    ink: token('--text-body'),
    font: token('--font-display'),
    getStyle: (node) => getComputedStyle(node),
  });
  const blob = await pictureToPng(picture);
  return downloadBlob(exportFileName('png', now), blob);
}

/**
 * Saves the archive of a game.
 *
 * @param {object} options Same shape as {@link buildArchive} takes.
 * @returns {boolean} True when the browser was asked to save.
 */
export function saveArchiveJson(options) {
  const archive = buildArchive(options);
  return downloadText(
    exportFileName('json', options.now),
    `${JSON.stringify(archive, null, 2)}\n`,
    'application/json;charset=utf-8',
  );
}
