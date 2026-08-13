/**
 * screens/rules.js - screen 5: the rules and the guide (SPEC 5.3).
 *
 * It is not a stage of a game, so it stays out of the stage strip. It opens
 * over whatever is on screen - the game screen included, because the middle of
 * a game is when a rule is usually needed - and closing it gives that screen
 * back exactly as it was. Nothing under it is unmounted, so a step waiting for
 * an answer survives a look at the rules.
 *
 * The text here is written for the two people playing, not for whoever
 * maintains this. No codes, no field names, no section numbers: whatever the
 * specification says in its own language has to be said again in theirs.
 *
 * Every line goes through `t()` with a literal key, like everywhere else, and
 * the keys are grouped by section so that a translator can work through them
 * in the order a reader meets them.
 */

import { el } from '../dom.js';
import { t } from '../../i18n/index.js';

/**
 * One collapsible section.
 *
 * The heading is a `<summary>`, which is the whole row: a heading that only
 * answers a click on its letters is a heading that looks broken.
 *
 * @param {string} title Heading, already translated.
 * @param {Array<Node>} children What the section holds.
 * @param {boolean} [open=false] Whether it starts unfolded.
 * @returns {HTMLElement} The section.
 */
function section(title, children, open = false) {
  return el('details', { class: 'rules__section', attrs: open ? { open: 'open' } : {} }, [
    el('summary', { class: 'rules__heading', text: title }),
    el('div', { class: 'rules__body' }, children),
  ]);
}

/**
 * A paragraph of prose (SPEC 5.13: ordinary case, no glow, readable colour).
 *
 * @param {string} text Already translated.
 * @returns {HTMLElement} The paragraph.
 */
function line(text) {
  return el('p', { class: 'rules__text', text });
}

/**
 * A numbered list of short steps.
 *
 * @param {string[]} items Already translated.
 * @returns {HTMLElement} The list.
 */
function steps(items) {
  return el(
    'ol',
    { class: 'rules__steps' },
    items.map((item) => el('li', { text: item })),
  );
}

/**
 * A term and what it means, for the glossary.
 *
 * @param {string} term The word.
 * @param {string} meaning One line.
 * @returns {Array<HTMLElement>} The pair.
 */
function entry(term, meaning) {
  return [el('dt', { text: term }), el('dd', { text: meaning })];
}

/**
 * One of the seven checks: its name as the report calls it, and what it means
 * in words. The names come from the report's own dictionary, so the two can
 * never drift apart.
 *
 * @param {string} name Check name, already translated.
 * @param {string} text What it does.
 * @returns {HTMLElement} The row.
 */
function check(name, text) {
  return el('li', {}, [el('b', { text: name }), el('span', { text: ` — ${text}` })]);
}

/**
 * Builds the rules overlay.
 *
 * @param {object} options Options.
 * @param {() => void} options.onClose Called when the reader is done.
 * @returns {{root: HTMLElement, focus: () => void, destroy: () => void}} The
 *   overlay, a way to put the keyboard inside it and a cleanup hook.
 */
export function createRulesScreen({ onClose }) {
  const closeButton = el('button', {
    class: 'rules__close',
    text: t('rules.close'),
    attrs: { type: 'button' },
    on: { click: () => onClose() },
  });

  const quickStart = section(
    t('rules.quickStart.title'),
    [
      line(t('rules.quickStart.intro')),
      steps([
        t('rules.quickStart.step1'),
        t('rules.quickStart.step2'),
        t('rules.quickStart.step3'),
        t('rules.quickStart.step4'),
        t('rules.quickStart.step5'),
        t('rules.quickStart.step6'),
        t('rules.quickStart.step7'),
        t('rules.quickStart.step8'),
      ]),
      line(t('rules.quickStart.codes')),
    ],
    true,
  );

  const board = section(t('rules.board.title'), [
    line(t('rules.board.grid')),
    line(t('rules.board.walls')),
    line(t('rules.board.limit')),
    line(t('rules.board.ends')),
    line(t('rules.board.path')),
    line(t('rules.board.invalid')),
  ]);

  const turn = section(t('rules.turn.title'), [
    line(t('rules.turn.first')),
    line(t('rules.turn.step')),
    line(t('rules.turn.rightBoard')),
    line(t('rules.turn.theirTurn')),
    line(t('rules.turn.newCells')),
    line(t('rules.turn.wall')),
    line(t('rules.turn.visited')),
    line(t('rules.turn.known')),
    line(t('rules.turn.override')),
    line(t('rules.turn.end')),
    line(t('rules.turn.pass')),
    line(t('rules.turn.undo')),
    line(t('rules.turn.clock')),
  ]);

  const ending = section(t('rules.end.title'), [
    line(t('rules.end.exit')),
    line(t('rules.end.limit')),
    line(t('rules.end.afterExit')),
    line(t('rules.end.resign')),
    line(t('rules.end.resignThem')),
    line(t('rules.end.verdict')),
    line(t('rules.end.again')),
  ]);

  const commit = section(t('rules.commit.title'), [
    line(t('rules.commit.why')),
    line(t('rules.commit.nothing')),
    // The commit and the reveal file are made one after the other on the same
    // screen, and they are easy to take for one thing. They are told apart
    // here on purpose, twice: once as a picture, once as plain instructions.
    line(t('rules.commit.envelope')),
    line(t('rules.commit.which')),
    line(t('rules.commit.exchange')),
    line(t('rules.commit.file')),
    line(t('rules.commit.lost')),
    line(t('rules.commit.after')),
  ]);

  const verify = section(t('rules.verify.title'), [
    line(t('rules.verify.intro')),
    el('ol', { class: 'rules__checks' }, [
      check(t('check.CODE_INTEGRITY'), t('rules.verify.check1')),
      check(t('check.COMMIT_MATCH'), t('rules.verify.check2')),
      check(t('check.SETTINGS_MATCH'), t('rules.verify.check3')),
      check(t('check.ENDPOINTS_MATCH'), t('rules.verify.check4')),
      check(t('check.MAZE_VALID'), t('rules.verify.check5')),
      check(t('check.LOG_REPLAY'), t('rules.verify.check6')),
      check(t('check.VERDICT'), t('rules.verify.check7')),
    ]),
    line(t('rules.verify.damaged')),
    line(t('rules.verify.commitFailed')),
    line(t('rules.verify.mismatch')),
    line(t('rules.verify.replay')),
  ]);

  const limits = section(t('rules.limits.title'), [
    line(t('rules.limits.intro')),
    line(t('rules.limits.noReveal')),
    line(t('rules.limits.dispute')),
    line(t('rules.limits.lostFile')),
  ]);

  const glossary = section(t('rules.glossary.title'), [
    el('dl', { class: 'rules__glossary' }, [
      ...entry(t('rules.glossary.settingsCodeTerm'), t('rules.glossary.settingsCode')),
      ...entry(t('rules.glossary.commitTerm'), t('rules.glossary.commit')),
      ...entry(t('rules.glossary.revealTerm'), t('rules.glossary.reveal')),
      ...entry(t('rules.glossary.saltTerm'), t('rules.glossary.salt')),
    ]),
  ]);

  const root = el(
    'div',
    {
      class: 'rules',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('rules.title'), tabindex: '-1' },
    },
    [
      el('div', { class: 'rules__sheet' }, [
        el('div', { class: 'rules__top' }, [
          el('h2', { class: 'rules__title', text: t('rules.title') }),
          closeButton,
        ]),
        line(t('rules.intro')),
        quickStart,
        board,
        turn,
        ending,
        commit,
        verify,
        limits,
        glossary,
        el('div', { class: 'rules__bottom' }, [
          el('button', {
            text: t('rules.close'),
            attrs: { type: 'button' },
            on: { click: () => onClose() },
          }),
        ]),
      ]),
    ],
  );

  /**
   * Escape closes the rules, the same as the button.
   *
   * @param {KeyboardEvent} event Key press.
   * @returns {void}
   */
  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  root.addEventListener('keydown', handleKeydown);

  return {
    root,

    focus() {
      closeButton.focus();
    },

    destroy() {
      root.removeEventListener('keydown', handleKeydown);
      root.remove();
    },
  };
}
