/* Shared helpers: navigation, escaping, file reading, downloads, toasts, service worker. */

/* ─── NAVIGATION ─── */
function showPage(name) {
  const page = document.getElementById('page-' + name);
  if (!page) return;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p === page));
  document.querySelectorAll('#app-nav .nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  window.dispatchEvent(new CustomEvent('pageshow-tool', { detail: name }));
}
document.querySelectorAll('#app-nav .nav-btn').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
if (location.hash.length > 1) showPage(location.hash.slice(1));
window.addEventListener('hashchange', () => { const n = location.hash.slice(1); if (document.getElementById('page-' + n)) showPage(n); });

/* ─── SAFE HTML ─── EXIF text comes from the file, so it must never be inserted as markup. */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = (id) => document.getElementById(id);

/* ─── FILES ─── */
function readFile(file, how) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r[how](file); });
}
const readAsArrayBuffer = file => readFile(file, 'readAsArrayBuffer');
const readAsDataURL = file => readFile(file, 'readAsDataURL');
/** Decodes a file to an ImageBitmap with EXIF rotation applied. */
async function decodeImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Cannot decode ' + file.name)); i.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
const bmpW = b => b.naturalWidth || b.width;
const bmpH = b => b.naturalHeight || b.height;

function canvasToBlob(canvas, type, quality) {
  return new Promise(res => canvas.toBlob(res, type, quality));
}

/* ─── DOWNLOADS ─── */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);                       // some browsers ignore clicks on detached links
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadText(text, filename, type = 'text/plain') { downloadBlob(new Blob([text], { type }), filename); }

function extForType(type) { return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type] || 'jpg'; }
function baseName(name) { return name.replace(/\.[^.]+$/, ''); }
function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

/** Fills {tokens} in a file-name pattern; unknown tokens are left blank. File-system-unsafe characters are removed. */
function fillPattern(pattern, values) {
  return pattern.replace(/\{(\w+)\}/g, (_, k) => (values[k] ?? '')).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'image';
}
/** Gives each name a unique suffix so ZIP entries never collide. */
function uniqueNames(names) {
  const used = new Map();
  return names.map(n => {
    const c = used.get(n) || 0; used.set(n, c + 1);
    return c ? n.replace(/(\.[^.]+)$/, `_${c + 1}$1`) : n;
  });
}

/* ─── DROP ZONES ─── */
function bindDrop(zone, handler) {
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', e => handler(e.dataTransfer.files));
}

/* ─── TOAST ─── */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ─── INSTALL + OFFLINE (need http/https; skipped when index.html is opened straight from disk) ─── */
if (/^https?:$/.test(location.protocol)) {
  const m = document.createElement('link'); m.rel = 'manifest'; m.href = 'manifest.json'; document.head.appendChild(m);
}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode is optional */ });
}

/* ─── PLAIN-LANGUAGE GLOSSARY ─── short, friendly explanations shown as tooltips and in the guide */
const GLOSSARY = {
  exif: ['EXIF (hidden photo info)', 'Hidden information a camera saves inside every photo: the camera model, the settings used, the date and sometimes the place.'],
  aperture: ['Aperture', 'How wide the lens opens, like the pupil of an eye. A small number such as f/1.8 is a wide opening: more light and a blurry background. A big number such as f/16 is a tiny opening: less light and everything looks sharp.'],
  shutter: ['Shutter speed', 'How long the camera lets light in. 1/1000s is super quick and freezes movement. 1/10s is slow: more light gets in, but moving things look blurry.'],
  iso: ['ISO', 'How sensitive the camera is to light. Low ISO (100) gives a clean photo but needs plenty of light. High ISO (6400) works in the dark but the photo gets speckled with grain.'],
  focal: ['Focal length (zoom)', 'How zoomed in the lens is. A big number such as 200mm is zoomed in a lot. A small number such as 24mm sees a wide scene.'],
  dof: ['Sharp zone (depth of field)', 'How much of the picture, from near to far, looks sharp. A small sharp zone makes the background blurry.'],
  grain: ['Grain (noise)', 'Tiny speckles that show up in dark photos, especially at high ISO.'],
  stop: ['Stop (step of light)', 'One step of light. Going up one stop doubles the light. Going down one stop halves it.'],
  diffraction: ['Tiny-opening blur (diffraction)', 'When the lens opening is very small, light bends around the edges and makes the picture a little less sharp.'],
  pixel: ['Pixel', 'One tiny dot of a picture. A photo is made of millions of them.'],
  histogram: ['Histogram', 'A chart that shows how bright the dots of a picture are: dark on the left, bright on the right.'],
  gps: ['GPS', 'Satellite location. A photo with GPS can be pinned on a map.'],
};
/** A word the reader can hover, tap or focus to see a one-sentence explanation. */
function term(key, label) {
  const g = GLOSSARY[key];
  return g ? `<span class="term" tabindex="0" data-tip="${esc(g[1])}">${esc(label || g[0])}</span>` : esc(label || key);
}
