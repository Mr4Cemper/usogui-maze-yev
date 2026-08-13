/**
 * screens/verify.js - screen 4: the exchange of reveals and the report
 * (SPEC 4.7, 4.8, 4.9, 2.5).
 *
 * Everything here is computed by the core. `verifyReveal` runs the seven
 * checks, `computeVerdict` decides the game; this screen hands them what it
 * has and shows what came back, in codes translated to words.
 *
 * Two things it must not do, and both are easy to do by accident:
 *
 *   - present the player's own statement as a computed result. "The opponent
 *     never sent a reveal" is something a person says, not something an
 *     application can check (SPEC 4.9);
 *   - word any failure as an accusation. A code that fails its checksum was
 *     damaged while copying; a commit that does not match was either mistyped
 *     or covers another maze (SPEC 4.8).
 */

import { buildAnswerLog } from '../../core/game.js';
import { cellToLabel } from '../../core/edges.js';
import { buildPayload, computeCommit, decodeReveal, encodeReveal } from '../../core/commit.js';
import { hexToBytes } from '../../core/sha256.js';
import { computeVerdict, verifyReveal } from '../../core/verify.js';
import { createMaze } from '../../core/maze.js';
import { createGameSettings, encodeSettingsCode } from '../../core/settings.js';
import { clear, el, setText, toggleClass } from '../dom.js';
import { createBoard, gameBoardModel, normalizeBoardModel } from '../board.js';
import { createCodeField, createCodeOutput } from '../components/codeField.js';
import { createReportPanel, verdictHeadline, verdictReasonText, verdictTone } from '../components/reportPanel.js';
import { createHistoryBlock, mergeHistory } from '../components/historyPanel.js';
import { isGameSetupComplete, runJournal } from '../gameLog.js';
import { nextGameState } from '../store.js';
import { downloadText, fileStamp } from '../download.js';
import { appendStroke, brushFor } from '../ink.js';
import { saveArchiveJson, saveBoardsPng } from '../export.js';
import { revealFileContents } from './build.js';
import { t } from '../../i18n/index.js';

/**
 * Builds an Error carrying a machine readable code.
 *
 * @param {string} code Failure kind, understood by `describeCodeError`.
 * @param {string} message Human readable English text.
 * @returns {Error} The error, ready to be thrown.
 */
function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Recognises which of the three codes of SPEC 4.4 was pasted.
 *
 * @param {string} value Whatever is in the field.
 * @returns {'reveal'|'settings'|'commit'|'unknown'} The kind.
 */
export function classifyCode(value) {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (text.startsWith('YMR1-')) {
    return 'reveal';
  }
  if (text.startsWith('YMC1-')) {
    return 'commit';
  }
  if (text.startsWith('YM1-')) {
    return 'settings';
  }
  return 'unknown';
}

/**
 * Reads the reveal string the opponent sent, and refuses the two mistakes that
 * would otherwise end in a false accusation.
 *
 * Pasting your own reveal here is a mistake of the hand: the two strings are
 * 68 characters each and sit next to each other. Left alone it would fail the
 * commit check, and "the commit does not match" is the most alarming line this
 * application can print (SPEC 4.8). The commits are compared, not the strings,
 * so spacing, case and grouping make no difference.
 *
 * @param {string} value The pasted string.
 * @param {string|null} myCommitHex My own commit, 64 hex characters, or null
 *   when this device no longer has one.
 * @returns {Promise<{payload: Uint8Array, salt: Uint8Array, commit: string}>}
 *   The parsed reveal.
 * @throws {Error} With `code = 'WRONG_KIND_SETTINGS'` or
 *   `'WRONG_KIND_COMMIT'` when another code was pasted, `'OWN_REVEAL'` when it
 *   is this player's own reveal, and the codes of `decodeReveal` otherwise.
 */
export async function readOpponentReveal(value, myCommitHex) {
  const kind = classifyCode(value);
  if (kind === 'settings') {
    throw codedError('WRONG_KIND_SETTINGS', 'this is a settings code, not a reveal string');
  }
  if (kind === 'commit') {
    throw codedError('WRONG_KIND_COMMIT', 'this is a commit code, not a reveal string');
  }
  const { payload, salt } = await decodeReveal(value);
  const commit = await computeCommit(payload, salt);
  if (myCommitHex !== null && commit === myCommitHex) {
    throw codedError('OWN_REVEAL', 'this reveal string is your own');
  }
  return { payload, salt, commit };
}

/**
 * Shortens a long code for a headline: enough of both ends to recognise it.
 *
 * @param {string} code The code.
 * @returns {string} The short form.
 */
export function shortCode(code) {
  return code.length <= 24 ? code : `${code.slice(0, 13)}…${code.slice(-6)}`;
}

/**
 * Builds screen 4.
 *
 * @param {object} options Screen options.
 * @param {object} options.store The application store.
 * @returns {{root: HTMLElement, update: (state: object) => void, destroy: () => void}}
 *   The screen element, its updater and a cleanup hook.
 */
export function createVerifyScreen({ store }) {
  /** The finished game, replayed from the journal. */
  let game = null;
  /** Correction lines of the journal, for the history. */
  let corrections = [];
  /** The report of the last successful run of `verifyReveal`. */
  let report = null;
  /** The reveal string the opponent sent, once it parses. */
  let theirReveal = null;
  /** How far the replay has been wound: null means "the whole game". */
  let replayAt = null;
  let replayTimer = null;
  /** Set when the player declares that no reveal ever arrived. */
  let noRevealArmed = false;
  let noRevealDeclared = false;
  let myReveal = null;

  const boardFrames = {
    opponent: el('div', { class: 'board-panel__frame' }),
    me: el('div', { class: 'board-panel__frame' }),
  };
  const boards = {
    opponent: createBoard(boardFrames.opponent, { mode: 'readonly', label: t('play.myMazeTitle') }),
    me: createBoard(boardFrames.me, { mode: 'readonly', label: t('play.opponentMazeTitle') }),
  };

  const myRevealOutput = createCodeOutput({
    label: t('verify.myRevealLabel'),
    hint: t('verify.myRevealHint'),
  });
  const saveAgainButton = el('button', {
    text: t('verify.saveAgain'),
    attrs: { type: 'button' },
    on: { click: () => void saveRevealFile() },
  });
  const myRevealStatus = el('div', { class: 'status', attrs: { role: 'status' } });
  const myRevealPaste = createCodeField({
    label: t('verify.myRevealPasteLabel'),
    hint: t('verify.myRevealPasteHint'),
    placeholder: 'YMR1-…-XXXX',
    acceptedText: t('verify.myRevealPasteAccepted'),
    decode: (value) => decodeReveal(value),
    onAccepted: (_, value) => {
      myReveal = value;
      myRevealOutput.setCode(value);
    },
  });
  const myRevealPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('verify.myRevealTitle') }),
    el('p', { class: 'panel__hint', text: t('verify.myRevealExplain') }),
    el('p', { class: 'status is-warn', text: t('verify.noRevealRule') }),
    myRevealOutput.root,
    el('div', { class: 'button-row' }, [saveAgainButton]),
    myRevealStatus,
    myRevealPaste.root,
  ]);

  const theirRevealField = createCodeField({
    label: t('verify.theirRevealLabel'),
    hint: t('verify.theirRevealHint'),
    placeholder: 'YMR1-…-XXXX',
    acceptedText: t('verify.theirRevealAccepted'),
    // The core parses it, and the two mix-ups that would end in a false
    // accusation are caught before the report is ever started (SPEC 4.8).
    decode: (value) => readOpponentReveal(value, store.getState().commit?.commit ?? null),
    onAccepted: (_, value) => {
      theirReveal = value;
      void runCheck();
    },
    onCleared: () => {
      theirReveal = null;
      report = null;
      render(store.getState());
    },
  });

  const noRevealButton = el('button', {
    text: t('verify.noReveal'),
    attrs: { type: 'button' },
    on: { click: () => declareNoReveal() },
  });
  const noRevealNotice = el('p', { class: 'status is-warn' });
  const noRevealVerdict = el('div', { class: 'verdict' });
  const theirRevealPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('verify.theirRevealTitle') }),
    theirRevealField.root,
    el('div', { class: 'button-row' }, [noRevealButton]),
    noRevealNotice,
    noRevealVerdict,
  ]);

  const noCommitNotice = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('verify.noCommitTitle') }),
    el('p', { class: 'panel__hint', text: t('verify.noCommitText') }),
  ]);

  // Nobody has to remember what is in the state: the report says what it is
  // about, right above itself.
  const subjectLine = el('div', { class: 'verify__subject' });
  // The strip opens this screen at any point, so a game that is still going on
  // can be looked at here. Everything the report says is then about a part of
  // a game, and it says so rather than letting a running game read as a
  // result.
  const runningNotice = el('p', { class: 'status is-warn', text: t('verify.gameRunning') });
  const reportPanel = createReportPanel();

  // Both exports live here: the game is over, the report is on the page, and
  // the archive has something to hold. On the game screen every button costs
  // height the boards need, so only the picture goes there (SPEC 5.9).
  const exportStatus = el('div', { class: 'status', attrs: { role: 'status' } });
  const pngButton = el('button', {
    text: t('export.png'),
    attrs: { type: 'button' },
    on: { click: () => void savePicture() },
  });
  const jsonButton = el('button', {
    text: t('export.json'),
    attrs: { type: 'button' },
    on: { click: () => saveArchive() },
  });
  const exportPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('export.title') }),
    el('p', { class: 'panel__hint', text: t('export.hint') }),
    el('div', { class: 'button-row' }, [pngButton, jsonButton]),
    exportStatus,
  ]);
  const replayLabel = el('span', { class: 'counter' });
  const replayButtons = {
    start: el('button', { text: t('verify.replayStart'), attrs: { type: 'button' }, on: { click: () => setReplay(0) } }),
    back: el('button', { text: t('verify.replayBack'), attrs: { type: 'button' }, on: { click: () => stepReplay(-1) } }),
    play: el('button', { text: t('verify.replayPlay'), attrs: { type: 'button' }, on: { click: () => toggleAutoReplay() } }),
    forward: el('button', { text: t('verify.replayForward'), attrs: { type: 'button' }, on: { click: () => stepReplay(1) } }),
    end: el('button', { text: t('verify.replayEnd'), attrs: { type: 'button' }, on: { click: () => setReplay(null) } }),
  };
  const replayPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('verify.replayTitle') }),
    el('p', { class: 'panel__hint', text: t('verify.replayHint') }),
    el('div', { class: 'button-row' }, [
      replayButtons.start,
      replayButtons.back,
      replayButtons.play,
      replayButtons.forward,
      replayButtons.end,
      replayLabel,
    ]),
  ]);

  const history = {
    me: createHistoryBlock({ title: t('play.historyMine'), emptyText: t('play.historyEmpty') }),
    opponent: createHistoryBlock({
      title: t('play.historyTheirs'),
      emptyText: t('play.historyEmpty'),
    }),
  };

  const boardPanels = {
    opponent: el('section', { class: 'panel board-panel' }, [
      el('h3', { class: 'panel__title', text: t('verify.myBoardTitle') }),
      boardFrames.opponent,
    ]),
    me: el('section', { class: 'panel board-panel' }, [
      el('h3', { class: 'panel__title', text: t('verify.theirBoardTitle') }),
      el('p', { class: 'panel__hint', text: t('verify.theirBoardHint') }),
      boardFrames.me,
    ]),
  };

  const nextGameButton = el('button', {
    text: t('verify.nextGame'),
    attrs: { type: 'button' },
    on: { click: () => void startNextGame() },
  });
  const nextGameStatus = el('div', { class: 'status', attrs: { role: 'status' } });
  const reviewedPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('verify.reviewedTitle') }),
    el('p', { class: 'panel__hint', text: t('verify.reviewedText') }),
    el('p', { class: 'status is-warn', text: t('verify.nextGameWarning') }),
    el('div', { class: 'button-row' }, [nextGameButton]),
    nextGameStatus,
  ]);

  const noGameNotice = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('verify.noGameTitle') }),
    el('p', { class: 'panel__hint', text: t('verify.noGameText') }),
  ]);

  const root = el('div', { class: 'screen' }, [
    noGameNotice,
    noCommitNotice,
    runningNotice,
    el('div', { class: 'columns' }, [myRevealPanel, theirRevealPanel]),
    subjectLine,
    reportPanel.root,
    reviewedPanel,
    // The replay controls sit directly on top of the boards they move: press
    // "forward" and the change is in front of you, not two screens down.
    exportPanel,
    replayPanel,
    el('div', { class: 'play__boards' }, [boardPanels.opponent, boardPanels.me]),
    el('div', { class: 'columns' }, [history.me.root, history.opponent.root]),
  ]);

  /**
   * The revealed maze, but only when it was actually checked.
   *
   * @returns {object|null} What the reveal contained, or null.
   */
  function revealedMaze() {
    return report !== null && report.revealed !== null && report.steps[1].status === 'ok'
      ? report.revealed
      : null;
  }

  /**
   * Saves both boards as one picture (SPEC 5.9).
   *
   * @returns {Promise<void>} Resolves once the browser was asked.
   */
  async function savePicture() {
    try {
      await saveBoardsPng([
        { board: boards.opponent.root, caption: t('verify.myBoardTitle') },
        { board: boards.me.root, caption: t('verify.theirBoardTitle') },
      ]);
      setText(exportStatus, '');
    } catch (error) {
      // A token that survived serialisation lands here rather than in a black
      // rectangle the player has to puzzle over.
      setText(exportStatus, t('export.failed', { message: error.message }));
      toggleClass(exportStatus, 'is-error', true);
    }
  }

  /**
   * Saves the archive of the game (SPEC 5.9). For reading only.
   *
   * @returns {void}
   */
  function saveArchive() {
    saveArchiveJson({
      state: store.getState(),
      game,
      report,
      revealed: revealedMaze(),
    });
  }
  /**
   * Rebuilds my own reveal string from the commit that is still in the state.
   *
   * @param {object} uiState Application state.
   * @returns {Promise<void>} Resolves once it is on screen.
   */
  async function buildMyReveal(uiState) {
    if (uiState.commit === null || !isGameSetupComplete(uiState)) {
      myReveal = null;
      myRevealOutput.setCode(null);
      return;
    }
    try {
      const payload = buildPayload(
        uiState.settings,
        createMaze({
          entrance: uiState.myMaze.entrance,
          exit: uiState.myMaze.exit,
          walls: uiState.myMaze.walls,
        }),
      );
      myReveal = await encodeReveal(payload, hexToBytes(uiState.commit.saltHex));
      myRevealOutput.setCode(myReveal);
    } catch (error) {
      // The salt or the maze did not survive; the file saved before the game
      // is then the only copy, and the player is told exactly that.
      myReveal = null;
      myRevealOutput.setCode(null);
      setText(myRevealStatus, t('verify.myRevealLost', { message: error.message }));
    }
  }

  /**
   * Saves the reveal file again, for a player who lost the first one.
   *
   * @returns {Promise<void>} Resolves once the browser was asked to save.
   */
  async function saveRevealFile() {
    const uiState = store.getState();
    if (myReveal === null || uiState.commit === null) {
      return;
    }
    const now = new Date();
    const saved = downloadText(
      `usogui-maze-reveal-${fileStamp(now)}.txt`,
      revealFileContents({
        reveal: myReveal,
        settingsCode: uiState.settingsCode ?? t('build.noSettingsCode'),
        commitCode: uiState.commit.commitCode,
        entrance: cellToLabel(uiState.myMaze.entrance.r, uiState.myMaze.entrance.c),
        exit: cellToLabel(uiState.myMaze.exit.r, uiState.myMaze.exit.c),
        savedAt: now.toISOString(),
      }),
    );
    setText(myRevealStatus, saved ? t('build.revealSaved') : t('build.revealFailed'));
    toggleClass(myRevealStatus, 'is-ok', saved);
    toggleClass(myRevealStatus, 'is-error', !saved);
  }

  /**
   * Runs the seven checks over the reveal the opponent sent.
   *
   * @returns {Promise<void>} Resolves once the report is on screen.
   */
  async function runCheck() {
    const uiState = store.getState();
    if (game === null || theirReveal === null || uiState.opponentCommit === null) {
      return;
    }
    try {
      report = await verifyReveal({
        expectedCommit: uiState.opponentCommit.code,
        agreedSettings: uiState.settings,
        declaredEntrance: uiState.opponentEnds.entrance,
        declaredExit: uiState.opponentEnds.exit,
        revealString: theirReveal,
        opponentAnswerLog: buildAnswerLog(game, 'me'),
        gameState: game,
      });
    } catch (error) {
      // Only malformed input reaches this, and the field itself has already
      // said what was wrong with it.
      report = null;
      console.warn('the report could not be produced:', error.message);
    }
    render(store.getState());
  }

  /**
   * Records the player's statement that no reveal ever arrived.
   *
   * By the rules that loses the game for the opponent (SPEC 4.9), and the core
   * can express it - a side that cannot reveal is handled by the same
   * violation channel as one caught cheating. What the core cannot do is
   * check it, so the screen says out loud that this is a statement.
   *
   * @returns {void}
   */
  function declareNoReveal() {
    if (game === null) {
      return;
    }
    if (!noRevealArmed) {
      noRevealArmed = true;
      render(store.getState());
      return;
    }
    noRevealArmed = false;
    noRevealDeclared = true;
    report = null;
    render(store.getState());
  }

  /**
   * Starts another game between the same two people under the same rules.
   *
   * The values of the settings survive; the game number does not, because a
   * new game needs a new one. That means a new settings code, and it has to be
   * sent to the opponent again - which the screen says out loud, because a
   * mismatched game number is only discovered at the next verification, after
   * a whole game has been played (SPEC 4.3).
   *
   * @returns {Promise<void>} Resolves once the next game is set up.
   */
  async function startNextGame() {
    const uiState = store.getState();
    if (uiState.settings === null) {
      return;
    }
    try {
      const { game_nonce: _dropped, ...values } = uiState.settings;
      const freshSettings = createGameSettings(values);
      const freshCode = await encodeSettingsCode(freshSettings);
      store.setState((state) => nextGameState(state, freshSettings, freshCode));
    } catch (error) {
      // Only the core can refuse here, and only for a reason it can name.
      setText(nextGameStatus, error.message);
      toggleClass(nextGameStatus, 'is-error', true);
    }
  }

  /**
   * Winds the replay to a number of actions.
   *
   * @param {number|null} at How many journal entries to play, or null for the
   *   whole game.
   * @returns {void}
   */
  function setReplay(at) {
    replayAt = at;
    render(store.getState());
  }

  /**
   * Moves the replay by one action.
   *
   * @param {number} delta Direction, -1 or 1.
   * @returns {void}
   */
  function stepReplay(delta) {
    const total = store.getState().gameActions.length;
    const current = replayAt === null ? total : replayAt;
    setReplay(Math.min(total, Math.max(0, current + delta)));
  }

  /**
   * Starts or stops the automatic replay.
   *
   * @returns {void}
   */
  function toggleAutoReplay() {
    if (replayTimer !== null) {
      clearInterval(replayTimer);
      replayTimer = null;
      render(store.getState());
      return;
    }
    const total = store.getState().gameActions.length;
    if (replayAt === null || replayAt >= total) {
      replayAt = 0;
    }
    replayTimer = setInterval(() => {
      const count = store.getState().gameActions.length;
      if (replayAt === null || replayAt >= count) {
        clearInterval(replayTimer);
        replayTimer = null;
        render(store.getState());
        return;
      }
      replayAt += 1;
      render(store.getState());
    }, 700);
    render(store.getState());
  }

  /**
   * The state to draw: the finished game, or the game as it was after the
   * chosen number of actions. The replay runs on its own state and never
   * touches the game.
   *
   * @param {object} uiState Application state.
   * @returns {{state: object, corrections: Array<object>}|null} What to draw.
   */
  function shownGame(uiState) {
    if (game === null) {
      return null;
    }
    if (replayAt === null) {
      return { state: game, corrections };
    }
    try {
      return runJournal(uiState, uiState.gameActions.slice(0, replayAt));
    } catch (error) {
      console.warn('the replay could not be wound there:', error.message);
      return { state: game, corrections };
    }
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
   * Draws the screen.
   *
   * @param {object} uiState Application state.
   * @returns {void}
   */
  function render(uiState) {
    const shown = shownGame(uiState);
    const hasCommit = uiState.opponentCommit !== null;
    // The core never ends a game by itself (SPEC 6.3), so "over" means one of
    // the sides resigned - the same thing the game screen reads.
    const running =
      game !== null && !game.sides.me.resigned && !game.sides.opponent.resigned;
    runningNotice.hidden = !running;
    noGameNotice.hidden = game !== null;
    // Say up front that there is nothing to check against, instead of waiting
    // for a pasted string only to show nothing.
    noCommitNotice.hidden = game === null || hasCommit;
    theirRevealPanel.hidden = game === null || !hasCommit;
    replayPanel.hidden = game === null;
    exportPanel.hidden = game === null;
    reportPanel.root.hidden = game === null;
    // "New game, same rules" throws the journal away. It is not offered while
    // that journal is a game still being played.
    reviewedPanel.hidden = running || (report === null && !noRevealDeclared);

    // A short headline over the report: whose commit, which ends they
    // announced, which settings both sides agreed on.
    setText(
      subjectLine,
      game === null || !hasCommit
        ? ''
        : t('verify.subject', {
            commit: shortCode(uiState.opponentCommit.code),
            entrance: cellToLabel(uiState.opponentEnds.entrance.r, uiState.opponentEnds.entrance.c),
            exit: cellToLabel(uiState.opponentEnds.exit.r, uiState.opponentEnds.exit.c),
            settings: uiState.settingsCode ?? t('build.noSettingsCode'),
          }),
    );
    subjectLine.hidden = subjectLine.textContent === '';

    const revealed = report !== null && report.revealed !== null && report.steps[1].status === 'ok';
    const mismatchEdges = report === null ? [] : report.mismatches.map((item) => item.edge);

    if (shown !== null) {
      boards.opponent.render(gameBoardModel(shown.state, 'opponent'));
      boards.opponent.renderInk(uiState.ink, 'opponent');
      boards.me.renderInk(uiState.ink, 'me');
      boards.opponent.setDrawing(brushFor(uiState, 'opponent', addStroke));
      boards.me.setDrawing(brushFor(uiState, 'me', addStroke));

      // Their maze is drawn in full once the reveal has been checked, with
      // what was scouted during the game on top, so it is plain where the
      // player never got to.
      const scouted = gameBoardModel(shown.state, 'me');
      boards.me.render(
        normalizeBoardModel({
          walls: revealed ? [...report.revealed.maze.walls] : [],
          knownWalls: [...scouted.knownWalls],
          knownPassages: [...scouted.knownPassages],
          entrance: scouted.entrance,
          exit: scouted.exit,
          visitedCells: [...scouted.visitedCells],
          tokens: { me: scouted.tokens.me },
          highlight: { edges: mismatchEdges },
        }),
      );

      const merged = mergeHistory(shown.state.history, shown.corrections);
      history.me.update(merged.filter((entry) => entry.side === 'me'));
      history.opponent.update(merged.filter((entry) => entry.side === 'opponent'));

      const total = uiState.gameActions.length;
      setText(
        replayLabel,
        t('verify.replayAt', { at: replayAt === null ? total : replayAt, total }),
      );
      setText(replayButtons.play, replayTimer === null ? t('verify.replayPlay') : t('verify.replayPause'));
    }

    reportPanel.update(report);

    setText(
      noRevealNotice,
      noRevealDeclared
        ? t('verify.noRevealDeclared')
        : noRevealArmed
          ? t('verify.noRevealWarning')
          : '',
    );
    clear(noRevealVerdict);
    if (noRevealDeclared && game !== null) {
      // The core can express "did not reveal" through the same violation
      // channel as a caught violation, because by the rules the outcome is the
      // same. What it cannot do is verify it, so the block says whose words
      // these are.
      const verdict = computeVerdict(game, game.settings, { opponent: ['NO_REVEAL'] });
      noRevealVerdict.appendChild(
        el('div', { class: `verdict__line is-${verdictTone(verdict)}` }, [
          el('span', { text: verdictHeadline(verdict) }),
        ]),
      );
      noRevealVerdict.appendChild(
        el('p', { class: 'panel__hint', text: verdictReasonText(verdict.reason) }),
      );
      noRevealVerdict.appendChild(
        el('p', { class: 'status is-warn', text: t('verify.noRevealNotProof') }),
      );
    }
    setText(noRevealButton, noRevealArmed ? t('verify.noRevealConfirm') : t('verify.noReveal'));
    toggleClass(noRevealButton, 'is-primary', noRevealArmed);
    noRevealButton.hidden = noRevealDeclared;

    saveAgainButton.disabled = myReveal === null;
    myRevealPaste.root.hidden = myReveal !== null;
  }

  return {
    root,

    update(uiState) {
      if (isGameSetupComplete(uiState)) {
        try {
          const replayed = runJournal(uiState, uiState.gameActions);
          game = replayed.state;
          corrections = replayed.corrections;
        } catch (error) {
          console.warn('the game could not be replayed for verification:', error.message);
          game = null;
        }
      } else {
        game = null;
      }
      if (myReveal === null) {
        void buildMyReveal(uiState);
      }
      render(uiState);
    },

    destroy() {
      if (replayTimer !== null) {
        clearInterval(replayTimer);
        replayTimer = null;
      }
      boards.me.destroy();
      boards.opponent.destroy();
      root.remove();
    },
  };
}
