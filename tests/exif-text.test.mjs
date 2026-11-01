import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { decodeUserComment, cameraName } = createRequire(import.meta.url)('../js/exif-text.js');

const bytes = s => Array.from(s, c => c.charCodeAt(0));
const ascii = text => [...bytes('ASCII'), 0, 0, 0, ...bytes(text)];

test('reads a normal comment after the ASCII label', () => {
  assert.equal(decodeUserComment(ascii('Shot at the school fair')), 'Shot at the school fair');
});
test('the exact bytes from a real photo (ASCII label, padding, 36 spaces) mean "no comment"', () => {
  const real = [65, 83, 67, 73, 73, 0, 0, 0, ...new Array(36).fill(32)];
  assert.equal(real.length, 44);
  assert.equal(decodeUserComment(real), '');
  assert.equal(decodeUserComment(new Uint8Array(real)), '');
});
test('works for text, a byte array and a list of numbers alike', () => {
  const s = 'ASCII\0\0\0Hello';
  assert.equal(decodeUserComment(s), 'Hello');
  assert.equal(decodeUserComment(new Uint8Array(bytes(s))), 'Hello');
  assert.equal(decodeUserComment(bytes(s)), 'Hello');
  assert.equal(decodeUserComment(new Uint8Array(bytes(s)).buffer), 'Hello');
});
test('reads UNICODE comments in either byte order', () => {
  const be = [...bytes('UNICODE'), 0, 0, 72, 0, 105, 0, 233];
  const le = [...bytes('UNICODE'), 0, 72, 0, 105, 0, 233, 0];
  assert.equal(decodeUserComment(be), 'Hié');
  assert.equal(decodeUserComment(le), 'Hié');
  assert.equal(decodeUserComment([...bytes('UNICODE'), 0, 0xff, 0xfe, 72, 0, 105, 0]), 'Hi');
});
test('a comment with no label at all is still read', () => {
  assert.equal(decodeUserComment(bytes('just text')), 'just text');
  assert.equal(decodeUserComment([0, 0, 0, 0, 0, 0, 0, 0, ...bytes('after blanks')]), 'after blanks');
});
test('nothing, or only control characters, gives an empty string', () => {
  for (const v of [undefined, null, '', [], new Uint8Array(0), 42, ascii('\0\0\0'), ascii('   \n  ')]) assert.equal(decodeUserComment(v), '', String(v));
});
test('line breaks and stray control characters become single spaces', () => {
  assert.equal(decodeUserComment(ascii('one\ntwo\u0001three')), 'one two three');
});
test('accented ASCII-label text written as UTF-8 is kept', () => {
  assert.equal(decodeUserComment([...bytes('ASCII'), 0, 0, 0, ...Buffer.from('café ☕')]), 'café ☕');
});

test('the camera name does not repeat the brand', () => {
  assert.equal(cameraName('Canon', 'Canon EOS R6'), 'Canon EOS R6');
  assert.equal(cameraName('NIKON CORPORATION', 'NIKON Z 6'), 'NIKON Z 6');
  assert.equal(cameraName('SONY', 'ILCE-7M3'), 'SONY ILCE-7M3');
  assert.equal(cameraName('Apple', 'iPhone 14 Pro'), 'Apple iPhone 14 Pro');
  assert.equal(cameraName('samsung', 'SM-G991B'), 'samsung SM-G991B');
});
test('the camera name copes with a missing brand or model', () => {
  assert.equal(cameraName('Canon', ''), 'Canon');
  assert.equal(cameraName(null, 'Z6'), 'Z6');
  assert.equal(cameraName(undefined, undefined), '');
  assert.equal(cameraName('  Canon ', ' Canon EOS R6 '), 'Canon EOS R6');
});
