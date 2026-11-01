import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const TEXT = /\.(html|css|js|mjs|json|md|svg|yml|txt)$/;
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === 'vendor') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else files.push(p);
  }
})(root);
const read = f => readFileSync(join(root, f), 'utf8');

test('no organisation-specific branding is left anywhere in the project', () => {
  const brand = new RegExp('guru' + 'kul', 'i');
  const hits = files.filter(f => TEXT.test(f) && brand.test(readFileSync(f, 'utf8'))).map(f => relative(root, f));
  assert.deepEqual(hits, []);
  assert.deepEqual(files.map(f => relative(root, f)).filter(f => brand.test(f) || /branding|set-logo/.test(f)), []);
});
test('the logo picker offers exactly two choices: Upload logo and None, and starts on None', () => {
  const html = read('index.html');
  const group = html.slice(html.indexOf('id="logoMode"'), html.indexOf('</div>', html.indexOf('id="logoMode"')));
  const buttons = [...group.matchAll(/<button[^>]*data-logo="(\w+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]);
  assert.deepEqual(buttons, [['custom', 'Upload logo'], ['none', 'None']]);
  assert.match(group, /data-logo="none"[^>]*class="on"|class="on"[^>]*data-logo="none"/);
  assert.match(html, /id="logoInput"/);
});
test('the watermark code has no built-in logo path: the logo is drawn only from the chosen mode', () => {
  const js = read('js/watermark.js');
  assert.doesNotMatch(js, /defaultLogo|BRAND|PHOTO_TOOLS_BRANDING/);
  assert.match(js, /const wmActiveLogo = \(\) => logoMode === 'custom' \? customLogo : null;/);
  assert.match(js, /const logo = wmActiveLogo\(\);/);
});
test('every script the page loads exists and is in the offline cache list', () => {
  const html = read('index.html'), sw = read('sw.js');
  for (const m of html.matchAll(/<script src="([^"?]+)/g)) {
    assert.ok(existsSync(join(root, m[1])), m[1] + ' is missing');
    assert.ok(sw.includes(`'${m[1]}'`), m[1] + ' is not in sw.js');
  }
});
test('asset URLs carry the same version number as the offline cache, so a changed file is never served from an old copy', () => {
  const cache = read('sw.js').match(/const VERSION = '[\w-]*?-v(\d+)'/)[1];
  const stamps = [...read('index.html').matchAll(/(?:src|href)="(?:js|css)\/[^"]+\?v=(\d+)"/g)].map(m => m[1]);
  assert.ok(stamps.length >= 10, 'expected versioned scripts and styles');
  assert.deepEqual([...new Set(stamps)], [cache], 'bump ?v= in index.html together with VERSION in sw.js');
});
