import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Jpeg = require('../js/jpeg.js');
const A = require('../js/analysis.js');

const seg = (marker, payload) => {
  const len = payload.length + 2;
  return [0xFF, marker, len >> 8, len & 0xFF, ...payload];
};
const str = s => [...s].map(c => c.charCodeAt(0));

function fakeJpeg() {
  return Uint8Array.from([
    0xFF, 0xD8,
    ...seg(0xE0, str('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...seg(0xE1, [...str('Exif\0\0'), 1, 2, 3, 4]),
    ...seg(0xE1, str('http://ns.adobe.com/xap/1.0/\0<x/>')),
    ...seg(0xE2, [...str('ICC_PROFILE\0'), 1, 1, 9, 9]),
    ...seg(0xED, str('Photoshop 3.0\0')),
    ...seg(0xFE, str('hello')),
    ...seg(0xDB, [0, 1, 2, 3]),
    0xFF, 0xDA, 0x00, 0x04, 0x01, 0x02,   // SOS header
    0x11, 0x22, 0xFF, 0x00, 0x33,          // scan data
    0xFF, 0xD9,
  ]);
}

test('segments are named', () => {
  const names = Jpeg.segments(fakeJpeg()).map(s => s.name);
  assert.deepEqual(names, ['APP0', 'EXIF', 'XMP', 'ICC', 'IPTC', 'COMMENT', 'MDB', 'SOS']);
});

test('strip removes EXIF/XMP/IPTC/comment but keeps ICC, JFIF, tables and scan data', () => {
  const src = fakeJpeg();
  const out = Jpeg.strip(src);
  const names = Jpeg.segments(out).map(s => s.name);
  assert.ok(!names.includes('EXIF') && !names.includes('XMP') && !names.includes('IPTC') && !names.includes('COMMENT'));
  assert.ok(names.includes('ICC') && names.includes('APP0') && names.includes('SOS'));
  assert.deepEqual([...out.slice(-7)], [0x11, 0x22, 0xFF, 0x00, 0x33, 0xFF, 0xD9]);
  assert.ok(out.length < src.length);
});

test('strip can keep only the orientation tag', () => {
  const out = Jpeg.strip(fakeJpeg(), { keepOrientation: 6 });
  const names = Jpeg.segments(out).map(s => s.name);
  assert.equal(names.filter(n => n === 'EXIF').length, 1);
  const exif = Jpeg.segments(out).find(s => s.name === 'EXIF');
  assert.equal(exif.end - exif.start, 36);               // marker (2) + length field (34)
  assert.equal(out[exif.start + 2 + 2 + 6 + 8 + 2 + 8 + 1], 6); // orientation value byte
});

test('non-JPEG input is rejected', () => {
  assert.throws(() => Jpeg.strip(Uint8Array.from([0x89, 0x50, 0x4E, 0x47])));
});

test('histogram, exposure stats and lint', () => {
  const dark = new Uint8ClampedArray(4 * 100);
  for (let i = 0; i < dark.length; i += 4) { dark[i] = dark[i + 1] = dark[i + 2] = 5; dark[i + 3] = 255; }
  const h = A.histogram(dark);
  assert.equal(h.y[5], 100);
  const st = A.exposureStats(h.y);
  assert.equal(st.darkShare, 1);
  const notes = A.lint(st, 10);
  assert.ok(notes.some(n => n.title === 'Too dark'));
  assert.ok(notes.some(n => n.title === 'Might be blurry'));
});

test('palette finds the dominant colour', () => {
  const d = new Uint8ClampedArray(4 * 50);
  for (let i = 0; i < d.length; i += 4) { d[i] = 250; d[i + 1] = 10; d[i + 2] = 10; d[i + 3] = 255; }
  const p = A.palette(d, 3);
  assert.equal(p.length, 1);
  assert.equal(p[0].share, 1);
  assert.match(p[0].hex, /^#f/);
});

test('sharpness: noisy checkerboard beats flat grey', () => {
  const w = 16, h = 16;
  const flat = new Uint8ClampedArray(w * h * 4).fill(128);
  const chk = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = ((i % w) + Math.floor(i / w)) % 2 ? 255 : 0; chk.set([v, v, v, 255], i * 4); }
  assert.equal(A.sharpness(flat, w, h), 0);
  assert.ok(A.sharpness(chk, w, h) > 1000);
});

test('describeHistogram explains the shape in plain words', () => {
  const dark = new Uint32Array(256); dark[3] = 90; dark[130] = 10;
  const d = A.describeHistogram(dark);
  assert.match(d.summary, /dark/);
  assert.ok(d.points.some(p => /far left/.test(p) && /pure black/.test(p)));
  const mid = new Uint32Array(256); for (let i = 80; i < 180; i++) mid[i] = 10;
  const m = A.describeHistogram(mid);
  assert.match(m.summary, /well-balanced/);
  assert.match(m.points[0], /keeps detail/);
  assert.equal(A.describeHistogram(new Uint32Array(256)).points.length, 0);
});
