import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const WmForm = createRequire(import.meta.url)('../js/wm-form.js');

const all = ['logoLook', 'resize', 'border', 'output'].map(n => WmForm.html(n)).join('');
const tag = id => all.match(new RegExp(`<(?:input|select)[^>]*\\bid="${id}"[^>]*>`))?.[0];
const attr = (t, name) => t.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/* The settings the Watermark Studio shipped with. People rely on these, so they must never drift. */
const ORIGINAL = {
  logoSize: ['range', 5, 5, 30], logoOpacity: ['range', 100, 10, 100], logoOffsetX: ['number', 24], logoOffsetY: ['number', -24],
  watermarkText: ['text', 'First Name | Class #'], textSize: ['range', 24, 10, 72], textOpacity: ['range', 100, 10, 100],
  textColorPicker: ['color', '#ffffff'], textColorHex: ['text', '#ffffff'], textOffsetX: ['number', -24], textOffsetY: ['number', -24],
  wmPadding: ['range', 16, 5, 50], resizeWidth: ['number', 2048, 10, 10000], resizeHeight: ['number', 800, 10, 10000],
  resizePercent: ['range', 100, 10, 200], borderWidth: ['range', 6, 1, 80], borderColorPicker: ['color', '#ffffff'], borderColorHex: ['text', '#ffffff'],
  innerLineWidth: ['range', 2, 1, 10], outputQuality: ['range', 100, 50, 100],
};
test('every numeric, text and colour control keeps its original default and range', () => {
  for (const [id, [type, value, min, max]] of Object.entries(ORIGINAL)) {
    const t = tag(id); assert.ok(t, id + ' is missing');
    assert.equal(attr(t, 'type'), type, id + ' type'); assert.equal(attr(t, 'value'), String(value), id + ' default');
    if (min !== undefined) { assert.equal(attr(t, 'min'), String(min), id + ' min'); assert.equal(attr(t, 'max'), String(max), id + ' max'); }
  }
});
test('check boxes start on, and the right option starts selected', () => {
  for (const id of ['textShadow', 'enableResize', 'keepAspect', 'enableBorder']) assert.match(tag(id), /type="checkbox"[^>]*checked/, id);
  assert.match(all, /<option value="width" selected>By Width<\/option>/);
  assert.equal((all.match(/ selected/g) || []).length, 1);
});
test('selects offer the original choices in the original order', () => {
  const options = id => [...all.match(new RegExp(`<select id="${id}">(.*?)</select>`))[1].matchAll(/<option value="([^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(options('outputFormat'), ['image/jpeg', 'image/png', 'image/webp']);
  assert.deepEqual(options('borderStyle'), ['solid', 'double', 'shadow']);
  assert.deepEqual(options('resizeMode'), ['width', 'height', 'both', 'percent']);
  assert.equal(options('watermarkFont').length, 6);
});
test('every control id is unique and every range has a value label', () => {
  const ids = [...all.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of all.matchAll(/<input type="range" id="(\w+)"[^>]*value="(-?\d+)"[^>]*><span id="\1Val">/g)) assert.ok(m[1]);
  assert.equal([...all.matchAll(/type="range"/g)].length, [...all.matchAll(/<span id="\w+Val">/g)].length);
});
test('the quality, scale and inner-line groups start hidden', () => {
  assert.match(all, /id="resizePercentGroup" style="display:none;"/);
  assert.match(all, /id="doubleLineGroup" style="display:none;"/);
  assert.doesNotMatch(all, /id="qualityGroup" style/);
});
