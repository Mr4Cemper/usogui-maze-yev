/**
 * A whole protocol round trip, printed step by step:
 *
 *   settings -> settings code -> maze -> payload -> commit -> reveal string
 *   -> a short game -> verification of an honest reveal
 *   -> verification of a game with one dishonest answer
 *
 * Run it with:  node examples/roundtrip.mjs
 */

import { cellToLabel } from '../src/core/edges.js';
import { createMaze, validateMaze } from '../src/core/maze.js';
import {
  createGameSettings,
  decodeSettingsCode,
  encodeSettingsCode,
  packSettings,
} from '../src/core/settings.js';
import {
  buildPayload,
  computeCommit,
  decodeCommitCode,
  decodeReveal,
  encodeCommitCode,
  encodeReveal,
  generateSalt,
  parsePayload,
} from '../src/core/commit.js';
import {
  buildAnswerLog,
  createGameState,
  endTurn,
  renderLogEntryEn,
  startTurn,
  tryStep,
} from '../src/core/game.js';
import { verifyReveal } from '../src/core/verify.js';

/**
 * Prints a section heading.
 *
 * @param {string} title Heading text.
 * @returns {void}
 */
function heading(title) {
  console.log(`\n=== ${title} ===`);
}

/**
 * Prints one report of {@link verifyReveal}.
 *
 * @param {object} report What verifyReveal returned.
 * @returns {void}
 */
function printReport(report) {
  for (const step of report.steps) {
    const details = Object.keys(step.details).length === 0 ? '' : ` ${JSON.stringify(step.details)}`;
    console.log(`  ${step.step}. ${step.code.padEnd(16)} ${step.status.toUpperCase()}${details}`);
  }
  console.log(`  ok = ${report.ok}, violated = ${report.violated}`);
}

// createGameSettings, not DEFAULT_SETTINGS: a new game draws a fresh nonce,
// and the nonce is what keeps a commit from an earlier game out of this one.
const settings = createGameSettings({ allow_pass: 1 });

heading('1. Settings code, exchanged before anything is built');
const settingsCode = await encodeSettingsCode(settings);
console.log(`  code   : ${settingsCode}`);
console.log(`  length : ${settingsCode.length} characters`);
console.log(`  decoded: game_nonce = ${(await decodeSettingsCode(settingsCode)).game_nonce}`);
const settingsBlock = packSettings(settings);

heading('2. The two mazes');
// The maze the opponent built. I walk through it and I do not see its walls.
const opponentMaze = createMaze({
  entrance: { r: 0, c: 0 },
  exit: { r: 2, c: 2 },
  walls: ['V0,1', 'H0,0', 'H1,2', 'V2,0'],
});
// My own maze. The opponent walks through it, I answer for it.
const myMaze = createMaze({
  entrance: { r: 5, c: 5 },
  exit: { r: 0, c: 0 },
  walls: ['V5,4', 'H3,0'],
});
console.log(`  opponent maze: ${cellToLabel(0, 0)} -> ${cellToLabel(2, 2)}, ${opponentMaze.walls.size} walls`);
console.log(`  my maze      : ${cellToLabel(5, 5)} -> ${cellToLabel(0, 0)}, ${myMaze.walls.size} walls`);
console.log(`  validity     : ${JSON.stringify(validateMaze(opponentMaze, settings))}`);

heading('3. Payload, salt and commit of the opponent maze');
const payload = buildPayload(settingsBlock, opponentMaze);
const salt = generateSalt();
const commit = await computeCommit(payload, salt);
const commitCode = await encodeCommitCode(commit);
console.log(`  payload    : ${payload.length} bytes`);
console.log(`  salt       : ${salt.length} bytes`);
console.log(`  commit     : ${commit}`);
console.log(`  commit code: ${commitCode}`);
console.log(`  length     : ${commitCode.length} characters`);
console.log(`  decoded    : ${await decodeCommitCode(commitCode) === commit ? 'same digest' : 'MISMATCH'}`);

heading('4. Reveal string, saved to a file before the game starts');
const reveal = await encodeReveal(payload, salt);
console.log(`  reveal : ${reveal}`);
console.log(`  length : ${reveal.length} characters`);

const decoded = await decodeReveal(reveal);
const parsed = parsePayload(decoded.payload);
console.log(`  parsed : entrance ${cellToLabel(parsed.maze.entrance.r, parsed.maze.entrance.c)},` +
  ` exit ${cellToLabel(parsed.maze.exit.r, parsed.maze.exit.c)},` +
  ` walls ${[...parsed.maze.walls].join(' ')}`);

heading('5. A short game');
const state = createGameState({
  settings,
  myMaze,
  opponentEntrance: opponentMaze.entrance,
  opponentExit: opponentMaze.exit,
  myPlayer: 1,
});

/**
 * Steps on my board and lets the real opponent maze answer, as an honest
 * opponent would.
 *
 * @param {'up'|'down'|'left'|'right'} direction Where to go.
 * @returns {object} What tryStep returned.
 */
function myStep(direction) {
  const { r, c } = state.sides.me.pos;
  const delta = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] }[direction];
  const walls = opponentMaze.walls;
  const target = { r: r + delta[0], c: c + delta[1] };
  const edge = r === target.r
    ? `V${r},${Math.min(c, target.c)}`
    : `H${Math.min(r, target.r)},${c}`;
  const result = tryStep(state, 'me', direction, walls.has(edge) ? 'wall' : 'pass');
  console.log(
    `  move ${state.globalMove} me      : ${direction.padEnd(5)} ${result.result.padEnd(4)}` +
    ` ${result.edge}${result.hints.length > 0 ? ` ${result.hints.join(',')}` : ''}`,
  );
  return result;
}

/**
 * Steps on the board of my own maze, which answers for itself.
 *
 * @param {'up'|'down'|'left'|'right'} direction Where to go.
 * @returns {object} What tryStep returned.
 */
function opponentStep(direction) {
  const result = tryStep(state, 'opponent', direction);
  console.log(
    `  move ${state.globalMove} opponent: ${direction.padEnd(5)} ${result.result.padEnd(4)}` +
    ` ${result.edge}${result.hints.length > 0 ? ` ${result.hints.join(',')}` : ''}`,
  );
  return result;
}

startTurn(state);
myStep('right');
myStep('right');
console.log(`  history: ${renderLogEntryEn(endTurn(state).entry)}`);

startTurn(state);
opponentStep('up');
opponentStep('up');
console.log(`  history: ${renderLogEntryEn(endTurn(state).entry)}`);

startTurn(state);
myStep('down');
myStep('down');
myStep('right');
console.log(`  history: ${renderLogEntryEn(endTurn(state).entry)}`);

startTurn(state);
opponentStep('left');
console.log(`  history: ${renderLogEntryEn(endTurn(state).entry)}`);

const answerLog = buildAnswerLog(state, 'me');
console.log(`  answers to check: ${answerLog.length}`);
console.log(`  I reached the exit on move ${state.sides.me.firstExitMove}`);
console.log(`  the opponent reached the exit on move ${state.sides.opponent.firstExitMove}`);

heading('6. Verification of an honest reveal');
const honest = await verifyReveal({
  expectedCommit: commitCode,
  agreedSettings: settingsBlock,
  declaredEntrance: opponentMaze.entrance,
  declaredExit: opponentMaze.exit,
  revealString: reveal,
  opponentAnswerLog: answerLog,
  gameState: state,
});
printReport(honest);
console.log(`  verdict: ${JSON.stringify(honest.verdict)}`);

heading('7. Verification when one answer was a lie');
const liedAt = answerLog.findIndex((record) => record.answer === 'pass');
const tamperedLog = answerLog.map((record, index) =>
  index === liedAt ? { ...record, answer: 'wall' } : record,
);
console.log(
  `  the opponent claims a wall on move ${tamperedLog[liedAt].move} between ` +
  `${cellToLabel(tamperedLog[liedAt].from.r, tamperedLog[liedAt].from.c)} and ` +
  `${cellToLabel(tamperedLog[liedAt].to.r, tamperedLog[liedAt].to.c)}`,
);
const cheated = await verifyReveal({
  expectedCommit: commitCode,
  agreedSettings: settingsBlock,
  declaredEntrance: opponentMaze.entrance,
  declaredExit: opponentMaze.exit,
  revealString: reveal,
  opponentAnswerLog: tamperedLog,
  gameState: state,
});
printReport(cheated);
console.log(`  mismatches: ${JSON.stringify(cheated.mismatches)}`);
console.log(`  verdict   : ${JSON.stringify(cheated.verdict)}`);
