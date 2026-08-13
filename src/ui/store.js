/**
 * store.js - one state object, one setter, a list of subscribers.
 *
 * No framework and no proxies: the interface is small enough that an explicit
 * "here is the new state, redraw" is easier to follow than anything clever.
 *
 * `serializeState` and `deserializeState` are pure and know nothing about
 * storage, which is what makes them testable in Node. `persist.js` is what
 * actually talks to localStorage.
 */

import { isOnBoard, parseEdgeId } from '../core/edges.js';
import { normalizeSettings } from '../core/settings.js';
import { FALLBACK_LANGUAGE, isLanguage } from '../i18n/index.js';
import { DEFAULT_THEME, isTheme } from './theme.js';
import { BOARD_TOKENS, readColourMap } from './colours.js';
import { DEFAULT_BRUSH, readBrush, readInk } from './ink.js';
import { assertAction } from './gameLog.js';

/** The four stages of a game, in the order of the strip. */
export const SCREENS = Object.freeze(['setup', 'build', 'play', 'verify']);

/**
 * Fields that live only as long as the page does.
 *
 * They are declared in {@link createDefaultState} like everything else - a
 * field the state does not declare is a field nobody can find - but they are
 * deliberately kept out of {@link serializeState}: each one describes this
 * session, not the game. The turn deadline is an absolute moment in time, and
 * carrying it across a reload would either hand a player a stale clock or a
 * fresh minute, depending on how long the page was closed.
 */
export const SESSION_FIELDS = Object.freeze([
  'gameLoadError',
  'buildTimerEndsAt',
  'turnTimerMove',
  'turnTimerEndsAt',
  // Drawing mode itself is not remembered: a reload should hand back a board
  // you can play on, not one that quietly swallows clicks (SPEC 5.7).
  'drawingOn',
]);

/** Longest string accepted from storage or from a paste field. */
export const MAX_CODE_LENGTH = 512;

const COMMIT_CODE_PATTERN = /^YMC1-[0-9a-fA-F]{64}-[0-9a-fA-F]{4}$/;
const COMMIT_PATTERN = /^[0-9a-f]{64}$/;
const SETTINGS_CODE_PATTERN = /^YM1-[0-9A-Z]{15}-[0-9A-F]{4}$/;
const SALT_PATTERN = /^[0-9a-f]{32}$/;

/**
 * The state of a fresh application.
 *
 * @returns {object} A new default state.
 */
export function createDefaultState() {
  return {
    screen: 'setup',
    myPlayer: 1,
    settings: null,
    settingsCode: null,
    settingsOrigin: null,
    settingsLocked: false,
    myMaze: { entrance: null, exit: null, walls: [] },
    opponentEnds: { entrance: null, exit: null },
    commit: null,
    revealSaved: false,
    opponentCommit: null,
    // The language of the interface. Like the theme and the switches, it
    // belongs to this device and to the person at it, not to the game, so it
    // survives Refresh fields (SPEC 5.8).
    lang: FALLBACK_LANGUAGE,
    // The look of the application. Like the language, a preference of this
    // device rather than part of a game (SPEC 5.5).
    theme: DEFAULT_THEME,
    // Colours of the board the player set by hand. Global on purpose: "I want
    // my walls orange" is about the player, not about the theme (SPEC 5.6).
    boardColours: {},
    // Drawings over the boards. Erased by Refresh fields, like the game they
    // were drawn over (SPEC 5.8).
    ink: [],
    // The brush is a preference and survives that reset, like the theme.
    brush: { ...DEFAULT_BRUSH },
    drawingOn: false,
    rainOn: true,
    crtOn: true,
    // Handing the turn over by itself once the core says it is technically
    // over. Off by default, and never part of the settings block: it is a
    // convenience of this device, not something the players agreed on.
    autoEndTurn: false,
    gameStarted: false,
    // The game is kept as a journal of actions and replayed through the core;
    // there is no second description of the game state anywhere (SPEC 5.3).
    gameActions: [],
    // The rules are not a stage of a game: they open over whatever is on
    // screen and give it back untouched when they close (SPEC 5.3).
    rulesOpen: false,
    // Set when a stored journal had to be thrown away. Not persisted: it
    // describes the last load, not the game.
    gameLoadError: null,
    // The two clocks. Their deadlines live here rather than inside the screens
    // so that stepping out to another screen and back does not hand the player
    // a fresh minute; they are not persisted, so a reload starts the clock of
    // the current turn - and of the building screen - again (SPEC 5.10).
    buildTimerEndsAt: null,
    turnTimerMove: null,
    turnTimerEndsAt: null,
  };
}

/**
 * Validates a cell coming from storage.
 *
 * @param {unknown} cell Candidate.
 * @returns {{r: number, c: number}|null} The cell, or null when unusable.
 */
function readCell(cell) {
  if (cell === null || typeof cell !== 'object') {
    return null;
  }
  return isOnBoard(cell.r, cell.c) ? { r: cell.r, c: cell.c } : null;
}

/**
 * Keeps only the edge ids that the core recognises.
 *
 * @param {unknown} walls Candidate list.
 * @returns {string[]} Valid edge ids.
 */
function readWalls(walls) {
  if (!Array.isArray(walls)) {
    return [];
  }
  const kept = [];
  for (const id of walls) {
    try {
      parseEdgeId(id);
      if (!kept.includes(id)) {
        kept.push(id);
      }
    } catch {
      // A wall id that the core refuses cannot be drawn or hashed, so it is
      // dropped. Storage on file:// may be shared with unrelated pages
      // (SPEC 5.2), which makes junk here an expected case, not a bug.
    }
  }
  return kept;
}

/**
 * Validates a string coming from storage.
 *
 * @param {unknown} value Candidate.
 * @param {RegExp} pattern Shape it must have.
 * @returns {string|null} The string, or null.
 */
function readPattern(value, pattern) {
  return typeof value === 'string' && value.length <= MAX_CODE_LENGTH && pattern.test(value)
    ? value
    : null;
}

/**
 * Turns the state into something JSON can hold.
 *
 * @param {object} state Application state.
 * @returns {object} A plain snapshot: settings, role, own layout, the
 *   opponent's ends, salt, commit, the opponent's commit and whether the
 *   reveal file has been saved.
 */
export function serializeState(state) {
  return {
    screen: state.screen,
    myPlayer: state.myPlayer,
    settings: state.settings === null ? null : { ...state.settings },
    settingsCode: state.settingsCode,
    settingsOrigin: state.settingsOrigin,
    settingsLocked: state.settingsLocked,
    myMaze: {
      entrance: state.myMaze.entrance === null ? null : { ...state.myMaze.entrance },
      exit: state.myMaze.exit === null ? null : { ...state.myMaze.exit },
      walls: [...state.myMaze.walls],
    },
    opponentEnds: {
      entrance: state.opponentEnds.entrance === null ? null : { ...state.opponentEnds.entrance },
      exit: state.opponentEnds.exit === null ? null : { ...state.opponentEnds.exit },
    },
    commit: state.commit === null ? null : { ...state.commit },
    revealSaved: state.revealSaved,
    opponentCommit: state.opponentCommit === null ? null : { ...state.opponentCommit },
    lang: state.lang,
    theme: state.theme,
    boardColours: { ...state.boardColours },
    ink: state.ink.map((stroke) => ({ ...stroke, points: [...stroke.points] })),
    brush: { ...state.brush },
    rainOn: state.rainOn,
    crtOn: state.crtOn,
    autoEndTurn: state.autoEndTurn,
    gameStarted: state.gameStarted,
    gameActions: state.gameActions.map((action) => ({ ...action })),
    rulesOpen: state.rulesOpen,
  };
}

/**
 * Validates a stored game journal.
 *
 * One damaged entry poisons every entry after it, because each one is played
 * on top of the one before, so a journal is kept whole or dropped whole.
 *
 * @param {unknown} actions Whatever was stored.
 * @returns {{actions: Array<object>, dropped: boolean}} The journal, or an
 *   empty one with `dropped` set so the screen can say what happened.
 */
function readGameActions(actions) {
  if (actions === undefined || actions === null) {
    return { actions: [], dropped: false };
  }
  if (!Array.isArray(actions)) {
    return { actions: [], dropped: true };
  }
  const kept = [];
  for (const action of actions) {
    try {
      kept.push(assertAction(action));
    } catch {
      // A journal with one unreadable entry is not a game; it is dropped as a
      // whole and the player is told, rather than replayed into something that
      // never happened.
      return { actions: [], dropped: true };
    }
  }
  return { actions: kept, dropped: false };
}

/**
 * Rebuilds the state from a snapshot, keeping only what still makes sense.
 *
 * Every field is checked: on `file://` the storage may be shared with other
 * local pages, so the snapshot is treated as untrusted input.
 *
 * @param {unknown} snapshot Whatever came out of storage.
 * @returns {object} A complete state; unusable fields fall back to defaults.
 */
export function deserializeState(snapshot) {
  const state = createDefaultState();
  if (snapshot === null || typeof snapshot !== 'object') {
    return state;
  }

  if (SCREENS.includes(snapshot.screen)) {
    state.screen = snapshot.screen;
  }
  if (snapshot.myPlayer === 1 || snapshot.myPlayer === 2) {
    state.myPlayer = snapshot.myPlayer;
  }
  if (snapshot.settings !== null && typeof snapshot.settings === 'object') {
    try {
      state.settings = normalizeSettings(snapshot.settings);
    } catch (error) {
      // Settings that the core refuses cannot be played with; the player is
      // sent back to an empty setup screen rather than to a broken one.
      console.warn('stored settings were dropped:', error.message);
      state.settings = null;
    }
  }
  state.settingsCode = readPattern(snapshot.settingsCode, SETTINGS_CODE_PATTERN);
  if (snapshot.settingsOrigin === 'created' || snapshot.settingsOrigin === 'imported') {
    state.settingsOrigin = snapshot.settingsOrigin;
  }
  state.settingsLocked = snapshot.settingsLocked === true && state.settings !== null;

  if (snapshot.myMaze !== null && typeof snapshot.myMaze === 'object') {
    state.myMaze = {
      entrance: readCell(snapshot.myMaze.entrance),
      exit: readCell(snapshot.myMaze.exit),
      walls: readWalls(snapshot.myMaze.walls),
    };
  }
  if (snapshot.opponentEnds !== null && typeof snapshot.opponentEnds === 'object') {
    state.opponentEnds = {
      entrance: readCell(snapshot.opponentEnds.entrance),
      exit: readCell(snapshot.opponentEnds.exit),
    };
  }

  if (snapshot.commit !== null && typeof snapshot.commit === 'object') {
    const commit = readPattern(snapshot.commit.commit, COMMIT_PATTERN);
    const commitCode = readPattern(snapshot.commit.commitCode, COMMIT_CODE_PATTERN);
    const saltHex = readPattern(snapshot.commit.saltHex, SALT_PATTERN);
    state.commit =
      commit !== null && commitCode !== null && saltHex !== null
        ? { commit, commitCode, saltHex }
        : null;
  }
  // The reveal file matches one commit. If the commit did not survive, the
  // saved file is meaningless and the blocking step starts again.
  state.revealSaved = snapshot.revealSaved === true && state.commit !== null;

  if (snapshot.opponentCommit !== null && typeof snapshot.opponentCommit === 'object') {
    const code = readPattern(snapshot.opponentCommit.code, COMMIT_CODE_PATTERN);
    const commit = readPattern(snapshot.opponentCommit.commit, COMMIT_PATTERN);
    state.opponentCommit = code !== null && commit !== null ? { code, commit } : null;
  }

  // A language this build does not carry falls back rather than leaving the
  // interface with a dictionary that is not there.
  state.lang = isLanguage(snapshot.lang) ? snapshot.lang : FALLBACK_LANGUAGE;
  // A theme this build no longer carries falls back rather than leaving the
  // page with no values at all.
  state.theme = isTheme(snapshot.theme) ? snapshot.theme : DEFAULT_THEME;
  // Untrusted like everything else out of storage: unknown tokens and values
  // that are not colours are dropped before anything reaches the DOM.
  state.boardColours = readColourMap(snapshot.boardColours, BOARD_TOKENS);
  // Both carry a colour that ends up in the DOM, so both are checked field by
  // field rather than trusted.
  state.ink = readInk(snapshot.ink);
  state.brush = readBrush(snapshot.brush);
  // Decoration, remembered like any other preference; anything that is not a
  // clear "off" leaves the rain on.
  state.rainOn = snapshot.rainOn !== false;
  state.crtOn = snapshot.crtOn !== false;
  state.autoEndTurn = snapshot.autoEndTurn === true;
  // Reading the rules is where the player was, so that is where the reload
  // puts them back.
  state.rulesOpen = snapshot.rulesOpen === true;

  const journal = readGameActions(snapshot.gameActions);
  state.gameActions = journal.actions;
  state.gameLoadError = journal.dropped ? 'CORRUPT_JOURNAL' : null;
  state.gameStarted = snapshot.gameStarted === true && state.commit !== null;

  if (state.settings === null && state.screen !== 'setup') {
    state.screen = 'setup';
  }
  if (!state.gameStarted && state.screen === 'play') {
    state.screen = 'build';
  }
  return state;
}

/**
 * Wipes the game and everything built for it, keeping the settings of the
 * interface itself (SPEC 5.8).
 *
 * Erased: both layouts, the walls, the ends, the journal with its history and
 * counters, the commit, the salt, the opponent's commit and the flag that the
 * reveal file was saved. The settings block goes too, because a new game needs
 * a new `game_nonce`, and that is exactly what stops a commit from an earlier
 * game being replayed.
 *
 * Kept: the role, the language and the switches of the interface. Game
 * colours, brush and sound will join them when they exist.
 *
 * @param {object} state Current application state.
 * @returns {object} A fresh state that remembers only the preferences.
 */
export function resetState(state) {
  const fresh = createDefaultState();
  fresh.myPlayer = state.myPlayer;
  fresh.lang = state.lang;
  fresh.theme = state.theme;
  fresh.boardColours = { ...state.boardColours };
  fresh.brush = { ...state.brush };
  fresh.rainOn = state.rainOn;
  fresh.crtOn = state.crtOn;
  fresh.autoEndTurn = state.autoEndTurn;
  return fresh;
}

/**
 * Starts another game between the same two people, under the same rules.
 *
 * Everything of the finished game goes: both mazes, the commits, the salt, the
 * journal, the saved-reveal flag. What stays is the agreed values of the
 * settings and the local preferences.
 *
 * The settings object handed in must be a fresh one - a new game needs a new
 * `game_nonce`, which is what stops a commit from the previous game being
 * replayed in this one (SPEC 4.3). That also means a new settings code, and
 * both players have to exchange it again.
 *
 * @param {object} state Current application state.
 * @param {object} freshSettings Settings with the same values but a new nonce.
 * @param {string} freshCode The settings code of those settings.
 * @returns {object} The state of the next game, on the setup screen.
 */
export function nextGameState(state, freshSettings, freshCode) {
  const fresh = createDefaultState();
  fresh.myPlayer = state.myPlayer;
  fresh.lang = state.lang;
  fresh.theme = state.theme;
  fresh.rainOn = state.rainOn;
  fresh.crtOn = state.crtOn;
  fresh.autoEndTurn = state.autoEndTurn;
  fresh.settings = freshSettings;
  fresh.settingsCode = freshCode;
  fresh.settingsOrigin = 'created';
  fresh.screen = 'setup';
  return fresh;
}

/**
 * Creates the store.
 *
 * @param {object} [initialState=createDefaultState()] Starting state.
 * @returns {{getState: () => object, setState: (patch: object|Function) => object, subscribe: (listener: Function) => Function}}
 *   `setState` takes either a patch object or a function of the current state
 *   and returns the new state. `subscribe` returns an unsubscribe function.
 * @throws {Error} If a listener is not a function or an updater returns
 *   something that is not an object.
 */
export function createStore(initialState = createDefaultState()) {
  let state = initialState;
  const listeners = new Set();

  return {
    getState() {
      return state;
    },
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : { ...state, ...patch };
      if (next === null || typeof next !== 'object') {
        throw new Error('setState must produce an object');
      }
      state = next;
      for (const listener of listeners) {
        listener(state);
      }
      return state;
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new Error('a subscriber must be a function');
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
