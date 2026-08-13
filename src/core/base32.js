/**
 * base32.js - Crockford Base32 and the four character checksum (SPEC 4.5).
 *
 * The alphabet leaves out I, L, O and U so that hand copied codes cannot turn
 * into something else. When parsing, I and L are read as 1, O is read as 0,
 * case is ignored and dashes and spaces are skipped.
 *
 * Bits at the end that do not complete a byte must be zero. That makes the
 * encoding canonical: one byte string has exactly one valid spelling, and a
 * damaged trailing character can no longer decode to the same bytes.
 */

import { sha256Hex } from './sha256.js';

/** Crockford Base32 alphabet used when encoding. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters skipped by {@link decode}: grouping dashes and whitespace. */
const SKIPPED = new Set(['-', ' ', '\t', '\n', '\r']);

const DECODE_MAP = buildDecodeMap();

/**
 * Builds an Error carrying a machine readable code (SPEC 4.6).
 *
 * @param {'BAD_FORMAT'} code Failure kind.
 * @param {string} message Human readable English text.
 * @returns {Error} The error, ready to be thrown.
 */
function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Builds the lookup table used when decoding, including the Crockford
 * aliases and both letter cases.
 *
 * @returns {Map<string, number>} Character to value map.
 */
function buildDecodeMap() {
  const map = new Map();
  for (let i = 0; i < ALPHABET.length; i += 1) {
    map.set(ALPHABET[i], i);
    map.set(ALPHABET[i].toLowerCase(), i);
  }
  for (const character of ['O', 'o']) {
    map.set(character, 0);
  }
  for (const character of ['I', 'i', 'L', 'l']) {
    map.set(character, 1);
  }
  return map;
}

/**
 * Encodes bytes as Crockford Base32.
 *
 * The output is not padded: the trailing character carries the last bits of
 * the input in its high positions and zeros below them.
 *
 * @param {Uint8Array} bytes Bytes to encode.
 * @returns {string} Upper case Base32 string, ceil(bytes * 8 / 5) characters.
 * @throws {Error} If the argument is not a Uint8Array.
 */
export function encode(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`bytes must be a Uint8Array, got ${String(bytes)}`);
  }
  let buffer = 0;
  let bits = 0;
  let out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Decodes a Crockford Base32 string.
 *
 * Case is ignored, dashes and spaces are skipped, I and L are read as 1 and
 * O is read as 0. Bits left over at the end that do not complete a byte must
 * be zero (SPEC 4.5); anything else is a damaged code.
 *
 * @param {string} text String to decode.
 * @returns {Uint8Array} Decoded bytes.
 * @throws {Error} If the argument is not a string. With
 *   `code = 'BAD_FORMAT'` if it holds a character outside the alphabet or its
 *   trailing bits are not zero.
 */
export function decode(text) {
  if (typeof text !== 'string') {
    throw new Error(`text must be a string, got ${String(text)}`);
  }
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const character of text) {
    if (SKIPPED.has(character)) {
      continue;
    }
    const value = DECODE_MAP.get(character);
    if (value === undefined) {
      throw codedError(
        'BAD_FORMAT',
        `character ${JSON.stringify(character)} is not valid Crockford Base32`,
      );
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw codedError(
      'BAD_FORMAT',
      `the last character carries ${bits} trailing bits that are not zero`,
    );
  }
  return Uint8Array.from(out);
}

/**
 * Four character checksum of a byte block: the first four hex characters of
 * its SHA-256 (SPEC 4.5). Sixteen bits miss roughly one damaged code in 65536.
 * Eight bits would miss one in 256, and a miss decodes into a different maze,
 * which the report would then present as a substituted maze - an accusation
 * caused by a typo.
 *
 * @param {Uint8Array} bytes Bytes the checksum is computed over.
 * @returns {Promise<string>} Four upper case hex characters.
 * @throws {Error} If the argument is not a Uint8Array.
 */
export async function checksum4(bytes) {
  const hex = await sha256Hex(bytes);
  return hex.slice(0, 4).toUpperCase();
}
