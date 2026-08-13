/**
 * sha256.js - SHA-256 with two interchangeable back ends (SPEC 5.2).
 *
 * `crypto.subtle` is used when it exists. It does not exist in every context:
 * a page opened over file:// is not a secure context in some browsers, and
 * then the built in pure JavaScript implementation takes over.
 *
 * The back end can be chosen explicitly, which is what the tests use to prove
 * both branches produce the same digest. There is no module level mutable
 * state: the choice travels as an argument.
 */

/** Back end names accepted by {@link sha256}. */
export const BACKENDS = Object.freeze(['auto', 'subtle', 'js']);

const K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_STATE = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

/**
 * Rotates a 32 bit word right.
 *
 * @param {number} word Word to rotate.
 * @param {number} bits Rotation amount, 1..31.
 * @returns {number} Rotated word.
 */
function rotr(word, bits) {
  return ((word >>> bits) | (word << (32 - bits))) >>> 0;
}

/**
 * Throws unless the argument is a Uint8Array.
 *
 * @param {unknown} bytes Value to check.
 * @param {string} name Name used in the error message.
 * @returns {Uint8Array} The value itself.
 * @throws {Error} If the value is not a Uint8Array.
 */
function assertBytes(bytes, name) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error(`${name} must be a Uint8Array, got ${String(bytes)}`);
  }
  return bytes;
}

/**
 * Tells whether Web Crypto digest is available in this runtime.
 *
 * @returns {boolean} True when `crypto.subtle.digest` can be called.
 */
export function isSubtleAvailable() {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

/**
 * Pure JavaScript SHA-256. Always available, synchronous.
 *
 * @param {Uint8Array} bytes Message to hash.
 * @returns {Uint8Array} 32 byte digest.
 * @throws {Error} If the argument is not a Uint8Array.
 */
export function sha256JsSync(bytes) {
  assertBytes(bytes, 'bytes');

  const bitLength = bytes.length * 8;
  const paddedLength = ((bytes.length + 9 + 63) >> 6) << 6;
  const message = new Uint8Array(paddedLength);
  message.set(bytes);
  message[bytes.length] = 0x80;

  // 64 bit big-endian message length; JavaScript numbers cover it exactly.
  const view = new DataView(message.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 2 ** 32), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const h = Uint32Array.from(INITIAL_STATE);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];

    for (let i = 0; i < 64; i += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) {
    digestView.setUint32(i * 4, h[i], false);
  }
  return digest;
}

/**
 * Pure JavaScript SHA-256, promise flavoured for symmetry with the Web Crypto
 * branch.
 *
 * @param {Uint8Array} bytes Message to hash.
 * @returns {Promise<Uint8Array>} 32 byte digest.
 * @throws {Error} If the argument is not a Uint8Array.
 */
export async function sha256Js(bytes) {
  return sha256JsSync(bytes);
}

/**
 * Web Crypto SHA-256.
 *
 * @param {Uint8Array} bytes Message to hash.
 * @returns {Promise<Uint8Array>} 32 byte digest.
 * @throws {Error} If the argument is not a Uint8Array or Web Crypto digest is
 *   not available in this runtime.
 */
export async function sha256Subtle(bytes) {
  assertBytes(bytes, 'bytes');
  if (!isSubtleAvailable()) {
    throw new Error('crypto.subtle.digest is not available in this runtime');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

/**
 * SHA-256 over raw bytes.
 *
 * @param {Uint8Array} bytes Message to hash.
 * @param {'auto'|'subtle'|'js'} [backend='auto'] Which implementation to use.
 *   'auto' prefers Web Crypto and falls back to the built in one.
 * @returns {Promise<Uint8Array>} 32 byte digest.
 * @throws {Error} If the argument is not a Uint8Array, the back end name is
 *   unknown, or 'subtle' was demanded but is not available.
 */
export async function sha256(bytes, backend = 'auto') {
  assertBytes(bytes, 'bytes');
  if (!BACKENDS.includes(backend)) {
    throw new Error(`backend must be one of ${BACKENDS.join(', ')}, got ${String(backend)}`);
  }
  if (backend === 'js') {
    return sha256Js(bytes);
  }
  if (backend === 'subtle') {
    return sha256Subtle(bytes);
  }
  return isSubtleAvailable() ? sha256Subtle(bytes) : sha256Js(bytes);
}

/**
 * SHA-256 as a lower case hex string.
 *
 * @param {Uint8Array} bytes Message to hash.
 * @param {'auto'|'subtle'|'js'} [backend='auto'] Which implementation to use.
 * @returns {Promise<string>} 64 lower case hex characters.
 * @throws {Error} If the argument is not a Uint8Array, the back end name is
 *   unknown, or 'subtle' was demanded but is not available.
 */
export async function sha256Hex(bytes, backend = 'auto') {
  return bytesToHex(await sha256(bytes, backend));
}

/**
 * Converts bytes to a lower case hex string.
 *
 * @param {Uint8Array} bytes Bytes to render.
 * @returns {string} Two lower case hex characters per byte.
 * @throws {Error} If the argument is not a Uint8Array.
 */
export function bytesToHex(bytes) {
  assertBytes(bytes, 'bytes');
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Converts a hex string to bytes. Case is ignored.
 *
 * @param {string} hex Hex string of even length.
 * @returns {Uint8Array} One byte per two characters.
 * @throws {Error} If the argument is not a string, its length is odd, or it
 *   holds a character that is not a hex digit.
 */
export function hexToBytes(hex) {
  if (typeof hex !== 'string') {
    throw new Error(`hex must be a string, got ${String(hex)}`);
  }
  if (hex.length % 2 !== 0) {
    throw new Error(`hex must have an even length, got ${hex.length}`);
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('hex must hold hex digits only');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
