import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Lab = require('../js/lab.js');
const E = require('../js/exposure.js');

const near = (a, b, eps = 0.1) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('sunny-16 rule: f/16 at 1/ISO is a correct exposure', () => {
  const st = { ...Lab.defaultState(), n: 16, t: 1 / 100, iso: 100 };
  near(Lab.brightnessStops(st), 0.36, 0.05);
  near(Lab.brightnessStops({ ...st, t: 1 / 128 }), 0, 0.02);
});

test('brightness goes up by one stop when the shutter time doubles', () => {
  const a = { ...Lab.defaultState() };
  near(Lab.brightnessStops({ ...a, t: a.t * 2 }) - Lab.brightnessStops(a), 1, 1e-9);
});

test('the focused layer has no blur and other layers blur more with a wider opening', () => {
  const st = { ...Lab.defaultState(), focus: 'mid', focal: 50 };
  assert.equal(Lab.metrics(st).layers.mid.px4000, 0);
  const wide = Lab.metrics({ ...st, n: 1.8 }).layers.far.px4000, narrow = Lab.metrics({ ...st, n: 11 }).layers.far.px4000;
  assert.ok(wide > narrow * 5, `${wide} vs ${narrow}`);
  assert.ok(Lab.metrics({ ...st, focus: 'near' }).layers.mid.px4000 > 0);
});

test('zooming in makes the sharp zone smaller', () => {
  const st = { ...Lab.defaultState(), n: 5.6, focus: 'mid' };
  assert.ok(Lab.metrics({ ...st, focal: 135 }).layers.far.px4000 > Lab.metrics({ ...st, focal: 50 }).layers.far.px4000);
});

test('motion smear shrinks with a faster shutter and shake only appears hand-held and slow', () => {
  const st = { ...Lab.defaultState(), t: 1 / 60 };
  assert.ok(Lab.metrics(st).riderSmear4000 > Lab.metrics({ ...st, t: 1 / 1000 }).riderSmear4000 * 10);
  assert.equal(Lab.metrics({ ...st, handheld: false }).shake4000, 0);
  assert.ok(Lab.metrics({ ...st, t: 1 / 10, handheld: true }).shake4000 > 3);
  assert.equal(Lab.metrics({ ...st, t: 1 / 100, handheld: true }).shake4000, 0);
});

test('balance() restores a correct exposure with shutter or ISO', () => {
  const st = { ...Lab.defaultState(), n: 2, t: 1 / 500, iso: 100 };
  assert.ok(Math.abs(Lab.brightnessStops(st)) > 2);
  assert.ok(Math.abs(Lab.brightnessStops(Lab.balance(st, 'shutter'))) <= 0.2);
  const dark = { ...Lab.defaultState(), light: 'cloud', n: 2.8, t: 1 / 1600, iso: 100 };
  assert.ok(Math.abs(Lab.brightnessStops(Lab.balance(dark, 'iso'))) <= 0.2);
  assert.deepEqual(Lab.balance(st, 'off'), st);
});

test('every challenge starts unsolved', () => {
  for (const ch of Lab.CHALLENGES) {
    const r = Lab.evaluate(ch, ch.start);
    assert.equal(r.done, false, ch.id + ' already passes at the start');
    assert.equal(r.stars, 0);
  }
});

test('every challenge can be won, with 3 stars', () => {
  for (const ch of Lab.CHALLENGES) {
    const best = Lab.solve(ch);
    assert.ok(best, ch.id + ' has no solution');
    assert.equal(best.stars, 3, ch.id + ' cannot reach 3 stars');
  }
});

test('challenge data is complete', () => {
  const ids = new Set();
  for (const ch of Lab.CHALLENGES) {
    assert.ok(!ids.has(ch.id)); ids.add(ch.id);
    assert.ok(ch.title && ch.brief && ch.required.length && ch.bonus.length && ch.hints.length >= 2);
    assert.ok(Lab.LIGHTS[ch.start.light] && Lab.FOCUS[ch.start.focus]);
    assert.ok([1, 2, 3].includes(ch.level));
  }
  assert.ok(Lab.CHALLENGES.length >= 8);
});

test('stars: a win with no bonus is 1 star', () => {
  const ch = Lab.CHALLENGES.find(c => c.id === 'just-right');
  const st = { ...ch.start, n: 22, t: 1 / 125, iso: 200 };       // correct exposure, but ISO 200 and a slower shutter
  const r = Lab.evaluate(ch, st);
  assert.equal(r.done, true);
  assert.equal(r.stars, 1);
});

test('lessons use valid scene settings', () => {
  assert.equal(Lab.LESSONS.length, 5);
  for (const l of Lab.LESSONS) {
    const st = { ...Lab.defaultState(), ...l.state };
    assert.ok(Lab.LIGHTS[st.light] && Lab.FOCUS[st.focus], l.id);
    assert.ok(l.task && l.meter);
    const m = Lab.metrics(Lab.balance(st, l.balance || 'off'));
    assert.ok(Math.abs(m.brightness) < 2.1, `${l.id} starts far from correct: ${m.brightness}`);
  }
});

test('lesson settings sit inside the slider ranges', () => {
  for (const l of Lab.LESSONS) {
    const st = { ...Lab.defaultState(), ...l.state };
    assert.ok(E.apertureIndex(st.n) >= E.APERTURE.min && E.apertureIndex(st.n) <= E.APERTURE.max);
    assert.ok(E.shutterIndex(st.t) >= E.SHUTTER.min && E.shutterIndex(st.t) <= E.SHUTTER.max);
    assert.ok(E.isoIndex(st.iso) >= E.ISO.min && E.isoIndex(st.iso) <= E.ISO.max);
  }
});
