/**
 * The themes. A preset that forgets a token does not fail loudly: it paints
 * black text on a black background, and somebody notices by accident three
 * parts later. So the token list is read out of `src/ui/theme.js` - one place,
 * never retyped here - and every preset is held against it.
 *
 * The second test reads the stylesheets and looks for colours written by hand
 * instead of through a token. That is the other way a theme quietly stops
 * being a theme.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_THEME,
  THEMES,
  THEME_TOKENS,
  applyTheme,
  contrastRatio,
  isTheme,
  parseColour,
  themeDefaults,
} from '../src/ui/theme.js';
import { createDefaultState, deserializeState, resetState, serializeState } from '../src/ui/store.js';

const STYLES = fileURLToPath(new URL('../src/styles/', import.meta.url));
const TOKENS_CSS = readFileSync(`${STYLES}tokens.css`, 'utf8');
const APP_CSS = readFileSync(`${STYLES}app.css`, 'utf8');
const BOARD_CSS = readFileSync(`${STYLES}board.css`, 'utf8');

/**
 * Splits a stylesheet into `{selector, body}` pairs. Good enough for these
 * files: they hold no nested rules apart from media queries, which are peeled
 * off first.
 *
 * @param {string} css Stylesheet source.
 * @returns {Array<{selector: string, body: string}>} The rules.
 */
function readRules(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const flat = withoutComments.replace(/@media[^{]*\{/g, '');
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(flat)) !== null) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

/**
 * Every custom property a set of rules declares.
 *
 * @param {Array<{selector: string, body: string}>} rules Rules to look in.
 * @param {(selector: string) => boolean} keep Which selectors count.
 * @returns {Map<string, string>} Token to its last value.
 */
function declaredTokens(rules, keep) {
  const found = new Map();
  for (const rule of rules) {
    if (!keep(rule.selector)) {
      continue;
    }
    for (const line of rule.body.split(';')) {
      const declaration = /^\s*(--[\w-]+)\s*:\s*(.+)$/s.exec(line);
      if (declaration !== null) {
        found.set(declaration[1], declaration[2].trim());
      }
    }
  }
  return found;
}

const RULES = readRules(TOKENS_CSS);

/**
 * The tokens a theme ends up with for one role: what the theme block declares,
 * plus what the role block inside that theme declares.
 *
 * @param {string} id Theme id.
 * @param {string} role Role, '1' or '2'.
 * @returns {Map<string, string>} The tokens in force.
 */
function tokensOf(id, role) {
  const themeOnly = declaredTokens(RULES, (selector) =>
    selector
      .split(',')
      .some((part) => part.includes(`[data-theme="${id}"]`) && !part.includes('data-role')),
  );
  const roleOnly = declaredTokens(RULES, (selector) =>
    selector
      .split(',')
      .some((part) => part.includes(`[data-theme="${id}"]`) && part.includes(`[data-role="${role}"]`)),
  );
  return new Map([...themeOnly, ...roleOnly]);
}

test('every preset declares every token, for both roles', () => {
  for (const theme of THEMES) {
    for (const role of ['1', '2']) {
      const tokens = tokensOf(theme.id, role);
      const missing = THEME_TOKENS.filter((token) => !tokens.has(token));
      assert.deepEqual(
        missing,
        [],
        `theme "${theme.id}", role ${role}: add these to tokens.css or the screen goes black on black`,
      );
    }
  }
});

test('no token is left pointing at a variable that theme does not define', () => {
  for (const theme of THEMES) {
    for (const role of ['1', '2']) {
      const tokens = tokensOf(theme.id, role);
      const dangling = [];
      for (const [name, value] of tokens) {
        for (const reference of value.matchAll(/var\((--[\w-]+)/g)) {
          if (!tokens.has(reference[1])) {
            dangling.push(`${name} -> ${reference[1]}`);
          }
        }
      }
      assert.deepEqual(dangling, [], `theme "${theme.id}", role ${role}`);
    }
  }
});

test('the rules use tokens, never a colour written out by hand', () => {
  // Colours belong to the themes. A hex in a rule is a colour one theme can
  // never change, and it is exactly what turns up as unreadable on a light
  // background.
  const offenders = [];
  for (const [name, css] of [
    ['app.css', APP_CSS],
    ['board.css', BOARD_CSS],
  ]) {
    for (const rule of readRules(css)) {
      for (const line of rule.body.split(';')) {
        if (/^\s*--/.test(line)) {
          continue;
        }
        const colour = /#[0-9a-f]{3,8}\b|\brgb\(|\bhsl\(/i.exec(line);
        // `rgba(0, 0, 0, var(--…))` is the one shape allowed: the scan lines
        // and the vignette are black veils whose strength is the token.
        const veiled = /rgba\(\s*0,\s*0,\s*0,\s*var\(--/.test(line);
        if (colour !== null && !veiled) {
          offenders.push(`${name}: ${rule.selector.slice(0, 40)} { ${line.trim().slice(0, 50)} }`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], 'these colours cannot be changed by a theme');
});

test('the default theme is a preset and comes with the terminal dressing', () => {
  assert.equal(isTheme(DEFAULT_THEME), true);
  assert.deepEqual(themeDefaults(DEFAULT_THEME), { crtOn: true, rainOn: true });
  assert.equal(isTheme('nothing-like-this'), false);
});

test('switching a theme brings its own idea of the dressing', () => {
  const state = { ...createDefaultState(), crtOn: true, rainOn: true };
  const light = applyTheme(state, 'light');
  assert.equal(light.theme, 'light');
  assert.equal(light.crtOn, false, 'scan lines on a light theme look like a printing fault');
  assert.equal(light.rainOn, false);
  const amber = applyTheme(light, 'amber');
  assert.equal(amber.crtOn, true, 'the amber monitor is the one theme that wants them');
  assert.equal(amber.rainOn, true);
  assert.equal(applyTheme(amber, 'amber'), amber, 'switching to the same theme changes nothing');
  assert.throws(() => applyTheme(state, 'neon'), /unknown theme/);
});

test('a switch the player flipped by hand survives until the theme changes', () => {
  // The recommendation is applied on the switch of theme and not afterwards:
  // `applyTheme` is the only place that touches the two flags.
  const amber = applyTheme(createDefaultState(), 'amber');
  const byHand = { ...amber, crtOn: false };
  assert.equal(applyTheme(byHand, 'amber'), byHand);
});

test('the chosen theme survives a reload and a reset of the fields', () => {
  const state = applyTheme(createDefaultState(), 'paper');
  assert.equal(deserializeState(serializeState(state)).theme, 'paper');
  assert.equal(resetState(state).theme, 'paper', 'a theme is a preference, not part of a game');
  // Something that is not a preset cannot come back out of storage.
  assert.equal(deserializeState({ ...serializeState(state), theme: 'neon' }).theme, DEFAULT_THEME);
});

test('contrast is computed, not guessed', () => {
  assert.equal(contrastRatio('#ffffff', '#000000'), 21);
  assert.equal(contrastRatio('#000000', '#000000'), 1);
  assert.equal(Math.round(contrastRatio('#777777', '#ffffff') * 100) / 100, 4.48);
  // The order of the arguments must not matter.
  assert.equal(contrastRatio('#00e5ff', '#000a12'), contrastRatio('#000a12', '#00e5ff'));
  assert.deepEqual(parseColour('#abc'), [170, 187, 204]);
  assert.deepEqual(parseColour('rgba(1, 2, 3, 0.5)'), [1, 2, 3]);
  assert.equal(parseColour('var(--bg)'), null);
  assert.equal(contrastRatio('var(--bg)', '#000000'), null);
});

test('the text of every theme is readable, and the found wall is loud', () => {
  const report = [];
  for (const theme of THEMES) {
    for (const role of ['1', '2']) {
      const tokens = tokensOf(theme.id, role);
      const bg = tokens.get('--bg');
      const body = contrastRatio(tokens.get('--text-body'), bg);
      // SPEC 5.13 asks for at least 7:1 for body text, and 10:1 on the light
      // themes, where a low ratio is felt at once.
      const floor = theme.id === 'light' || theme.id === 'paper' ? 10 : 7;
      assert.equal(
        body >= floor,
        true,
        `${theme.id}/${role}: body text is ${body?.toFixed(2)} to the background, wanted ${floor}`,
      );
      // A wall you ran into has to be the loudest thing on the board (SPEC 5.6).
      const found = contrastRatio(tokens.get('--board-wall-found'), tokens.get('--board-bg'));
      assert.equal(
        found >= 9,
        true,
        `${theme.id}/${role}: the found wall is ${found?.toFixed(2)} to the board, wanted 9`,
      );
      report.push(`${theme.id}/${role}: body ${body.toFixed(2)}, found wall ${found.toFixed(2)}`);
    }
  }
  assert.equal(report.length, THEMES.length * 2);
});
