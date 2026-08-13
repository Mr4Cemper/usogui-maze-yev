/**
 * screens/play.js - screen 3: the game itself (SPEC 2.2-2.5, 3.2, 5.3).
 *
 * The core is the engine. This screen never decides whether a turn is over,
 * whether a step is allowed or who is winning: it appends actions to the
 * journal, hands them to the core, and shows what came back. Every hint on the
 * screen is a code the core returned, translated here (SPEC 6.1).
 *
 * The two boards are mirror images of each other. On the left is my own maze,
 * walked by the opponent, and this device knows every wall of it, so it
 * answers for it. On the right is the opponent's maze, which I walk blind
 * (SPEC 2.4) - blind, but not forgetful: an edge the opponent has already
 * answered about is answered from this device's own map instead of being asked
 * again (SPEC 2.3).
 *
 * The core throws when the wrong side moves. The screen must never let that
 * happen: an exception from the core here would be a bug in this file, not a
 * caught error (SPEC 6.3). That is why the idle board is switched to
 * 'readonly' rather than merely ignored.
 *
 * Layout rule: on a laptop screen the voice line, both boards and the buttons
 * have to be visible at once, and the layout may not jump between the phases
 * of a turn. Hence a one line status, help folded away, a button bar stuck to
 * the bottom, boards bounded by the height of the viewport, and a block for
 * the question that keeps its height even when there is no question.
 */

import { DIRECTIONS, totalMoves } from '../../core/game.js';
import { cellToLabel, edgeBetween, isOnBoard } from '../../core/edges.js';
import { roundOfMove } from '../../core/verify.js';
import { clear, el, setText, toggleClass } from '../dom.js';
import { createBoard, gameBoardModel } from '../board.js';
import { createHistoryBlock, mergeHistory } from '../components/historyPanel.js';
import { applyAction, isGameSetupComplete, runJournal } from '../gameLog.js';
import { appendStroke, brushFor } from '../ink.js';
import { saveBoardsPng } from '../export.js';
import { formatClock } from './build.js';
import { t } from '../../i18n/index.js';

/** Keys that pick a direction: arrows and WASD, always. */
const KEY_DIRECTIONS = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
});

/**
 * Keys that answer a pending step.
 *
 * W is deliberately absent: a WASD player pressing it means "up", and an
 * answer cannot be taken back once it is in the journal. Enter is not bound
 * either - "passed" is far too common an answer to hand to the key people
 * press without looking.
 */
const KEY_ANSWERS = Object.freeze({ p: 'pass', 1: 'pass', b: 'wall', 2: 'wall' });

/** Hints that mean the turn is technically over (SPEC 2.2). */
const TURN_OVER_HINTS = Object.freeze(['TURN_OVER_WALL', 'TURN_OVER_NEW_CELLS']);

/**
 * Text for a hint code of SPEC 6.1.
 *
 * @param {string} code Hint code from the core.
 * @returns {string} A line for the player.
 */
export function hintText(code) {
  switch (code) {
    case 'TURN_OVER_WALL':
      return t('hint.TURN_OVER_WALL');
    case 'TURN_OVER_NEW_CELLS':
      return t('hint.TURN_OVER_NEW_CELLS');
    case 'REACHED_EXIT':
      return t('hint.REACHED_EXIT');
    case 'KNOWN_WALL_WARNING':
      return t('hint.KNOWN_WALL_WARNING');
    case 'MOVE_LIMIT_REACHED':
      return t('hint.MOVE_LIMIT_REACHED');
    case 'PASS_NOT_ALLOWED':
      return t('hint.PASS_NOT_ALLOWED');
    case 'EMPTY_TURN_WARNING':
      return t('hint.EMPTY_TURN_WARNING');
    default:
      return t('hint.UNKNOWN');
  }
}

/**
 * Names the direction from one cell to a neighbour.
 *
 * @param {{r: number, c: number}} from Starting cell.
 * @param {{r: number, c: number}} to Target cell.
 * @returns {string|null} Direction name, or null when the cells are not
 *   orthogonal neighbours.
 */
export function directionBetween(from, to) {
  for (const [name, delta] of Object.entries(DIRECTIONS)) {
    if (from.r + delta.dr === to.r && from.c + delta.dc === to.c) {
      return name;
    }
  }
  return null;
}

/**
 * The cells a pawn may step onto: its neighbours that are on the board. The
 * walls are not consulted - stepping into one is a legal move that ends the
 * turn (SPEC 2.2).
 *
 * @param {{r: number, c: number}} pos Where the pawn stands.
 * @returns {Array<{r: number, c: number}>} Neighbouring cells.
 */
export function availableCells(pos) {
  const cells = [];
  for (const delta of Object.values(DIRECTIONS)) {
    const cell = { r: pos.r + delta.dr, c: pos.c + delta.dc };
    if (isOnBoard(cell.r, cell.c)) {
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * Decides how a step has to be handled before anything is recorded (SPEC 2.3).
 *
 * Four outcomes, and they are not interchangeable:
 *
 *   `off-board`    - the border. Not a move at all.
 *   `own-maze`     - the opponent walking my maze; my walls answer.
 *   `auto`         - an edge I have already walked through. The opponent
 *                    answered about it once; asking again would be asking a
 *                    living person to repeat themselves. Both of its cells
 *                    have been visited, so such a step can never open a new
 *                    cell and never spends the per turn allowance.
 *   `confirm-wall` - an edge known to be a wall. Never answered
 *                    automatically: the step would end the turn, and one slip
 *                    of the mouse would cost a whole turn. It is allowed, but
 *                    only on purpose.
 *   `ask`          - an edge nobody has said anything about yet.
 *
 * @param {object} game Core game state.
 * @param {'me'|'opponent'} side Whose step it is.
 * @param {string} direction One of up, down, left, right.
 * @returns {{mode: string, answer: 'pass'|'wall'|null, from: object, to: object|null, edge: string|null}}
 *   What to do with the step.
 * @throws {Error} If the direction is unknown.
 */
export function resolveStep(game, side, direction) {
  const delta = DIRECTIONS[direction];
  if (delta === undefined) {
    throw new Error(`direction must be one of ${Object.keys(DIRECTIONS).join(', ')}`);
  }
  const from = { ...game.sides[side].pos };
  const to = { r: from.r + delta.dr, c: from.c + delta.dc };
  if (!isOnBoard(to.r, to.c)) {
    return { mode: 'off-board', answer: null, from, to: null, edge: null };
  }
  const edge = edgeBetween(from.r, from.c, to.r, to.c);
  if (side === 'opponent') {
    return { mode: 'own-maze', answer: null, from, to, edge };
  }
  const board = game.sides.me;
  if (board.knownOpen.has(edge)) {
    return { mode: 'auto', answer: 'pass', from, to, edge };
  }
  if (board.knownWalls.has(edge)) {
    return { mode: 'confirm-wall', answer: 'wall', from, to, edge };
  }
  return { mode: 'ask', answer: null, from, to, edge };
}

/**
 * Whether the turn should be handed over without a further click.
 *
 * The application is a helper, not a referee (SPEC 1.1): it may not decide for
 * the player. A switch the player turned on themselves is not the application
 * deciding - it is the player's own decision, given in advance. By the rules
 * the turn really is over at this point; carrying on is only possible because
 * nothing is blocked.
 *
 * @param {string[]} hints Hint codes the core just returned.
 * @param {object} options Current conditions.
 * @param {boolean} options.autoEndTurn Whether the switch is on.
 * @param {boolean} options.pending Whether a step is still waiting for an
 *   answer. Nothing is handed over while it is.
 * @returns {boolean} True when the turn should be closed now.
 */
export function shouldAutoEnd(hints, { autoEndTurn, pending }) {
  if (autoEndTurn !== true || pending === true) {
    return false;
  }
  return hints.some((code) => TURN_OVER_HINTS.includes(code));
}

/**
 * Builds screen 3.
 *
 * @param {object} options Screen options.
 * @param {object} options.store The application store.
 * @returns {{root: HTMLElement, update: (state: object) => void, destroy: () => void}}
 *   The screen element, its updater and a cleanup hook.
 */
export function createPlayScreen({ store }) {
  /** The core game state, rebuilt from the journal, never persisted. */
  let game = null;
  /** Correction lines the journal carries, from steps that were taken back. */
  let corrections = [];
  /** How many journal entries are already inside `game`. */
  let appliedCount = 0;
  /** Set when the journal could not be replayed at all. */
  let failure = null;
  /** A step waiting for an answer or for a confirmation. */
  let pending = null;
  /** The last resolved step, which is what gets announced or read. */
  let lastStep = null;
  let lastHints = [];
  /** The line to read out loud: `{result, from, to}` or null. */
  let sayLine = null;
  /** Which resignation is armed for its second press: 'me', 'opponent', null. */
  let resignArmed = null;
  /** Set when the last turn was handed over by itself: the reason and where. */
  let autoEnded = null;
  let timerHandle = null;

  const boards = {};
  const boardFrames = {
    opponent: el('div', { class: 'board-panel__frame' }),
    me: el('div', { class: 'board-panel__frame' }),
  };

  const statusLine = el('div', { class: 'play__status' });
  // The one thing on this screen done with the voice rather than the eyes.
  // Its own element, named, in two places: at the top of the screen and right
  // under the board where the opponent's steps are entered.
  const sayBanner = el('div', { class: 'play__say', attrs: { id: 'play-say', role: 'status' } });
  const sayUnderBoard = el('div', { class: 'play__say play__say--board' });
  const voiceLine = el('div', { class: 'play__voice-line' });
  const voiceHint = el('p', { class: 'panel__hint play__voice-hint' });
  const overrideRow = el('div', { class: 'play__override' });
  const hintList = el('ul', { class: 'problem-list' });

  /**
   * Builds a row of answer buttons.
   *
   * There are two such rows: one in the voice block, which explains what is
   * going on, and one directly under the board being clicked, so that the eye
   * does not have to travel between choosing a cell and confirming an answer.
   *
   * @param {boolean} withCancel Whether the row carries the "choose another
   *   step" button. The row under the board does not: every extra button there
   *   takes height away from the board.
   * @returns {{root: HTMLElement, pass: HTMLElement, wall: HTMLElement, label: HTMLElement}}
   *   The row and the parts that change.
   */
  function answerRow(withCancel) {
    const label = el('span', { class: 'play__answer-label' });
    const pass = el('button', {
      class: 'is-primary play__answer-button',
      text: t('play.answerPassed'),
      attrs: { type: 'button' },
      on: { click: () => answerPending('pass') },
    });
    const wall = el('button', {
      class: 'is-primary play__answer-button',
      text: t('play.answerWalled'),
      attrs: { type: 'button' },
      on: { click: () => answerPending('wall') },
    });
    const children = [label, pass, wall];
    if (withCancel) {
      children.push(
        el('button', {
          text: t('play.cancelStep'),
          attrs: { type: 'button' },
          on: { click: () => cancelPending() },
        }),
      );
    }
    return { root: el('div', { class: 'play__answers' }, children), pass, wall, label };
  }

  const voiceAnswers = answerRow(true);
  const boardAnswers = answerRow(false);

  const helpBlock = el('details', { class: 'play__help' }, [
    el('summary', { text: t('play.helpSummary') }),
    el('p', { class: 'panel__hint', text: t('play.helpMine') }),
    el('p', { class: 'panel__hint', text: t('play.helpTheirs') }),
    el('p', { class: 'panel__hint', text: t('play.helpAuto') }),
    el('p', { class: 'panel__hint', text: t('play.helpKeys') }),
  ]);

  // One block, always the same height, carrying whatever the moment needs:
  // the line to read out loud, the question about an answer, or nothing.
  const voiceBlock = el('div', { class: 'play__voice' }, [
    sayBanner,
    voiceLine,
    voiceHint,
    voiceAnswers.root,
    overrideRow,
  ]);

  const turnPanel = el('section', { class: 'panel play__turn' }, [
    statusLine,
    voiceBlock,
    hintList,
    helpBlock,
  ]);

  const boardPanels = {
    opponent: el('section', { class: 'panel board-panel' }, [
      el('h3', { class: 'panel__title', text: t('play.myMazeTitle') }),
      boardFrames.opponent,
      sayUnderBoard,
    ]),
    me: el('section', { class: 'panel board-panel' }, [
      el('h3', { class: 'panel__title', text: t('play.opponentMazeTitle') }),
      boardFrames.me,
      boardAnswers.root,
    ]),
  };

  const history = {
    me: createHistoryBlock({ title: t('play.historyMine'), emptyText: t('play.historyEmpty') }),
    opponent: createHistoryBlock({
      title: t('play.historyTheirs'),
      emptyText: t('play.historyEmpty'),
    }),
  };

  const stage = el('div', { class: 'play__stage' }, [
    el('div', { class: 'play__boards' }, [boardPanels.opponent, boardPanels.me]),
    el('div', { class: 'play__history' }, [history.me.root, history.opponent.root]),
  ]);

  const endTurnButton = el('button', {
    class: 'is-primary',
    text: t('play.endTurn'),
    attrs: { type: 'button' },
    on: { click: () => endTurnNow() },
  });
  const undoStepButton = el('button', {
    text: t('play.undoStepMine'),
    attrs: { type: 'button' },
    on: { click: () => undoStepNow() },
  });
  const undoButton = el('button', {
    text: t('play.undo'),
    attrs: { type: 'button' },
    on: { click: () => undoNow() },
  });
  const passButton = el('button', {
    text: t('play.passMine'),
    attrs: { type: 'button' },
    on: { click: () => passNow() },
  });
  const resignButton = el('button', {
    text: t('play.resign'),
    attrs: { type: 'button' },
    on: { click: () => resignNow('me') },
  });
  // A resignation by the opponent has to be recordable too: without it the
  // verdict computed at verification would be wrong (SPEC 2.5).
  const resignThemButton = el('button', {
    text: t('play.resignThem'),
    attrs: { type: 'button' },
    on: { click: () => resignNow('opponent') },
  });
  // The picture of a finished game, next to the way out of it. Only when the
  // game is over: while it is running every button here costs the boards
  // height, and there is nothing to keep a picture of yet.
  const pngButton = el('button', {
    text: t('export.png'),
    attrs: { type: 'button' },
    on: {
      click: () =>
        void saveBoardsPng([
          { board: boards.opponent.root, caption: t('play.myMazeTitle') },
          { board: boards.me.root, caption: t('play.opponentMazeTitle') },
        ]).catch((error) => {
          setText(barNotice, t('export.failed', { message: error.message }));
        }),
    },
  });

  const verifyButton = el('button', {
    text: t('play.toVerify'),
    attrs: { type: 'button' },
    on: { click: () => store.setState({ screen: 'verify' }) },
  });

  const counterLine = el('div', { class: 'counter' });
  const limitLine = el('div', { class: 'play__limit' });
  const barNotice = el('div', { class: 'status' });

  // The row follows how often a button is needed. "End the turn" is pressed
  // every single turn and stands first; taking something back happens now and
  // then; a resignation happens once a game or never, so both of them live
  // behind one folded control at the far end. "To verification" is not in the
  // row at all during a game - the stage strip carries that step - and takes
  // the main place only once the game is over.
  const finishPanel = el('details', { class: 'play__finish' }, [
    el('summary', { text: t('play.finishGame') }),
    el('p', { class: 'panel__hint', text: t('play.finishWhy') }),
    el('div', { class: 'button-row' }, [resignButton, resignThemButton]),
  ]);

  const actionBar = el('div', { class: 'play__bar' }, [
    el('div', { class: 'play__bar-left' }, [counterLine, limitLine, barNotice]),
    el('div', { class: 'button-row play__bar-buttons' }, [
      endTurnButton,
      undoStepButton,
      undoButton,
      passButton,
      verifyButton,
      pngButton,
      finishPanel,
    ]),
  ]);

  const failureBox = el('section', { class: 'panel' });
  const root = el('div', { class: 'screen play' }, [failureBox, turnPanel, stage, actionBar]);

  boards.opponent = createBoard(boardFrames.opponent, {
    mode: 'readonly',
    label: t('play.myMazeTitle'),
    onCellClick: (cell) => handleCellClick('opponent', cell),
  });
  boards.me = createBoard(boardFrames.me, {
    mode: 'readonly',
    label: t('play.opponentMazeTitle'),
    onCellClick: (cell) => handleCellClick('me', cell),
  });

  /**
   * Appends one action to the journal.
   *
   * Everything except `UNDO_STEP` is also played into the live game at once;
   * a cancelled step cannot be un-played, so that one asks for a full replay
   * instead. Both routes end in the same `runJournal`, which is what keeps a
   * reloaded game identical to a played one.
   *
   * @param {object} action Journal entry.
   * @returns {object|null} What the core returned, or null when the action was
   *   not played here.
   */
  function dispatch(action) {
    if (game === null) {
      return null;
    }
    const journal = [...store.getState().gameActions, action];

    if (action.type === 'UNDO_STEP') {
      // Leaving appliedCount behind makes the next update() replay the journal.
      store.setState({ gameActions: journal });
      return null;
    }

    let result;
    try {
      result = applyAction(game, action);
    } catch (error) {
      // Reaching this means the screen offered something the core refuses,
      // which is a bug here rather than a player mistake. Say so plainly and
      // keep the journal clean.
      failure = t('play.actionRefused', { message: error.message });
      render(store.getState());
      return null;
    }
    appliedCount += 1;
    store.setState({ gameActions: journal });
    return result;
  }

  /**
   * Opens the turn if it is not open yet. Turns are opened lazily, right
   * before the first thing that needs one, so that "take the turn back" still
   * works while nobody has moved yet.
   *
   * @returns {void}
   */
  function ensureTurnStarted() {
    if (game !== null && !game.turnActive) {
      dispatch({ type: 'START_TURN' });
    }
  }

  /**
   * Whether this device is still in the game. After a resignation it is not:
   * the core keeps the game running, but there is nothing left for this player
   * to do except reveal (SPEC 2.5).
   *
   * @returns {boolean} True once this player has resigned.
   */
  function isOut() {
    return game !== null && game.sides.me.resigned;
  }

  /**
   * Whether the game is over for this device: either side has resigned.
   *
   * The core keeps the game running - it never ends one (SPEC 6.3) - but a
   * game in which somebody has resigned has nothing left to enter.
   *
   * @returns {boolean} True when nobody is going to move any more.
   */
  function isFinished() {
    return game !== null && (game.sides.me.resigned || game.sides.opponent.resigned);
  }

  /**
   * A click on a cell of one of the boards.
   *
   * @param {'me'|'opponent'} side Which board was clicked.
   * @param {{r: number, c: number}} cell The cell.
   * @returns {void}
   */
  function handleCellClick(side, cell) {
    if (game === null || isFinished() || side !== game.current || pending !== null) {
      return;
    }
    const direction = directionBetween(game.sides[side].pos, cell);
    if (direction === null) {
      return;
    }
    stepInDirection(direction);
  }

  /**
   * Makes a step, asks about it, or asks to confirm it - see
   * {@link resolveStep}.
   *
   * @param {string} direction One of up, down, left, right.
   * @returns {void}
   */
  function stepInDirection(direction) {
    if (game === null || isFinished() || pending !== null) {
      return;
    }
    const side = game.current;
    const plan = resolveStep(game, side, direction);

    if (plan.mode === 'off-board') {
      // The border is not a wall a player may bump into: the core would throw,
      // so the step simply does not happen.
      return;
    }

    if (plan.mode === 'own-maze') {
      ensureTurnStarted();
      const result = dispatch({ type: 'STEP', side: 'opponent', direction });
      if (result !== null) {
        lastStep = { side: 'opponent', direction, auto: false, ...result };
        lastHints = result.hints;
        // What the player now has to say out loud. It stays until the next
        // input of any kind, including an automatic hand-over.
        sayLine = { result: result.result, from: result.from, to: result.to };
        maybeAutoEnd(result.hints, result);
      }
      render(store.getState());
      return;
    }

    if (plan.mode === 'auto') {
      // Already walked through: the opponent answered about this edge once and
      // is not asked again.
      playMyStep(direction, 'pass', true);
      return;
    }

    pending = { mode: plan.mode, direction, from: plan.from, to: plan.to, edge: plan.edge };
    lastHints = plan.mode === 'confirm-wall' ? ['KNOWN_WALL_WARNING'] : [];
    render(store.getState());
  }

  /**
   * Records one of my steps with the answer it got.
   *
   * @param {string} direction Where the pawn goes.
   * @param {'pass'|'wall'} answer The answer.
   * @param {boolean} auto Whether the answer came from my own map.
   * @returns {void}
   */
  function playMyStep(direction, answer, auto) {
    sayLine = null;
    ensureTurnStarted();
    const result = dispatch({ type: 'STEP', side: 'me', direction, answer, auto });
    if (result !== null) {
      lastStep = { side: 'me', direction, auto, ...result };
      lastHints = result.hints;
      maybeAutoEnd(result.hints, result);
    }
    render(store.getState());
  }

  /**
   * Hands the turn over when the player asked for that to happen by itself.
   *
   * @param {string[]} hints Hints the core returned for the step just made.
   * @returns {void}
   */
  function maybeAutoEnd(hints, step) {
    if (
      !shouldAutoEnd(hints, {
        autoEndTurn: store.getState().autoEndTurn === true,
        pending: pending !== null,
      })
    ) {
      return;
    }
    const closed = dispatch({ type: 'END_TURN' });
    if (closed !== null) {
      autoEnded = hints.includes('TURN_OVER_WALL')
        ? { kind: 'wall', from: step.from, to: step.to }
        : { kind: 'cells' };
      // The hints of the step itself stay on screen: they are the reason the
      // turn was handed over.
      lastStep = null;
    }
  }

  /**
   * Records the answer the opponent gave to my step.
   *
   * @param {'pass'|'wall'} answer What the opponent said.
   * @returns {void}
   */
  function answerPending(answer) {
    if (game === null || pending === null) {
      return;
    }
    const { direction } = pending;
    // An answer given here came from a voice, even when the map suggested it.
    const auto = pending.mode === 'confirm-wall' && answer === 'wall';
    pending = null;
    playMyStep(direction, answer, auto);
  }

  /**
   * Drops a step that was chosen but not answered yet. Nothing was recorded,
   * so nothing is undone.
   *
   * @returns {void}
   */
  function cancelPending() {
    pending = null;
    lastHints = [];
    render(store.getState());
  }

  /**
   * Takes back a step this device answered from its own map, because the
   * opponent has just said something else. The step stays in the journal and
   * is cancelled there, and the question is asked properly.
   *
   * @returns {void}
   */
  function overrideAutoStep() {
    if (game === null || lastStep === null || lastStep.auto !== true) {
      return;
    }
    // The cells come from the step itself: after the undo the pawn is back
    // where it started, but the question is about the same two cells.
    const { direction, from, to, edge } = lastStep;
    lastStep = null;
    lastHints = [];
    dispatch({ type: 'UNDO_STEP' });
    pending = { mode: 'ask', direction, from, to, edge };
    render(store.getState());
  }

  /**
   * Takes back the last step of the open turn (SPEC 3.3).
   *
   * @returns {void}
   */
  function undoStepNow() {
    if (game === null || isFinished() || pending !== null) {
      return;
    }
    if (!game.turnActive || game.sides[game.current].turnSteps.length === 0) {
      return;
    }
    lastStep = null;
    lastHints = [];
    dispatch({ type: 'UNDO_STEP' });
  }

  /**
   * Closes the turn.
   *
   * @returns {void}
   */
  function endTurnNow() {
    if (game === null || isFinished()) {
      return;
    }
    ensureTurnStarted();
    const result = dispatch({ type: 'END_TURN' });
    if (result !== null) {
      lastHints = result.hints;
      lastStep = null;
      // The line to read out loud is deliberately left standing: closing the
      // turn is not a new answer, and the opponent may still be listening.
      autoEnded = null;
      pending = null;
    }
    render(store.getState());
  }

  /**
   * Passes the turn. Only offered when the settings allow it (SPEC 2.2).
   *
   * @returns {void}
   */
  function passNow() {
    if (game === null || isFinished()) {
      return;
    }
    if (game.settings.allow_pass !== 1) {
      lastHints = ['PASS_NOT_ALLOWED'];
      render(store.getState());
      return;
    }
    const result = dispatch({ type: 'PASS' });
    if (result !== null) {
      lastHints = result.hints;
      lastStep = null;
      sayLine = null;
      autoEnded = null;
      pending = null;
    }
    render(store.getState());
  }

  /**
   * Takes a whole turn back.
   *
   * A turn that is already open with steps in it is first closed and then
   * undone, so the archive keeps both lines: what was announced, and that it
   * was taken back (SPEC 3.3).
   *
   * @returns {void}
   */
  function undoNow() {
    if (game === null || isFinished()) {
      return;
    }
    pending = null;
    if (game.turnActive) {
      dispatch({ type: 'END_TURN' });
    }
    dispatch({ type: 'UNDO' });
    lastHints = [];
    lastStep = null;
    sayLine = null;
    autoEnded = null;
    render(store.getState());
  }

  /**
   * Resigns, in two steps, so a stray click cannot end the game, and only
   * once: a resignation is an announcement, not a move (SPEC 2.5).
   *
   * @returns {void}
   */
  function resignNow(side) {
    if (game === null || isFinished()) {
      return;
    }
    if (resignArmed !== side) {
      resignArmed = side;
      render(store.getState());
      return;
    }
    resignArmed = null;
    pending = null;
    lastStep = null;
    sayLine = null;
    autoEnded = null;
    lastHints = [];
    dispatch({ type: 'RESIGN', side });
    render(store.getState());
  }

  /**
   * Records a finished drawing. The stroke arrives from the board in board
   * units, so it scales with the board and lands in the export in place
   * (SPEC 5.7).
   *
   * @param {object} stroke The stroke.
   * @returns {void}
   */
  function addStroke(stroke) {
    store.setState((state) => ({ ...state, ink: appendStroke(state, stroke) }));
  }
  /**
   * Directions and answers from the keyboard.
   *
   * @param {KeyboardEvent} event Key press.
   * @returns {void}
   */
  function handleKeydown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    // The rules open over this screen without unmounting it, so the keys of
    // the game have to stand down while they are being read: nobody expects a
    // pawn to move because they pressed a key over a page of text.
    if (store.getState().rulesOpen === true) {
      return;
    }
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    if (pending !== null) {
      const answer = KEY_ANSWERS[key];
      if (answer !== undefined) {
        event.preventDefault();
        answerPending(answer);
      } else if (key === 'Escape') {
        event.preventDefault();
        cancelPending();
      }
      return;
    }

    const direction = KEY_DIRECTIONS[key];
    if (direction !== undefined) {
      event.preventDefault();
      stepInDirection(direction);
    }
  }

  /**
   * Warns before the tab closes, but only while there is a game worth losing.
   *
   * @param {BeforeUnloadEvent} event The event.
   * @returns {void}
   */
  function handleBeforeUnload(event) {
    const actions = store.getState().gameActions;
    const played = actions.some((action) => action.type === 'STEP' || action.type === 'PASS');
    const over = actions.some((action) => action.type === 'RESIGN');
    if (!played || over) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  }

  /**
   * Rebuilds the game from the journal.
   *
   * @param {object} uiState Application state.
   * @returns {void}
   */
  function rebuild(uiState) {
    lastStep = null;
    lastHints = [];
    sayLine = null;
    autoEnded = null;
    try {
      const replayed = runJournal(uiState, uiState.gameActions);
      game = replayed.state;
      corrections = replayed.corrections;
      appliedCount = uiState.gameActions.length;
      failure = uiState.gameLoadError === null ? null : t('play.journalDropped');
    } catch (error) {
      // A journal that cannot be replayed is not a game any more. Say what
      // happened and offer a fresh start rather than a blank screen.
      game = null;
      corrections = [];
      appliedCount = 0;
      pending = null;
      failure = t('play.journalBroken', { message: error.message });
    }
  }

  /**
   * Throws the journal away and starts the game again from move one.
   *
   * @returns {void}
   */
  function restart() {
    store.setState({ gameActions: [], gameLoadError: null });
  }

  /**
   * Keeps the turn clock in step with the turn (SPEC 5.10). A player who has
   * resigned has no turn to time.
   *
   * @param {object} uiState Application state.
   * @returns {void}
   */
  function syncTimer(uiState) {
    const settings = game?.settings ?? null;
    const enabled =
      settings !== null &&
      !isFinished() &&
      settings.timers_visible === 1 &&
      settings.turn_timer_sec > 0;
    if (!enabled) {
      if (timerHandle !== null) {
        clearInterval(timerHandle);
        timerHandle = null;
      }
      return;
    }
    // The deadline lives in the state, not in this closure: stepping out to
    // another screen and back must not hand the player a fresh minute.
    if (uiState.turnTimerMove !== game.globalMove) {
      store.setState({
        turnTimerMove: game.globalMove,
        turnTimerEndsAt: Date.now() + settings.turn_timer_sec * 1000,
      });
      return;
    }
    if (timerHandle === null) {
      // Only the status line is repainted every second: redrawing the whole
      // screen would rebuild the history and fight whoever is reading it.
      timerHandle = setInterval(paintStatus, 1000);
    }
  }

  /**
   * The clock. Once the turn time is spent it counts up instead of standing
   * still on "time is out": the number stays informative and stops being noise.
   *
   * @returns {string} The clock, or an empty string when there is none.
   */
  function clockText() {
    const endsAt = store.getState().turnTimerEndsAt;
    if (timerHandle === null || typeof endsAt !== 'number') {
      return '';
    }
    const left = Math.ceil((endsAt - Date.now()) / 1000);
    return left >= 0
      ? t('play.timerLeft', { clock: formatClock(left) })
      : t('play.timerOver', { clock: formatClock(-left) });
  }

  /**
   * Writes the one line status: whose turn, which move, which round, how many
   * new cells are left in it, and the clock.
   *
   * @returns {void}
   */
  function paintStatus() {
    if (game === null) {
      return;
    }
    const out = isFinished();
    const board = game.sides[game.current];
    const clock = clockText();
    setText(
      statusLine,
      t('play.status', {
        turn: out
          ? t('play.statusOut')
          : game.current === 'me'
            ? t('play.yourTurn')
            : t('play.theirTurn'),
        move: game.globalMove,
        round: roundOfMove(game.globalMove),
        cells: board.newCellsThisTurn,
        limit: game.settings.new_cells_per_turn,
      }) + (clock === '' ? '' : ` · ${clock}`),
    );
    toggleClass(statusLine, 'is-out', out);
  }

  /**
   * Draws the screen.
   *
   * @param {object} uiState Application state.
   * @returns {void}
   */
  function render(uiState) {
    clear(failureBox);
    failureBox.hidden = failure === null;
    if (failure !== null) {
      failureBox.appendChild(el('h2', { class: 'panel__title', text: t('play.problemTitle') }));
      failureBox.appendChild(el('p', { class: 'panel__hint', text: failure }));
      failureBox.appendChild(
        el('div', { class: 'button-row' }, [
          el('button', {
            text: t('play.restart'),
            attrs: { type: 'button' },
            on: { click: () => restart() },
          }),
        ]),
      );
    }

    const playable = game !== null;
    turnPanel.hidden = !playable;
    stage.hidden = !playable;
    actionBar.hidden = !playable;
    if (!playable) {
      return;
    }

    const out = isFinished();
    const side = game.current;
    const mine = side === 'me';
    const board = game.sides[side];

    // Only the side to move gets a live board, so the core is never asked to
    // move the wrong side. After resigning, neither board is live.
    boards.me.setMode(!out && mine ? 'play' : 'readonly');
    boards.opponent.setMode(!out && !mine ? 'play' : 'readonly');
    toggleClass(boardPanels.me, 'is-idle', out || !mine);
    toggleClass(boardPanels.opponent, 'is-idle', out || mine);

    const available = pending === null && !out ? availableCells(board.pos) : [];
    boards.me.render(gameBoardModel(game, 'me', { available: mine ? available : [] }));
    boards.me.renderInk(uiState.ink, 'me');
    boards.me.setDrawing(brushFor(uiState, 'me', addStroke));
    boards.opponent.setDrawing(brushFor(uiState, 'opponent', addStroke));
    boards.opponent.renderInk(uiState.ink, 'opponent');
    boards.opponent.render(
      gameBoardModel(game, 'opponent', { available: mine ? [] : available }),
    );

    syncTimer(uiState);
    paintStatus();
    renderVoice(mine, out);

    clear(hintList);
    for (const code of lastHints) {
      hintList.appendChild(
        el('li', { class: 'problem-list__item is-consequence' }, [
          el('span', { class: 'problem-list__marker', text: '!' }),
          el('span', { text: hintText(code) }),
        ]),
      );
    }

    const steps = game.turnActive ? game.sides[side].turnSteps.length : 0;
    const turnOver = lastHints.some((code) => TURN_OVER_HINTS.includes(code));
    endTurnButton.hidden = out;
    endTurnButton.disabled = pending !== null;
    // The core said the turn is technically over. It does not close it - that
    // would be refereeing - but the button stops looking like the others.
    toggleClass(endTurnButton, 'is-urgent', turnOver && pending === null);
    undoStepButton.hidden = out || steps === 0;
    undoStepButton.disabled = pending !== null;
    setText(undoStepButton, mine ? t('play.undoStepMine') : t('play.undoStepTheirs'));
    undoButton.hidden = out;
    undoButton.disabled = pending !== null || (steps === 0 && game.undoStack.length === 0);
    passButton.hidden = out || game.settings.allow_pass !== 1;
    passButton.disabled = pending !== null || steps > 0;
    setText(passButton, mine ? t('play.passMine') : t('play.passTheirs'));
    // During the game the way to verification is the stage strip; the button
    // appears here only when there is nothing else left to do.
    verifyButton.hidden = !out;
    pngButton.hidden = !out;
    finishPanel.hidden = out;
    if (out) {
      finishPanel.open = false;
    }
    resignButton.hidden = out;
    setText(resignButton, resignArmed === 'me' ? t('play.resignConfirm') : t('play.resign'));
    toggleClass(resignButton, 'is-primary', resignArmed === 'me');
    resignThemButton.hidden = out;
    setText(
      resignThemButton,
      resignArmed === 'opponent' ? t('play.resignThemConfirm') : t('play.resignThem'),
    );
    toggleClass(resignThemButton, 'is-primary', resignArmed === 'opponent');
    toggleClass(verifyButton, 'is-primary', out);

    setText(
      barNotice,
      out
        ? isOut()
          ? t('play.resigned')
          : t('play.theyResigned')
        : resignArmed === 'me'
          ? t('play.resignWarning')
          : resignArmed === 'opponent'
            ? t('play.resignThemWarning')
            : '',
    );
    toggleClass(barNotice, 'is-warn', out || resignArmed !== null);

    setText(
      counterLine,
      t('play.counters', { mine: game.sides.me.moves, theirs: game.sides.opponent.moves }),
    );
    const limit = game.settings.move_limit_total;
    const total = totalMoves(game);
    const reached = limit !== 0 && total >= limit;
    setText(limitLine, limit === 0 ? t('play.noLimit', { total }) : t('play.limit', { total, limit }));
    toggleClass(limitLine, 'is-warn', reached);

    const merged = mergeHistory(game.history, corrections);
    history.me.update(merged.filter((entry) => entry.side === 'me'));
    history.opponent.update(merged.filter((entry) => entry.side === 'opponent'));
  }

  /**
   * Fills the block that says what to do or what to say right now.
   *
   * In the opponent's turn this block carries the one thing the player has to
   * do with their voice rather than their eyes, so it is the loudest thing on
   * the screen and it stays until the next input.
   *
   * @param {boolean} mine Whether it is my turn.
   * @param {boolean} out Whether this player has resigned.
   * @returns {void}
   */
  function renderVoice(mine, out) {
    const asking = pending !== null;
    const confirming = asking && pending.mode === 'confirm-wall';

    for (const row of [voiceAnswers, boardAnswers]) {
      toggleClass(row.root, 'is-active', asking);
      row.pass.hidden = confirming;
      setText(row.wall, confirming ? t('play.confirmWall') : t('play.answerWalled'));
      setText(
        row.label,
        asking
          ? `${cellToLabel(pending.from.r, pending.from.c)} → ${cellToLabel(pending.to.r, pending.to.c)}`
          : '',
      );
    }

    // The line to read out loud, in both of its places. It is driven by
    // `sayLine` alone, not by whose turn it is, so handing the turn over -
    // by hand or by the switch - does not take it off the screen.
    const sayText =
      sayLine === null
        ? ''
        : sayLine.result === 'wall'
          ? t('play.sayWall', {
              from: cellToLabel(sayLine.from.r, sayLine.from.c),
              to: cellToLabel(sayLine.to.r, sayLine.to.c),
            })
          : t('play.sayPass');
    for (const node of [sayBanner, sayUnderBoard]) {
      setText(node, sayText);
      node.hidden = sayText === '';
    }

    clear(overrideRow);
    for (const flag of ['is-question', 'is-auto', 'is-out', 'is-handed']) {
      toggleClass(voiceLine, flag, false);
    }

    if (out) {
      toggleClass(voiceLine, 'is-out', true);
      setText(voiceLine, isOut() ? t('play.finished') : t('play.finishedThem'));
      setText(voiceHint, isOut() ? t('play.finishedHint') : t('play.finishedThemHint'));
      helpBlock.hidden = true;
      return;
    }
    helpBlock.hidden = false;

    if (asking) {
      toggleClass(voiceLine, 'is-question', true);
      setText(
        voiceLine,
        confirming
          ? t('play.confirmWallQuestion', {
              from: cellToLabel(pending.from.r, pending.from.c),
              to: cellToLabel(pending.to.r, pending.to.c),
            })
          : t('play.askAnswer', {
              from: cellToLabel(pending.from.r, pending.from.c),
              to: cellToLabel(pending.to.r, pending.to.c),
            }),
      );
      setText(voiceHint, confirming ? t('play.confirmWallHint') : t('play.askAnswerHint'));
      return;
    }

    if (autoEnded !== null) {
      // The switch handed the turn over. Say so, and say why.
      toggleClass(voiceLine, 'is-handed', true);
      setText(
        voiceLine,
        autoEnded.kind === 'wall'
          ? t('play.handedOverWall', {
              from: cellToLabel(autoEnded.from.r, autoEnded.from.c),
              to: cellToLabel(autoEnded.to.r, autoEnded.to.c),
            })
          : t('play.handedOverCells'),
      );
      setText(voiceHint, mine ? t('play.chooseYourStep') : t('play.chooseTheirStep'));
      return;
    }

    if (mine && lastStep !== null && lastStep.side === 'me' && lastStep.auto === true) {
      toggleClass(voiceLine, 'is-auto', true);
      setText(
        voiceLine,
        t('play.fromMap', {
          from: cellToLabel(lastStep.from.r, lastStep.from.c),
          to: cellToLabel(lastStep.to.r, lastStep.to.c),
        }),
      );
      setText(voiceHint, t('play.fromMapHint'));
      // Small and quiet, because it is needed rarely - but without it the
      // application would be arguing with a living person.
      overrideRow.appendChild(
        el('button', {
          class: 'play__override-button',
          text: t('play.overrideAuto'),
          attrs: { type: 'button' },
          on: { click: () => overrideAutoStep() },
        }),
      );
      return;
    }

    setText(voiceLine, mine ? t('play.chooseYourStep') : t('play.chooseTheirStep'));
    setText(voiceHint, '');
  }

  document.addEventListener('keydown', handleKeydown);
  globalThis.addEventListener('beforeunload', handleBeforeUnload);

  return {
    root,

    update(uiState) {
      if (!isGameSetupComplete(uiState)) {
        game = null;
        failure = t('play.setupMissing');
        render(uiState);
        return;
      }
      if (game === null || uiState.gameActions.length !== appliedCount) {
        rebuild(uiState);
      }
      render(uiState);
    },

    destroy() {
      document.removeEventListener('keydown', handleKeydown);
      globalThis.removeEventListener('beforeunload', handleBeforeUnload);
      if (timerHandle !== null) {
        clearInterval(timerHandle);
        timerHandle = null;
      }
      boards.me.destroy();
      boards.opponent.destroy();
      root.remove();
    },
  };
}
