import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const F = createRequire(import.meta.url)('../js/fixer-core.js');

const px = (r, g, b) => new Uint8ClampedArray([r, g, b, 255]);
const run = (r, g, b, p) => [...F.applyAdjustments(px(r, g, b), p)].slice(0, 3);

test('neutral settings leave pixels untouched', () => {
  assert.deepEqual(run(10, 120, 250, {}), [10, 120, 250]);
  assert.equal(F.isNeutral({}), true);
  assert.equal(F.isNeutral({ rotate: 1, flipH: true, straighten: 3 }), true);   // geometry is not tone
  assert.equal(F.isNeutral({ contrast: 5 }), false);
});

test('exposure brightens and darkens', () => {
  assert.ok(run(100, 100, 100, { exposure: 1 })[0] > 130);
  assert.ok(run(100, 100, 100, { exposure: -1 })[0] < 75);
  assert.equal(run(255, 255, 255, { exposure: 2 })[0], 255);
  assert.equal(run(0, 0, 0, { exposure: 2 })[0], 0);
});

test('contrast pushes darks darker and brights brighter', () => {
  assert.ok(run(190, 190, 190, { contrast: 60 })[0] > 190);
  assert.ok(run(70, 70, 70, { contrast: 60 })[0] < 70);
  assert.ok(Math.abs(run(128, 128, 128, { contrast: 60 })[0] - 128) <= 1);
  assert.ok(run(190, 190, 190, { contrast: -60 })[0] < 190);
});

test('shadows lift the darks and highlights recover the brights', () => {
  assert.ok(run(60, 60, 60, { shadows: 80 })[0] > 70);
  assert.ok(run(220, 220, 220, { highlights: -80 })[0] < 212);
  assert.equal(run(0, 0, 0, { shadows: 100 })[0], 0);
  assert.equal(run(255, 255, 255, { highlights: -100 })[0] >= 235, true);
});

test('the tone curve never runs backwards, even at the extremes', () => {
  for (const p of [{ shadows: -100, highlights: 100 }, { shadows: 100, highlights: -100, contrast: 100 }, { exposure: 2, contrast: -100 }, { exposure: -2, shadows: 100 }]) {
    const lut = F.buildToneLUT(p);
    for (let i = 1; i < 256; i++) assert.ok(lut[i] >= lut[i - 1] - 1e-9, JSON.stringify(p) + ' at ' + i);
  }
});

test('saturation -100 is black and white, +100 pushes colour apart', () => {
  const [r, g, b] = run(200, 100, 50, { saturation: -100 });
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1);
  const more = run(200, 100, 50, { saturation: 60 });
  assert.ok(more[0] - more[2] > 150);
});

test('warmth moves red up and blue down', () => {
  const warm = run(120, 120, 120, { warmth: 80 }), cool = run(120, 120, 120, { warmth: -80 });
  assert.ok(warm[0] > 120 && warm[2] < 120);
  assert.ok(cool[0] < 120 && cool[2] > 120);
});

test('sharpen raises edge contrast and leaves flat areas alone', () => {
  const w = 5, h = 5, flat = new Uint8ClampedArray(w * h * 4).fill(100);
  assert.deepEqual([...F.sharpen(new Uint8ClampedArray(flat), w, h, 80)], [...flat]);
  const edge = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) edge.set(x < 2 ? [60, 60, 60, 255] : [180, 180, 180, 255], (y * w + x) * 4);
  const out = F.sharpen(new Uint8ClampedArray(edge), w, h, 80);
  const at = (a, x, y) => a[(y * w + x) * 4];
  assert.ok(at(out, 1, 2) < at(edge, 1, 2));          // dark side gets darker
  assert.ok(at(out, 2, 2) > at(edge, 2, 2));          // bright side gets brighter
});

test('auto fix brightens a dark picture, darkens a bright one and adds contrast to a flat one', () => {
  const fill = v => { const d = new Uint8ClampedArray(4 * 200); for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = v + (i % 8 ? 6 : 0); d[i + 3] = 255; } return d; };
  assert.ok(F.autoFix(fill(30)).exposure > 0.3);
  assert.ok(F.autoFix(fill(225)).exposure < -0.3);
  assert.ok(Math.abs(F.autoFix(fill(118)).exposure) <= 0.2);
  assert.ok(F.autoFix(fill(118)).contrast > 0);       // all the same tone = a flat picture
  assert.equal(F.autoFix(new Uint8ClampedArray(0)).exposure, 0);
});

test('normalize clamps values and wraps quarter turns', () => {
  const q = F.normalize({ exposure: 9, contrast: -500, rotate: -1, straighten: 40, flipH: 1 });
  assert.equal(q.exposure, 2); assert.equal(q.contrast, -100); assert.equal(q.rotate, 3); assert.equal(q.straighten, 15); assert.equal(q.flipH, true);
});

test('geometry helpers', () => {
  assert.deepEqual(F.frameSize(400, 300, 1), { w: 300, h: 400 });
  assert.deepEqual(F.frameSize(400, 300, 2), { w: 400, h: 300 });
  assert.equal(F.straightenScale(400, 300, 0), 1);
  assert.ok(F.straightenScale(400, 300, 5) > 1.1);
  assert.ok(F.straightenScale(400, 300, 5) >= Math.cos(5 * Math.PI / 180) + (4 / 3) * Math.sin(5 * Math.PI / 180));   // covers the frame
  assert.ok(F.straightenScale(400, 300, -5) === F.straightenScale(400, 300, 5));
});

test('looks only use known settings', () => {
  for (const [name, look] of Object.entries(F.LOOKS)) for (const k of Object.keys(look)) assert.ok(F.TONE_KEYS.includes(k), name + ' uses ' + k);
});
