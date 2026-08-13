/**
 * bits.js - packing and unpacking of bit fields of arbitrary width.
 *
 * Bit order is big-endian: the first field written occupies the most
 * significant bits of byte 0, exactly as SPEC 4.2 and 4.3 require.
 *
 * Out of range values throw instead of being silently truncated. Silent
 * truncation would change the payload, change the hash and turn an honest
 * player into an apparent cheater.
 */

const MAX_WIDTH = 32;

/**
 * Throws unless the value is a plain integer number.
 *
 * @param {unknown} value Value to check.
 * @param {string} name Name used in the error message.
 * @returns {number} The value itself.
 * @throws {Error} If the value is not an integer number.
 */
function assertInt(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer, got ${String(value)}`);
  }
  return value;
}

/**
 * Validates a field width.
 *
 * @param {unknown} width Width in bits.
 * @returns {number} The width itself.
 * @throws {Error} If the width is not an integer in 1..32.
 */
function assertWidth(width) {
  assertInt(width, 'width');
  if (width < 1 || width > MAX_WIDTH) {
    throw new Error(`width must be in 1..${MAX_WIDTH}, got ${width}`);
  }
  return /** @type {number} */ (width);
}

/**
 * Writes unsigned integer fields into a fixed size bit buffer, big-endian.
 */
export class BitWriter {
  #bytes;
  #capacityBits;
  #position = 0;

  /**
   * @param {number} totalBits Capacity of the buffer in bits, at least 1.
   * @throws {Error} If totalBits is not a positive integer.
   */
  constructor(totalBits) {
    assertInt(totalBits, 'totalBits');
    if (totalBits < 1) {
      throw new Error(`totalBits must be positive, got ${totalBits}`);
    }
    this.#capacityBits = totalBits;
    this.#bytes = new Uint8Array(Math.ceil(totalBits / 8));
  }

  /** @returns {number} How many bits have been written so far. */
  get bitsWritten() {
    return this.#position;
  }

  /** @returns {number} How many bits are still free. */
  get bitsLeft() {
    return this.#capacityBits - this.#position;
  }

  /**
   * Appends one unsigned field.
   *
   * @param {number} value Value to write, 0 .. 2^width - 1.
   * @param {number} width Field width in bits, 1..32.
   * @returns {BitWriter} This writer, so calls can be chained.
   * @throws {Error} If the width is invalid, the value is not an integer,
   *   the value does not fit the field, or the buffer has no room left.
   */
  write(value, width) {
    assertWidth(width);
    assertInt(value, 'value');
    const limit = 2 ** width - 1;
    if (value < 0 || value > limit) {
      throw new Error(`value ${value} does not fit into ${width} bits (allowed 0..${limit})`);
    }
    if (width > this.bitsLeft) {
      throw new Error(
        `cannot write ${width} bits: only ${this.bitsLeft} of ${this.#capacityBits} bits left`,
      );
    }
    for (let i = width - 1; i >= 0; i -= 1) {
      const bit = Math.floor(value / 2 ** i) % 2;
      if (bit === 1) {
        this.#bytes[this.#position >> 3] |= 1 << (7 - (this.#position & 7));
      }
      this.#position += 1;
    }
    return this;
  }

  /**
   * Returns the buffer. Bits that were never written stay zero.
   *
   * @returns {Uint8Array} A copy of the written bytes.
   */
  bytes() {
    return this.#bytes.slice();
  }
}

/**
 * Reads unsigned integer fields out of a byte buffer, big-endian.
 */
export class BitReader {
  #bytes;
  #position = 0;

  /**
   * @param {Uint8Array} bytes Buffer to read from.
   * @throws {Error} If the argument is not a Uint8Array.
   */
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(`bytes must be a Uint8Array, got ${String(bytes)}`);
    }
    this.#bytes = bytes;
  }

  /** @returns {number} How many bits have been read so far. */
  get bitsRead() {
    return this.#position;
  }

  /** @returns {number} How many bits are still unread. */
  get bitsLeft() {
    return this.#bytes.length * 8 - this.#position;
  }

  /**
   * Reads the next unsigned field.
   *
   * @param {number} width Field width in bits, 1..32.
   * @returns {number} The value, 0 .. 2^width - 1.
   * @throws {Error} If the width is invalid or the buffer is exhausted.
   */
  read(width) {
    assertWidth(width);
    if (width > this.bitsLeft) {
      throw new Error(
        `cannot read ${width} bits: only ${this.bitsLeft} bits left in the buffer`,
      );
    }
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      const bit = (this.#bytes[this.#position >> 3] >> (7 - (this.#position & 7))) & 1;
      value = value * 2 + bit;
      this.#position += 1;
    }
    return value;
  }
}
