/**
 * components/colourPanel.js - a list of colour fields with a reset on each and
 * one on the panel.
 *
 * Both panels are the same thing over a different set of tokens: the board
 * colours (SPEC 5.6) and, later, the shell of a custom theme (SPEC 5.5). The
 * component knows nothing about either - it is handed fields, values and
 * warnings, and it hands back which token the player touched.
 *
 * The input is `<input type="color">` on purpose: it can only ever produce
 * `#rrggbb`, so there is no path from a keyboard to `setProperty`. The value
 * still goes through `normalizeColour` before it leaves this file.
 */

import { clear, el, setText, toggleClass } from '../dom.js';
import { normalizeColour } from '../colours.js';
import { parseColour } from '../theme.js';
import { t } from '../../i18n/index.js';

/**
 * Turns whatever a theme declared into something `<input type="color">` can
 * show: it understands `#rrggbb` and nothing else.
 *
 * @param {string} value CSS colour.
 * @returns {string} A six digit hex colour.
 */
export function toInputColour(value) {
  const channels = parseColour(value);
  if (channels === null) {
    return '#000000';
  }
  return `#${channels.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Builds a panel of colour fields.
 *
 * @param {object} options Options.
 * @param {string} options.title Heading, already translated.
 * @param {string} options.hint One line under the heading.
 * @param {Array<{token: string, label: string}>} options.fields What to show.
 * @param {(token: string, value: string) => void} options.onChange Called with
 *   a value that has already been checked.
 * @param {(token: string) => void} options.onReset Give one field back to the
 *   theme.
 * @param {() => void} options.onResetAll Give every field back to the theme.
 * @returns {{root: HTMLElement, update: (view: object) => void}} The element
 *   and its updater.
 */
export function createColourPanel({ title, hint, fields, onChange, onReset, onResetAll }) {
  const inputs = new Map();
  const resets = new Map();
  const rows = [];

  for (const field of fields) {
    const input = el('input', {
      class: 'colour-row__input',
      attrs: { type: 'color', 'aria-label': field.label },
      on: {
        input: () => {
          const value = normalizeColour(input.value);
          if (value !== null) {
            onChange(field.token, value);
          }
        },
      },
    });
    const reset = el('button', {
      class: 'colour-row__reset',
      text: t('colours.resetField'),
      attrs: { type: 'button', 'aria-label': `${t('colours.resetField')}: ${field.label}` },
      on: { click: () => onReset(field.token) },
    });
    inputs.set(field.token, input);
    resets.set(field.token, reset);
    rows.push(
      el('div', { class: 'colour-row' }, [
        el('label', { class: 'colour-row__label' }, [input, el('span', { text: field.label })]),
        reset,
      ]),
    );
  }

  const notices = el('div', { class: 'colour-panel__notices' });
  const resetAll = el('button', {
    text: t('colours.resetAll'),
    attrs: { type: 'button' },
    on: { click: () => onResetAll() },
  });

  const root = el('details', { class: 'colour-panel' }, [
    el('summary', { class: 'colour-panel__title', text: title }),
    el('p', { class: 'panel__hint', text: hint }),
    notices,
    el('div', { class: 'colour-panel__grid' }, rows),
    el('div', { class: 'button-row' }, [resetAll]),
  ]);

  return {
    root,

    /**
     * Draws the panel.
     *
     * @param {object} view What to show.
     * @param {object} view.values Token to the colour in force.
     * @param {object} view.overrides Token to the colour the player set.
     * @param {Array<string>} view.notices Lines to show above the fields.
     * @returns {void}
     */
    update({ values, overrides, notices: lines }) {
      for (const [token, input] of inputs) {
        const shown = toInputColour(values[token] ?? '#000000');
        // Writing the value while the picker is open would fight the player.
        if (document.activeElement !== input && input.value !== shown) {
          input.value = shown;
        }
        const touched = Object.prototype.hasOwnProperty.call(overrides, token);
        resets.get(token).disabled = !touched;
        toggleClass(inputs.get(token), 'is-overridden', touched);
      }
      resetAll.disabled = Object.keys(overrides).length === 0;

      clear(notices);
      for (const line of lines) {
        notices.appendChild(el('p', { class: 'status is-warn', text: line }));
      }
      notices.hidden = lines.length === 0;
    },
  };
}

/**
 * The line a warning turns into.
 *
 * Codes come from `boardWarnings`; the names of the fields come from the panel
 * that owns them, so the same warning reads correctly in both panels.
 *
 * @param {{code: string, token?: string, value?: number}} warning The warning.
 * @param {(token: string) => string} nameOf Field name by token.
 * @returns {string} The line.
 */
export function warningText(warning, nameOf) {
  switch (warning.code) {
    case 'LOW_CONTRAST':
      return t('colours.lowContrast', {
        name: nameOf(warning.token),
        ratio: warning.value.toFixed(1),
      });
    case 'WALLS_ALIKE':
      return t('colours.wallsAlike');
    default:
      // Codes come from `boardWarnings` in this repository, not from the core:
      // an unknown one is a mistake in the code, not a state to translate. It
      // shows as itself rather than costing three lines of translation.
      return warning.code;
  }
}

/**
 * Puts the overrides on an element, and takes back the ones that are gone.
 *
 * The only place a colour reaches the DOM. Everything that arrives here has
 * been through `normalizeColour`; anything else is removed rather than
 * written, so a value that slipped in earlier cannot survive a reload.
 *
 * @param {HTMLElement} node Element to style, normally the root.
 * @param {readonly string[]} tokens Every token this panel owns.
 * @param {object} overrides Token to colour.
 * @returns {void}
 */
export function applyColourOverrides(node, tokens, overrides) {
  for (const token of tokens) {
    const value = normalizeColour(overrides[token]);
    if (value === null) {
      node.style.removeProperty(token);
    } else {
      node.style.setProperty(token, value);
    }
  }
}
