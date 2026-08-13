import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMIT_CODE_PREFIX,
  FORMAT_VERSION,
  PAYLOAD_BYTES,
  SALT_BYTES,
  buildPayload,
  computeCommit,
  decodeCommitCode,
  decodeReveal,
  encodeCommitCode,
  encodeReveal,
  generateSalt,
  parsePayload,
} from '../src/core/commit.js';
import { ALPHABET, checksum4 } from '../src/core/base32.js';
import { hexToBytes } from '../src/core/sha256.js';
import { EDGE_ORDER, cellToIndex, edgeToBitIndex } from '../src/core/edges.js';
import { DEFAULT_SETTINGS, packSettings } from '../src/core/settings.js';
import { createMaze } from '../src/core/maze.js';

/**
 * Small deterministic generator, so a failing case can always be reproduced.
 *
 * @param {number} seed Starting seed.
 * @returns {() => number} Function returning floats in [0, 1).
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shuffles a copy of an array.
 *
 * @param {string[]} items Items to shuffle.
 * @param {() => number} random Source of randomness.
 * @returns {string[]} A shuffled copy.
 */
function shuffled(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const SETTINGS_BYTES_DEFAULT = packSettings(DEFAULT_SETTINGS);
const WALLS = ['V0,0', 'H0,3', 'V2,3', 'H4,5', 'V5,4', 'H1,1', 'V3,2', 'H3,0'];

test('the payload follows the layout of the table in SPEC 4.2', () => {
  const maze = createMaze({
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: ['V0,0', 'H4,5'],
  });
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, maze);

  assert.equal(payload.length, PAYLOAD_BYTES);
  assert.equal(payload[0], FORMAT_VERSION);
  assert.deepEqual([...payload.slice(1, 10)], [...SETTINGS_BYTES_DEFAULT]);
  assert.equal(payload[10], cellToIndex(0, 0));
  assert.equal(payload[11], cellToIndex(5, 5));

  // V0,0 is bit 0: the top bit of the first mask byte.
  assert.equal(edgeToBitIndex('V0,0'), 0);
  assert.equal(payload[12] & 0b10000000, 0b10000000);
  // H4,5 is bit 59: the fourth bit from the top of the last mask byte.
  assert.equal(edgeToBitIndex('H4,5'), 59);
  assert.equal(payload[19] & 0b00010000, 0b00010000);
  // Bits 60..63 are reserved and stay zero.
  assert.equal(payload[19] & 0b00001111, 0);
});

test('the payload is deterministic: 100 different insertion orders, one result', () => {
  const random = mulberry32(4242);
  const reference = buildPayload(
    SETTINGS_BYTES_DEFAULT,
    { entrance: { r: 1, c: 2 }, exit: { r: 4, c: 3 }, walls: new Set(WALLS) },
  );

  for (let i = 0; i < 100; i += 1) {
    const walls = new Set(shuffled(WALLS, random));
    const payload = buildPayload(
      SETTINGS_BYTES_DEFAULT,
      { entrance: { r: 1, c: 2 }, exit: { r: 4, c: 3 }, walls },
    );
    assert.deepEqual([...payload], [...reference], `insertion order ${i} changed the payload`);
  }
});

test('every single edge lands on its own bit', () => {
  for (const id of EDGE_ORDER) {
    const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
      entrance: { r: 0, c: 0 },
      exit: { r: 5, c: 5 },
      walls: [id],
    });
    const mask = payload.slice(12);
    const bit = edgeToBitIndex(id);
    let set = 0;
    for (let i = 0; i < 64; i += 1) {
      if ((mask[i >> 3] >> (7 - (i & 7))) & 1) {
        set += 1;
        assert.equal(i, bit, `${id} lit bit ${i} instead of ${bit}`);
      }
    }
    assert.equal(set, 1);
  }
});

test('parsePayload gives the maze back', () => {
  const maze = createMaze({ entrance: { r: 2, c: 1 }, exit: { r: 3, c: 4 }, walls: WALLS });
  const parsed = parsePayload(buildPayload(SETTINGS_BYTES_DEFAULT, maze));

  assert.equal(parsed.formatVersion, FORMAT_VERSION);
  assert.deepEqual([...parsed.settings], [...SETTINGS_BYTES_DEFAULT]);
  assert.deepEqual(parsed.maze.entrance, { r: 2, c: 1 });
  assert.deepEqual(parsed.maze.exit, { r: 3, c: 4 });
  assert.deepEqual([...parsed.maze.walls].sort(), [...WALLS].sort());
});

test('buildPayload guards its arguments', () => {
  assert.throws(
    () => buildPayload(SETTINGS_BYTES_DEFAULT, { entrance: { r: 0, c: 0 }, walls: [] }),
    /both an entrance and an exit/,
  );
  assert.throws(() => buildPayload(new Uint8Array(8), { entrance: { r: 0, c: 0 }, exit: { r: 1, c: 1 } }), /9 bytes/);
  assert.throws(() => buildPayload(null, { entrance: { r: 0, c: 0 }, exit: { r: 1, c: 1 } }), /settings must be/);
  assert.throws(() => buildPayload(SETTINGS_BYTES_DEFAULT, null), /must be an object/);

  // A settings object is packed on the spot, which is handy for the interface.
  const fromObject = buildPayload(DEFAULT_SETTINGS, {
    entrance: { r: 0, c: 0 },
    exit: { r: 1, c: 1 },
    walls: [],
  });
  assert.deepEqual([...fromObject.slice(1, 10)], [...SETTINGS_BYTES_DEFAULT]);
});

test('parsePayload guards its argument', () => {
  const good = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: [],
  });
  assert.throws(() => parsePayload(good.slice(0, 19)), /must be 20 bytes/);
  assert.throws(() => parsePayload('twenty bytes'), /must be a Uint8Array/);

  const wrongVersion = good.slice();
  wrongVersion[0] = 2;
  assert.throws(() => parsePayload(wrongVersion), /unsupported payload format version 2/);

  const reservedBitSet = good.slice();
  reservedBitSet[19] |= 0b00000001;
  assert.throws(() => parsePayload(reservedBitSet), /reserved wall bit 63 must be zero/);
});

test('a broken cell index in a payload says which end it was', () => {
  const good = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: [],
  });

  const messages = new Set();
  for (const [offset, field] of [[10, 'entrance'], [11, 'exit']]) {
    for (const value of [36, 255]) {
      const broken = good.slice();
      broken[offset] = value;
      let thrown = null;
      try {
        parsePayload(broken);
      } catch (error) {
        thrown = error;
      }
      assert.notEqual(thrown, null, `${field} = ${value} passed silently`);
      assert.equal(thrown.code, 'OUT_OF_RANGE');
      assert.match(thrown.message, new RegExp(`payload ${field} is not a cell`));
      assert.match(thrown.message, /cell index must be in 0\.\.35/);
      assert.equal(thrown.cause instanceof Error, true, 'the original complaint is kept');
      assert.match(thrown.cause.message, new RegExp(`got ${value}`));
      messages.add(thrown.message);
    }
  }
  assert.equal(messages.size, 4, 'all four cases read differently');
});

test('a re-wrapped parse error keeps the original as its cause', async () => {
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: WALLS,
  });
  const reveal = await encodeReveal(payload, new Uint8Array(SALT_BYTES).fill(6));
  const withBadCharacter = `${reveal.slice(0, 10)}U${reveal.slice(11)}`;

  const error = await decodeReveal(withBadCharacter).then(() => null, (caught) => caught);
  assert.equal(error.code, 'BAD_FORMAT');
  assert.equal(error.cause instanceof Error, true);
  assert.match(error.cause.message, /"U" is not valid Crockford Base32/);
  assert.equal(error.cause.code, 'BAD_FORMAT');
});

test('the salt is sixteen fresh random bytes', () => {
  const first = generateSalt();
  const second = generateSalt();
  assert.equal(first.length, SALT_BYTES);
  assert.notDeepEqual([...first], [...second]);
});

test('the commit is 64 lower case hex characters and depends on the salt', async () => {
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: WALLS,
  });
  const salt = new Uint8Array(SALT_BYTES).fill(7);
  const commit = await computeCommit(payload, salt);
  assert.match(commit, /^[0-9a-f]{64}$/);
  assert.equal(commit, await computeCommit(payload, salt), 'the same input hashes the same');

  const otherSalt = new Uint8Array(SALT_BYTES).fill(8);
  assert.notEqual(commit, await computeCommit(payload, otherSalt));

  await assert.rejects(() => computeCommit(payload.slice(0, 19), salt), /payload must be/);
  await assert.rejects(() => computeCommit(payload, salt.slice(0, 15)), /salt must be/);
});

test('the reveal string has the shape of SPEC 4.4', async () => {
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: WALLS,
  });
  const reveal = await encodeReveal(payload, new Uint8Array(SALT_BYTES).fill(3));
  assert.match(reveal, /^YMR1-[0-9A-Z]{58}-[0-9A-F]{4}$/);
  assert.equal(reveal.length, 68);
});

test('payload and salt survive the reveal string, 1000 random draws', async () => {
  const random = mulberry32(90210);
  for (let i = 0; i < 1000; i += 1) {
    const walls = EDGE_ORDER.filter(() => random() < 0.3);
    const entrance = { r: Math.floor(random() * 6), c: Math.floor(random() * 6) };
    const exit = { r: Math.floor(random() * 6), c: Math.floor(random() * 6) };
    const settings = packSettings({
      ...DEFAULT_SETTINGS,
      game_nonce: Math.floor(random() * 65536),
      wall_limit: Math.floor(random() * 64),
    });
    const payload = buildPayload(settings, { entrance, exit, walls });
    const salt = Uint8Array.from({ length: SALT_BYTES }, () => Math.floor(random() * 256));

    const reveal = await encodeReveal(payload, salt);
    const back = await decodeReveal(reveal);
    assert.deepEqual([...back.payload], [...payload], `iteration ${i}`);
    assert.deepEqual([...back.salt], [...salt], `iteration ${i}`);

    const parsed = parsePayload(back.payload);
    assert.deepEqual(parsed.maze.entrance, entrance, `iteration ${i}`);
    assert.deepEqual(parsed.maze.exit, exit, `iteration ${i}`);
    assert.deepEqual([...parsed.maze.walls].sort(), [...walls].sort(), `iteration ${i}`);
  }
});

test('a damaged reveal is told apart from a reveal of the wrong shape', async () => {
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: WALLS,
  });
  const reveal = await encodeReveal(payload, new Uint8Array(SALT_BYTES).fill(5));

  const damaged = `${reveal.slice(0, 5)}${reveal[5] === 'A' ? 'B' : 'A'}${reveal.slice(6)}`;
  const damagedError = await decodeReveal(damaged).then(() => null, (error) => error);
  assert.equal(damagedError.code, 'BAD_CHECKSUM');

  for (const broken of ['', 'YMR2-AAA-0000', reveal.replace('YMR1', 'YM1'), reveal.slice(0, 40), `${reveal}Z`, 'nonsense', reveal.slice(0, 64) + '-00']) {
    const error = await decodeReveal(broken).then(() => null, (caught) => caught);
    assert.notEqual(error, null, `${JSON.stringify(broken)} should not decode`);
    assert.equal(error.code, 'BAD_FORMAT', `${JSON.stringify(broken)} -> ${error.message}`);
  }
});

test('exactly one spelling of the last character of a reveal is accepted', async () => {
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 1, c: 1 },
    exit: { r: 4, c: 4 },
    walls: WALLS,
  });
  const reveal = await encodeReveal(payload, new Uint8Array(SALT_BYTES).fill(9));
  let accepted = 0;
  let badFormat = 0;
  let badChecksum = 0;

  for (const character of ALPHABET) {
    const candidate = reveal.slice(0, 62) + character + reveal.slice(63);
    const error = await decodeReveal(candidate).then(() => null, (caught) => caught);
    if (error === null) {
      accepted += 1;
      assert.equal(candidate, reveal);
    } else if (error.code === 'BAD_FORMAT') {
      badFormat += 1;
      assert.match(error.message, /trailing bits/);
    } else {
      badChecksum += 1;
      assert.equal(error.code, 'BAD_CHECKSUM');
    }
  }

  assert.equal(accepted, 1);
  // 58 characters carry 290 bits for 288 bits of data: two trailing bits, so
  // 24 of the 32 spellings are not canonical at all.
  assert.equal(badFormat, 24);
  assert.equal(badChecksum, 7);
});

test('the commit travels in the wrapper of SPEC 4.4', async () => {
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 0, c: 0 },
    exit: { r: 5, c: 5 },
    walls: WALLS,
  });
  const commit = await computeCommit(payload, new Uint8Array(SALT_BYTES).fill(1));
  const code = await encodeCommitCode(commit);

  assert.match(code, /^YMC1-[0-9a-f]{64}-[0-9A-F]{4}$/);
  assert.equal(code.length, 74);
  assert.equal(code.startsWith(`${COMMIT_CODE_PREFIX}-${commit}-`), true, 'the digest is untouched');
  assert.equal(await decodeCommitCode(code), commit);

  // The checksum covers the 32 raw digest bytes, not their hex spelling.
  assert.equal(code.slice(70), await checksum4(hexToBytes(commit)));

  assert.equal(await decodeCommitCode(code.toUpperCase()), commit, 'case does not matter');
  const grouped = `YMC1-${commit.slice(0, 32)}-${commit.slice(32)}-${code.slice(70)}`;
  assert.equal(await decodeCommitCode(grouped), commit, 'grouping dashes are ignored');
});

test('every single substituted character in a commit code is refused', async () => {
  const payload = buildPayload(SETTINGS_BYTES_DEFAULT, {
    entrance: { r: 2, c: 2 },
    exit: { r: 3, c: 3 },
    walls: WALLS,
  });
  const commit = await computeCommit(payload, new Uint8Array(SALT_BYTES).fill(2));
  const code = await encodeCommitCode(commit);

  let total = 0;
  let caught = 0;
  const missed = [];
  for (let position = 5; position < 69; position += 1) {
    for (const replacement of '0123456789abcdef') {
      if (replacement === code[position]) {
        continue;
      }
      total += 1;
      const damaged = code.slice(0, position) + replacement + code.slice(position + 1);
      const error = await decodeCommitCode(damaged).then(() => null, (thrown) => thrown);
      if (error === null) {
        assert.equal(
          await checksum4(hexToBytes(damaged.slice(5, 69))),
          code.slice(70),
          'only a real collision may slip through',
        );
        missed.push(position);
        continue;
      }
      assert.equal(error.code, 'BAD_CHECKSUM');
      caught += 1;
    }
  }

  assert.equal(total, 64 * 15);
  assert.equal(
    caught / total > 0.999,
    true,
    `only ${caught} of ${total} substitutions were caught, missed at ${JSON.stringify(missed)}`,
  );
});

test('a bare commit is refused and junk wrappers are told apart', async () => {
  const commit = await computeCommit(
    buildPayload(SETTINGS_BYTES_DEFAULT, { entrance: { r: 0, c: 0 }, exit: { r: 5, c: 5 }, walls: [] }),
    new Uint8Array(SALT_BYTES).fill(4),
  );
  const code = await encodeCommitCode(commit);

  const bare = await decodeCommitCode(commit).then(() => null, (error) => error);
  assert.equal(bare.code, 'BAD_FORMAT', 'bare 64 hex characters carry no checksum');

  const wrongChecksum = await decodeCommitCode(
    `${code.slice(0, 70)}${code.slice(70) === '0000' ? '1111' : '0000'}`,
  ).then(() => null, (error) => error);
  assert.equal(wrongChecksum.code, 'BAD_CHECKSUM');

  for (const broken of ['', 'YMC1', 'YMC1-', 'YMC1--0000', `YMC1-${'z'.repeat(64)}-0000`, `YMC1-${commit.slice(0, 63)}-0000`, code.replace('YMC1', 'YMR1'), `${code}0`]) {
    const error = await decodeCommitCode(broken).then(() => null, (caught) => caught);
    assert.notEqual(error, null, `${JSON.stringify(broken)} should not decode`);
    assert.equal(error.code, 'BAD_FORMAT', `${JSON.stringify(broken)} -> ${error.message}`);
  }

  await assert.rejects(() => encodeCommitCode('abc'), /64 hex characters/);
  await assert.rejects(() => encodeCommitCode(null), /must be a string/);
});
