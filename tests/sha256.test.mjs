import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bytesToHex,
  isSubtleAvailable,
  sha256,
  sha256Hex,
  sha256JsSync,
} from '../src/core/sha256.js';

/**
 * Encodes text as UTF-8 bytes.
 *
 * @param {string} text Text to encode.
 * @returns {Uint8Array} The bytes.
 */
function utf8(text) {
  return new TextEncoder().encode(text);
}

const VECTORS = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
  [
    'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  ],
];

test('known vectors, empty input and input longer than one block', async () => {
  for (const [text, expected] of VECTORS) {
    assert.equal(await sha256Hex(utf8(text), 'js'), expected, `js backend, ${text.length} bytes`);
    assert.equal(
      await sha256Hex(utf8(text), 'subtle'),
      expected,
      `subtle backend, ${text.length} bytes`,
    );
    assert.equal(bytesToHex(sha256JsSync(utf8(text))), expected);
  }
});

test('both backends agree around every block boundary', async () => {
  for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 121, 200, 1000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + 7) & 0xff);
    const fromJs = await sha256Hex(bytes, 'js');
    const fromSubtle = await sha256Hex(bytes, 'subtle');
    assert.equal(fromJs, fromSubtle, `length ${length}`);
  }
});

test('the automatic backend picks Web Crypto when it exists', async () => {
  assert.equal(isSubtleAvailable(), true, 'Node 18+ exposes crypto.subtle');
  const bytes = utf8('usogui');
  assert.equal(await sha256Hex(bytes, 'auto'), await sha256Hex(bytes, 'subtle'));
  assert.equal(await sha256Hex(bytes, 'auto'), await sha256Hex(bytes, 'js'));
});

test('digests are 32 bytes and rendered in lower case hex', async () => {
  const digest = await sha256(utf8('abc'));
  assert.equal(digest.length, 32);
  assert.equal(digest instanceof Uint8Array, true);
  const hex = await sha256Hex(utf8('abc'));
  assert.equal(hex.length, 64);
  assert.equal(hex, hex.toLowerCase());
});

test('junk arguments throw', async () => {
  await assert.rejects(() => sha256('abc'), /must be a Uint8Array/);
  await assert.rejects(() => sha256(null), /must be a Uint8Array/);
  await assert.rejects(() => sha256(new Uint8Array(1), 'md5'), /backend must be one of/);
  assert.throws(() => sha256JsSync([1, 2, 3]), /must be a Uint8Array/);
  assert.throws(() => bytesToHex('ff'), /must be a Uint8Array/);
});
