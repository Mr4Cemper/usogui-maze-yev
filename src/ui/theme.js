/**
 * theme.js - the list of themes and the list of tokens they have to fill in.
 *
 * A theme is nothing but values: every rule in the stylesheets reads a token,
 * so a preset that declares them all cannot break the layout, and a preset
 * that forgets one paints black text on a black background - which is why
 * `tests/ui-theme.test.mjs` reads {@link THEME_TOKENS} and checks every preset
 * against it (SPEC 5.5, 5.11).
 *
 * The names live here rather than in the test, so that adding a token is one
 * edit and the test starts demanding it everywhere at once.
 */

import { t } from '../i18n/index.js';

/**
 * Every custom property a preset must declare, in the order of SPEC 5.11.
 *
 * Three of them - `--acc-dim`, `--acc-dark`, `--hover` - were used by the
 * rules before they were written down; they are part of the contract now.
 * `--board-wall-found` and `--stroke-wall-found-glow` are new (SPEC 5.6).
 */
export const THEME_TOKENS = Object.freeze([
  // Shell
  '--bg',
  '--bg-elevated',
  '--surface',
  '--border',
  '--text',
  '--text-body',
  '--text-muted',
  '--accent',
  '--accent-contrast',
  '--ok',
  '--warn',
  '--error',
  '--focus-ring',
  '--hover',
  '--acc-dim',
  '--acc-dark',
  // Board
  '--board-bg',
  '--board-grid',
  '--board-label',
  '--board-wall',
  '--board-wall-found',
  '--board-passage',
  '--board-entrance',
  '--board-exit',
  '--board-token-me',
  '--board-token-opponent',
  '--board-hover',
  '--board-unknown',
  // Metrics
  '--radius',
  '--gap',
  '--font-display',
  '--font-ui',
  '--font-mono',
  '--stroke-grid',
  '--stroke-wall',
  '--stroke-wall-glow',
  '--stroke-wall-found-glow',
  '--stroke-passage',
  // Glow and letter spacing
  '--glow-sm',
  '--glow-md',
  '--glow-lg',
  '--track-tight',
  '--track-wide',
  '--track-hero',
  // Cathode ray tube
  '--scanline-opacity',
  '--vignette-strength',
  '--rain-opacity',
]);

/**
 * The presets.
 *
 * `crt` and `rain` are what the theme asks for, not what the player is stuck
 * with: switching themes applies them, and the switches in the interface panel
 * override them until the next switch of theme (SPEC 5.5).
 */
export const THEMES = Object.freeze([
  Object.freeze({ id: 'xp-cyber', crt: true, rain: true }),
  Object.freeze({ id: 'dark', crt: false, rain: false }),
  Object.freeze({ id: 'light', crt: false, rain: false }),
  Object.freeze({ id: 'paper', crt: false, rain: false }),
  Object.freeze({ id: 'amber', crt: true, rain: true }),
]);

/** The theme a fresh application starts in. */
export const DEFAULT_THEME = 'xp-cyber';

/**
 * Tells whether a theme id is one of the presets.
 *
 * @param {unknown} id Candidate.
 * @returns {boolean} True when a preset carries that id.
 */
export function isTheme(id) {
  return typeof id === 'string' && THEMES.some((theme) => theme.id === id);
}

/**
 * What a theme asks the cathode ray tube effects and the rain to be.
 *
 * @param {string} id Theme id.
 * @returns {{crtOn: boolean, rainOn: boolean}} The recommendation.
 */
export function themeDefaults(id) {
  const theme = THEMES.find((item) => item.id === id) ?? THEMES[0];
  return { crtOn: theme.crt, rainOn: theme.rain };
}

/**
 * Switches the theme and takes its recommendations with it.
 *
 * Predictability beats keeping a manual switch alive: a light theme with scan
 * lines left on from the terminal theme looks like a printing fault, and the
 * player would have to guess which switch caused it (SPEC 5.5).
 *
 * @param {object} state Application state.
 * @param {string} id Theme to switch to.
 * @returns {object} The next state.
 * @throws {Error} If the theme is not a preset.
 */
export function applyTheme(state, id) {
  if (!isTheme(id)) {
    throw new Error(`unknown theme ${JSON.stringify(id)}`);
  }
  if (state.theme === id) {
    return state;
  }
  return { ...state, theme: id, ...themeDefaults(id) };
}

/**
 * The name of a theme, in the language on screen.
 *
 * @param {string} id Theme id.
 * @returns {string} The name.
 */
export function themeName(id) {
  switch (id) {
    case 'xp-cyber':
      return t('theme.xp-cyber');
    case 'dark':
      return t('theme.dark');
    case 'light':
      return t('theme.light');
    case 'paper':
      return t('theme.paper');
    case 'amber':
      return t('theme.amber');
    default:
      return id;
  }
}

/**
 * Reads a CSS colour into three channels.
 *
 * Only the notations the token files actually use: `#rgb`, `#rrggbb` and
 * `rgb()` / `rgba()`. An alpha channel is dropped rather than blended - a
 * translucent surface has no single contrast to report, and the caller is
 * asking about the colour it was given.
 *
 * @param {string} colour CSS colour.
 * @returns {[number, number, number]|null} Channels 0..255, or null.
 */
export function parseColour(colour) {
  const text = String(colour).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex !== null) {
    const digits = hex[1];
    const full =
      digits.length === 3
        ? [...digits].map((character) => character + character)
        : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
    return full.map((pair) => Number.parseInt(pair, 16));
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (rgb !== null) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

/**
 * Relative luminance, as WCAG defines it.
 *
 * @param {[number, number, number]} channels Channels 0..255.
 * @returns {number} Luminance 0..1.
 */
export function relativeLuminance(channels) {
  const [r, g, b] = channels.map((value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast between two colours, the number SPEC 5.13 sets thresholds on.
 *
 * @param {string} foreground CSS colour.
 * @param {string} background CSS colour.
 * @returns {number|null} The ratio, 1..21, or null when a colour is not
 *   readable as a colour.
 */
export function contrastRatio(foreground, background) {
  const first = parseColour(foreground);
  const second = parseColour(background);
  if (first === null || second === null) {
    return null;
  }
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}
