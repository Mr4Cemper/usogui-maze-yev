/**
 * commit.js - the canonical payload, the salt, the commit and the reveal
 * string (SPEC 4.2, 4.4, 4.5).
 *
 * The commitment is a hash, not a cipher: a stream cipher can be re-keyed to
 * decrypt to any maze the cheater likes, a hash cannot (SPEC 4.1).
 *
 *   payload = 20 bytes, layout fixed by SPEC 4.2
 *   salt    = 16 random bytes
 *   commit  = SHA-256(payload || salt), 64 lower case hex characters
 *
 * The commit travels between the players inside a checksummed wrapper,
 * `YMC1-<64 hex>-<4 hex>`; the digest inside it is untouched.
 *
 * The payload layout and the wall bit order must never change: every commit
 * ever published depends on them.
 */

import { cellToIndex, edgeToBitIndex, bitIndexToEdge, indexToCell, EDGE_COUNT } from './edges.js';
import { createMaze } from './maze.js';
import { SETTINGS_BYTES, packSettings, splitCode } from './settings.js';
import { checksum4, decode as base32Decode, encode as base32Encode } from './base32.js';
import { bytesToHex, hexToBytes, sha256Hex } from './sha256.js';

/** Value of the `format_version` byte at offset 0. */
export const FORMAT_VERSION = 0x01;

/** Size of the canonical payload. */
export const PAYLOAD_BYTES = 20;

/** Size of the salt. */
export const SALT_BYTES = 16;

/** Offset of the wall bitmask inside the payload. */
const WALLS_OFFSET = 12;

/** Prefix of the reveal string, protocol version included. */
export const REVEAL_PREFIX = 'YMR1';

/** Prefix of the transport wrapper the commit travels in (SPEC 4.4). */
export const COMMIT_CODE_PREFIX = 'YMC1';

/** Length of the commit in hex characters. */
const COMMIT_HEX_LENGTH = 64;

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
 * Accepts either a packed settings block or a settings object.
 *
 * @param {Uint8Array|object} settings Packed block of 9 bytes, or an object.
 * @returns {Uint8Array} The packed block.
 * @throws {Error} If the block has the wrong length or the object holds a
 *   value outside its range.
 */
function toSettingsBytes(settings) {
  if (settings instanceof Uint8Array) {
    if (settings.length !== SETTINGS_BYTES) {
      throw new Error(
        `settings block must be ${SETTINGS_BYTES} bytes, got ${settings.length}`,
      );
    }
    return settings;
  }
  if (settings === null || typeof settings !== 'object') {
    throw new Error(
      `settings must be a Uint8Array of ${SETTINGS_BYTES} bytes or a settings object, got ${String(settings)}`,
    );
  }
  return packSettings(settings);
}

/**
 * Builds the canonical 20 byte payload of SPEC 4.2.
 *
 * The result depends only on which walls are present, never on the order in
 * which they were added: the walls are read through the fixed edge order.
 *
 * @param {Uint8Array|object} settingsBytes Packed settings block of 9 bytes,
 *   or a settings object to pack.
 * @param {{entrance: {r: number, c: number}, exit: {r: number, c: number}, walls: Set<string>|string[]}} maze
 *   Maze with both ends placed.
 * @returns {Uint8Array} Exactly 20 bytes.
 * @throws {Error} If the settings block is malformed, the maze is malformed,
 *   the entrance or the exit is missing, or a wall is not a valid edge id.
 */
export function buildPayload(settingsBytes, maze) {
  const settings = toSettingsBytes(settingsBytes);
  const checked = createMaze(maze);
  if (checked.entrance === null || checked.exit === null) {
    throw new Error('payload needs a maze with both an entrance and an exit');
  }

  const payload = new Uint8Array(PAYLOAD_BYTES);
  payload[0] = FORMAT_VERSION;
  payload.set(settings, 1);
  payload[10] = cellToIndex(checked.entrance.r, checked.entrance.c);
  payload[11] = cellToIndex(checked.exit.r, checked.exit.c);
  for (const id of checked.walls) {
    const bit = edgeToBitIndex(id);
    payload[WALLS_OFFSET + (bit >> 3)] |= 1 << (7 - (bit & 7));
  }
  return payload;
}

/**
 * Reads a canonical payload back.
 *
 * @param {Uint8Array} bytes Exactly 20 bytes.
 * @returns {{formatVersion: number, settings: Uint8Array, maze: {entrance: {r: number, c: number}, exit: {r: number, c: number}, walls: Set<string>}}}
 *   The format version, the packed settings block and the maze. The settings
 *   stay packed so that they can be compared byte by byte; use
 *   `unpackSettings` for the object form.
 * @throws {Error} If the argument is not a Uint8Array of 20 bytes or the
 *   format version is unknown. With `code = 'OUT_OF_RANGE'` if the entrance or
 *   the exit is not a cell index - the message names which of the two - or if
 *   a reserved wall bit is not zero.
 */
export function parsePayload(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`payload must be a Uint8Array, got ${String(bytes)}`);
  }
  if (bytes.length !== PAYLOAD_BYTES) {
    throw new Error(`payload must be ${PAYLOAD_BYTES} bytes, got ${bytes.length}`);
  }
  if (bytes[0] !== FORMAT_VERSION) {
    throw new Error(
      `unsupported payload format version ${bytes[0]}, expected ${FORMAT_VERSION}`,
    );
  }

  const walls = new Set();
  for (let bit = 0; bit < EDGE_COUNT; bit += 1) {
    const byte = bytes[WALLS_OFFSET + (bit >> 3)];
    if ((byte >> (7 - (bit & 7))) & 1) {
      walls.add(bitIndexToEdge(bit));
    }
  }
  for (let bit = EDGE_COUNT; bit < 64; bit += 1) {
    const byte = bytes[WALLS_OFFSET + (bit >> 3)];
    if ((byte >> (7 - (bit & 7))) & 1) {
      throw codedError('OUT_OF_RANGE', `reserved wall bit ${bit} must be zero`);
    }
  }

  return {
    formatVersion: bytes[0],
    settings: bytes.slice(1, 1 + SETTINGS_BYTES),
    maze: {
      entrance: readCell(bytes[10], 'entrance'),
      exit: readCell(bytes[11], 'exit'),
      walls,
    },
  };
}

/**
 * Reads one of the two cell bytes of the payload and says which one it was
 * when it turns out to be out of range. A reveal comes from the other player,
 * so "some cell index is wrong" is a much less useful complaint than
 * "the entrance is wrong".
 *
 * @param {number} byte The byte as stored in the payload.
 * @param {'entrance'|'exit'} field Which field it is.
 * @returns {{r: number, c: number}} The cell.
 * @throws {Error} With `code = 'OUT_OF_RANGE'` if the byte is not a cell index.
 */
function readCell(byte, field) {
  try {
    return indexToCell(byte);
  } catch (error) {
    throw codedError('OUT_OF_RANGE', `payload ${field} is not a cell: ${error.message}`, error);
  }
}

/**
 * Draws a fresh salt. A player supplied salt is deliberately impossible
 * (SPEC 4.2).
 *
 * @returns {Uint8Array} 16 random bytes.
 * @throws {Error} If `crypto.getRandomValues` is not available.
 */
export function generateSalt() {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available in this runtime');
  }
  const salt = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

/**
 * Joins the payload and the salt exactly as the protocol hashes and encodes
 * them.
 *
 * @param {Uint8Array} payload 20 bytes.
 * @param {Uint8Array} salt 16 bytes.
 * @returns {Uint8Array} 36 bytes, payload first.
 * @throws {Error} If either block is missing or has the wrong length.
 */
function joinPayloadAndSalt(payload, salt) {
  if (!(payload instanceof Uint8Array) || payload.length !== PAYLOAD_BYTES) {
    throw new Error(`payload must be a Uint8Array of ${PAYLOAD_BYTES} bytes`);
  }
  if (!(salt instanceof Uint8Array) || salt.length !== SALT_BYTES) {
    throw new Error(`salt must be a Uint8Array of ${SALT_BYTES} bytes`);
  }
  const joined = new Uint8Array(PAYLOAD_BYTES + SALT_BYTES);
  joined.set(payload, 0);
  joined.set(salt, PAYLOAD_BYTES);
  return joined;
}

/**
 * Computes the commit that is exchanged before the game starts (SPEC 4.2).
 * The digest itself is unchanged by the transport wrapper below.
 *
 * @param {Uint8Array} payload Canonical payload, 20 bytes.
 * @param {Uint8Array} salt Salt, 16 bytes.
 * @returns {Promise<string>} 64 lower case hex characters.
 * @throws {Error} If either block is missing or has the wrong length.
 */
export async function computeCommit(payload, salt) {
  return sha256Hex(joinPayloadAndSalt(payload, salt));
}

/**
 * Validates a bare commit digest.
 *
 * @param {unknown} commitHex Value to check.
 * @returns {string} The digest in lower case.
 * @throws {Error} With `code = 'BAD_FORMAT'` if it is not 64 hex characters.
 */
function assertCommitHex(commitHex) {
  if (typeof commitHex !== 'string') {
    throw codedError('BAD_FORMAT', `commit must be a string, got ${String(commitHex)}`);
  }
  const trimmed = commitHex.trim();
  if (!new RegExp(`^[0-9a-fA-F]{${COMMIT_HEX_LENGTH}}$`).test(trimmed)) {
    throw codedError(
      'BAD_FORMAT',
      `commit must be ${COMMIT_HEX_LENGTH} hex characters, got ${trimmed.length}`,
    );
  }
  return trimmed.toLowerCase();
}

/**
 * Wraps the commit for transport (SPEC 4.4). The commit is the longest string
 * a player copies by hand and it travels at the very start of the game, so it
 * carries a checksum of its own: a typo caught at paste time is a typo, the
 * same typo caught after the game looks like a substituted maze.
 *
 * The checksum covers the 32 raw digest bytes, not their hex spelling.
 *
 * @param {string} commitHex The commit, 64 hex characters.
 * @returns {Promise<string>} A code such as `YMC1-<64 hex>-<4 hex>`, 74
 *   characters long.
 * @throws {Error} With `code = 'BAD_FORMAT'` if the commit is not 64 hex
 *   characters.
 */
export async function encodeCommitCode(commitHex) {
  const commit = assertCommitHex(commitHex);
  const sum = await checksum4(hexToBytes(commit));
  return `${COMMIT_CODE_PREFIX}-${commit}-${sum}`;
}

/**
 * Reads a commit back out of its transport wrapper. Bare 64 hex characters are
 * refused on purpose: without the checksum a mistyped commit is only noticed
 * after the game (SPEC 4.4).
 *
 * @param {string} text Code such as `YMC1-<64 hex>-<4 hex>`. Case is ignored,
 *   extra dashes and spaces inside the body are ignored.
 * @returns {Promise<string>} The commit, 64 lower case hex characters.
 * @throws {Error} With `code = 'BAD_FORMAT'` for a wrong prefix, version,
 *   length or alphabet, `code = 'BAD_CHECKSUM'` when the checksum does not
 *   match the digest.
 */
export async function decodeCommitCode(text) {
  const { body, checksum } = splitCode(text, COMMIT_CODE_PREFIX);
  const packed = body.replace(/[-\s]/g, '');
  // Both cases are accepted here rather than relying on splitCode having
  // upper cased the code already: this parser must stand on its own.
  if (!new RegExp(`^[0-9a-fA-F]{${COMMIT_HEX_LENGTH}}$`).test(packed)) {
    throw codedError(
      'BAD_FORMAT',
      `commit code must carry ${COMMIT_HEX_LENGTH} hex characters, got ${packed.length}`,
    );
  }
  const commit = packed.toLowerCase();
  const expected = await checksum4(hexToBytes(commit));
  if (expected !== checksum) {
    throw codedError(
      'BAD_CHECKSUM',
      `commit code checksum does not match: expected ${expected}, got ${checksum}`,
    );
  }
  return commit;
}

/**
 * Builds the reveal string that is exchanged after the game (SPEC 4.4).
 *
 * @param {Uint8Array} payload Canonical payload, 20 bytes.
 * @param {Uint8Array} salt Salt, 16 bytes.
 * @returns {Promise<string>} A string such as `YMR1-<58 characters>-XXXX`,
 *   68 characters long.
 * @throws {Error} If either block is missing or has the wrong length.
 */
export async function encodeReveal(payload, salt) {
  const joined = joinPayloadAndSalt(payload, salt);
  const body = base32Encode(joined);
  const sum = await checksum4(joined);
  return `${REVEAL_PREFIX}-${body}-${sum}`;
}

/**
 * Reads a reveal string back.
 *
 * A damaged code and a code of the wrong kind are told apart on purpose: the
 * first means "retype it", the second means "you pasted the wrong thing".
 * Neither one means "your opponent cheated" (SPEC 4.5).
 *
 * @param {string} text Reveal string. Case is ignored, extra dashes and spaces
 *   inside the body are ignored.
 * @returns {Promise<{payload: Uint8Array, salt: Uint8Array}>} The 20 byte
 *   payload and the 16 byte salt.
 * @throws {Error} With `code = 'BAD_FORMAT'` for a wrong prefix, version,
 *   length, alphabet or non zero trailing bits, `code = 'BAD_CHECKSUM'` when
 *   the checksum does not match the body.
 */
export async function decodeReveal(text) {
  const { body, checksum } = splitCode(text, REVEAL_PREFIX);
  let joined;
  try {
    joined = base32Decode(body);
  } catch (error) {
    throw codedError('BAD_FORMAT', `reveal body is not valid Base32: ${error.message}`, error);
  }
  if (joined.length !== PAYLOAD_BYTES + SALT_BYTES) {
    throw codedError(
      'BAD_FORMAT',
      `reveal must carry ${PAYLOAD_BYTES + SALT_BYTES} bytes, got ${joined.length}`,
    );
  }
  const expected = await checksum4(joined);
  if (expected !== checksum) {
    throw codedError(
      'BAD_CHECKSUM',
      `reveal checksum does not match: expected ${expected}, got ${checksum}`,
    );
  }
  return {
    payload: joined.slice(0, PAYLOAD_BYTES),
    salt: joined.slice(PAYLOAD_BYTES),
  };
}

/** Re-exported so that callers can render a digest without a second import. */
export { bytesToHex };
