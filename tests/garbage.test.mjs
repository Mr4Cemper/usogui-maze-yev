/**
 * Every module is fed the kind of junk a real interface will hand it sooner or
 * later: empty strings, truncated codes, extra characters, negative
 * coordinates, missing arguments. Nothing may crash on undefined; everything
 * must come back as an Error with a readable English message.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cellToIndex,
  cellToLabel,
  edgeBetween,
  edgeToBitIndex,
  indexToCell,
  labelToCell,
  parseEdgeId,
} from '../src/core/edges.js';
import { createMaze, findPath, hasWall, openSides, validateMaze } from '../src/core/maze.js';
import { BitReader, BitWriter } from '../src/core/bits.js';
import { decode as base32Decode, encode as base32Encode } from '../src/core/base32.js';
import { sha256, sha256JsSync } from '../src/core/sha256.js';
import {
  decodeSettingsCode,
  encodeSettingsCode,
  packSettings,
  unpackSettings,
} from '../src/core/settings.js';
import {
  buildPayload,
  computeCommit,
  decodeCommitCode,
  decodeReveal,
  encodeCommitCode,
  encodeReveal,
  parsePayload,
} from '../src/core/commit.js';
import { createGameState, renderLogEntryEn, startTurn, tryStep } from '../src/core/game.js';
import { computeVerdict, verifyReveal } from '../src/core/verify.js';

/**
 * Asserts that a call throws a real Error carrying a non empty message.
 *
 * @param {() => unknown} call What to run.
 * @param {string} what Description used when the assertion fails.
 * @returns {Error} The error that was thrown.
 */
function throwsReadably(call, what) {
  let thrown = null;
  try {
    call();
  } catch (error) {
    thrown = error;
  }
  assert.notEqual(thrown, null, `${what} should have thrown`);
  assert.equal(thrown instanceof Error, true, `${what} threw something that is not an Error`);
  assert.equal(typeof thrown.message === 'string' && thrown.message.length > 0, true);
  assert.equal(/undefined is not|cannot read|is not a function/i.test(thrown.message), false,
    `${what} leaked a runtime error: ${thrown.message}`);
  return thrown;
}

/**
 * Same as {@link throwsReadably} for promises.
 *
 * @param {() => Promise<unknown>} call What to run.
 * @param {string} what Description used when the assertion fails.
 * @returns {Promise<Error>} The error that was thrown.
 */
async function rejectsReadably(call, what) {
  const thrown = await call().then(() => null, (error) => error);
  assert.notEqual(thrown, null, `${what} should have rejected`);
  assert.equal(thrown instanceof Error, true, `${what} rejected with something that is not an Error`);
  assert.equal(typeof thrown.message === 'string' && thrown.message.length > 0, true);
  assert.equal(/undefined is not|cannot read|is not a function/i.test(thrown.message), false,
    `${what} leaked a runtime error: ${thrown.message}`);
  return thrown;
}

const JUNK = [undefined, null, '', ' ', 0, -1, 1.5, NaN, {}, [], true, 'nonsense'];
/** Junk for arguments where 0 is a perfectly good value. */
const JUNK_COORDINATES = [undefined, null, '', ' ', -1, 6, 1.5, NaN, {}, [], true, 'nonsense'];
const JUNK_INDEXES = [undefined, null, '', ' ', -1, 36, 1.5, NaN, {}, [], true, 'nonsense'];

test('coordinate helpers survive junk', () => {
  for (const junk of JUNK_COORDINATES) {
    throwsReadably(() => cellToIndex(junk, 0), `cellToIndex(${String(junk)}, 0)`);
    throwsReadably(() => cellToIndex(0, junk), `cellToIndex(0, ${String(junk)})`);
    throwsReadably(() => cellToLabel(junk, junk), `cellToLabel(${String(junk)})`);
  }
  for (const junk of JUNK_INDEXES) {
    throwsReadably(() => indexToCell(junk), `indexToCell(${String(junk)})`);
  }
  for (const junk of JUNK) {
    throwsReadably(() => labelToCell(junk), `labelToCell(${String(junk)})`);
    throwsReadably(() => parseEdgeId(junk), `parseEdgeId(${String(junk)})`);
    throwsReadably(() => edgeToBitIndex(junk), `edgeToBitIndex(${String(junk)})`);
  }
  throwsReadably(() => cellToIndex(-1, -1), 'negative coordinates');
  throwsReadably(() => edgeBetween(-1, 0, 0, 0), 'negative coordinates in edgeBetween');
  throwsReadably(() => labelToCell('A0'), 'column zero');
  throwsReadably(() => labelToCell('Z9'), 'row beyond the board');
  throwsReadably(() => parseEdgeId('V,'), 'edge id without numbers');
  throwsReadably(() => parseEdgeId('V-1,0'), 'negative edge index');
});

test('the maze survives junk', () => {
  // An empty object is a maze that has not been built yet, not junk.
  const notAMaze = JUNK.filter((value) => typeof value !== 'object' || value === null);
  for (const junk of notAMaze) {
    throwsReadably(() => createMaze(junk), `createMaze(${String(junk)})`);
    throwsReadably(() => validateMaze(junk, { wall_limit: 20 }), `validateMaze(${String(junk)})`);
  }
  for (const junk of JUNK) {
    throwsReadably(() => hasWall(junk, 0, 0, 0, 1), `hasWall(${String(junk)})`);
    throwsReadably(() => openSides(junk, 0, 0), `openSides(${String(junk)})`);
    throwsReadably(() => findPath(junk), `findPath(${String(junk)})`);
  }
  throwsReadably(
    () => createMaze({ entrance: { r: -1, c: 0 }, exit: { r: 0, c: 0 }, walls: [] }),
    'negative entrance',
  );
  throwsReadably(() => createMaze({ walls: ['', ' ', 'V9,9'] }), 'junk wall ids');
});

test('the bit reader and writer survive junk', () => {
  for (const junk of JUNK) {
    throwsReadably(() => new BitWriter(junk), `new BitWriter(${String(junk)})`);
    throwsReadably(() => new BitReader(junk), `new BitReader(${String(junk)})`);
    throwsReadably(() => new BitWriter(8).write(1, junk), `write(1, ${String(junk)})`);
    throwsReadably(() => new BitReader(new Uint8Array(1)).read(junk), `read(${String(junk)})`);
  }
  for (const junk of [undefined, null, '', ' ', -1, 16, 1.5, NaN, {}, [], true, 'nonsense']) {
    throwsReadably(() => new BitWriter(8).write(junk, 4), `write(${String(junk)}, 4)`);
  }
});

test('base32 and sha256 survive junk', async () => {
  for (const junk of JUNK) {
    throwsReadably(() => base32Encode(junk), `encode(${String(junk)})`);
    await rejectsReadably(() => sha256(junk), `sha256(${String(junk)})`);
    throwsReadably(() => sha256JsSync(junk), `sha256JsSync(${String(junk)})`);
  }
  for (const junk of [undefined, null, 0, {}, []]) {
    throwsReadably(() => base32Decode(junk), `decode(${String(junk)})`);
  }
  assert.deepEqual([...base32Decode('')], [], 'an empty string decodes to no bytes');
  throwsReadably(() => base32Decode('AAAU'), 'a letter outside the alphabet');
});

test('the settings block survives junk', async () => {
  for (const junk of JUNK) {
    throwsReadably(() => unpackSettings(junk), `unpackSettings(${String(junk)})`);
    await rejectsReadably(() => decodeSettingsCode(junk), `decodeSettingsCode(${String(junk)})`);
  }
  // packSettings() with nothing at all means "the defaults", which is useful;
  // anything that is not a settings object is refused.
  for (const junk of [null, 0, '', 'text', true, { grid_w: -1 }, { nonsense: 1 }]) {
    throwsReadably(() => packSettings(junk), `packSettings(${String(junk)})`);
  }
  const code = await encodeSettingsCode({});
  for (const broken of ['', '   ', code.slice(0, 10), `${code}EXTRA`, code.replace('-', ''), 'YM1-!!!!!!!!!!!!!!!-00']) {
    const error = await rejectsReadably(
      () => decodeSettingsCode(broken),
      `decodeSettingsCode(${JSON.stringify(broken)})`,
    );
    assert.equal(['BAD_FORMAT', 'BAD_CHECKSUM', 'OUT_OF_RANGE'].includes(error.code), true);
  }
});

test('the payload and the reveal survive junk', async () => {
  for (const junk of JUNK) {
    throwsReadably(() => parsePayload(junk), `parsePayload(${String(junk)})`);
    throwsReadably(() => buildPayload(packSettings({}), junk), 'buildPayload maze');
    await rejectsReadably(() => computeCommit(junk, junk), `computeCommit(${String(junk)})`);
    await rejectsReadably(() => encodeReveal(junk, junk), `encodeReveal(${String(junk)})`);
    await rejectsReadably(() => decodeReveal(junk), `decodeReveal(${String(junk)})`);
  }
  for (const junk of [undefined, null, 0, '', true, 'nonsense', new Uint8Array(3)]) {
    throwsReadably(
      () => buildPayload(junk, { entrance: { r: 0, c: 0 }, exit: { r: 1, c: 1 } }),
      `buildPayload(${String(junk)})`,
    );
  }
  for (const broken of ['', 'YMR1', 'YMR1-', 'YMR1--0000', 'YMR1-AAAA-0000']) {
    const error = await rejectsReadably(() => decodeReveal(broken), `decodeReveal(${JSON.stringify(broken)})`);
    assert.equal(error.code, 'BAD_FORMAT');
  }
});

test('the commit wrapper survives junk', async () => {
  for (const junk of JUNK) {
    await rejectsReadably(() => encodeCommitCode(junk), `encodeCommitCode(${String(junk)})`);
    await rejectsReadably(() => decodeCommitCode(junk), `decodeCommitCode(${String(junk)})`);
  }
  for (const broken of ['', '   ', 'YMC1', 'YMC1-', 'YMC1--0000', `YMC1-${'0'.repeat(63)}-0000`, `YMC1-${'0'.repeat(65)}-0000`, `YMC1-${'g'.repeat(64)}-0000`]) {
    const error = await rejectsReadably(
      () => decodeCommitCode(broken),
      `decodeCommitCode(${JSON.stringify(broken)})`,
    );
    assert.equal(error.code, 'BAD_FORMAT');
  }
});

test('the log renderer survives junk', () => {
  for (const junk of JUNK) {
    throwsReadably(() => renderLogEntryEn(junk), `renderLogEntryEn(${String(junk)})`);
  }
  throwsReadably(() => renderLogEntryEn({ move: 1 }), 'entry without steps');
  throwsReadably(() => renderLogEntryEn({ steps: [] }), 'entry without a move number');
});

test('the game survives junk', () => {
  for (const junk of JUNK) {
    throwsReadably(() => createGameState(junk), `createGameState(${String(junk)})`);
    throwsReadably(() => startTurn(junk), `startTurn(${String(junk)})`);
    throwsReadably(() => tryStep(junk, 'me', 'up', 'pass'), `tryStep(${String(junk)})`);
  }
  const state = createGameState({
    settings: {},
    myMaze: { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: [] },
    opponentEntrance: { r: 2, c: 2 },
    opponentExit: { r: 5, c: 5 },
  });
  startTurn(state);
  for (const junk of JUNK) {
    throwsReadably(() => tryStep(state, junk, 'up', 'pass'), `side ${String(junk)}`);
    throwsReadably(() => tryStep(state, 'me', junk, 'pass'), `direction ${String(junk)}`);
    throwsReadably(() => tryStep(state, 'me', 'up', junk), `answer ${String(junk)}`);
  }
});

test('the verdict and the report survive junk', async () => {
  for (const junk of JUNK) {
    throwsReadably(() => computeVerdict(junk, { play_after_exit: 1 }), `computeVerdict(${String(junk)})`);
    await rejectsReadably(() => verifyReveal(junk), `verifyReveal(${String(junk)})`);
  }
});
