/**
 * historyPanel.js - the two history blocks, "my moves" and "the opponent's
 * moves" (SPEC 3.2).
 *
 * The core stores history as structure and hands out no text at all, so the
 * line is built here, from the dictionary. `renderLogEntryEn` in the core is
 * for debugging and examples; it is deliberately not what the interface uses.
 */

import { cellToLabel } from '../../core/edges.js';
import { clear, el } from '../dom.js';
import { t } from '../../i18n/index.js';

/**
 * Renders one history entry as a line for the player.
 *
 * @param {{move: number, type: string, steps: Array<object>}} entry Entry from
 *   `state.history`.
 * @returns {string} A line such as `12. C3-C4; C4-C5; wall C5-C6`.
 * @throws {Error} If the entry is not a history entry.
 */
export function formatHistoryEntry(entry) {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`a history entry must be an object, got ${String(entry)}`);
  }
  if (!Number.isInteger(entry.move) || !Array.isArray(entry.steps)) {
    throw new Error('a history entry must carry a move number and a steps array');
  }

  const number = `${entry.move}.`;
  switch (entry.type) {
    case 'UNDO_STEP': {
      // A step that was taken back never reached the core, so this line is the
      // only trace of it. It is written on purpose: the archive is allowed to
      // show a correction, it is not allowed to lie.
      const step = entry.steps[0];
      return `${number} ${t('history.stepTakenBack', {
        from: cellToLabel(step.from.r, step.from.c),
        to: cellToLabel(step.to.r, step.to.c),
      })}`;
    }
    case 'PASS':
      return `${number} ${t('history.pass')}`;
    case 'UNDO':
      return `${number} ${t('history.undo')}`;
    case 'RESIGN':
      return `${number} ${t('history.resign')}`;
    default: {
      if (entry.steps.length === 0) {
        return `${number} ${t('history.noSteps')}`;
      }
      const parts = entry.steps.map((step) => {
        const from = cellToLabel(step.from.r, step.from.c);
        const to = cellToLabel(step.to.r, step.to.c);
        return step.result === 'wall'
          ? t('history.wallStep', { from, to })
          : t('history.step', { from, to });
      });
      return `${number} ${parts.join('; ')}`;
    }
  }
}

/**
 * Weaves the corrections of the journal into the history the core kept.
 *
 * Each correction knows how many history entries existed when it happened, so
 * it lands exactly where it belongs in the reading order.
 *
 * @param {Array<object>} entries History entries from the core.
 * @param {Array<object>} corrections Corrections from the replay.
 * @returns {Array<object>} One list, in the order it happened.
 */
export function mergeHistory(entries, corrections) {
  const merged = [];
  for (let i = 0; i <= entries.length; i += 1) {
    for (const correction of corrections) {
      if (correction.at === i) {
        merged.push({
          move: correction.move,
          side: correction.side,
          type: 'UNDO_STEP',
          steps: [{ from: correction.from, to: correction.to, result: 'pass', isNewCell: false }],
          wall: null,
        });
      }
    }
    if (i < entries.length) {
      merged.push(entries[i]);
    }
  }
  return merged;
}

/**
 * Builds one history block.
 *
 * @param {object} options Block options.
 * @param {string} options.title Heading, already translated.
 * @param {string} options.emptyText Shown while nothing has happened.
 * @returns {{root: HTMLElement, update: (entries: Array<object>) => void}} The
 *   element and its updater.
 */
export function createHistoryBlock({ title, emptyText }) {
  const list = el('ol', { class: 'history__list' });
  const root = el('section', { class: 'panel history' }, [
    el('h3', { class: 'panel__title', text: title }),
    list,
  ]);

  return {
    root,
    update(entries) {
      // The list is short and rebuilt rarely - once per action - so replacing
      // it is simpler than diffing and costs nothing at this size.
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
      clear(list);
      if (entries.length === 0) {
        list.appendChild(el('li', { class: 'history__item is-empty', text: emptyText }));
        return;
      }
      for (const entry of entries) {
        list.appendChild(
          el('li', {
            class: `history__item history__item--${entry.type.toLowerCase()}`,
            text: formatHistoryEntry(entry),
          }),
        );
      }
      // Follow the newest line, unless the player has scrolled up to read.
      if (atBottom) {
        list.scrollTop = list.scrollHeight;
      }
    },
  };
}
