import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  SETTINGS_FIELDS,
  createGameSettings,
  decodeSettingsCode,
  encodeSettingsCode,
  generateGameNonce,
  packSettings,
  splitCode,
  unpackSettings,
} from '../src/core/settings.js';
import { ALPHABET, checksum4, decode as base32Decode, encode as base32Encode } from '../src/core/base32.js';
import { BitWriter } from '../src/core/bits.js';

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
 * Draws a settings object with every field inside its range.
 *
 * @param {() => number} random Source of randomness.
 * @returns {object} Settings object.
 */
function randomSettings(random) {
  const settings = {};
  for (const field of SETTINGS_FIELDS) {
    if (field.reserved) {
      continue;
    }
    settings[field.name] = field.min + Math.floor(random() * (field.max - field.min + 1));
  }
  return settings;
}

test('the defaults are the ones in the table of SPEC 4.3', () => {
  assert.deepEqual({ ...DEFAULT_SETTINGS }, {
    grid_w: 6,
    grid_h: 6,
    wall_limit: 20,
    new_cells_per_turn: 3,
    move_limit_total: 150,
    exits_count: 1,
    allow_pass: 0,
    play_after_exit: 1,
    timers_visible: 1,
    build_timer_sec: 300,
    turn_timer_sec: 90,
    first_move: 0,
    game_nonce: 0,
  });
  assert.equal(Object.isFrozen(DEFAULT_SETTINGS), true);
});

test('the block is nine bytes and the fields add up to 72 bits', () => {
  assert.equal(SETTINGS_FIELDS.reduce((sum, field) => sum + field.bits, 0), 72);
  assert.equal(packSettings(DEFAULT_SETTINGS).length, 9);
});

test('settings survive a round trip through the nine bytes, 1000 random draws', () => {
  const random = mulberry32(20240810);
  for (let i = 0; i < 1000; i += 1) {
    const settings = randomSettings(random);
    const bytes = packSettings(settings);
    assert.equal(bytes.length, 9, `iteration ${i}`);
    assert.deepEqual(unpackSettings(bytes), settings, `iteration ${i}`);
  }
});

test('missing fields fall back to the defaults', () => {
  const bytes = packSettings({ wall_limit: 25 });
  const back = unpackSettings(bytes);
  assert.equal(back.wall_limit, 25);
  assert.equal(back.move_limit_total, DEFAULT_SETTINGS.move_limit_total);
  assert.equal(back.play_after_exit, DEFAULT_SETTINGS.play_after_exit);
});

test('values outside their range throw instead of being truncated', () => {
  assert.throws(() => packSettings({ grid_w: 2 }), /grid_w" must be in 3\.\.15/);
  assert.throws(() => packSettings({ grid_w: 16 }), /grid_w" must be in 3\.\.15/);
  assert.throws(() => packSettings({ wall_limit: 64 }), /wall_limit" must be in 0\.\.63/);
  assert.throws(() => packSettings({ new_cells_per_turn: 0 }), /new_cells_per_turn" must be in 1\.\.7/);
  assert.throws(() => packSettings({ move_limit_total: 1024 }), /move_limit_total" must be in 0\.\.1023/);
  assert.throws(() => packSettings({ turn_timer_sec: 256 }), /turn_timer_sec" must be in 0\.\.255/);
  assert.throws(() => packSettings({ allow_pass: 2 }), /allow_pass" must be in 0\.\.1/);
  assert.throws(() => packSettings({ game_nonce: 65536 }), /game_nonce" must be in 0\.\.65535/);
  assert.throws(() => packSettings({ wall_limit: 1.5 }), /must be an integer/);
  assert.throws(() => packSettings({ nonsense: 1 }), /unknown setting/);
  assert.throws(() => packSettings(null), /must be an object/);

  const rangeError = (() => {
    try {
      packSettings({ grid_w: 0 });
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.equal(rangeError.code, 'OUT_OF_RANGE');
});

test('the settings code has the shape of SPEC 4.4', async () => {
  const code = await encodeSettingsCode({ ...DEFAULT_SETTINGS, game_nonce: 0xa71f });
  assert.match(code, /^YM1-[0-9A-Z]{15}-[0-9A-F]{4}$/);
  assert.equal(code.length, 24);
  assert.deepEqual(await decodeSettingsCode(code), { ...DEFAULT_SETTINGS, game_nonce: 0xa71f });
});

test('the settings code survives a round trip, 1000 random draws', async () => {
  const random = mulberry32(777);
  for (let i = 0; i < 1000; i += 1) {
    const settings = randomSettings(random);
    const code = await encodeSettingsCode(settings);
    assert.deepEqual(await decodeSettingsCode(code), settings, `iteration ${i}`);
  }
});

test('the code is read back whatever the case and the grouping', async () => {
  const settings = { ...DEFAULT_SETTINGS, game_nonce: 4242 };
  const code = await encodeSettingsCode(settings);
  assert.deepEqual(await decodeSettingsCode(code.toLowerCase()), settings);
  assert.deepEqual(await decodeSettingsCode(`  ${code}  `), settings);
  const body = code.slice(4, 19);
  const grouped = `YM1-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10)}-${code.slice(20)}`;
  assert.deepEqual(await decodeSettingsCode(grouped), settings);
});

test('every single substituted character in the settings code is refused', async () => {
  const code = await encodeSettingsCode({ ...DEFAULT_SETTINGS, game_nonce: 31337 });
  const body = code.slice(4, 19);
  const checksum = code.slice(20);

  const damagedFirst = `${body[0] === '0' ? '1' : '0'}${body.slice(1)}`;
  const firstError = await decodeSettingsCode(`YM1-${damagedFirst}-${checksum}`).then(
    () => null,
    (error) => error,
  );
  assert.equal(firstError.code, 'BAD_CHECKSUM');
  assert.match(firstError.message, /checksum does not match/);

  // Sixteen bits of checksum miss about one damaged code in 65536. Anything
  // that slips through must be a genuine checksum4 collision, never a check
  // that was not performed.
  let total = 0;
  let caught = 0;
  const missed = [];
  for (let position = 0; position < body.length; position += 1) {
    for (const replacement of ALPHABET) {
      if (replacement === body[position]) {
        continue;
      }
      total += 1;
      const damaged = body.slice(0, position) + replacement + body.slice(position + 1);
      const error = await decodeSettingsCode(`YM1-${damaged}-${checksum}`).then(
        () => null,
        (thrown) => thrown,
      );
      if (error === null) {
        // Canonical Base32 means the bytes really did change, so only a
        // collision can explain this.
        assert.equal(await checksum4(base32Decode(damaged)), checksum);
        missed.push({ position, replacement });
        continue;
      }
      assert.equal(
        ['BAD_CHECKSUM', 'BAD_FORMAT', 'OUT_OF_RANGE'].includes(error.code),
        true,
        `unexpected error code ${error.code}`,
      );
      caught += 1;
    }
  }

  assert.equal(total, 15 * 31);
  assert.equal(
    caught / total > 0.999,
    true,
    `only ${caught} of ${total} substitutions were caught, missed ${JSON.stringify(missed)}`,
  );
});

test('exactly one spelling of the last character of a settings code is accepted', async () => {
  const code = await encodeSettingsCode({ ...DEFAULT_SETTINGS, game_nonce: 2024 });
  let accepted = 0;
  let badFormat = 0;
  let badChecksum = 0;

  for (const character of ALPHABET) {
    const candidate = code.slice(0, 18) + character + code.slice(19);
    const error = await decodeSettingsCode(candidate).then(() => null, (caught) => caught);
    if (error === null) {
      accepted += 1;
      assert.equal(candidate, code, 'the only acceptable spelling is the canonical one');
    } else if (error.code === 'BAD_FORMAT') {
      badFormat += 1;
      assert.match(error.message, /trailing bits/);
    } else {
      badChecksum += 1;
      assert.equal(error.code, 'BAD_CHECKSUM');
    }
  }

  assert.equal(accepted, 1);
  // Fifteen characters carry 75 bits for 72 bits of settings: three trailing
  // bits, so 28 of the 32 spellings are not canonical at all.
  assert.equal(badFormat, 28);
  assert.equal(badChecksum, 3);
});

test('a damaged checksum is told apart from a wrong format and a bad value', async () => {
  const code = await encodeSettingsCode(DEFAULT_SETTINGS);

  const wrongChecksum = await decodeSettingsCode(
    `${code.slice(0, 20)}${code.slice(20) === '0000' ? '1111' : '0000'}`,
  ).then(() => null, (error) => error);
  assert.equal(wrongChecksum.code, 'BAD_CHECKSUM');

  for (const broken of ['', 'YM2-AAAAAAAAAAAAAAA-0000', 'YMR1-AAAAAAAAAAAAAAA-0000', code.slice(4), `${code}X`, 'YM1--0000', 'YM1-AAAAAAAAAAAAAAA', 'YM1-AAAAAAAAAAAAAAA-ZZZZ', 'YM1-AAAAAAAAAAAAAAA-00']) {
    const error = await decodeSettingsCode(broken).then(() => null, (caught) => caught);
    assert.notEqual(error, null, `${JSON.stringify(broken)} should not decode`);
    assert.equal(error.code, 'BAD_FORMAT', `${JSON.stringify(broken)} -> ${error.message}`);
  }

  // A code whose checksum is right but whose grid_w is below its minimum.
  const writer = new BitWriter(72);
  writer.write(0, 4); // grid_w, not allowed below 3
  for (const field of SETTINGS_FIELDS.slice(1)) {
    writer.write(field.reserved ? 0 : field.min, field.bits);
  }
  const bytes = writer.bytes();
  const outOfRange = `YM1-${base32Encode(bytes)}-${await checksum4(bytes)}`;
  const rangeError = await decodeSettingsCode(outOfRange).then(() => null, (error) => error);
  assert.equal(rangeError.code, 'OUT_OF_RANGE');
  assert.match(rangeError.message, /grid_w/);
});

test('reserved bits must be zero', async () => {
  const writer = new BitWriter(72);
  for (const field of SETTINGS_FIELDS) {
    writer.write(field.reserved ? 0 : field.min, field.bits);
  }
  const bytes = writer.bytes();
  // The reserved nibble sits in the bits just before the 16 bit nonce.
  bytes[6] |= 0b00001000;
  assert.throws(() => unpackSettings(bytes), /reserved settings bits must be zero/);

  const code = `YM1-${base32Encode(bytes)}-${await checksum4(bytes)}`;
  const error = await decodeSettingsCode(code).then(() => null, (caught) => caught);
  assert.equal(error.code, 'OUT_OF_RANGE');
});

test('unpackSettings guards its input', () => {
  assert.throws(() => unpackSettings(new Uint8Array(8)), /must be 9 bytes/);
  assert.throws(() => unpackSettings('nine bytes'), /must be a Uint8Array/);
});

test('splitCode hands both parts back in upper case', async () => {
  // Every code parser is written on top of this. The guarantee lives in the
  // JSDoc; this test is what actually holds it in place.
  const code = await encodeSettingsCode({ ...DEFAULT_SETTINGS, game_nonce: 51966 });
  const fromLower = splitCode(code.toLowerCase(), 'YM1');
  assert.equal(fromLower.body, code.slice(4, 19).toUpperCase());
  assert.equal(fromLower.checksum, code.slice(20).toUpperCase());
  assert.equal(fromLower.body, fromLower.body.toUpperCase());
  assert.equal(fromLower.checksum, fromLower.checksum.toUpperCase());

  const mixed = splitCode(`  ymC1-AbCdEf-12aB  `, 'YMC1');
  assert.deepEqual(mixed, { body: 'ABCDEF', checksum: '12AB' });
});

test('a re-wrapped settings code error keeps the original as its cause', async () => {
  const code = await encodeSettingsCode(DEFAULT_SETTINGS);
  const error = await decodeSettingsCode(`YM1-U${code.slice(5, 19)}-${code.slice(20)}`).then(
    () => null,
    (caught) => caught,
  );
  assert.equal(error.code, 'BAD_FORMAT');
  assert.equal(error.cause instanceof Error, true);
  assert.match(error.cause.message, /"U" is not valid Crockford Base32/);
});

test('settings for a new game always carry a fresh nonce', () => {
  const first = createGameSettings();
  const second = createGameSettings();
  assert.notEqual(first.game_nonce, second.game_nonce, 'two games must not share a nonce');
  assert.equal(first.game_nonce >= 0 && first.game_nonce <= 65535, true);

  const drawn = new Set();
  for (let i = 0; i < 100; i += 1) {
    drawn.add(createGameSettings().game_nonce);
  }
  assert.equal(drawn.size > 90, true, `only ${drawn.size} distinct nonces out of 100`);

  const configured = createGameSettings({ allow_pass: 1, wall_limit: 25 });
  assert.equal(configured.allow_pass, 1);
  assert.equal(configured.wall_limit, 25);
  assert.equal(configured.move_limit_total, DEFAULT_SETTINGS.move_limit_total);
});

test('a nonce cannot be handed to createGameSettings', () => {
  assert.throws(() => createGameSettings({ game_nonce: 7 }), /cannot be supplied/);
  assert.throws(() => createGameSettings({ game_nonce: 0 }), /cannot be supplied/);
  assert.throws(() => createGameSettings({ game_nonce: undefined }), /cannot be supplied/);
  assert.throws(() => createGameSettings(null), /must be an object/);
  assert.throws(() => createGameSettings({ nonsense: 1 }), /unknown setting/);
  assert.throws(() => createGameSettings({ allow_pass: 2 }), /allow_pass" must be in 0\.\.1/);

  // The default 0 is still reachable on purpose, for tests and for reading
  // someone else's code back.
  assert.equal(DEFAULT_SETTINGS.game_nonce, 0);
  assert.equal(normalizeSettingsNonce(), 0);
});

/**
 * The nonce a bare normalize call ends up with.
 *
 * @returns {number} The default nonce.
 */
function normalizeSettingsNonce() {
  return unpackSettings(packSettings({})).game_nonce;
}

test('the game nonce is two random bytes', () => {
  const drawn = new Set();
  for (let i = 0; i < 200; i += 1) {
    const nonce = generateGameNonce();
    assert.equal(Number.isInteger(nonce), true);
    assert.equal(nonce >= 0 && nonce <= 65535, true);
    drawn.add(nonce);
  }
  assert.equal(drawn.size > 1, true, 'a constant nonce would defeat its purpose');
});
