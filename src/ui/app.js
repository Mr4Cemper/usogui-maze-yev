/**
 * app.js - the shell: which screen is on, and the state that survives a
 * reload.
 *
 * Part 3 carries screens 1 and 2. The game screen is a stub with one button
 * back, and the verification screen, the themes, the other languages, the
 * drawing overlay and the exports belong to the parts after this one.
 */

import { createBuildScreen } from './screens/build.js';
import { createPlayScreen } from './screens/play.js';
import { createRulesScreen } from './screens/rules.js';
import { createSetupScreen } from './screens/setup.js';
import { createVerifyScreen } from './screens/verify.js';
import { clear, el, setText, toggleClass } from './dom.js';
import {
  SCREENS,
  createDefaultState,
  createStore,
  deserializeState,
  resetState,
  serializeState,
} from './store.js';
import { isStorageAvailable, loadSnapshot, saveSnapshot } from './persist.js';
import { createRain, prefersReducedMotion } from './rain.js';
import { createSound } from './sound.js';
import { THEMES, applyTheme, isTheme, themeName } from './theme.js';
import { BOARD_TOKENS, boardWarnings, normalizeColour } from './colours.js';
import { BRUSH_WIDTHS, hasRoom, withoutLastStroke } from './ink.js';
import { REPOSITORY_URL } from './links.js';
import {
  applyColourOverrides,
  createColourPanel,
  warningText,
} from './components/colourPanel.js';
import {
  FALLBACK_LANGUAGE,
  availableLanguages,
  isLanguage,
  languageName,
  setLanguage,
  t,
} from '../i18n/index.js';

/** Screens, in the order of the stage strip. */
const STEPS = Object.freeze([
  { screen: 'setup', labelKey: 'setup' },
  { screen: 'build', labelKey: 'build' },
  { screen: 'play', labelKey: 'play' },
  { screen: 'verify', labelKey: 'verify' },
]);

/**
 * Caption of a header step.
 *
 * @param {string} key Step key.
 * @returns {string} The caption.
 */
function stepLabel(key) {
  switch (key) {
    case 'setup':
      return t('app.stepSetup');
    case 'build':
      return t('app.stepBuild');
    case 'play':
      return t('app.stepPlay');
    case 'verify':
      return t('app.stepVerify');
    default:
      return key;
  }
}

/**
 * The name of a board colour, in the language on screen.
 *
 * A switch of literals, not a built key: the checker reads the sources, and a
 * key it cannot see is a key that goes missing in a translation.
 *
 * @param {string} token Custom property name.
 * @returns {string} The name.
 */
export function boardColourName(token) {
  switch (token) {
    case '--board-entrance':
      return t('colours.entrance');
    case '--board-exit':
      return t('colours.exit');
    case '--board-token-me':
      return t('colours.tokenMe');
    case '--board-token-opponent':
      return t('colours.tokenOpponent');
    case '--board-wall':
      return t('colours.wall');
    case '--board-wall-found':
      return t('colours.wallFound');
    case '--board-passage':
      return t('colours.passage');
    case '--board-grid':
      return t('colours.grid');
    case '--board-label':
      return t('colours.label');
    case '--board-bg':
      return t('colours.boardBg');
    default:
      return token;
  }
}

/**
 * Whether a stage can be opened from the strip.
 *
 * A stage that has been reached stays reachable: the building screen shows a
 * frozen maze, the settings screen shows frozen settings, and nothing there
 * can change a game that is under way. Verification is open at any point -
 * during a game as much as after it - because the strip is the only way off
 * the game screen, and a player who never resigned would otherwise be locked
 * in (SPEC 5.3).
 *
 * @param {string} screen Screen name.
 * @param {object} state Application state.
 * @returns {boolean} True when the strip may open it.
 */
export function canOpen(screen, state) {
  if (screen === 'build') {
    return state.settings !== null;
  }
  if (screen === 'play') {
    return state.gameStarted === true;
  }
  return true;
}

/**
 * Opens a stage from the strip.
 *
 * Navigation moves the screen and nothing else: the journal, the maze, the
 * codes and every other field are handed back untouched (SPEC 5.3). A stage
 * that cannot be opened yet returns the very same state, so a click on a step
 * that is not ready cannot half-change anything.
 *
 * @param {object} state Application state.
 * @param {string} screen Screen to open.
 * @returns {object} The next state, or the same one when the stage is closed.
 * @throws {Error} If the screen is not one of the four.
 */
export function openStage(state, screen) {
  if (!SCREENS.includes(screen)) {
    throw new Error(`unknown stage ${JSON.stringify(screen)}`);
  }
  if (!canOpen(screen, state)) {
    return state;
  }
  return { ...state, screen };
}

/**
 * Opens the rules over whatever is on screen.
 *
 * The rules are not a stage and they are not a place: `screen` is left exactly
 * as it was, which is what makes going back a matter of one flag rather than
 * of remembering a route. They are reachable from everywhere, the game screen
 * included - the middle of a game is when a rule is usually needed (SPEC 5.3).
 *
 * @param {object} state Application state.
 * @returns {object} The state with the rules open.
 */
export function openRules(state) {
  return state.rulesOpen === true ? state : { ...state, rulesOpen: true };
}

/**
 * Closes the rules and gives the screen back untouched.
 *
 * @param {object} state Application state.
 * @returns {object} The state with the rules closed.
 */
export function closeRules(state) {
  return state.rulesOpen === true ? { ...state, rulesOpen: false } : state;
}

/**
 * Starts the application inside a container.
 *
 * @param {Element} container Element the interface is mounted into.
 * @returns {{store: object, destroy: () => void}} The store, so that a future
 *   part can drive the interface from tests, and a cleanup hook.
 * @throws {Error} If the container is missing.
 */
export function startApp(container) {
  if (container === null || container === undefined) {
    throw new Error('startApp needs a container element');
  }

  const restored = deserializeState(loadSnapshot() ?? createDefaultState());
  const store = createStore(restored);

  // The stage strip runs across the top and stays there while the page
  // scrolls, with a hairline between the steps.
  // The strip is the way out of every screen: a stage that has been reached
  // can be opened again, read only while a game is running.
  const stepNodes = new Map();
  const stripChildren = [];
  STEPS.forEach((step, index) => {
    if (index > 0) {
      stripChildren.push(el('i', { class: 'stagebar__line' }));
    }
    // The number and the word are separate elements: on a narrow screen the
    // word folds away and the number stays, and the button keeps its size
    // either way. The word carries the separator, so nothing dangles when it
    // goes (SPEC 5.13).
    const node = el(
      'button',
      {
        class: 'stagebar__step',
        attrs: { type: 'button' },
        on: { click: () => store.setState((state) => openStage(state, step.screen)) },
      },
      [
        el('span', { class: 'stagebar__num', text: String(index + 1) }),
        el('span', { class: 'stagebar__word' }),
      ],
    );
    stepNodes.set(step.screen, node);
    stripChildren.push(node);
  });
  const stagebar = el('nav', { class: 'stagebar', attrs: { 'aria-label': t('app.stages') } }, stripChildren);

  // Four short tones, made on the spot (SPEC 5.10). Built here and handed to
  // the screen that has something to sound about; the audio device itself is
  // not opened until the player asks for sound.
  const sound = createSound({ isOn: () => store.getState().soundOn === true });

  // The switches of the interface itself, folded into one block: the header is
  // already tight, and Part 4 brings the theme and the game colours here too.
  const toggles = new Map();
  // Every caption of the shell is repainted when the language changes, so each
  // one is remembered together with the key it comes from.
  const captions = [];

  /**
   * Remembers a node so that a change of language can repaint it.
   *
   * The text comes as a function, not as a key: `t('app.title')` then stays a
   * literal call in the source, which is the only form `tools/check-i18n.mjs`
   * can see.
   *
   * @param {Node} node Element carrying the text.
   * @param {() => string} text Produces the caption in the current language.
   * @returns {Node} The same node.
   */
  function caption(node, text) {
    captions.push({ node, text });
    return node;
  }

  /**
   * Builds one switch of the interface panel.
   *
   * @param {string} key State field it drives.
   * @param {() => string} label Caption.
   * @param {() => string} hint One line about what it does.
   * @returns {HTMLElement} The row.
   */
  function interfaceToggle(key, label, hint) {
    const input = el('input', {
      attrs: { type: 'checkbox' },
      on: {
        change: () => {
          store.setState({ [key]: input.checked });
          // Switching sound on is a click, and a click is the one moment a
          // browser lets a page open the audio device (SPEC 5.10).
          if (key === 'soundOn') {
            sound.unlock();
          }
        },
      },
    });
    toggles.set(key, input);
    return el('div', { class: 'interface__row' }, [
      el('label', { class: 'checkbox' }, [input, caption(el('span', {}), label)]),
      caption(el('p', { class: 'panel__hint' }), hint),
    ]);
  }

  // The language picker lists whatever dictionaries the build carries, each
  // written in its own language: a picker that named them in the language
  // currently on screen would be no use to whoever cannot read that one.
  const languageSelect = el(
    'select',
    { on: { change: () => store.setState({ lang: languageSelect.value }) } },
    availableLanguages().map((code) =>
      el('option', { text: languageName(code), attrs: { value: code } }),
    ),
  );
  // A theme is values, not rules, so the picker only writes an id and the
  // stylesheet does the rest. Switching a theme brings its own idea of the
  // screen effects and of the rain with it (SPEC 5.5).
  const themeSelect = el(
    'select',
    { on: { change: () => store.setState((state) => applyTheme(state, themeSelect.value)) } },
    THEMES.map((theme) => el('option', { attrs: { value: theme.id } })),
  );
  const themeRow = el('div', { class: 'interface__row' }, [
    el('label', { class: 'interface__language' }, [
      caption(el('span', {}), () => t('app.theme')),
      themeSelect,
    ]),
  ]);

  const languageRow = el('div', { class: 'interface__row' }, [
    el('label', { class: 'interface__language' }, [
      caption(el('span', {}), () => t('app.language')),
      languageSelect,
    ]),
    caption(el('p', { class: 'panel__hint' }), () => t('app.languageHint')),
  ]);

  // The colours of the board are a plaque of their own (SPEC 5.6): they belong
  // to the player rather than to the theme, and they never touch a token the
  // theme editor owns.
  let colourPanel = null;
  /** Set when the theme changed while the player had colours of their own. */
  let colourThemeChanged = false;

  const boardPanel = createColourPanel({
    title: t('colours.title'),
    hint: t('colours.hint'),
    fields: BOARD_TOKENS.map((token) => ({ token, label: boardColourName(token) })),
    onChange: (token, value) =>
      store.setState((state) => ({
        ...state,
        boardColours: { ...state.boardColours, [token]: value },
      })),
    onReset: (token) =>
      store.setState((state) => {
        const { [token]: _dropped, ...rest } = state.boardColours;
        return { ...state, boardColours: rest };
      }),
    onResetAll: () => {
      colourThemeChanged = false;
      store.setState((state) => ({ ...state, boardColours: {} }));
    },
  });
  colourPanel = boardPanel;

  // Drawing over the boards (SPEC 5.7). The switch, the brush and the two
  // ways back live together: "clear" is only reachable while drawing is on,
  // so it cannot be hit by accident in the middle of a turn.
  const inkColour = el('input', {
    class: 'colour-row__input',
    attrs: { type: 'color', 'aria-label': t('ink.colour') },
    on: {
      input: () => {
        const colour = normalizeColour(inkColour.value);
        if (colour !== null) {
          store.setState((state) => ({ ...state, brush: { ...state.brush, colour } }));
        }
      },
    },
  });
  const inkWidth = el(
    'select',
    {
      attrs: { 'aria-label': t('ink.width') },
      on: {
        change: () =>
          store.setState((state) => ({
            ...state,
            brush: { ...state.brush, width: Number(inkWidth.value) },
          })),
      },
    },
    BRUSH_WIDTHS.map((width) =>
      el('option', { text: String(width), attrs: { value: String(width) } }),
    ),
  );
  const inkUndo = el('button', {
    attrs: { type: 'button' },
    on: {
      click: () =>
        store.setState((state) => ({ ...state, ink: withoutLastStroke(state.ink) })),
    },
  });
  caption(inkUndo, () => t('ink.undo'));
  const inkClear = el('button', {
    attrs: { type: 'button' },
    on: { click: () => store.setState((state) => ({ ...state, ink: [] })) },
  });
  caption(inkClear, () => t('ink.clear'));
  const inkFull = el('p', { class: 'status is-warn' });
  caption(inkFull, () => t('ink.full'));
  const inkTools = el('div', { class: 'interface__row ink-tools' }, [
    el('label', { class: 'interface__language' }, [
      caption(el('span', {}), () => t('ink.colour')),
      inkColour,
    ]),
    el('label', { class: 'interface__language' }, [
      caption(el('span', {}), () => t('ink.width')),
      inkWidth,
    ]),
    el('div', { class: 'button-row' }, [inkUndo, inkClear]),
    inkFull,
  ]);
  // Where the sources are. In the panel rather than in the header: it is not
  // a game action and must not compete with one, and a footer would take
  // height away from the boards.
  const repositoryLink = el('a', {
    class: 'interface__link',
    attrs: {
      href: REPOSITORY_URL,
      target: '_blank',
      // Without `noopener` the opened page gets a handle on this window.
      rel: 'noopener noreferrer',
    },
  });
  caption(repositoryLink, () => t('app.repository'));
  const interfacePanel = el('details', { class: 'interface' }, [
    caption(el('summary', {}), () => t('app.interfaceTitle')),
    languageRow,
    themeRow,
    interfaceToggle('rainOn', () => t('app.rainToggle'), () => t('app.rainHint')),
    interfaceToggle('crtOn', () => t('app.crtToggle'), () => t('app.crtHint')),
    interfaceToggle('soundOn', () => t('app.soundToggle'), () => t('app.soundHint')),
    interfaceToggle('drawingOn', () => t('ink.toggle'), () => t('ink.hint')),
    inkTools,
    boardPanel.root,
    el('div', { class: 'interface__row' }, [repositoryLink]),
    interfaceToggle('autoEndTurn', () => t('app.autoEndToggle'), () => t('app.autoEndHint')),
  ]);

  // "Refresh fields" (SPEC 5.8). Two steps, because it throws away a maze, a
  // salt and a game.
  let resetArmed = false;
  const resetNotice = el('p', { class: 'app__notice app__notice--danger' });
  const resetButton = el('button', {
    text: t('app.reset'),
    attrs: { type: 'button' },
    on: {
      click: () => {
        if (!resetArmed) {
          resetArmed = true;
          paintReset();
          return;
        }
        resetArmed = false;
        store.setState((state) => ({ ...resetState(state), screen: 'setup' }));
        paintReset();
      },
    },
  });

  /**
   * Shows or hides the warning that goes with the reset button.
   *
   * @returns {void}
   */
  function paintReset() {
    setText(resetButton, resetArmed ? t('app.resetConfirm') : t('app.reset'));
    toggleClass(resetButton, 'is-primary', resetArmed);
    setText(resetNotice, resetArmed ? `${t('app.resetWhat')} ${t('app.resetFile')}` : '');
    resetNotice.hidden = !resetArmed;
  }

  // The rules sit in the header rather than in the strip: they are not a stage
  // of a game, and they are needed from every screen, most of all from the
  // game itself (SPEC 5.3).
  const rulesButton = el('button', {
    attrs: { type: 'button' },
    on: { click: () => store.setState((state) => openRules(state)) },
  });
  caption(rulesButton, () => t('app.rules'));

  const header = el('header', { class: 'app__header' }, [
    el('div', {}, [
      el('h1', {}, [
        caption(el('span', { class: 'app__title' }), () => t('app.title')),
        el('span', { class: 'app__cursor', text: '_' }),
      ]),
      caption(el('p', { class: 'app__subtitle' }), () => t('app.subtitle')),
    ]),
    el('div', { class: 'app__tools' }, [rulesButton, interfacePanel, resetButton]),
  ]);

  const storageNotice = el('p', { class: 'app__notice' });
  const screenHost = el('main', {});
  const root = el('div', { class: 'app' }, [header, resetNotice, storageNotice, screenHost]);
  // The rules live outside `.app` on purpose: `.app` opens a stacking context
  // of its own, and a sheet that has to cover the stage strip cannot be drawn
  // inside it.
  const rulesHost = el('div', {});
  container.appendChild(stagebar);
  container.appendChild(root);
  container.appendChild(rulesHost);

  const canvas = document.getElementById('rain');
  const rain =
    canvas === null ? null : createRain(canvas, { enabled: store.getState().rainOn !== false });

  let current = null;
  let currentScreen = null;
  let rules = null;
  let appliedLanguage = null;

  /**
   * Writes every caption of the shell out again.
   *
   * The screens are rebuilt instead: they hold far more text, and each of them
   * already knows how to draw itself from scratch.
   *
   * @returns {void}
   */
  function paintChrome() {
    for (const { node, text } of captions) {
      setText(node, text());
    }
    // The names of the themes are text like everything else on this panel.
    for (const option of themeSelect.options) {
      setText(option, themeName(option.value));
    }
    STEPS.forEach((step, index) => {
      const node = stepNodes.get(step.screen);
      const word = stepLabel(step.labelKey);
      setText(node.querySelector('.stagebar__word'), word);
      // The word can be folded away by the stylesheet; the name a screen
      // reader announces must not fold with it.
      node.setAttribute('aria-label', `${index + 1} · ${word}`);
    });
    stagebar.setAttribute('aria-label', t('app.stages'));
    setText(
      storageNotice,
      isStorageAvailable() ? t('app.storageNotice') : t('app.storageUnavailable'),
    );
    paintReset();
  }

  /**
   * Switches the dictionary when the state asks for another language.
   *
   * @param {object} state Application state.
   * @returns {boolean} True when the language changed and everything visible
   *   has to be drawn again.
   */
  /**
   * Puts the chosen theme on the root element, where the token blocks hang.
   *
   * @param {object} state Application state.
   * @returns {void}
   */
  function applyThemeAttribute(state) {
    const id = isTheme(state.theme) ? state.theme : THEMES[0].id;
    if (document.documentElement.dataset.theme !== id) {
      // Colours picked against one theme may read badly against another. Not
      // forbidden - said out loud, with a reset next to it (SPEC 5.6).
      if (Object.keys(state.boardColours).length > 0) {
        colourThemeChanged = true;
      }
      document.documentElement.dataset.theme = id;
      // The rain takes its colour from the accent, which the theme just moved.
      rain?.refreshColour();
    }
    if (themeSelect.value !== id) {
      themeSelect.value = id;
    }
  }

  function applyLanguage(state) {
    const code = isLanguage(state.lang) ? state.lang : FALLBACK_LANGUAGE;
    if (code === appliedLanguage) {
      return false;
    }
    setLanguage(code);
    appliedLanguage = code;
    languageSelect.value = code;
    document.documentElement.lang = code;
    return true;
  }

  /**
   * Builds the screen a state asks for.
   *
   * @param {string} screen Screen name.
   * @returns {object} The screen object.
   */
  function buildScreen(screen) {
    if (screen === 'build') {
      return createBuildScreen({ store });
    }
    if (screen === 'play') {
      return createPlayScreen({ store, sound });
    }
    if (screen === 'verify') {
      return createVerifyScreen({ store });
    }
    return createSetupScreen({ store });
  }

  /**
   * Writes the player's board colours onto the root and redraws the panel.
   *
   * The values shown are the ones actually in force - an override where there
   * is one, the theme's value where there is not - read back from the computed
   * style rather than guessed, so the warnings are about what is on screen.
   *
   * @param {object} state Application state.
   * @returns {void}
   */
  function paintBoardColours(state) {
    applyColourOverrides(document.documentElement, BOARD_TOKENS, state.boardColours);
    const computed = getComputedStyle(document.documentElement);
    const resolved = {};
    for (const token of BOARD_TOKENS) {
      resolved[token] = computed.getPropertyValue(token).trim();
    }
    const notices = boardWarnings(resolved).map((warning) =>
      warningText(warning, boardColourName),
    );
    if (colourThemeChanged && Object.keys(state.boardColours).length > 0) {
      notices.unshift(t('colours.themeChanged'));
    }
    colourPanel.update({ values: resolved, overrides: state.boardColours, notices });
  }

  /**
   * Shows or hides the rules over the current screen.
   *
   * The screen underneath is left mounted: a game with a step waiting for an
   * answer must survive someone looking up how the answer works.
   *
   * @param {object} state Application state.
   * @returns {void}
   */
  function renderRules(state) {
    if (state.rulesOpen === true) {
      if (rules === null) {
        rules = createRulesScreen({ onClose: () => store.setState((s) => closeRules(s)) });
        rulesHost.appendChild(rules.root);
        rules.focus();
      }
      return;
    }
    if (rules !== null) {
      rules.destroy();
      rules = null;
      rulesButton.focus();
    }
  }

  /**
   * Mounts the right screen and hands it the state.
   *
   * @param {object} state Application state.
   * @returns {void}
   */
  function render(state) {
    if (applyLanguage(state)) {
      paintChrome();
      // Screens and the rules sheet hold their captions in closures, so they
      // are thrown away and built again rather than repainted line by line.
      if (current !== null) {
        current.destroy();
        current = null;
        currentScreen = null;
        clear(screenHost);
      }
      if (rules !== null) {
        rules.destroy();
        rules = null;
      }
    }

    if (state.screen !== currentScreen) {
      if (current !== null) {
        current.destroy();
      }
      clear(screenHost);
      current = buildScreen(state.screen);
      currentScreen = state.screen;
      screenHost.appendChild(current.root);
    }
    current.update(state);

    // The storage warning belongs to the screens where the setup and the
    // reveal file are made. During a game it would only eat the height the
    // boards and the buttons need.
    storageNotice.hidden = state.screen === 'play' || state.screen === 'verify';

    // The chosen role paints the whole application: cyan for Player 1, lime
    // for Player 2, exactly as the prototype did (SPEC 5.13).
    if (document.documentElement.dataset.role !== String(state.myPlayer)) {
      document.documentElement.dataset.role = String(state.myPlayer);
      rain?.refreshColour();
    }

    const currentIndex = STEPS.findIndex((step) => step.screen === state.screen);
    STEPS.forEach((step, index) => {
      const node = stepNodes.get(step.screen);
      toggleClass(node, 'is-current', index === currentIndex);
      toggleClass(node, 'is-done', index < currentIndex);
      node.disabled = !canOpen(step.screen, state);
    });

    // The notice is about remembering the setup and about the reveal file, so
    // it belongs to the screens where those are made.
    storageNotice.hidden = state.screen === 'play' || state.screen === 'verify';

    applyThemeAttribute(state);
    paintBoardColours(state);
    // The brush controls appear with the mode they belong to (SPEC 5.7).
    inkTools.hidden = state.drawingOn !== true;
    if (inkColour.value !== state.brush.colour && document.activeElement !== inkColour) {
      inkColour.value = state.brush.colour;
    }
    inkWidth.value = String(state.brush.width);
    inkUndo.disabled = state.ink.length === 0;
    inkClear.disabled = state.ink.length === 0;
    inkFull.hidden = hasRoom(state.ink);
    renderRules(state);

    const rainOn = state.rainOn !== false;
    toggles.get('rainOn').checked = rainOn && !prefersReducedMotion();
    toggles.get('rainOn').disabled = prefersReducedMotion();
    toggles.get('crtOn').checked = state.crtOn !== false;
    toggles.get('soundOn').checked = state.soundOn === true;
    toggles.get('autoEndTurn').checked = state.autoEndTurn === true;
    rain?.setEnabled(rainOn);
    // The scan lines and the vignette are one layer; switching them off is a
    // class on the root, so no rule has to know about the switch.
    toggleClass(document.documentElement, 'no-crt', state.crtOn === false);
  }

  const unsubscribe = store.subscribe((state) => {
    render(state);
    saveSnapshot(serializeState(state));
  });

  render(store.getState());

  return {
    store,
    destroy() {
      unsubscribe();
      rain?.destroy();
      if (current !== null) {
        current.destroy();
      }
      if (rules !== null) {
        rules.destroy();
        rules = null;
      }
      stagebar.remove();
      root.remove();
      rulesHost.remove();
    },
  };
}

/**
 * Boots the interface when the document is ready. The bundle is inlined into
 * the page, so this runs on `file://` without a server (SPEC 5.1).
 *
 * @returns {void}
 */
export function main() {
  const mount = document.getElementById('app');
  if (mount === null) {
    throw new Error('the page has no #app element to mount into');
  }
  startApp(mount);
}
