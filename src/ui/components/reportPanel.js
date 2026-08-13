/**
 * reportPanel.js - the seven checks of SPEC 4.7 as lines on screen, and the
 * verdict of SPEC 2.5 under them.
 *
 * Two rules here are easy to break and important to keep:
 *
 *   - Step 7 always has the status `ok`, which means "the verdict was
 *     computed", not "nothing is wrong". It must never be painted from its
 *     status; its colour comes from the outcome (SPEC 4.8).
 *   - No wording accuses anybody. A code that fails check 1 was damaged while
 *     copying. A commit that does not match was either mistyped or covers a
 *     different maze. Which of the two it is, this application cannot know.
 */

import { clear, el, setText } from '../dom.js';
import { t } from '../../i18n/index.js';

/**
 * Groups the answer mismatches of check 6 by the edge they happened on.
 *
 * An edge is walked many times over a game - even more so now that a known
 * passage is answered from the map - so a single wrong answer about a busy
 * edge would otherwise fill the report with identical lines.
 *
 * @param {Array<{move: number, edge: string, from: string, to: string, declared: string, actual: string}>} mismatches
 *   Mismatches as `verifyReveal` reported them.
 * @returns {Array<{edge: string, from: string, to: string, declared: string, actual: string, count: number, moves: number[]}>}
 *   One entry per edge, in the order the edges first went wrong.
 */
export function groupMismatches(mismatches) {
  const byEdge = new Map();
  for (const mismatch of mismatches) {
    const found = byEdge.get(mismatch.edge);
    if (found === undefined) {
      byEdge.set(mismatch.edge, {
        edge: mismatch.edge,
        from: mismatch.from,
        to: mismatch.to,
        declared: mismatch.declared,
        actual: mismatch.actual,
        count: 1,
        moves: [mismatch.move],
      });
      continue;
    }
    found.count += 1;
    if (!found.moves.includes(mismatch.move)) {
      found.moves.push(mismatch.move);
    }
  }
  return [...byEdge.values()];
}

/**
 * Which side the verdict fell on, as a word the styling can use.
 *
 * @param {object|null} verdict Verdict from `computeVerdict`.
 * @returns {'win'|'loss'|'draw'|'both-lose'|'none'} The tone.
 */
export function verdictTone(verdict) {
  if (verdict === null || verdict === undefined) {
    return 'none';
  }
  if (verdict.outcome === 'DRAW') {
    return 'draw';
  }
  if (verdict.outcome === 'BOTH_LOSE') {
    return 'both-lose';
  }
  return verdict.winner === 'me' ? 'win' : 'loss';
}

/**
 * The reason the game ended the way it did.
 *
 * @param {string} reason Reason code from `computeVerdict`.
 * @returns {string} One sentence.
 */
export function verdictReasonText(reason) {
  switch (reason) {
    case 'VIOLATION':
      return t('verdict.reason.VIOLATION');
    case 'BOTH_VIOLATED':
      return t('verdict.reason.BOTH_VIOLATED');
    case 'RESIGN':
      return t('verdict.reason.RESIGN');
    case 'BOTH_RESIGNED':
      return t('verdict.reason.BOTH_RESIGNED');
    case 'NO_EXIT_REACHED':
      return t('verdict.reason.NO_EXIT_REACHED');
    case 'ONLY_ONE_REACHED_EXIT':
      return t('verdict.reason.ONLY_ONE_REACHED_EXIT');
    case 'SAME_ROUND':
      return t('verdict.reason.SAME_ROUND');
    case 'EARLIER_ROUND':
      return t('verdict.reason.EARLIER_ROUND');
    case 'EARLIER_MOVE':
      return t('verdict.reason.EARLIER_MOVE');
    default:
      return t('verdict.reason.UNKNOWN');
  }
}

/**
 * The headline of a verdict.
 *
 * @param {object|null} verdict Verdict from `computeVerdict`.
 * @returns {string} One line.
 */
export function verdictHeadline(verdict) {
  switch (verdictTone(verdict)) {
    case 'win':
      return t('verdict.win');
    case 'loss':
      return t('verdict.loss');
    case 'draw':
      return t('verdict.draw');
    case 'both-lose':
      return t('verdict.bothLose');
    default:
      return t('verdict.none');
  }
}

/**
 * Name of one check.
 *
 * @param {string} code Check code from `VERIFY_CHECKS`.
 * @returns {string} The name.
 */
export function checkTitle(code) {
  switch (code) {
    case 'CODE_INTEGRITY':
      return t('check.CODE_INTEGRITY');
    case 'COMMIT_MATCH':
      return t('check.COMMIT_MATCH');
    case 'SETTINGS_MATCH':
      return t('check.SETTINGS_MATCH');
    case 'ENDPOINTS_MATCH':
      return t('check.ENDPOINTS_MATCH');
    case 'MAZE_VALID':
      return t('check.MAZE_VALID');
    case 'LOG_REPLAY':
      return t('check.LOG_REPLAY');
    case 'VERDICT':
      return t('check.VERDICT');
    default:
      return code;
  }
}

/**
 * What to say about one check.
 *
 * @param {{step: number, status: string, code: string, details: object}} step
 *   One line of the report.
 * @returns {string} A sentence for the player.
 */
export function checkText(step) {
  if (step.status === 'skipped') {
    return step.details.reason === 'GAME_STATE_NOT_PROVIDED'
      ? t('check.skipped.NO_GAME')
      : t('check.skipped.EARLIER_CHECK');
  }
  if (step.status === 'ok') {
    return t('check.ok');
  }
  switch (step.code) {
    case 'CODE_INTEGRITY':
      // Never an accusation: a damaged code is a damaged code (SPEC 4.8).
      return step.details.reason === 'CHECKSUM_MISMATCH'
        ? t('check.fail.DAMAGED')
        : t('check.fail.NOT_A_REVEAL');
    case 'COMMIT_MATCH':
      return t('check.fail.COMMIT');
    case 'SETTINGS_MATCH':
      return t('check.fail.SETTINGS');
    case 'ENDPOINTS_MATCH':
      return t('check.fail.ENDS', {
        declaredEntrance: step.details.declaredEntrance,
        declaredExit: step.details.declaredExit,
        revealedEntrance: step.details.revealedEntrance,
        revealedExit: step.details.revealedExit,
      });
    case 'MAZE_VALID':
      return t('check.fail.MAZE');
    case 'LOG_REPLAY':
      return t('check.fail.ANSWERS', { count: step.details.mismatches.length });
    default:
      return t('check.fail.UNKNOWN');
  }
}

/**
 * The one word status of a check.
 *
 * @param {'ok'|'fail'|'skipped'} status Status from the report.
 * @returns {string} The word.
 */
export function statusWord(status) {
  switch (status) {
    case 'ok':
      return t('status.ok');
    case 'fail':
      return t('status.fail');
    default:
      return t('status.skipped');
  }
}

/**
 * Builds the report panel.
 *
 * @returns {{root: HTMLElement, update: (report: object|null) => void}} The
 *   element and its updater. `update(null)` puts it back to "nothing checked
 *   yet".
 */
export function createReportPanel() {
  const list = el('ol', { class: 'report' });
  const verdictBox = el('div', { class: 'verdict' });
  const empty = el('p', { class: 'panel__hint', text: t('verify.reportEmpty') });
  const root = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('verify.reportTitle') }),
    empty,
    list,
    verdictBox,
  ]);

  return {
    root,

    update(report) {
      clear(list);
      clear(verdictBox);
      empty.hidden = report !== null;
      if (report === null) {
        return;
      }

      // Checks that passed are folded into one line: six identical "matches"
      // rows are wallpaper. Anything that failed or was skipped stays open.
      const passed = report.steps.filter(
        (step) => step.status === 'ok' && step.code !== 'VERDICT',
      );
      if (passed.length > 0) {
        const folded = el('details', { class: 'report__passed' }, [
          el('summary', { text: t('verify.passedSummary', { count: passed.length }) }),
        ]);
        for (const step of passed) {
          folded.appendChild(
            el('div', { class: 'report__passed-item' }, [
              el('span', { class: 'report__number', text: `${step.step}.` }),
              el('span', { text: checkTitle(step.code) }),
            ]),
          );
        }
        list.appendChild(folded);
      }

      for (const step of report.steps) {
        if (step.status === 'ok' && step.code !== 'VERDICT') {
          continue;
        }
        const isVerdict = step.code === 'VERDICT';
        // Step 7 never takes its colour from its status: `ok` there only means
        // that the verdict was computed (SPEC 4.8).
        const tone = isVerdict ? `is-${verdictTone(report.verdict)}` : `is-${step.status}`;
        const item = el('li', { class: `report__item ${tone}` }, [
          el('span', { class: 'report__number', text: `${step.step}.` }),
          el('span', { class: 'report__title', text: checkTitle(step.code) }),
          el('span', {
            class: 'report__status',
            text: isVerdict ? t('check.computed') : statusWord(step.status),
          }),
          el('span', {
            class: 'report__text',
            // The verdict line says what was decided, not "matches": there is
            // nothing to match there (SPEC 4.8).
            text:
              isVerdict && step.status === 'ok' && report.verdict !== null
                ? `${verdictHeadline(report.verdict)}. ${verdictReasonText(report.verdict.reason)}`
                : checkText(step),
          }),
        ]);
        list.appendChild(item);

        if (step.code === 'LOG_REPLAY' && step.status === 'fail') {
          item.appendChild(mismatchList(step.details.mismatches));
        }
      }

      if (report.verdict !== null) {
        verdictBox.appendChild(
          el('div', { class: `verdict__line is-${verdictTone(report.verdict)}` }, [
            el('span', { text: verdictHeadline(report.verdict) }),
          ]),
        );
        verdictBox.appendChild(
          el('p', { class: 'panel__hint', text: verdictReasonText(report.verdict.reason) }),
        );
      }
    },
  };
}

/**
 * The mismatches of check 6, one line per edge with the moves folded away.
 *
 * @param {Array<object>} mismatches Mismatches from the report.
 * @returns {HTMLElement} The list.
 */
function mismatchList(mismatches) {
  const grouped = groupMismatches(mismatches);
  const list = el('ul', { class: 'report__mismatches' });
  for (const group of grouped) {
    const line = el('li', {}, [
      el('span', {
        text: t('verify.mismatchLine', {
          from: group.from,
          to: group.to,
          declared: group.declared === 'wall' ? t('verify.wordWall') : t('verify.wordPass'),
          actual: group.actual === 'wall' ? t('verify.wordWall') : t('verify.wordPass'),
          count: group.count,
        }),
      }),
    ]);
    const moves = el('details', {}, [
      el('summary', { text: t('verify.mismatchMoves', { count: group.moves.length }) }),
      el('p', { class: 'panel__hint' }),
    ]);
    setText(moves.querySelector('p'), group.moves.join(', '));
    line.appendChild(moves);
    list.appendChild(line);
  }
  return list;
}
