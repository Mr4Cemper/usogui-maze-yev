/**
 * validationPanel.js - the five checks of SPEC 1.5, as lines on screen.
 *
 * The panel never decides anything: it renders whatever `validateMaze`
 * returned. All problems are shown at once, and `NO_PATH` is shown last
 * because a sealed entrance or exit always drags it along, and the cause is
 * more useful than the consequence.
 */

import { clear, el, setText } from '../dom.js';
import { t } from '../../i18n/index.js';

/**
 * Text for one problem code of SPEC 1.5.
 *
 * @param {string} code Problem code.
 * @returns {string} A line for the player.
 */
export function describeProblem(code) {
  switch (code) {
    case 'ENTRANCE_MISSING':
      return t('validate.ENTRANCE_MISSING');
    case 'EXIT_MISSING':
      return t('validate.EXIT_MISSING');
    case 'ENTRANCE_EQUALS_EXIT':
      return t('validate.ENTRANCE_EQUALS_EXIT');
    case 'WALL_LIMIT_EXCEEDED':
      return t('validate.WALL_LIMIT_EXCEEDED');
    case 'ENTRANCE_SEALED':
      return t('validate.ENTRANCE_SEALED');
    case 'EXIT_SEALED':
      return t('validate.EXIT_SEALED');
    case 'NO_PATH':
      return t('validate.NO_PATH');
    default:
      return t('validate.UNKNOWN');
  }
}

/**
 * Orders problems for display: causes first, `NO_PATH` last (SPEC 1.5).
 *
 * @param {string[]} problems Codes as the core returned them.
 * @returns {string[]} The same codes, ordered for reading.
 */
export function orderProblems(problems) {
  const rest = problems.filter((code) => code !== 'NO_PATH');
  const noPath = problems.filter((code) => code === 'NO_PATH');
  return [...rest, ...noPath];
}

/**
 * Builds the panel.
 *
 * @param {object} [options={}] Panel options.
 * @param {string} [options.title] Heading text, already translated.
 * @returns {{root: HTMLElement, update: (result: object|null) => void}} The
 *   element and its updater. `update(null)` means "nothing to check yet".
 */
export function createValidationPanel(options = {}) {
  const { title = t('validate.title') } = options;
  const list = el('ul', { class: 'problem-list' });
  const root = el('section', { class: 'panel' }, [
    el('h3', { class: 'panel__title', text: title }),
    list,
  ]);

  return {
    root,
    update(result) {
      clear(list);
      if (result === null) {
        list.appendChild(
          el('li', { class: 'problem-list__item is-consequence' }, [
            el('span', { class: 'problem-list__marker', text: '·' }),
            el('span', { text: t('validate.pending') }),
          ]),
        );
        return;
      }
      if (result.ok) {
        list.appendChild(
          el('li', { class: 'problem-list__item is-ok' }, [
            el('span', { class: 'problem-list__marker', text: '✓' }),
            el('span', { text: t('validate.ok') }),
          ]),
        );
        return;
      }
      // The verdict of the panel comes first and the reasons follow: a list of
      // problems with no line above it makes the reader work out for himself
      // what the list adds up to.
      list.appendChild(
        el('li', { class: 'problem-list__item is-failed' }, [
          el('span', { class: 'problem-list__marker', text: '×' }),
          el('span', { text: t('validate.failed') }),
        ]),
      );
      const ordered = orderProblems(result.problems);
      const sealed =
        result.problems.includes('ENTRANCE_SEALED') || result.problems.includes('EXIT_SEALED');
      for (const code of ordered) {
        const consequence = code === 'NO_PATH' && sealed;
        const item = el('li', {
          class: `problem-list__item${consequence ? ' is-consequence' : ''}`,
        });
        item.appendChild(el('span', { class: 'problem-list__marker', text: consequence ? '·' : '×' }));
        const text = el('span');
        setText(text, consequence ? t('validate.NO_PATH_consequence') : describeProblem(code));
        item.appendChild(text);
        list.appendChild(item);
      }
    },
  };
}
