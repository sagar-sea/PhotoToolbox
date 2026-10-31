import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { visibleBounds, fitToReference } = createRequire(import.meta.url)('../js/logo-fit.js');

/** RGBA data of a w×h image, opaque inside `rect` and transparent elsewhere. */
const image = (w, h, rect, alpha = 255) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) d[(y * w + x) * 4 + 3] = alpha;
  return d;
};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} is not ${b}`);

test('visibleBounds finds the artwork inside transparent padding', () => {
  assert.deepEqual(visibleBounds(image(40, 40, { x: 10, y: 5, w: 20, h: 12 }), 40, 40), { x: 10, y: 5, w: 20, h: 12 });
});
test('visibleBounds ignores faint, almost invisible pixels', () => {
  assert.deepEqual(visibleBounds(image(20, 20, { x: 2, y: 2, w: 16, h: 16 }, 10), 20, 20), { x: 0, y: 0, w: 20, h: 20 });
});
test('visibleBounds: a fully opaque or an empty image counts as filling the whole picture', () => {
  assert.deepEqual(visibleBounds(image(8, 6, { x: 0, y: 0, w: 8, h: 6 }), 8, 6), { x: 0, y: 0, w: 8, h: 6 });
  assert.deepEqual(visibleBounds(new Uint8ClampedArray(8 * 6 * 4), 8, 6), { x: 0, y: 0, w: 8, h: 6 });
});

const reference = { w: 132, h: 132, bounds: { x: 1, y: 1, w: 130, h: 130 } };
const box = { x: 100, y: 50, w: 200, h: 200 };               // where the reference logo is drawn
const refVisible = { x: 100 + 200 / 132, y: 50 + 200 / 132, w: 200 * 130 / 132, h: 200 * 130 / 132 };

test('a logo identical to the reference lands exactly on it', () => {
  const f = fitToReference(reference, reference, box);
  for (const k of ['x', 'y', 'w', 'h']) near(f[k], box[k]);
});
test('a logo with 25% padding is enlarged until its artwork matches the reference artwork', () => {
  const padded = { w: 400, h: 400, bounds: { x: 100, y: 100, w: 200, h: 200 } };
  const f = fitToReference(padded, reference, box);
  for (const k of ['x', 'y', 'w', 'h']) near(f.visible[k], refVisible[k]);
  near(f.w, 400 * refVisible.w / 200);                       // the whole image is drawn about twice as large as before
});
test('image dimensions do not matter: a 50 px and a 5000 px copy of the same art look the same', () => {
  const small = fitToReference({ w: 50, h: 50, bounds: { x: 5, y: 5, w: 40, h: 40 } }, reference, box);
  const big = fitToReference({ w: 5000, h: 5000, bounds: { x: 500, y: 500, w: 4000, h: 4000 } }, reference, box);
  for (const k of ['x', 'y', 'w', 'h']) { near(small.visible[k], big.visible[k], 1e-6); near(small[k], big[k], 1e-6); }
});
test('a wide logo fills the width of the reference logo and keeps its shape, centred', () => {
  const f = fitToReference({ w: 800, h: 200, bounds: { x: 0, y: 0, w: 800, h: 200 } }, reference, box);
  near(f.visible.w, refVisible.w); near(f.visible.h, refVisible.w / 4);
  near(f.visible.x + f.visible.w / 2, refVisible.x + refVisible.w / 2); near(f.visible.y + f.visible.h / 2, refVisible.y + refVisible.h / 2);
});
test('a tall logo fills the height of the reference logo and keeps its shape, centred', () => {
  const f = fitToReference({ w: 200, h: 600, bounds: { x: 0, y: 0, w: 200, h: 600 } }, reference, box);
  near(f.visible.h, refVisible.h); near(f.visible.w, refVisible.h / 3);
  near(f.visible.x + f.visible.w / 2, refVisible.x + refVisible.w / 2);
});
test('the logo is never cropped: its artwork always fits inside the reference logo\'s area', () => {
  for (const [w, h] of [[300, 300], [800, 200], [200, 600], [37, 91], [1000, 999]]) {
    const v = fitToReference({ w, h, bounds: { x: 0, y: 0, w, h } }, reference, box).visible;
    assert.ok(v.w <= refVisible.w + 1e-9 && v.h <= refVisible.h + 1e-9);
  }
});
test('follows the reference logo when its size setting changes', () => {
  const l = { w: 400, h: 400, bounds: { x: 100, y: 100, w: 200, h: 200 } };
  const a = fitToReference(l, reference, { x: 0, y: 0, w: 100, h: 100 }), b = fitToReference(l, reference, { x: 0, y: 0, w: 300, h: 300 });
  near(b.w / a.w, 3);
});
test('a reference logo with its own padding is the yardstick, not its full image', () => {
  const padded = { w: 200, h: 200, bounds: { x: 50, y: 50, w: 100, h: 100 } };    // art is half the image
  const f = fitToReference({ w: 100, h: 100, bounds: { x: 0, y: 0, w: 100, h: 100 } }, padded, { x: 0, y: 0, w: 200, h: 200 });
  near(f.w, 100); near(f.x, 50);
});

/* how the Watermark Studio uses it: the reference is a plain square as wide as the Logo Size setting */
const square = { w: 1, h: 1, bounds: { x: 0, y: 0, w: 1, h: 1 } };
const slot = { x: 40, y: 60, w: 100, h: 100 };
test('uploaded logos fill the Logo Size square whatever their padding, size or shape', () => {
  const cases = [
    { w: 400, h: 400, bounds: { x: 100, y: 100, w: 200, h: 200 } },           // 25% padding
    { w: 64, h: 64, bounds: { x: 0, y: 0, w: 64, h: 64 } },                   // small, no padding
    { w: 3000, h: 3000, bounds: { x: 750, y: 750, w: 1500, h: 1500 } },       // huge, padded
  ];
  for (const l of cases) { const v = fitToReference(l, square, slot).visible; for (const k of ['x', 'y', 'w', 'h']) near(v[k], slot[k]); }
});
test('a wide uploaded logo is as wide as the square, a tall one as tall, both centred and in proportion', () => {
  const wide = fitToReference({ w: 800, h: 200, bounds: { x: 0, y: 0, w: 800, h: 200 } }, square, slot).visible;
  near(wide.w, 100); near(wide.h, 25); near(wide.y + wide.h / 2, 110);
  const tall = fitToReference({ w: 200, h: 600, bounds: { x: 0, y: 0, w: 200, h: 600 } }, square, slot).visible;
  near(tall.h, 100); near(tall.w, 100 / 3); near(tall.x + tall.w / 2, 90);
});
