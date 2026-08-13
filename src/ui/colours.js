/**
 * colours.js - the pure half of the two colour panels: what a colour is
 * allowed to be, which tokens each panel owns, and what is worth warning
 * about.
 *
 * Every value here ends up in `style.setProperty()`, so nothing reaches the
 * DOM without going through {@link normalizeColour} first. The check is ours,
 * not the browser's: a value the browser merely ignores is a value we have
 * already written into the state and will write again on the next reload.
 *
 * The two panels never share a token (SPEC 5.5, 5.6): the board panel owns
 * `--board-*`, the theme editor owns the shell. A token in both would mean two
 * places to change one colour and no way to tell which won.
 */

import { contrastRatio, parseColour } from './theme.js';

/** The only shapes a colour may have: #rgb, #rrggbb, #rrggbbaa. */
export const COLOUR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * The colours of the board, in the order the panel shows them (SPEC 5.6).
 *
 * Ends first, then the pieces, then the walls, then the quiet lines: the order
 * a player looks for them in.
 */
export const BOARD_TOKENS = Object.freeze([
  '--board-entrance',
  '--board-exit',
  '--board-token-me',
  '--board-token-opponent',
  '--board-wall',
  '--board-wall-found',
  '--board-passage',
  '--board-grid',
  '--board-label',
  '--board-bg',
]);

/**
 * Tells whether a value may be handed to `setProperty`.
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True when it is a colour of an allowed shape.
 */
export function isColourValue(value) {
  return typeof value === 'string' && COLOUR_PATTERN.test(value.trim());
}

/**
 * The value to write, or null when there is nothing safe to write.
 *
 * @param {unknown} value Candidate.
 * @returns {string|null} The trimmed, lower case colour, or null.
 */
export function normalizeColour(value) {
  return isColourValue(value) ? value.trim().toLowerCase() : null;
}

/**
 * Keeps the overrides that are both known and valid.
 *
 * Storage is untrusted (SPEC 5.2): an unknown token would end up as a custom
 * property nobody reads, and a bad value would be written to the DOM on every
 * load.
 *
 * @param {unknown} raw Whatever was stored.
 * @param {readonly string[]} allowed Tokens this panel owns.
 * @returns {object} Token to colour, with everything else dropped.
 */
export function readColourMap(raw, allowed) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const kept = {};
  for (const token of allowed) {
    const colour = normalizeColour(raw[token]);
    if (colour !== null) {
      kept[token] = colour;
    }
  }
  return kept;
}

/**
 * How far apart two colours are, plainly: the distance between them in RGB.
 *
 * Contrast alone does not answer "do these look the same": cyan and orange sit
 * at 1.68 and could not look less alike. For "my wall and the wall I ran into
 * are now the same thing" the question really is distance.
 *
 * @param {string} first CSS colour.
 * @param {string} second CSS colour.
 * @returns {number|null} 0..441, or null when a colour cannot be read.
 */
export function colourDistance(first, second) {
  const a = parseColour(first);
  const b = parseColour(second);
  if (a === null || b === null) {
    return null;
  }
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Below this the two kinds of wall stop being two kinds of wall. */
export const ALIKE_DISTANCE = 60;

/** Below this a line on the board is not reliably visible on it. */
export const MIN_BOARD_CONTRAST = 3;

/**
 * What is worth telling the player about the colours they have chosen.
 *
 * Nothing here forbids anything: these are their colours. But a wall that
 * cannot be seen on the board, or a found wall that looks like an ordinary
 * one, costs them a game, so the panel says so out loud (SPEC 5.6).
 *
 * @param {object} resolved Token to the colour actually in force.
 * @returns {Array<{code: string, token?: string, value?: number}>} The
 *   warnings, in a fixed order so the panel does not jump about.
 */
export function boardWarnings(resolved) {
  const warnings = [];
  const background = resolved['--board-bg'];

  for (const token of BOARD_TOKENS) {
    if (token === '--board-bg' || token === '--board-grid') {
      // The grid is meant to be almost invisible (SPEC 5.13); warning about it
      // would be warning about the design.
      continue;
    }
    const ratio = contrastRatio(resolved[token], background);
    if (ratio !== null && ratio < MIN_BOARD_CONTRAST) {
      warnings.push({ code: 'LOW_CONTRAST', token, value: ratio });
    }
  }

  const distance = colourDistance(resolved['--board-wall'], resolved['--board-wall-found']);
  if (distance !== null && distance < ALIKE_DISTANCE) {
    warnings.push({ code: 'WALLS_ALIKE', value: distance });
  }

  return warnings;
}
