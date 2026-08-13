import test from 'node:test';
import assert from 'node:assert/strict';

import { ALPHABET, checksum4, decode, encode } from '../src/core/base32.js';
import { sha256Hex } from '../src/core/sha256.js';

test('the alphabet is the Crockford one', () => {
  assert.equal(ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  assert.equal(ALPHABET.length, 32);
  for (const forbidden of ['I', 'L', 'O', 'U']) {
    assert.equal(ALPHABET.includes(forbidden), false, `${forbidden} must not be encodable`);
  }
});

test('encoding produces the lengths the protocol expects', () => {
  assert.equal(encode(new Uint8Array(9)).length, 15, 'settings block');
  assert.equal(encode(new Uint8Array(36)).length, 58, 'payload and salt');
  assert.equal(encode(new Uint8Array(0)), '');
});

test('bytes survive a round trip', () => {
  for (const length of [1, 2, 5, 9, 16, 20, 36, 64]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
    assert.deepEqual([...decode(encode(bytes))], [...bytes], `length ${length}`);
  }
});

test('O reads as zero and I and L read as one', () => {
  // Eight characters are forty bits, exactly five bytes, so these strings
  // carry no trailing bits to argue about.
  assert.deepEqual([...decode('OOOOOOOO')], [...decode('00000000')]);
  assert.deepEqual([...decode('IIIIIIII')], [...decode('11111111')]);
  assert.deepEqual([...decode('LLLLLLLL')], [...decode('11111111')]);
  assert.deepEqual([...decode('oOoOoOoO')], [...decode('00000000')]);
  assert.deepEqual([...decode('iLiLiLiL')], [...decode('11111111')]);
});

test('trailing bits that do not complete a byte must be zero', () => {
  // Two characters are ten bits: one byte and two bits left over.
  assert.deepEqual([...decode('00')], [0]);
  assert.deepEqual([...decode('0W')], [0b00000111], 'W is 28, its low two bits are zero');
  const error = (() => {
    try {
      decode('01');
      return null;
    } catch (caught) {
      return caught;
    }
  })();
  assert.notEqual(error, null, 'a non zero remainder must be refused');
  assert.equal(error.code, 'BAD_FORMAT');
  assert.match(error.message, /trailing bits/);

  // Whatever encode() produces is canonical and decodes back.
  for (const length of [1, 2, 3, 4, 5, 9, 20, 36]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 53 + 29) & 0xff);
    assert.deepEqual([...decode(encode(bytes))], [...bytes], `length ${length}`);
  }
});

test('case does not matter and dashes and spaces are skipped', () => {
  const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x42]);
  const code = encode(bytes);
  assert.deepEqual([...decode(code.toLowerCase())], [...bytes]);
  assert.deepEqual([...decode(`${code.slice(0, 3)}-${code.slice(3)}`)], [...bytes]);
  assert.deepEqual([...decode(`${code.slice(0, 2)} ${code.slice(2, 5)}\t${code.slice(5)}`)], [...bytes]);
  assert.deepEqual([...decode(`--${code}--`)], [...bytes]);
});

test('characters outside the alphabet are refused', () => {
  assert.throws(() => decode('AAU'), /is not valid Crockford Base32/);
  assert.equal(
    (() => {
      try {
        decode('AAU');
        return null;
      } catch (error) {
        return error.code;
      }
    })(),
    'BAD_FORMAT',
  );
  assert.throws(() => decode('AA$'), /is not valid Crockford Base32/);
  assert.throws(() => decode('АА'), /is not valid Crockford Base32/); // Cyrillic А
  assert.throws(() => decode(null), /must be a string/);
  assert.throws(() => encode([1, 2, 3]), /must be a Uint8Array/);
});

test('the checksum is the first four hex characters of SHA-256, upper case', async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const sum = await checksum4(bytes);
  const hex = await sha256Hex(bytes);
  assert.equal(sum, hex.slice(0, 4).toUpperCase());
  assert.match(sum, /^[0-9A-F]{4}$/);
});
