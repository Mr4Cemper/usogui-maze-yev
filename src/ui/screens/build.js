/**
 * screens/build.js - screen 2: building the maze (SPEC 2.1, 5.3).
 *
 * Left board: my own maze, the one the opponent will walk. Right board: the
 * opponent's maze, where only the two ends are known, because the opponent
 * announced them out loud (SPEC 2.4).
 *
 * The screen decides nothing about validity: it hands the maze to
 * `validateMaze` after every change and renders what comes back. The commit,
 * the salt and the reveal all come from the core as well.
 */

import { cellToLabel } from '../../core/edges.js';
import { createMaze, validateMaze } from '../../core/maze.js';
import {
  buildPayload,
  computeCommit,
  decodeCommitCode,
  encodeCommitCode,
  encodeReveal,
  generateSalt,
} from '../../core/commit.js';
import { bytesToHex, hexToBytes } from '../../core/sha256.js';
import { el, setText, toggleClass } from '../dom.js';
import { boardModelFromState, createBoard } from '../board.js';
import { createCodeField, createCodeOutput } from '../components/codeField.js';
import { createValidationPanel } from '../components/validationPanel.js';
import { downloadText, fileStamp } from '../download.js';
import { appendStroke, brushFor } from '../ink.js';
import { t } from '../../i18n/index.js';

/**
 * Renders a number of seconds as mm:ss.
 *
 * @param {number} seconds Seconds left, never negative.
 * @returns {string} The clock.
 */
export function formatClock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/**
 * Text of the reveal file. Kept pure so it can be read at a glance and tested.
 *
 * @param {object} data What the file has to carry.
 * @param {string} data.reveal The reveal string.
 * @param {string} data.settingsCode The settings code of this game.
 * @param {string} data.commitCode The commit code sent to the opponent.
 * @param {string} data.entrance Entrance label such as "A1".
 * @param {string} data.exit Exit label.
 * @param {string} data.savedAt Human readable timestamp.
 * @returns {string} File contents.
 */
export function revealFileContents(data) {
  return [
    t('reveal.fileTitle'),
    '',
    `${t('reveal.fileReveal')}: ${data.reveal}`,
    `${t('reveal.fileCommit')}: ${data.commitCode}`,
    `${t('reveal.fileSettings')}: ${data.settingsCode}`,
    `${t('reveal.fileEnds')}: ${data.entrance} / ${data.exit}`,
    `${t('reveal.fileSaved')}: ${data.savedAt}`,
    '',
    t('reveal.fileWhy'),
    t('reveal.fileLost'),
    '',
  ].join('\n');
}

/**
 * Builds screen 2.
 *
 * @param {object} options Screen options.
 * @param {object} options.store The application store.
 * @returns {{root: HTMLElement, update: (state: object) => void, destroy: () => void}}
 *   The screen element, its updater and a cleanup hook.
 */
export function createBuildScreen({ store }) {
  /** Snapshots of my maze, for the undo button. Not persisted on purpose. */
  const undoStack = [];
  let placeMode = 'walls';
  let opponentPlaceMode = 'entrance';
  let timerHandle = null;
  let lastValidation = null;

  /**
   * The maze as the core wants to see it.
   *
   * @param {object} state Application state.
   * @returns {object} A core maze object.
   */
  function coreMaze(state) {
    return createMaze({
      entrance: state.myMaze.entrance,
      exit: state.myMaze.exit,
      walls: state.myMaze.walls,
    });
  }

  /**
   * Remembers the current maze so the last change can be taken back.
   *
   * @returns {void}
   */
  function pushUndo() {
    const { myMaze } = store.getState();
    undoStack.push({
      entrance: myMaze.entrance,
      exit: myMaze.exit,
      walls: [...myMaze.walls],
    });
    if (undoStack.length > 200) {
      undoStack.shift();
    }
  }

  /**
   * Applies a change to my maze. Any change invalidates a commit that was
   * already made, which is why editing is blocked while one exists.
   *
   * @param {object} patch New pieces of the maze.
   * @returns {void}
   */
  function changeMaze(patch) {
    const state = store.getState();
    if (state.commit !== null) {
      return;
    }
    pushUndo();
    store.setState({ myMaze: { ...state.myMaze, ...patch } });
  }

  const myBoardFrame = el('div', { class: 'board-panel__frame' });
  const opponentBoardFrame = el('div', { class: 'board-panel__frame' });

  const myBoardView = createBoard(myBoardFrame, {
    mode: 'build',
    label: t('build.myBoardLabel'),
    onEdgeClick: (edgeId) => {
      if (placeMode !== 'walls') {
        return;
      }
      const { myMaze } = store.getState();
      const walls = myMaze.walls.includes(edgeId)
        ? myMaze.walls.filter((id) => id !== edgeId)
        : [...myMaze.walls, edgeId];
      changeMaze({ walls });
    },
    onCellClick: (cell) => {
      if (placeMode === 'entrance') {
        changeMaze({ entrance: cell });
      } else if (placeMode === 'exit') {
        changeMaze({ exit: cell });
      }
    },
  });

  const opponentBoardView = createBoard(opponentBoardFrame, {
    mode: 'build',
    label: t('build.opponentBoardLabel'),
    onCellClick: (cell) => {
      const { opponentEnds } = store.getState();
      store.setState({
        opponentEnds:
          opponentPlaceMode === 'entrance'
            ? { ...opponentEnds, entrance: cell }
            : { ...opponentEnds, exit: cell },
      });
    },
  });

  const placeButtons = new Map();
  /**
   * Builds one of the three placement buttons of my board.
   *
   * @param {'walls'|'entrance'|'exit'} mode Mode the button selects.
   * @param {string} label Button caption.
   * @returns {HTMLElement} The button.
   */
  function placeButton(mode, label) {
    const button = el('button', {
      text: label,
      attrs: { type: 'button' },
      on: {
        click: () => {
          placeMode = mode;
          refresh();
        },
      },
    });
    placeButtons.set(mode, button);
    return button;
  }

  const wallCounter = el('span', { class: 'counter' });
  const undoButton = el('button', {
    text: t('build.undo'),
    attrs: { type: 'button' },
    on: {
      click: () => {
        const previous = undoStack.pop();
        if (previous === undefined) {
          return;
        }
        const state = store.getState();
        if (state.commit !== null) {
          return;
        }
        store.setState({ myMaze: { ...previous, walls: [...previous.walls] } });
      },
    },
  });
  const resetButton = el('button', {
    text: t('build.reset'),
    attrs: { type: 'button' },
    on: {
      click: () => changeMaze({ entrance: null, exit: null, walls: [] }),
    },
  });

  const timerLine = el('div', { class: 'timer' });

  const myBoardPanel = el('section', { class: 'panel board-panel' }, [
    el('h2', { class: 'panel__title', text: t('build.myBoardTitle') }),
    el('p', { class: 'panel__hint', text: t('build.myBoardHint') }),
    el('div', { class: 'button-row' }, [
      placeButton('walls', t('build.modeWalls')),
      placeButton('entrance', t('build.modeEntrance')),
      placeButton('exit', t('build.modeExit')),
    ]),
    myBoardFrame,
    el('div', { class: 'button-row' }, [wallCounter, undoButton, resetButton]),
    timerLine,
  ]);

  const opponentButtons = new Map();
  /**
   * Builds one of the two placement buttons of the opponent's board.
   *
   * @param {'entrance'|'exit'} mode Mode the button selects.
   * @param {string} label Button caption.
   * @returns {HTMLElement} The button.
   */
  function opponentButton(mode, label) {
    const button = el('button', {
      text: label,
      attrs: { type: 'button' },
      on: {
        click: () => {
          opponentPlaceMode = mode;
          refresh();
        },
      },
    });
    opponentButtons.set(mode, button);
    return button;
  }

  const opponentEndsLine = el('div', { class: 'counter' });
  const opponentBoardPanel = el('section', { class: 'panel board-panel' }, [
    el('h2', { class: 'panel__title', text: t('build.opponentBoardTitle') }),
    el('p', { class: 'panel__hint', text: t('build.opponentBoardHint') }),
    el('div', { class: 'button-row' }, [
      opponentButton('entrance', t('build.modeEntrance')),
      opponentButton('exit', t('build.modeExit')),
    ]),
    opponentBoardFrame,
    opponentEndsLine,
  ]);

  const validationPanel = createValidationPanel({ title: t('validate.title') });

  const commitOutput = createCodeOutput({
    label: t('build.commitLabel'),
    hint: t('build.commitHint'),
  });
  const commitButton = el('button', {
    class: 'is-primary',
    text: t('build.freeze'),
    attrs: { type: 'button' },
    on: { click: () => void makeCommit() },
  });
  const unfreezeButton = el('button', {
    text: t('build.unfreeze'),
    attrs: { type: 'button' },
    on: { click: () => unfreeze() },
  });
  const commitStatus = el('div', { class: 'status', attrs: { role: 'status' } });
  const commitPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('build.commitTitle') }),
    el('p', { class: 'panel__hint', text: t('build.commitExplain') }),
    el('div', { class: 'button-row' }, [commitButton, unfreezeButton]),
    commitStatus,
    commitOutput.root,
  ]);

  const revealButton = el('button', {
    class: 'is-primary',
    text: t('build.saveReveal'),
    attrs: { type: 'button' },
    on: { click: () => void saveReveal() },
  });
  const revealStatus = el('div', { class: 'status', attrs: { role: 'status' } });
  const revealPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('build.revealTitle') }),
    el('p', { class: 'panel__hint', text: t('build.revealExplain') }),
    el('p', { class: 'status is-warn', text: t('build.revealWarning') }),
    el('div', { class: 'button-row' }, [revealButton]),
    revealStatus,
  ]);

  const opponentCommitField = createCodeField({
    label: t('build.opponentCommitLabel'),
    hint: t('build.opponentCommitHint'),
    placeholder: 'YMC1-…-XXXX',
    acceptedText: t('build.opponentCommitAccepted'),
    decode: (value) => decodeCommitCode(value),
    onAccepted: (commit, value) => {
      store.setState({ opponentCommit: { code: value, commit } });
    },
    onCleared: () => {
      if (store.getState().opponentCommit !== null) {
        store.setState({ opponentCommit: null });
      }
    },
  });
  const opponentCommitPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('build.opponentCommitTitle') }),
    opponentCommitField.root,
  ]);

  const checklist = el('ul', { class: 'checklist' });
  const startButton = el('button', {
    class: 'is-primary',
    text: t('build.start'),
    attrs: { type: 'button' },
    // Starting the game freezes the maze, the announced ends and the settings
    // (SPEC 2.1 step 6): from here on the journal is replayed against exactly
    // this setup, so it must not move.
    on: { click: () => store.setState({ screen: 'play', gameStarted: true }) },
  });
  const backButton = el('button', {
    text: t('build.back'),
    attrs: { type: 'button' },
    on: { click: () => store.setState({ screen: 'setup' }) },
  });
  const startPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('build.startTitle') }),
    checklist,
    el('div', { class: 'button-row' }, [startButton, backButton]),
  ]);

  const root = el('div', { class: 'screen' }, [
    el('div', { class: 'columns' }, [myBoardPanel, opponentBoardPanel]),
    validationPanel.root,
    el('div', { class: 'columns' }, [commitPanel, revealPanel]),
    el('div', { class: 'columns' }, [opponentCommitPanel, startPanel]),
  ]);

  /**
   * Freezes the maze: salt, payload, commit, transport code (SPEC 4.7 step 4).
   *
   * @returns {Promise<void>} Resolves once the commit is on screen.
   */
  async function makeCommit() {
    const state = store.getState();
    try {
      const salt = generateSalt();
      const payload = buildPayload(state.settings, coreMaze(state));
      const commit = await computeCommit(payload, salt);
      const commitCode = await encodeCommitCode(commit);
      store.setState({
        commit: { commit, commitCode, saltHex: bytesToHex(salt) },
        revealSaved: false,
      });
      toggleClass(commitStatus, 'is-error', false);
      setText(commitStatus, t('build.commitDone'));
    } catch (error) {
      // Only the core can refuse here, and only for a reason it can name.
      toggleClass(commitStatus, 'is-error', true);
      setText(commitStatus, error.message);
    }
  }

  /**
   * Drops the commit so the maze can be edited again. The salt goes with it,
   * which makes any reveal file saved so far useless.
   *
   * @returns {void}
   */
  function unfreeze() {
    store.setState({ commit: null, revealSaved: false });
    setText(commitStatus, t('build.unfrozen'));
    toggleClass(commitStatus, 'is-error', false);
    setText(revealStatus, '');
  }

  /**
   * Writes the reveal file. This is the blocking step of SPEC 4.7: without the
   * file there is no way to reveal, and no way to reveal is a technical loss.
   *
   * @returns {Promise<void>} Resolves once the browser was asked to save.
   */
  async function saveReveal() {
    const state = store.getState();
    if (state.commit === null) {
      return;
    }
    try {
      const payload = buildPayload(state.settings, coreMaze(state));
      const reveal = await encodeReveal(payload, hexToBytes(state.commit.saltHex));
      const now = new Date();
      const contents = revealFileContents({
        reveal,
        settingsCode: state.settingsCode ?? t('build.noSettingsCode'),
        commitCode: state.commit.commitCode,
        entrance: cellToLabel(state.myMaze.entrance.r, state.myMaze.entrance.c),
        exit: cellToLabel(state.myMaze.exit.r, state.myMaze.exit.c),
        savedAt: now.toISOString(),
      });
      const saved = downloadText(`usogui-maze-reveal-${fileStamp(now)}.txt`, contents);
      if (saved) {
        store.setState({ revealSaved: true });
        toggleClass(revealStatus, 'is-error', false);
        toggleClass(revealStatus, 'is-ok', true);
        setText(revealStatus, t('build.revealSaved'));
      } else {
        toggleClass(revealStatus, 'is-ok', false);
        toggleClass(revealStatus, 'is-error', true);
        setText(revealStatus, t('build.revealFailed'));
      }
    } catch (error) {
      toggleClass(revealStatus, 'is-ok', false);
      toggleClass(revealStatus, 'is-error', true);
      setText(revealStatus, error.message);
    }
  }

  /**
   * The four conditions of SPEC 2.1 step 6, each with its own line.
   *
   * @param {object} state Application state.
   * @returns {Array<{key: string, text: string, done: boolean}>} The checklist.
   */
  function startConditions(state) {
    const ends = state.opponentEnds;
    const endsPlaced =
      ends.entrance !== null &&
      ends.exit !== null &&
      !(ends.entrance.r === ends.exit.r && ends.entrance.c === ends.exit.c);
    return [
      {
        key: 'maze',
        text: t('build.checkMaze'),
        done: lastValidation !== null && lastValidation.ok && state.commit !== null,
      },
      { key: 'ends', text: t('build.checkOpponentEnds'), done: endsPlaced },
      { key: 'reveal', text: t('build.checkReveal'), done: state.revealSaved },
      { key: 'commit', text: t('build.checkOpponentCommit'), done: state.opponentCommit !== null },
    ];
  }

  /**
   * Redraws everything from the current state.
   *
   * @returns {void}
   */
  function refresh() {
    render(store.getState());
  }

  /**
   * Seconds left on the build clock, or null when there is no clock.
   *
   * The deadline lives in the state rather than in this closure: leaving for
   * the settings screen and coming back destroys the screen, and a clock that
   * restarts itself every time would measure nothing.
   *
   * @param {object} state Application state.
   * @returns {number|null} Seconds left.
   */
  function timerSecondsLeft(state) {
    const settings = state.settings;
    const enabled =
      settings !== null && settings.timers_visible === 1 && settings.build_timer_sec > 0;
    if (!enabled) {
      return null;
    }
    if (typeof state.buildTimerEndsAt !== 'number') {
      return settings.build_timer_sec;
    }
    return Math.max(0, Math.ceil((state.buildTimerEndsAt - Date.now()) / 1000));
  }

  /**
   * Starts the build clock (SPEC 5.10: visual only, blocks nothing).
   *
   * @param {object} state Application state.
   * @returns {void}
   */
  function ensureTimer(state) {
    if (timerSecondsLeft(state) === null) {
      if (timerHandle !== null) {
        clearInterval(timerHandle);
        timerHandle = null;
      }
      return;
    }
    if (typeof state.buildTimerEndsAt !== 'number') {
      store.setState({ buildTimerEndsAt: Date.now() + state.settings.build_timer_sec * 1000 });
      return;
    }
    if (timerHandle === null) {
      timerHandle = setInterval(paintTimer, 1000);
    }
  }

  /**
   * Writes the clock line.
   *
   * @returns {void}
   */
  function paintTimer() {
    const left = timerSecondsLeft(store.getState());
    if (left === null) {
      setText(timerLine, t('build.timerOff'));
      toggleClass(timerLine, 'is-off', true);
      toggleClass(timerLine, 'is-expired', false);
      return;
    }
    toggleClass(timerLine, 'is-off', false);
    toggleClass(timerLine, 'is-expired', left === 0);
    setText(
      timerLine,
      left === 0 ? t('build.timerExpired') : t('build.timerLeft', { clock: formatClock(left) }),
    );
  }

  /**
   * Draws the whole screen for a given state.
   *
   * @param {object} state Application state.
   * @returns {void}
   */
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
  function render(state) {
    const frozen = state.commit !== null;
    const started = state.gameStarted === true;

    myBoardView.setMode(frozen ? 'readonly' : 'build');
    myBoardView.render(boardModelFromState(state, 'mine'));
    opponentBoardView.render(boardModelFromState(state, 'opponent'));
    // A drawing belongs to the board it was made on, not to the screen.
    myBoardView.renderInk(state.ink, 'opponent');
    myBoardView.setDrawing(brushFor(state, 'opponent', addStroke));
    opponentBoardView.setDrawing(brushFor(state, 'me', addStroke));
    opponentBoardView.renderInk(state.ink, 'me');

    for (const [mode, button] of placeButtons) {
      toggleClass(button, 'is-active', mode === placeMode);
      button.disabled = frozen;
    }
    opponentBoardView.setMode(started ? 'readonly' : 'build');
    for (const [mode, button] of opponentButtons) {
      toggleClass(button, 'is-active', mode === opponentPlaceMode);
      button.disabled = started;
    }
    undoButton.disabled = frozen || undoStack.length === 0;
    resetButton.disabled = frozen;

    lastValidation = state.settings === null ? null : validateMaze(coreMaze(state), state.settings);
    validationPanel.update(lastValidation);

    setText(
      wallCounter,
      t('build.wallCounter', {
        count: state.myMaze.walls.length,
        limit: state.settings === null ? '?' : state.settings.wall_limit,
      }),
    );
    toggleClass(
      wallCounter,
      'is-error',
      lastValidation !== null && lastValidation.problems.includes('WALL_LIMIT_EXCEEDED'),
    );

    const ends = state.opponentEnds;
    setText(
      opponentEndsLine,
      t('build.opponentEnds', {
        entrance: ends.entrance === null ? '—' : cellToLabel(ends.entrance.r, ends.entrance.c),
        exit: ends.exit === null ? '—' : cellToLabel(ends.exit.r, ends.exit.c),
      }),
    );

    commitButton.disabled = frozen || lastValidation === null || !lastValidation.ok;
    // Once the game has started the maze is frozen for good: the journal is
    // replayed against it, and a changed wall would rewrite history.
    unfreezeButton.hidden = !frozen || started;
    if (started) {
      setText(commitStatus, t('build.gameStarted'));
      toggleClass(commitStatus, 'is-error', false);
    }
    commitOutput.setCode(frozen ? state.commit.commitCode : null);
    if (!frozen && commitStatus.textContent === '') {
      setText(commitStatus, t('build.commitPending'));
    }

    revealButton.disabled = !frozen;
    if (!frozen) {
      setText(revealStatus, t('build.revealNeedsCommit'));
      toggleClass(revealStatus, 'is-ok', false);
      toggleClass(revealStatus, 'is-error', false);
    } else if (state.revealSaved && revealStatus.textContent === '') {
      setText(revealStatus, t('build.revealSaved'));
      toggleClass(revealStatus, 'is-ok', true);
    }

    setText(startButton, started ? t('build.backToGame') : t('build.start'));
    const conditions = startConditions(state);
    checklist.replaceChildren(
      ...conditions.map((condition) =>
        el('li', {
          class: `checklist__item ${condition.done ? 'is-done' : 'is-missing'}`,
          text: `${condition.done ? '✓' : '•'} ${condition.text}`,
        }),
      ),
    );
    startButton.disabled = conditions.some((condition) => !condition.done);

    ensureTimer(state);
    paintTimer();
  }

  return {
    root,

    update(state) {
      render(state);
      if (state.opponentCommit !== null && opponentCommitField.getValue() === '') {
        opponentCommitField.setValue(state.opponentCommit.code);
      }
    },

    destroy() {
      if (timerHandle !== null) {
        clearInterval(timerHandle);
        timerHandle = null;
      }
      myBoardView.destroy();
      opponentBoardView.destroy();
      root.remove();
    },
  };
}
