import test from 'node:test';
import assert from 'node:assert/strict';

import { BitReader, BitWriter } from '../src/core/bits.js';

test('fields are laid out big-endian, first field in the high bits', () => {
  const writer = new BitWriter(16);
  writer.write(0b1010, 4);
  writer.write(0b0101, 4);
  writer.write(0xff, 8);
  assert.deepEqual([...writer.bytes()], [0b10100101, 0xff]);
});

test('bits that were never written stay zero', () => {
  const writer = new BitWriter(24);
  writer.write(1, 1);
  assert.deepEqual([...writer.bytes()], [0b10000000, 0, 0]);
  assert.equal(writer.bitsWritten, 1);
  assert.equal(writer.bitsLeft, 23);
});

test('what the writer wrote the reader reads back', () => {
  const fields = [
    [6, 4], [6, 4], [20, 6], [3, 3], [150, 10], [1, 3],
    [0, 1], [1, 1], [1, 1], [300, 10], [60, 8], [0, 1], [0, 4], [40000, 16],
  ];
  const writer = new BitWriter(72);
  for (const [value, width] of fields) {
    writer.write(value, width);
  }
  const reader = new BitReader(writer.bytes());
  for (const [value, width] of fields) {
    assert.equal(reader.read(width), value);
  }
  assert.equal(reader.bitsLeft, 0);
});

test('a value too large for its field throws instead of being truncated', () => {
  const writer = new BitWriter(32);
  assert.throws(() => writer.write(16, 4), /does not fit into 4 bits \(allowed 0\.\.15\)/);
  assert.throws(() => writer.write(-1, 4), /does not fit into 4 bits/);
  assert.throws(() => writer.write(1024, 10), /does not fit into 10 bits/);
  // Nothing was written, so the buffer is still untouched.
  assert.deepEqual([...writer.bytes()], [0, 0, 0, 0]);
});

test('non integer values and impossible widths throw', () => {
  const writer = new BitWriter(32);
  assert.throws(() => writer.write(1.5, 4), /must be an integer/);
  assert.throws(() => writer.write(undefined, 4), /must be an integer/);
  assert.throws(() => writer.write('3', 4), /must be an integer/);
  assert.throws(() => writer.write(1, 0), /width must be in 1\.\.32/);
  assert.throws(() => writer.write(1, 33), /width must be in 1\.\.32/);
  assert.throws(() => new BitWriter(0), /totalBits must be positive/);
  assert.throws(() => new BitWriter(undefined), /must be an integer/);
});

test('running past the end of the buffer throws on both sides', () => {
  const writer = new BitWriter(8);
  writer.write(0, 6);
  assert.throws(() => writer.write(0, 4), /only 2 of 8 bits left/);

  const reader = new BitReader(new Uint8Array([0xff]));
  reader.read(6);
  assert.throws(() => reader.read(4), /only 2 bits left/);
  assert.throws(() => new BitReader([1, 2, 3]), /must be a Uint8Array/);
});

test('the widest field is handled exactly', () => {
  const writer = new BitWriter(32);
  writer.write(4294967295, 32);
  assert.deepEqual([...writer.bytes()], [0xff, 0xff, 0xff, 0xff]);
  assert.equal(new BitReader(writer.bytes()).read(32), 4294967295);
});

test('bytes() hands out a copy, not the internal buffer', () => {
  const writer = new BitWriter(8);
  writer.write(0xff, 8);
  const first = writer.bytes();
  first[0] = 0;
  assert.equal(writer.bytes()[0], 0xff);
});
