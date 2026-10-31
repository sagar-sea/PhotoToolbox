/* Watermark Studio: stamps a logo and/or text on photos, with resize, border, a live preview, saved settings and ZIP download. */
let files = [], processed = [], logoImage = null;
const wmTokens = new Map();           // File -> { Make, Model, ... } from EXIF, used for {tokens}
let wmThumbUrls = [];

/* ─── logo: the visitor's own upload, or none ─── */
const CUSTOM_LOGO_KEY = 'phototools.watermark.customLogo.v1';
const MAX_SAVED_LOGO = 400000;                       // characters of data URL we keep in this browser
let logoMode = 'none';                               // 'custom' | 'none'
let customLogo = null;                               // { img, src, w, h, name, solid, bounds }
let logoEpoch = 0;                                   // bumped on every choice, so a slow upload or preset cannot overrule a newer click

const wmOpenImage = src => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('This image cannot be opened'));
  img.src = src;
});
/** True when every pixel is opaque, i.e. the logo has a solid background and will show as a box. */
function logoIsSolid(img) {
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return false;
  return true;
}
const logoDims = l => `${l.w} × ${l.h} px`;
/** A logo entry: the image, its size, whether it is a solid box, and the part of it that is visible (so padding never shrinks it). */
function wmMakeLogo(img, src, name) {
  const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 512 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, c.width, c.height);
  const b = LogoFit.visibleBounds(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  return { img, src, w, h, name, solid: logoIsSolid(img), bounds: { x: b.x / k, y: b.y / k, w: b.w / k, h: b.h / k } };
}
/** The logo that is drawn: always read from the chosen mode, never from a cached copy. */
const wmActiveLogo = () => logoMode === 'custom' ? customLogo : null;
/** Throws away finished pictures (they no longer match the settings) and refreshes the grid so no old result stays on screen. */
function wmDiscardResults() { processed = []; if ($('wmGrid').querySelector('.done-badge')) wmDrawGrid(); wmRefreshStatus(); }

/** Width (in pixels) the logo needs to look sharp at the current size on the first photo, or 0 when there is no photo yet. */
function logoNeededWidth() {
  if (!files.length || !liveImg) return 0;
  return Math.ceil(wmOutputSize(liveImg, getSettings()).w * int('logoSize', 5) / 100);
}

/** The one-line guidance under the logo picker. */
function wmLogoAdvice() {
  const el = $('logoAdvice'); if (!el) return;
  const parts = []; let level = '';
  if (logoMode === 'custom' && customLogo) {
    const need = logoNeededWidth();
    if (need && customLogo.w < need) { parts.push(`Your logo is ${customLogo.w} px wide. About ${need} px is needed at this size, so it may look soft.`); level = 'warn'; }
    else { parts.push(need ? `Sharp at this size (${logoDims(customLogo)}).` : `${logoDims(customLogo)}.`); level = 'ok'; }
    if (customLogo.solid) { parts.push('It has a solid background and will show as a box. A transparent PNG looks best.'); level = 'warn'; }
  } else {
    parts.push('Best: a PNG with a transparent background, large enough to stay sharp.');
  }
  el.textContent = parts.join(' '); el.className = 'hint logo-advice ' + level;
}

/** Brings the picker, the preview and the drawing code in line with `logoMode`. */
function wmLogoRefresh() {
  if (logoMode === 'custom' && !customLogo) logoMode = 'none';
  const cur = wmActiveLogo();
  logoImage = cur ? cur.img : null;
  document.querySelectorAll('#logoMode button').forEach(b => { const on = b.dataset.logo === logoMode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const prev = $('logoPreview');
  if (cur) prev.src = cur.src; else prev.removeAttribute('src');
  prev.closest('.logo-thumb').classList.toggle('empty', !cur);
  $('logoTitle').textContent = cur ? cur.name : 'No logo';
  $('logoDims').textContent = cur ? logoDims(cur) : 'Nothing will be added';
  $('logoBrowse').textContent = cur ? 'Replace…' : 'Browse…';
  $('logoForget').hidden = !customLogo;
  wmLogoAdvice(); wmLive();
}

/** Switches the logo. "Upload logo" with nothing uploaded yet opens the file picker instead. */
function wmLogoMode(mode) {
  if (mode === 'custom' && !customLogo) { $('logoInput').click(); return; }
  logoEpoch++; logoMode = mode; wmLogoRefresh();
}

async function wmLogoFromFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please choose a picture (PNG, JPG, WebP or SVG)'); return; }
  try {
    const src = await readAsDataURL(file);
    const img = await wmOpenImage(src);
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('This image has no size. Use PNG, JPG or WebP.');
    customLogo = wmMakeLogo(img, src, file.name);
    let saved = true;
    try { if (src.length < MAX_SAVED_LOGO) localStorage.setItem(CUSTOM_LOGO_KEY, JSON.stringify({ src, name: file.name })); else { localStorage.removeItem(CUSTOM_LOGO_KEY); saved = false; } } catch (e) { saved = false; }
    if (!saved) toast('Logo is in use, but it is too large to remember for next time');
    logoEpoch++; logoMode = 'custom'; wmDiscardResults(); wmLogoRefresh();
  } catch (e) { toast(e.message); }
}

function wmForgetLogo() {
  customLogo = null;
  try { localStorage.removeItem(CUSTOM_LOGO_KEY); } catch (e) { /* storage blocked */ }
  $('logoInput').value = '';
  logoEpoch++; logoMode = 'none'; wmDiscardResults();
  wmLogoRefresh(); toast('Your saved logo was removed');
}

$('logoMode').addEventListener('click', e => { const b = e.target.closest('button[data-logo]'); if (b) { wmDiscardResults(); wmLogoMode(b.dataset.logo); } });
$('logoInput').addEventListener('change', e => { wmLogoFromFile(e.target.files[0]); e.target.value = ''; });
$('logoForget').addEventListener('click', wmForgetLogo);
bindDrop($('logoDropArea'), list => wmLogoFromFile(list[0]));

// the tool starts with no logo; the one this browser remembers is one click away (first refresh: end of this file)
try {
  const saved = JSON.parse(localStorage.getItem(CUSTOM_LOGO_KEY) || 'null');
  if (saved && saved.src) wmOpenImage(saved.src).then(img => { customLogo = wmMakeLogo(img, saved.src, saved.name || 'My logo'); wmLogoRefresh(); }).catch(() => {});
} catch (e) { /* nothing saved */ }

/* ─── controls ─── */
/** Every slider shows its value next to it: the number plus the unit named in its data-unit. */
document.querySelectorAll('.wm-page input[type="range"][data-unit]').forEach(slider => {
  const label = $(slider.id + 'Val');
  const show = () => { label.textContent = slider.value + slider.dataset.unit; };
  slider.addEventListener('input', show); show();
});

/** Keeps a colour picker and its hex box in step; the hex box only counts once it is a full #rrggbb. */
function wmLinkColour(picker, hex) {
  const [p, h] = [$(picker), $(hex)];
  p.addEventListener('input', () => { h.value = p.value; });
  h.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(h.value)) p.value = h.value; });
}
wmLinkColour('textColorPicker', 'textColorHex');
wmLinkColour('borderColorPicker', 'borderColorHex');

function wmToggleVisibility() {
  const fmt = $('outputFormat').value;
  $('qualityGroup').style.display = fmt === 'image/jpeg' ? 'block' : 'none';   // same as the original app
  $('doubleLineGroup').style.display = $('borderStyle').value === 'double' ? 'block' : 'none';
  const pct = $('resizeMode').value === 'percent';
  $('resizeDims').style.display = pct ? 'none' : 'grid';
  $('resizePercentGroup').style.display = pct ? 'block' : 'none';
}
$('outputFormat').addEventListener('change', wmToggleVisibility);
$('borderStyle').addEventListener('change', wmToggleVisibility);
$('resizeMode').addEventListener('change', wmToggleVisibility);
wmToggleVisibility();

$('wmTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) wmShowTab(b.dataset.tab, b); });
function wmShowTab(name, btn) {
  document.querySelectorAll('.wm-page .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.wm-page .tab-pane').forEach(c => c.classList.toggle('active', c.id === 'wm-pane-' + name));
}

$('wmSocial').addEventListener('change', e => {
  if (!e.target.value) return;
  $('enableResize').checked = true;
  $('resizeMode').value = 'width';
  $('resizeWidth').value = e.target.value;
  $('keepAspect').checked = true;
  wmToggleVisibility(); wmLive();
});
document.querySelectorAll('[data-token]').forEach(b => b.addEventListener('click', () => { $('watermarkText').value = b.dataset.token; wmLive(); }));

/* ─── files ─── */
const wmDropZone = $('wmDropZone');
$('wmPhotoInput').addEventListener('change', e => { wmTakeFiles(e.target.files); e.target.value = ''; });
bindDrop(wmDropZone, wmTakeFiles);

const WM_EXIF_FIELDS = ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'CreateDate', 'Artist', 'Copyright', 'ISO', 'FNumber', 'ExposureTime', 'FocalLength'];
/** Reads the camera info used by {tokens} in the text; the preview refreshes once the first photo's info arrives. */
async function wmReadTokens(f) {
  try {
    const tags = await exifr.parse(f, WM_EXIF_FIELDS);
    if (tags) { wmTokens.set(f, tags); if (files[0] === f) wmLive(); }
  } catch (e) { /* no camera info in this file */ }
}
function wmTakeFiles(newFiles) {
  for (const f of [...newFiles].filter(f => f.type.startsWith('image/'))) { files.push(f); wmReadTokens(f); }
  processed = []; wmDrawGrid(); wmRefreshStatus(); wmLive();
}
function wmRemoveFile(idx) { files.splice(idx, 1); processed = []; wmDrawGrid(); wmRefreshStatus(); wmLive(); }
function wmClearPhotos() { files = []; processed = []; wmDrawGrid(); wmRefreshStatus(); wmLive(); }

function wmDrawGrid() {
  wmThumbUrls.forEach(u => URL.revokeObjectURL(u)); wmThumbUrls = [];
  const grid = $('wmGrid');
  if (files.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">🖼️</div><p>Add photos to get started</p></div>';
    return;
  }
  const card = (f, i) => {
    const url = URL.createObjectURL(processed[i] ? processed[i].blob : f); wmThumbUrls.push(url);
    const badge = processed[i] ? '<span class="done-badge">✓</span>' : '';
    return `<div class="image-card"><div style="position:relative;"><img src="${url}" alt="${esc(f.name)}">${badge}</div>
      <div class="image-card-footer"><span class="image-card-name">${esc(f.name)}</span><button class="remove-btn" data-idx="${i}" aria-label="Remove ${esc(f.name)}">×</button></div></div>`;
  };
  grid.innerHTML = files.map(card).join('');
}
$('wmGrid').addEventListener('click', e => { const b = e.target.closest('.remove-btn'); if (b) wmRemoveFile(+b.dataset.idx); });

function wmRefreshStatus() {
  const n = files.length, noun = `${n} image${n > 1 ? 's' : ''}`;
  const allDone = n > 0 && processed.filter(Boolean).length === n;
  const [text, cls] = n === 0 ? ['No images loaded', ''] : allDone ? [`✓ ${noun} processed`, ' done'] : [`${noun} loaded — click Process`, ''];
  $('wmStatus').textContent = text; $('wmStatus').className = 'wm-status-text' + cls;
  $('downloadBtn').hidden = $('previewBtn').hidden = !allDone;
}

/* ─── settings ─── */
const int = (id, d = 0) => { const v = parseInt($(id).value); return isNaN(v) ? d : v; };
function getSettings() {
  return {
    text: $('watermarkText').value, font: $('watermarkFont').value, textSize: int('textSize', 24),
    textOpacity: int('textOpacity', 100) / 100, textColor: $('textColorHex').value, textShadow: $('textShadow').checked,
    textOffsetX: int('textOffsetX'), textOffsetY: int('textOffsetY'), textAnchor: $('textAnchor').value,
    logoSize: int('logoSize', 5) / 100, logoOpacity: int('logoOpacity', 100) / 100,
    logoOffsetX: int('logoOffsetX'), logoOffsetY: int('logoOffsetY'), logoAnchor: $('logoAnchor').value,
    padding: int('wmPadding'),
    tile: $('tileEnable').checked, tileAngle: int('tileAngle', -30), tileGap: int('tileGap', 180),
    enableResize: $('enableResize').checked, resizeMode: $('resizeMode').value,
    resizeWidth: int('resizeWidth', 1080), resizeHeight: int('resizeHeight', 1080), resizePercent: int('resizePercent', 100) / 100,
    keepAspect: $('keepAspect').checked,
    enableBorder: $('enableBorder').checked, borderWidth: int('borderWidth', 6), borderColor: $('borderColorHex').value,
    borderStyle: $('borderStyle').value, innerLineWidth: int('innerLineWidth', 2),
    format: $('outputFormat').value, quality: int('outputQuality', 100) / 100,
    namePattern: $('wmNamePattern').value || '{name}_watermarked',
  };
}

/** Replaces {Make} {Model} {Year} … in the watermark text with this photo's EXIF. */
function wmFillText(text, file) {
  const t = wmTokens.get(file) || {};
  const d = t.DateTimeOriginal || t.CreateDate;
  const date = d instanceof Date && !isNaN(d) ? d : null;
  const vals = {
    Make: t.Make, Model: t.Model, Lens: t.LensModel, Artist: t.Artist, ISO: t.ISO ? 'ISO ' + t.ISO : '',
    Aperture: t.FNumber ? Exposure.formatAperture(t.FNumber) : '', Shutter: t.ExposureTime ? Exposure.formatShutter(t.ExposureTime) : '',
    Focal: t.FocalLength ? Math.round(t.FocalLength) + 'mm' : '', Date: date ? date.toLocaleDateString() : '',
    Year: date ? String(date.getFullYear()) : String(new Date().getFullYear()), Filename: baseName(file.name),
  };
  if (!/\{\w+\}/.test(text)) return text;                    // plain text is drawn exactly as typed
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? (vals[k] ?? '') : m)).replace(/\s{2,}/g, ' ').trim();
}

function wmOutputSize(img, s) {
  let w = bmpW(img), h = bmpH(img);
  if (s.enableResize) {
    if (s.resizeMode === 'percent') { w = Math.round(w * s.resizePercent); h = Math.round(h * s.resizePercent); }
    else if (s.resizeMode === 'width') { const k = s.resizeWidth / w; w = s.resizeWidth; h = s.keepAspect ? Math.round(h * k) : h; }
    else if (s.resizeMode === 'height') { const k = s.resizeHeight / h; h = s.resizeHeight; w = s.keepAspect ? Math.round(w * k) : w; }
    else { w = s.resizeWidth; h = s.resizeHeight; }
  }
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

function anchorPos(anchor, bw_, bh_, W, H, pad, border) {
  const col = anchor[1], row = anchor[0];
  const x = col === 'l' ? border + pad : col === 'c' ? border + (W - bw_) / 2 : border + W - pad - bw_;
  const y = row === 't' ? border + pad : row === 'm' ? border + (H - bh_) / 2 : border + H - pad - bh_;
  return { x, y };
}
// anchors are written "<row><col>": tl, tc, tr, ml, mc, mr, bl, bc, br
const wmAnchor = a => a;

/**
 * Draws the finished picture onto ctx. `k` scales every pixel-based setting, so the live preview
 * looks the same as the full-size output. Returns the logo and text boxes (for dragging).
 */
function wmRender(ctx, img, s, k, text) {
  const { w: ow, h: oh } = wmOutputSize(img, s);
  const w = ow * k, h = oh * k, bw = (s.enableBorder ? s.borderWidth : 0) * k;
  const cw = w + bw * 2, ch = h + bw * 2;
  ctx.canvas.width = Math.max(1, Math.round(cw)); ctx.canvas.height = Math.max(1, Math.round(ch));
  ctx.clearRect(0, 0, cw, ch);
  if (s.enableBorder) { ctx.fillStyle = s.borderColor; ctx.fillRect(0, 0, cw, ch); }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  const frame = { x: bw, y: bw };                         // the photo sits inside the border
  ctx.drawImage(img, frame.x, frame.y, w, h);
  if (s.enableBorder && s.borderStyle === 'double') {
    const lw = s.innerLineWidth * k, inset = bw - lw - 4 * k;
    ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    if (inset > 0) ctx.strokeRect(inset, inset, cw - inset * 2, ch - inset * 2);
  }
  const pad = s.padding * k, boxes = {};
  const logo = wmActiveLogo();
  if (logo) {
    // the logo's visible part is fitted (never cropped, shape kept) into a square as wide as the Logo Size, so padding and shape never make it look smaller
    const lw = w * s.logoSize;
    const p = anchorPos(wmAnchor(s.logoAnchor), lw, lw, w, h, pad, bw);
    const x = p.x + s.logoOffsetX * k, y = p.y + s.logoOffsetY * k;
    const f = LogoFit.fitToReference(logo, { w: 1, h: 1, bounds: { x: 0, y: 0, w: 1, h: 1 } }, { x, y, w: lw, h: lw });
    ctx.globalAlpha = s.logoOpacity; ctx.drawImage(logo.img, f.x, f.y, f.w, f.h); ctx.globalAlpha = 1;
    boxes.logo = f.visible;
  }
  if (text) {
    const size = s.textSize * k;
    ctx.font = `${size}px ${s.font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const tw = ctx.measureText(text).width;
    ctx.globalAlpha = s.textOpacity; ctx.fillStyle = s.textColor;
    if (s.textShadow) { ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6 * k; ctx.shadowOffsetX = k; ctx.shadowOffsetY = k; }
    if (s.tile) {
      ctx.save();
      ctx.beginPath(); ctx.rect(bw, bw, w, h); ctx.clip();
      ctx.translate(bw + w / 2, bw + h / 2); ctx.rotate(s.tileAngle * Math.PI / 180);
      const gx = tw + s.tileGap * k * 0.6, gy = size * 1 + s.tileGap * k * 0.5, reach = Math.hypot(w, h) / 2;
      let row = 0;
      for (let y = -reach; y < reach; y += gy, row++) for (let x = -reach - (row % 2 ? gx / 2 : 0); x < reach; x += gx) ctx.fillText(text, x, y);
      ctx.restore();
    } else {
      const p = anchorPos(wmAnchor(s.textAnchor), tw, size, w, h, pad, bw);
      const x = p.x + s.textOffsetX * k, y = p.y + s.textOffsetY * k;
      ctx.fillText(text, x, y + size);
      boxes.text = { x, y, w: tw, h: size };
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  return boxes;
}

/* ─── live preview with drag-to-position ─── */
let liveBoxes = {}, liveScale = 1, liveImg = null, liveFor = null, liveRaf = 0;
function wmLive() {
  if (!liveRaf) liveRaf = requestAnimationFrame(async () => { liveRaf = 0; await wmLiveDraw(); });
}
async function wmLiveDraw() {
  const wrap = $('wmLiveWrap');
  if (!files.length) { wrap.hidden = true; liveImg = liveFor = null; wmLogoAdvice(); return; }
  wrap.hidden = false;
  if (liveFor !== files[0]) { liveFor = files[0]; liveImg = null; try { liveImg = await wmLoadImage(files[0]); } catch (e) { $('wmLiveInfo').textContent = 'Cannot preview this image.'; return; } }
  if (!liveImg) return;
  const s = getSettings();
  const out = wmOutputSize(liveImg, s), full = out.w + (s.enableBorder ? s.borderWidth * 2 : 0);
  liveScale = Math.min(1, 900 / full);
  const canvas = $('wmLive');
  if ($('wmShowOriginal').checked) {
    canvas.width = Math.round(bmpW(liveImg) * Math.min(1, 720 / bmpW(liveImg))); canvas.height = Math.round(bmpH(liveImg) * canvas.width / bmpW(liveImg));
    canvas.getContext('2d').drawImage(liveImg, 0, 0, canvas.width, canvas.height); liveBoxes = {};
  } else {
    liveBoxes = wmRender(canvas.getContext('2d'), liveImg, s, liveScale, wmFillText(s.text, files[0]));
  }
  $('wmLiveInfo').textContent = `${files[0].name} → ${out.w} × ${out.h}px${s.tile ? '' : '. Drag the logo or text to move it.'}`;
  wmLogoAdvice();
}
(function bindLiveDrag() {
  const c = $('wmLive'); let drag = null;
  const pos = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
  const hit = (b, p) => b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  c.addEventListener('pointerdown', e => {
    const p = pos(e);
    const which = hit(liveBoxes.text, p) ? 'text' : hit(liveBoxes.logo, p) ? 'logo' : null;
    if (!which) return;
    drag = { which, last: p }; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing';
  });
  c.addEventListener('pointermove', e => {
    const p = pos(e);
    if (!drag) { c.style.cursor = hit(liveBoxes.text, p) || hit(liveBoxes.logo, p) ? 'grab' : 'default'; return; }
    const dx = (p.x - drag.last.x) / liveScale, dy = (p.y - drag.last.y) / liveScale;
    drag.last = p;
    const [ix, iy] = drag.which === 'text' ? ['textOffsetX', 'textOffsetY'] : ['logoOffsetX', 'logoOffsetY'];
    $(ix).value = Math.round(int(ix) + dx); $(iy).value = Math.round(int(iy) + dy);
    wmLive();
  });
  const end = () => { drag = null; c.style.cursor = 'default'; };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
})();
document.querySelector('.wm-page').addEventListener('input', e => { if (e.target.id !== 'wmPresetName' && e.target.id !== 'wmPhotoInput' && e.target.id !== 'logoInput') { processed = []; wmRefreshStatus(); wmLive(); } });
document.querySelector('.wm-page').addEventListener('change', e => { if (!['wmPhotoInput', 'logoInput', 'wmPresetSel'].includes(e.target.id)) wmLive(); });
$('wmShowOriginal').addEventListener('change', wmLive);
window.addEventListener('pageshow-tool', e => { if (e.detail === 'watermark') wmLive(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(wmLive);

/* ─── presets (browser localStorage) ─── */
const PRESET_KEY = 'phototools.watermark.presets.v1';
const PRESET_SKIP = new Set(['wmPhotoInput', 'logoInput', 'wmPresetName', 'wmPresetSel', 'wmShowOriginal']);
function wmPresets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY)) || {}; } catch (e) { return {}; } }
function wmPresetControls() { return [...document.querySelectorAll('.wm-page input[id], .wm-page select[id]')].filter(el => !PRESET_SKIP.has(el.id) && el.type !== 'file'); }
function wmPresetRefresh(selected) {
  const names = Object.keys(wmPresets()).sort();
  $('wmPresetSel').innerHTML = '<option value="">— no preset —</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  if (selected) $('wmPresetSel').value = selected;
}
$('wmPresetSave').addEventListener('click', () => {
  const name = $('wmPresetName').value.trim() || $('wmPresetSel').value;
  if (!name) { toast('Type a name for these settings first'); return; }
  const snap = {};
  wmPresetControls().forEach(el => { snap[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  snap.__logoMode = logoMode;
  if (logoMode === 'custom' && customLogo && customLogo.src.length < MAX_SAVED_LOGO) { snap.__logo = customLogo.src; snap.__logoName = customLogo.name; }
  const all = wmPresets(); all[name] = snap;
  try { localStorage.setItem(PRESET_KEY, JSON.stringify(all)); wmPresetRefresh(name); toast(`Settings "${name}" saved`); } catch (e) { toast('Browser storage is full or blocked'); }
});
$('wmPresetSel').addEventListener('change', async e => {
  const snap = wmPresets()[e.target.value]; if (!snap) return;
  wmPresetControls().forEach(el => {
    if (!(el.id in snap)) return;
    if (el.type === 'checkbox') el.checked = snap[el.id]; else el.value = snap[el.id];
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const epoch = ++logoEpoch;
  let mode = snap.__logoMode === 'none' || snap.__logoMode === 'default' ? 'none' : logoMode;   // 'default' only exists in presets saved by older versions
  if (snap.__logoMode === 'custom' && snap.__logo) {
    try { const img = await wmOpenImage(snap.__logo); customLogo = wmMakeLogo(img, snap.__logo, snap.__logoName || 'My logo'); mode = 'custom'; } catch (err) { mode = 'none'; }
  }
  if (epoch !== logoEpoch) return;                                     // the visitor chose a logo while this preset was loading
  logoMode = mode; wmDiscardResults();
  wmLogoRefresh();
  $('wmPresetName').value = e.target.value;
  wmToggleVisibility(); wmLive();
});
$('wmPresetDelete').addEventListener('click', () => {
  const n = $('wmPresetSel').value; if (!n) return;
  const all = wmPresets(); delete all[n]; localStorage.setItem(PRESET_KEY, JSON.stringify(all)); wmPresetRefresh(); toast(`Settings "${n}" deleted`);
});
wmPresetRefresh();

/* ─── reset to the original (source) settings ─── */
// Captured at load, before anything can be changed, so this is always the app's original default state.
const WM_DEFAULTS = {};
wmPresetControls().forEach(el => { WM_DEFAULTS[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
$('wmReset').addEventListener('click', () => {
  wmPresetControls().forEach(el => {
    if (!(el.id in WM_DEFAULTS)) return;
    if (el.type === 'checkbox') el.checked = WM_DEFAULTS[el.id]; else el.value = WM_DEFAULTS[el.id];
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $('wmPresetSel').value = ''; $('wmPresetName').value = ''; $('wmShowOriginal').checked = false;
  $('logoInput').value = '';
  logoEpoch++; logoMode = 'none'; wmLogoRefresh();                     // no logo, as at the start
  wmShowTab('watermark', document.querySelector('.wm-page .tab-btn'));
  wmToggleVisibility();
  processed = []; wmDrawGrid(); wmRefreshStatus(); wmLive();
  toast('Settings are back to the original defaults');
});

/* ─── processing ─── */
/** Decodes exactly like the original app (data URL into an <img>), so resized output stays pixel-identical. */
async function wmLoadImage(file) {
  let src;
  try { src = await readAsDataURL(file); } catch (e) { throw new Error('Cannot read ' + file.name); }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Cannot decode ' + file.name));
    img.src = src;
  });
}

async function wmProcessFile(file, s) {
  const img = await wmLoadImage(file);
  const c = $('wmWork');
  wmRender(c.getContext('2d'), img, s, 1, wmFillText(s.text, file));
  const blob = await canvasToBlob(c, s.format, s.format === 'image/png' ? undefined : s.quality);
  return blob;
}

async function wmProcessAll() {
  if (!files.length) { toast('Please add some photos first.'); return; }
  const s = getSettings(), total = files.length, bar = $('progressFill'), label = $('progressLabel');
  processed = [];
  $('progressContainer').style.display = 'block';
  $('wmStatus').textContent = 'Processing...'; $('wmStatus').className = 'wm-status-text processing';
  try {
    for (const [i, file] of files.entries()) {
      bar.style.width = Math.round(i / total * 100) + '%';
      label.textContent = `Processing ${i + 1} of ${total}: ${file.name}`;
      await new Promise(r => setTimeout(r, 0));          // let the browser paint progress between images
      processed.push({ blob: await wmProcessFile(file, s), file });
    }
    bar.style.width = '100%'; label.textContent = 'Done!';
  } catch (e) {
    toast('Could not process: ' + e.message); processed = [];
  }
  setTimeout(() => { $('progressContainer').style.display = 'none'; }, 1500);
  wmDrawGrid(); wmRefreshStatus();
}

function wmEntryNames(s) {
  const raw = processed.map((p, i) => {
    const t = wmTokens.get(p.file) || {}, d = t.DateTimeOriginal || t.CreateDate;
    const date = d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
    return fillPattern(s.namePattern, { name: baseName(p.file.name), date, n: i + 1 }) + '.' + extForType(p.blob.type);
  });
  return uniqueNames(raw);
}

async function wmZipBlob(entries, names, onProgress) {
  if (!window.JSZip) throw new Error('The ZIP library did not load');
  const zip = new JSZip();
  entries.forEach((p, i) => zip.file(names[i], p.blob));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => onProgress(Math.round(m.percent)));
}

async function wmDownloadAll() {
  const ready = processed.filter(Boolean);
  if (!ready.length) { toast('Process your images first.'); return; }
  const btn = $('downloadBtn'), original = btn.textContent, names = wmEntryNames(getSettings());
  btn.disabled = true;
  try {
    downloadBlob(await wmZipBlob(ready, names, pct => { btn.textContent = `Zipping ${pct}%`; }), 'watermarked_images.zip');
  } catch (err) {
    console.warn('Could not build a ZIP, saving the files one by one instead:', err);
    for (const [i, p] of ready.entries()) { downloadBlob(p.blob, names[i]); await new Promise(r => setTimeout(r, 400)); }
  } finally { btn.disabled = false; btn.textContent = original; }
}

$('wmProcess').addEventListener('click', wmProcessAll);
$('wmClearPhotos').addEventListener('click', wmClearPhotos);
$('downloadBtn').addEventListener('click', wmDownloadAll);
$('previewBtn').addEventListener('click', () => wmPreviewFirst());
const wmPreviewFirst = () => { if (processed[0]) window.open(URL.createObjectURL(processed[0].blob), '_blank'); };

wmLogoRefresh();                                                  // show the starting state (None) once everything above exists
