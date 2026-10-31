import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const E = createRequire(import.meta.url)('../js/exposure.js');

const orig = { n: 2.8, t: 1 / 250, iso: 100 };
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('one stop changes', () => {
  near(E.deltaEV(orig, { ...orig, t: 1 / 125 }), 1);
  near(E.deltaEV(orig, { ...orig, iso: 200 }), 1);
  near(E.deltaEV(orig, { ...orig, n: 2.8 * Math.SQRT2 }), -1);
});

test('compensation keeps brightness', () => {
  const t = E.compensateShutter(orig, 5.6, 100);
  near(E.deltaEV(orig, { n: 5.6, t, iso: 100 }), 0, 1e-9);
  const iso = E.compensateISO(orig, 5.6, 1 / 250);
  near(E.deltaEV(orig, { n: 5.6, t: 1 / 250, iso }), 0, 1e-9);
});

test('slider index round trip', () => {
  assert.equal(E.apertureIndex(E.apertureAt(12)), 12);
  assert.equal(E.shutterIndex(E.shutterAt(24)), 24);
  assert.equal(E.isoIndex(E.isoAt(9)), 9);
  near(E.apertureAt(6), 2, 1e-9);
});

test('formatting', () => {
  assert.equal(E.formatShutter(1 / 250), '1/250s');
  assert.equal(E.formatShutter(2), '2s');
  assert.equal(E.formatAperture(5.6), 'f/5.6');
  assert.equal(E.formatAperture(16), 'f/16');
});

test('depth of field: 50mm f/2 at 3m full frame is about 0.5 m deep', () => {
  const d = E.depthOfField({ focal: 50, n: 2, distanceMm: 3000, crop: 1 });
  assert.ok(d.total > 400 && d.total < 700, String(d.total));
  assert.ok(d.near < 3000 && d.far > 3000);
});

test('depth of field: far limit is infinity past hyperfocal', () => {
  const d = E.depthOfField({ focal: 24, n: 11, distanceMm: 20000, crop: 1 });
  assert.equal(d.far, Infinity);
});

test('motion blur: walking at 1/60 smears more than at 1/1000', () => {
  const slow = E.motionBlur({ t: 1 / 60, speed: 1.4, distanceM: 5, focal35: 50 });
  const fast = E.motionBlur({ t: 1 / 1000, speed: 1.4, distanceM: 5, focal35: 50 });
  assert.ok(slow.px4000 > fast.px4000 * 10);
  assert.ok(fast.frozen && !slow.frozen);
});

test('diffraction gets worse at small apertures', () => {
  assert.equal(E.diffraction(5.6, 1).soft, false);
  assert.equal(E.diffraction(22, 1).soft, true);
});

test('applyExposure: +1 EV brightens, clipping is reported', () => {
  const px = new Uint8ClampedArray([100, 100, 100, 255, 240, 240, 240, 255]);
  const before = px[0];
  const stats = E.applyExposure(px, { ev: 1 });
  assert.ok(px[0] > before);
  assert.equal(px[4], 255);
  assert.equal(stats.highlightsClipped, 0.5);
});

test('applyExposure is deterministic for the same seed', () => {
  const mk = () => new Uint8ClampedArray(Array.from({ length: 64 }, (_, i) => (i % 4 === 3 ? 255 : 90)));
  const a = mk(), b = mk();
  E.applyExposure(a, { isoFrom: 100, isoTo: 6400, seed: 3 });
  E.applyExposure(b, { isoFrom: 100, isoTo: 6400, seed: 3 });
  assert.deepEqual([...a], [...b]);
});

test('describeEV', () => {
  assert.equal(E.describeEV(0.05), 'About the same brightness');
  assert.equal(E.describeEV(-1), '1 stop darker');
  assert.equal(E.describeEV(2), '2 stops brighter');
});
