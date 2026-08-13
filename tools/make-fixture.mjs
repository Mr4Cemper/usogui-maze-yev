/**
 * make-fixture.mjs - puts the application into a state you need, without
 * playing a game by hand to get there.
 *
 * Why it exists: everything past the first screen needs a settings code, two
 * mazes, a salt, two commits and a journal, and clicking all of that together
 * takes half an hour. This builds it on the core - the same functions the
 * application itself uses - and prints one line you paste into the browser
 * console. Reload the page after pasting: the running page keeps its state in
 * memory and the first change would write over what you pasted.
 *
 * It is a development tool. It is not imported by anything in `src/`, and
 * nothing of it reaches the built `Usogui_Maze_yev.html`.
 *
 * Usage:
 *
 *   node tools/make-fixture.mjs                       a game under way, 6 moves
 *   node tools/make-fixture.mjs --moves=20            a longer one
 *   node tools/make-fixture.mjs --cheat               one answer contradicts the maze
 *   node tools/make-fixture.mjs --resign=me           closed by my resignation
 *   node tools/make-fixture.mjs --resign=opponent     closed by theirs
 *   node tools/make-fixture.mjs --screen=verify       opens on the verification screen
 *   node tools/make-fixture.mjs --json                the snapshot alone, for a file
 *
 * The line to paste goes to stdout. Everything you need alongside it - the
 * opponent's reveal string to paste into the verification screen, your own,
 * the settings code - goes to stderr, so `> fixture.js` still gives you a
 * clean file.
 */

import { edgeBetween, isOnBoard } from '../src/core/edges.js';
import { createMaze, hasWall } from '../src/core/maze.js';
import { createGameSettings, encodeSettingsCode } from '../src/core/settings.js';
import {
  buildPayload,
  computeCommit,
  encodeCommitCode,
  encodeReveal,
  generateSalt,
} from '../src/core/commit.js';
import { bytesToHex } from '../src/core/sha256.js';
import { DIRECTIONS } from '../src/core/game.js';
import { applyAction, createGameFromState, runJournal } from '../src/ui/gameLog.js';
import { createDefaultState, serializeState } from '../src/ui/store.js';

/** The schema version `persist.js` reads. Kept in step with it by hand. */
const SCHEMA_VERSION = 1;

/** My maze: a plain diagonal corridor with a few walls to bump into. */
const MY_MAZE = Object.freeze({
  entrance: { r: 0, c: 0 },
  exit: { r: 5, c: 5 },
  walls: Object.freeze(['V0,1', 'H1,0', 'V2,2', 'H3,3', 'V4,4']),
});

/** The opponent's maze, as it really is. */
const THEIR_MAZE = Object.freeze({
  entrance: { r: 0, c: 5 },
  exit: { r: 5, c: 0 },
  walls: Object.freeze(['V0,3', 'H1,4', 'V2,1', 'H3,1', 'V4,2']),
});

/** Directions tried in this order; the first one that stays on the board wins. */
const ORDER = Object.freeze(['down', 'right', 'up', 'left']);

/**
 * Reads the command line into options.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {{moves: number, cheat: boolean, resign: string|null, screen: string, json: boolean}}
 *   The options.
 * @throws {Error} If an argument is not understood.
 */
export function parseArgs(argv) {
  const options = { moves: 6, cheat: false, resign: null, screen: 'play', json: false };
  for (const argument of argv) {
    const [name, value] = argument.split('=');
    if (name === '--moves') {
      options.moves = Number(value);
      if (!Number.isInteger(options.moves) || options.moves < 0) {
        throw new Error(`--moves needs a whole number, got ${JSON.stringify(value)}`);
      }
    } else if (name === '--cheat') {
      options.cheat = true;
    } else if (name === '--resign') {
      if (value !== 'me' && value !== 'opponent') {
        throw new Error(`--resign is me or opponent, got ${JSON.stringify(value)}`);
      }
      options.resign = value;
    } else if (name === '--screen') {
      if (!['setup', 'build', 'play', 'verify'].includes(value)) {
        throw new Error(`--screen is setup, build, play or verify, got ${JSON.stringify(value)}`);
      }
      options.screen = value;
    } else if (name === '--json') {
      options.json = true;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(argument)}`);
    }
  }
  return options;
}

/**
 * Picks a direction that stays on the board and does not walk straight back.
 *
 * The order of preference rotates with the move number, so the pawn wanders
 * instead of running down one column: a fixture is more useful when the game
 * touched a few different edges.
 *
 * @param {{r: number, c: number}} from Where the pawn stands.
 * @param {string|null} last The direction taken before, to avoid going back.
 * @param {number} move Move number, used to rotate the preference.
 * @returns {string} A direction.
 */
function pickDirection(from, last, move) {
  const back = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const turn = move % ORDER.length;
  const order = [...ORDER.slice(turn), ...ORDER.slice(0, turn)];
  const tried = order.filter((direction) => {
    const delta = DIRECTIONS[direction];
    return isOnBoard(from.r + delta.dr, from.c + delta.dc) && direction !== back[last];
  });
  if (tried.length > 0) {
    return tried[0];
  }
  // Boxed into a corner by the "do not go back" rule: going back is fine then.
  return order.find((direction) => {
    const delta = DIRECTIONS[direction];
    return isOnBoard(from.r + delta.dr, from.c + delta.dc);
  });
}

/**
 * Plays a game of the requested length and returns its journal.
 *
 * Every entry goes through `applyAction`, which is the same path the game
 * screen takes, so the journal is one the application could have written
 * itself. Answers to my own steps are read off the opponent's real maze -
 * that is what an honest opponent would say - unless a lie was asked for.
 *
 * @param {object} uiState The frozen setup: settings, mazes, announced ends.
 * @param {{moves: number, cheat: boolean, resign: string|null}} options What
 *   kind of game to play.
 * @returns {{actions: Array<object>, lie: object|null}} The journal, and the
 *   step that was answered wrongly when one was.
 */
function playGame(uiState, options) {
  const game = createGameFromState(uiState);
  const theirMaze = createMaze({
    entrance: THEIR_MAZE.entrance,
    exit: THEIR_MAZE.exit,
    walls: [...THEIR_MAZE.walls],
  });
  const actions = [];
  const last = { me: null, opponent: null };
  // The lie goes in the middle of the game, where it is neither the first nor
  // the last thing the report meets. Only my own steps carry an answer, and
  // whose move falls in the middle depends on who started, so it lands on the
  // first step of mine from there on.
  const lieAfter = options.cheat ? Math.max(1, Math.floor(options.moves / 2)) : Infinity;
  let lie = null;

  for (let move = 0; move < options.moves; move += 1) {
    const side = game.current;
    const from = { ...game.sides[side].pos };
    const direction = pickDirection(from, last[side], move);
    last[side] = direction;
    const delta = DIRECTIONS[direction];
    const to = { r: from.r + delta.dr, c: from.c + delta.dc };

    let action;
    if (side === 'me') {
      const truth = hasWall(theirMaze, from.r, from.c, to.r, to.c) ? 'wall' : 'pass';
      const lying = lie === null && move >= lieAfter;
      const answer = lying ? (truth === 'wall' ? 'pass' : 'wall') : truth;
      if (lying) {
        lie = {
          move: move + 1,
          edge: edgeBetween(from.r, from.c, to.r, to.c),
          said: answer,
          truth,
        };
      }
      action = { type: 'STEP', side: 'me', direction, answer, auto: false };
    } else {
      action = { type: 'STEP', side: 'opponent', direction };
    }

    for (const entry of [{ type: 'START_TURN' }, action, { type: 'END_TURN' }]) {
      applyAction(game, entry);
      actions.push(entry);
    }
  }

  if (options.cheat && lie === null) {
    // Better to say so than to hand back a "dishonest" game that is honest.
    throw new Error('--cheat needs a step of mine in the second half of the game; try --moves=6');
  }

  if (options.resign !== null) {
    const entry = { type: 'RESIGN', side: options.resign };
    applyAction(game, entry);
    actions.push(entry);
  }

  return { actions, lie };
}

/**
 * Builds a whole fixture: the state, both reveal strings and the codes.
 *
 * @param {object} [options=parseArgs([])] What kind of game to build.
 * @returns {Promise<{snapshot: object, state: object, myReveal: string, theirReveal: string, settingsCode: string, lie: object|null}>}
 *   The snapshot as `persist.js` stores it, the state it was made from, the
 *   two reveal strings, the settings code, and the lie if one was asked for.
 */
export async function buildFixture(options = parseArgs([])) {
  const settings = createGameSettings({});
  const settingsCode = await encodeSettingsCode(settings);

  const myMaze = {
    entrance: { ...MY_MAZE.entrance },
    exit: { ...MY_MAZE.exit },
    walls: [...MY_MAZE.walls],
  };
  const myPayload = buildPayload(settings, createMaze(myMaze));
  const mySalt = generateSalt();
  const myCommit = await computeCommit(myPayload, mySalt);

  const theirPayload = buildPayload(
    settings,
    createMaze({
      entrance: THEIR_MAZE.entrance,
      exit: THEIR_MAZE.exit,
      walls: [...THEIR_MAZE.walls],
    }),
  );
  const theirSalt = generateSalt();
  const theirCommit = await computeCommit(theirPayload, theirSalt);

  const state = {
    ...createDefaultState(),
    screen: options.screen,
    myPlayer: 1,
    settings,
    settingsCode,
    settingsOrigin: 'created',
    settingsLocked: true,
    myMaze,
    opponentEnds: { entrance: { ...THEIR_MAZE.entrance }, exit: { ...THEIR_MAZE.exit } },
    commit: {
      commit: myCommit,
      commitCode: await encodeCommitCode(myCommit),
      saltHex: bytesToHex(mySalt),
    },
    revealSaved: true,
    opponentCommit: { code: await encodeCommitCode(theirCommit), commit: theirCommit },
    gameStarted: true,
  };

  const { actions, lie } = playGame(state, options);
  state.gameActions = actions;
  // A journal the application cannot replay is not a fixture, it is a trap.
  runJournal(state, state.gameActions);

  return {
    snapshot: { version: SCHEMA_VERSION, data: serializeState(state) },
    state,
    myReveal: await encodeReveal(myPayload, mySalt),
    theirReveal: await encodeReveal(theirPayload, theirSalt),
    settingsCode,
    lie,
  };
}

/**
 * Runs the tool.
 *
 * @returns {Promise<void>} Resolves once everything is printed.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await buildFixture(options);
  const json = JSON.stringify(fixture.snapshot);

  if (options.json) {
    process.stdout.write(`${json}\n`);
  } else {
    process.stdout.write(`localStorage.setItem('umy:state', ${JSON.stringify(json)});\n`);
  }

  const notes = [
    '',
    'Paste the line above into the console of the built page, then reload it.',
    `settings code   ${fixture.settingsCode}`,
    `their reveal    ${fixture.theirReveal}`,
    `my reveal       ${fixture.myReveal}`,
    `moves           ${options.moves}${options.resign === null ? '' : `, ${options.resign} resigned`}`,
  ];
  if (fixture.lie !== null) {
    notes.push(
      `the lie         move ${fixture.lie.move}, edge ${fixture.lie.edge}: said ${fixture.lie.said}, the maze says ${fixture.lie.truth}`,
    );
  }
  notes.push('my maze         A1 to F6, theirs A6 to F1', '');
  process.stderr.write(`${notes.join('\n')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('make-fixture.mjs')) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
