/**
 * settings.js - the nine byte settings block and the settings code
 * (SPEC 4.3, 4.5).
 *
 * The whole block goes into the commit hash, reserved bits included, so the
 * field order and the field widths are as fixed as the edge order is.
 *
 * The settings code looks like `YM1-<15 Base32 characters>-<4 hex>`, 24
 * characters in total (SPEC 4.4).
 */

import { BitReader, BitWriter } from './bits.js';
import { checksum4, decode as base32Decode, encode as base32Encode } from './base32.js';

/** Prefix of the settings code, including the protocol version. */
export const SETTINGS_CODE_PREFIX = 'YM1';

/** Size of the packed settings block in bytes. */
export const SETTINGS_BYTES = 9;

/**
 * The settings block layout of SPEC 4.3, big-endian, in order.
 * `reserved` fields are written as zero and are not part of the object form.
 *
 * @type {ReadonlyArray<{name: string, bits: number, min: number, max: number, reserved?: boolean}>}
 */
export const SETTINGS_FIELDS = Object.freeze([
  Object.freeze({ name: 'grid_w', bits: 4, min: 3, max: 15 }),
  Object.freeze({ name: 'grid_h', bits: 4, min: 3, max: 15 }),
  Object.freeze({ name: 'wall_limit', bits: 6, min: 0, max: 63 }),
  Object.freeze({ name: 'new_cells_per_turn', bits: 3, min: 1, max: 7 }),
  Object.freeze({ name: 'move_limit_total', bits: 10, min: 0, max: 1023 }),
  Object.freeze({ name: 'exits_count', bits: 3, min: 1, max: 7 }),
  Object.freeze({ name: 'allow_pass', bits: 1, min: 0, max: 1 }),
  Object.freeze({ name: 'play_after_exit', bits: 1, min: 0, max: 1 }),
  Object.freeze({ name: 'timers_visible', bits: 1, min: 0, max: 1 }),
  Object.freeze({ name: 'build_timer_sec', bits: 10, min: 0, max: 1023 }),
  Object.freeze({ name: 'turn_timer_sec', bits: 8, min: 0, max: 255 }),
  Object.freeze({ name: 'first_move', bits: 1, min: 0, max: 1 }),
  Object.freeze({ name: 'reserved', bits: 4, min: 0, max: 0, reserved: true }),
  Object.freeze({ name: 'game_nonce', bits: 16, min: 0, max: 65535 }),
]);

/**
 * Default settings of the table in SPEC 4.3.
 *
 * `game_nonce` is 0 here, which is a value no real game may use: the nonce is
 * what stops a commit from a previous game being replayed. Zero exists so that
 * tests and code readers have something fixed to compare against, and so that
 * a pasted code can be decoded field by field. Settings for a new game are
 * built with {@link createGameSettings}, never by copying this object.
 */
export const DEFAULT_SETTINGS = Object.freeze({
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
  // 90 rather than 60: a turn is played out loud, and a minute is not enough
  // to name a step, hear the answer and type it in. Three minutes turned out
  // to be more than a turn ever needs.
  turn_timer_sec: 90,
  first_move: 0,
  game_nonce: 0,
});

/**
 * Builds an Error carrying a machine readable code.
 *
 * @param {'BAD_FORMAT'|'BAD_CHECKSUM'|'OUT_OF_RANGE'} code Failure kind.
 * @param {string} message Human readable English text.
 * @param {Error} [cause] The error being re-wrapped, kept so that the original
 *   complaint - which character, which byte - survives into the stack.
 * @returns {Error} The error, ready to be thrown.
 */
function codedError(code, message, cause) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  return error;
}

/**
 * Fills missing fields of a partial settings object from the defaults and
 * checks every value against its range.
 *
 * A missing `game_nonce` falls back to the default 0, which is fine for tests
 * and for reading someone else's code back, and wrong for a new game: use
 * {@link createGameSettings} there.
 *
 * @param {object} [partial={}] Settings, possibly incomplete.
 * @returns {object} A complete, validated settings object.
 * @throws {Error} If the argument is not an object, carries an unknown field,
 *   or holds a value outside its range. The error has `code = 'OUT_OF_RANGE'`
 *   for range problems.
 */
export function normalizeSettings(partial = {}) {
  if (partial === null || typeof partial !== 'object') {
    throw new Error(`settings must be an object, got ${String(partial)}`);
  }
  const known = new Set(SETTINGS_FIELDS.filter((f) => !f.reserved).map((f) => f.name));
  for (const key of Object.keys(partial)) {
    if (!known.has(key)) {
      throw new Error(`unknown setting ${JSON.stringify(key)}`);
    }
  }
  const result = {};
  for (const field of SETTINGS_FIELDS) {
    if (field.reserved) {
      continue;
    }
    const value = partial[field.name] ?? DEFAULT_SETTINGS[field.name];
    assertFieldValue(field, value);
    result[field.name] = value;
  }
  return result;
}

/**
 * Checks one settings value against its declared range.
 *
 * @param {{name: string, min: number, max: number}} field Field description.
 * @param {unknown} value Value to check.
 * @returns {void}
 * @throws {Error} With `code = 'OUT_OF_RANGE'` if the value is not an integer
 *   inside the range.
 */
function assertFieldValue(field, value) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw codedError(
      'OUT_OF_RANGE',
      `setting "${field.name}" must be an integer, got ${String(value)}`,
    );
  }
  if (value < field.min || value > field.max) {
    throw codedError(
      'OUT_OF_RANGE',
      `setting "${field.name}" must be in ${field.min}..${field.max}, got ${value}`,
    );
  }
}

/**
 * Packs a settings object into the nine byte block of SPEC 4.3.
 *
 * @param {object} settings Settings object; missing fields fall back to
 *   {@link DEFAULT_SETTINGS}.
 * @returns {Uint8Array} Exactly 9 bytes.
 * @throws {Error} If a value is missing its type or leaves its range
 *   (`code = 'OUT_OF_RANGE'`).
 */
export function packSettings(settings) {
  const complete = normalizeSettings(settings);
  const writer = new BitWriter(SETTINGS_BYTES * 8);
  for (const field of SETTINGS_FIELDS) {
    writer.write(field.reserved ? 0 : complete[field.name], field.bits);
  }
  return writer.bytes();
}

/**
 * Unpacks the nine byte settings block.
 *
 * @param {Uint8Array} bytes Exactly 9 bytes.
 * @returns {object} Settings object without the reserved field.
 * @throws {Error} If the argument is not a Uint8Array of 9 bytes
 *   (`code = 'BAD_FORMAT'`), or a field holds a value outside its range,
 *   reserved bits included (`code = 'OUT_OF_RANGE'`).
 */
export function unpackSettings(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw codedError('BAD_FORMAT', `bytes must be a Uint8Array, got ${String(bytes)}`);
  }
  if (bytes.length !== SETTINGS_BYTES) {
    throw codedError(
      'BAD_FORMAT',
      `settings block must be ${SETTINGS_BYTES} bytes, got ${bytes.length}`,
    );
  }
  const reader = new BitReader(bytes);
  const settings = {};
  for (const field of SETTINGS_FIELDS) {
    const value = reader.read(field.bits);
    if (field.reserved) {
      if (value !== 0) {
        throw codedError('OUT_OF_RANGE', 'reserved settings bits must be zero');
      }
      continue;
    }
    assertFieldValue(field, value);
    settings[field.name] = value;
  }
  return settings;
}

/**
 * Draws a fresh game nonce: sixteen random bits read as two bytes, big-endian.
 * The nonce makes every settings code unique so that a commit from an older
 * game cannot be reused (SPEC 4.3).
 *
 * @returns {number} A random integer in 0..65535.
 * @throws {Error} If `crypto.getRandomValues` is not available.
 */
export function generateGameNonce() {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available in this runtime');
  }
  const bytes = new Uint8Array(2);
  globalThis.crypto.getRandomValues(bytes);
  return bytes[0] * 256 + bytes[1];
}

/**
 * Builds the settings of a new game. Identical to {@link normalizeSettings}
 * except that `game_nonce` is always drawn fresh and cannot be supplied.
 *
 * The nonce is the only thing that stops a commit from an earlier game being
 * replayed in this one (SPEC 4.3). Leaving it at the default 0 would switch
 * that protection off without a single error message anywhere, so the caller
 * is not offered the choice: this is the entry point for a new game.
 *
 * @param {object} [partial={}] Settings, possibly incomplete, without
 *   `game_nonce`.
 * @returns {object} A complete, validated settings object with a fresh nonce.
 * @throws {Error} If `game_nonce` is supplied, if a field is unknown, if a
 *   value leaves its range (`code = 'OUT_OF_RANGE'`), or if
 *   `crypto.getRandomValues` is not available.
 */
export function createGameSettings(partial = {}) {
  if (partial === null || typeof partial !== 'object') {
    throw new Error(`settings must be an object, got ${String(partial)}`);
  }
  if ('game_nonce' in partial) {
    throw new Error(
      'game_nonce cannot be supplied to createGameSettings: it is drawn fresh for every game',
    );
  }
  return normalizeSettings({ ...partial, game_nonce: generateGameNonce() });
}

/**
 * Encodes a settings object as the shareable settings code (SPEC 4.3).
 *
 * @param {object} settings Settings object; missing fields fall back to
 *   {@link DEFAULT_SETTINGS}.
 * @returns {Promise<string>} A code such as `YM1-A7F2K9M3XQ4B7NP-3FB2`,
 *   24 characters long.
 * @throws {Error} If a value leaves its range (`code = 'OUT_OF_RANGE'`).
 */
export async function encodeSettingsCode(settings) {
  const bytes = packSettings(settings);
  const body = base32Encode(bytes);
  const sum = await checksum4(bytes);
  return `${SETTINGS_CODE_PREFIX}-${body}-${sum}`;
}

/**
 * Splits a `PREFIX-BODY-CHECKSUM` code into its parts. Shared by all three
 * codes of SPEC 4.4, which are framed the same way.
 *
 * Both returned parts are upper cased. Callers are allowed to rely on that and
 * `tests/settings.test.mjs` pins it, but a parser should still accept both
 * cases on its own account rather than lean on this.
 *
 * @param {unknown} text Code to split.
 * @param {string} prefix Expected prefix, version included.
 * @returns {{body: string, checksum: string}} The body and the four character
 *   checksum, both in upper case.
 * @throws {Error} With `code = 'BAD_FORMAT'` if the shape does not match.
 */
export function splitCode(text, prefix) {
  if (typeof text !== 'string') {
    throw codedError('BAD_FORMAT', `code must be a string, got ${String(text)}`);
  }
  const trimmed = text.trim().toUpperCase();
  if (trimmed.length === 0) {
    throw codedError('BAD_FORMAT', 'code is empty');
  }
  if (!trimmed.startsWith(`${prefix}-`)) {
    throw codedError(
      'BAD_FORMAT',
      `code must start with "${prefix}-", got ${JSON.stringify(text.trim().slice(0, 8))}`,
    );
  }
  const lastDash = trimmed.lastIndexOf('-');
  if (lastDash <= prefix.length) {
    throw codedError('BAD_FORMAT', 'code has no checksum part');
  }
  const body = trimmed.slice(prefix.length + 1, lastDash);
  const checksum = trimmed.slice(lastDash + 1);
  if (!/^[0-9A-F]{4}$/.test(checksum)) {
    throw codedError(
      'BAD_FORMAT',
      `checksum must be four hex characters, got ${JSON.stringify(checksum)}`,
    );
  }
  if (body.length === 0) {
    throw codedError('BAD_FORMAT', 'code has no payload part');
  }
  return { body, checksum };
}

/**
 * Decodes the shareable settings code.
 *
 * The three failure kinds are told apart, because they mean different things
 * to a player: a wrong prefix means the wrong kind of code was pasted, a
 * checksum mismatch means the code was damaged while copying, and an out of
 * range value means the code was built by something that does not follow the
 * specification.
 *
 * @param {string} text Code such as `YM1-A7F2K9M3XQ4B7NP-3FB2`. Case is
 *   ignored, extra dashes and spaces inside the body are ignored.
 * @returns {Promise<object>} The settings object.
 * @throws {Error} With `code = 'BAD_FORMAT'` for a wrong prefix, version,
 *   length, alphabet or non zero trailing bits, `code = 'BAD_CHECKSUM'` when
 *   the checksum does not match, `code = 'OUT_OF_RANGE'` when a field leaves
 *   its range.
 */
export async function decodeSettingsCode(text) {
  const { body, checksum } = splitCode(text, SETTINGS_CODE_PREFIX);
  let bytes;
  try {
    bytes = base32Decode(body);
  } catch (error) {
    throw codedError(
      'BAD_FORMAT',
      `settings code body is not valid Base32: ${error.message}`,
      error,
    );
  }
  if (bytes.length !== SETTINGS_BYTES) {
    throw codedError(
      'BAD_FORMAT',
      `settings code must carry ${SETTINGS_BYTES} bytes, got ${bytes.length}`,
    );
  }
  const expected = await checksum4(bytes);
  if (expected !== checksum) {
    throw codedError(
      'BAD_CHECKSUM',
      `settings code checksum does not match: expected ${expected}, got ${checksum}`,
    );
  }
  return unpackSettings(bytes);
}
