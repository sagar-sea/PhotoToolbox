/* Photo Fixer screen: non-destructive edits on a preview, full-size export, undo/redo. Maths lives in fixer-core.js. */

const Fixer = (() => {
  const F = FixerCore;
  const PREVIEW_MAX = 1100;
  const SLIDERS = [
    ['Light', [['exposure', 'Exposure', -2, 2, 0.05, v => (v > 0 ? '+' : '') + v.toFixed(2)], ['contrast', 'Contrast', -100, 100, 1], ['highlights', 'Highlights', -100, 100, 1], ['shadows', 'Shadows', -100, 100, 1]]],
    ['Colour', [['saturation', 'Saturation', -100, 100, 1], ['warmth', 'Warmth', -100, 100, 1]]],
    ['Detail', [['sharpen', 'Sharpen', 0, 100, 1]]],
  ];
  const fmt = (v, f) => (f ? f(v) : (v > 0 ? '+' : '') + Math.round(v));

  let bmp = null, name = 'photo', params = F.normalize({}), committed = F.normalize({}), undo = [], redo = [];
  let baseData = null, outW = 0, outH = 0, scale = 1, raf = 0, comparing = false;
  const view = () => $('fxCanvas');

  /* ───────── panel ───────── */
  function buildPanel() {
    const group = (title, rows) => `<div class="fx-group"><h3>${title}</h3>${rows}</div>`;
    const sliderRow = ([key, label, min, max, step, f]) => `<div class="form-group"><label for="fx-${key}">${label} <b class="val" id="fx-${key}-v"></b></label><input type="range" id="fx-${key}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="0"></div>`;
    $('fxPanel').innerHTML = `<fieldset id="fxFields" disabled>
      ${group('Quick', `<div class="fx-geo"><button class="btn btn-sm" id="fxAuto" type="button">Auto-fix</button></div><div class="looks">${Object.keys(F.LOOKS).map(k => `<button class="chip-btn" type="button" data-look="${k}">${k}</button>`).join('')}</div>`)}
      ${SLIDERS.map(([title, rows]) => group(title, rows.map(sliderRow).join(''))).join('')}
      ${group('Position', `<div class="fx-geo"><button class="chip-btn" type="button" data-geo="left">⟲ Turn left</button><button class="chip-btn" type="button" data-geo="right">⟳ Turn right</button><button class="chip-btn" type="button" data-geo="flipH">⇋ Mirror</button><button class="chip-btn" type="button" data-geo="flipV">⇵ Flip upside down</button></div>
        <div class="form-group"><label for="fx-straighten">Straighten <b class="val" id="fx-straighten-v"></b></label><input type="range" id="fx-straighten" data-key="straighten" min="-15" max="15" step="0.5" value="0"></div>`)}
      ${group('Save', `<div class="grid2"><div class="form-group"><label for="fxFormat">Format</label><select id="fxFormat"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select></div>
        <div class="form-group" id="fxQ"><label for="fxQuality">Quality <b class="val" id="fxQv">92%</b></label><input type="range" id="fxQuality" min="60" max="100" value="92"></div></div>
        <button class="btn" id="fxSave" type="button" style="width:100%">Download</button><p class="hint" id="fxSize" style="margin-top:8px"></p>`)}
    </fieldset>`;
    $('fxPanel').addEventListener('input', e => {
      const k = e.target.dataset && e.target.dataset.key;
      if (k) { params[k] = +e.target.value; paintValue(k); k === 'straighten' ? rebuildBase() : schedule(); }
      else if (e.target.id === 'fxQuality') $('fxQv').textContent = e.target.value + '%';
    });
    $('fxPanel').addEventListener('change', e => {
      const k = e.target.dataset && e.target.dataset.key;
      if (k) commit();
      else if (e.target.id === 'fxFormat') $('fxQ').hidden = e.target.value === 'image/png';
    });
    $('fxPanel').addEventListener('click', e => {
      const look = e.target.closest('[data-look]'), geo = e.target.closest('[data-geo]');
      if (look) applyLook(look.dataset.look);
      else if (geo) turn(geo.dataset.geo);
      else if (e.target.closest('#fxAuto')) autoFix();
      else if (e.target.closest('#fxSave')) save();
    });
  }
  const paintValue = k => { const el = $('fx-' + k + '-v'); if (!el) return; const row = SLIDERS.flatMap(s => s[1]).find(r => r[0] === k); el.textContent = k === 'straighten' ? (params[k] > 0 ? '+' : '') + params[k].toFixed(1) + '°' : fmt(params[k], row && row[5]); };
  function syncPanel() {
    for (const k of [...F.TONE_KEYS, 'straighten']) { const el = $('fx-' + k); if (el) el.value = params[k]; paintValue(k); }
    $('fxUndo').disabled = !undo.length; $('fxRedo').disabled = !redo.length;
  }

  /* ───────── history ───────── */
  const snap = p => JSON.stringify(F.normalize(p));
  function commit() {
    if (snap(params) === snap(committed)) return;
    undo.push(committed); redo = []; committed = F.normalize(params); syncPanel();
  }
  function restore(p, geometryChanged) { params = F.normalize(p); committed = F.normalize(p); syncPanel(); geometryChanged ? rebuildBase() : schedule(); }
  const geoDiffers = (a, b) => a.rotate !== b.rotate || a.flipH !== b.flipH || a.flipV !== b.flipV || a.straighten !== b.straighten;
  function doUndo() { if (!undo.length) return; const prev = undo.pop(), g = geoDiffers(prev, committed); redo.push(committed); restore(prev, g); }
  function doRedo() { if (!redo.length) return; const next = redo.pop(), g = geoDiffers(next, committed); undo.push(committed); restore(next, g); }

  /* ───────── actions ───────── */
  function turn(kind) {
    if (kind === 'left') params.rotate = (params.rotate + 3) % 4;
    else if (kind === 'right') params.rotate = (params.rotate + 1) % 4;
    else if (kind === 'flipH') params.flipH = !params.flipH; else params.flipV = !params.flipV;
    commit(); rebuildBase();
  }
  function applyLook(k) {
    for (const key of F.TONE_KEYS) params[key] = 0;
    Object.assign(params, F.LOOKS[k]); params = F.normalize(params); commit(); syncPanel(); schedule();
  }
  function autoFix() {
    const keep = { rotate: params.rotate, flipH: params.flipH, flipV: params.flipV, straighten: params.straighten };
    params = F.normalize({ ...F.autoFix(baseData.data), ...keep }); commit(); syncPanel(); schedule();
  }

  /* ───────── drawing ───────── */
  function drawGeometry(ctx, w, h, k, p) {
    const frame = F.frameSize(w, h, p.rotate), s = k * F.straightenScale(frame.w, frame.h, p.straighten);
    ctx.save();
    ctx.translate(Math.round(frame.w * k) / 2, Math.round(frame.h * k) / 2);
    ctx.scale(p.flipH ? -1 : 1, p.flipV ? -1 : 1);
    ctx.rotate(p.straighten * Math.PI / 180); ctx.rotate(p.rotate * Math.PI / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, -w * s / 2, -h * s / 2, w * s, h * s);
    ctx.restore();
    return { w: Math.round(frame.w * k), h: Math.round(frame.h * k) };
  }
  function rebuildBase() {
    if (!bmp) return;
    const w = bmpW(bmp), h = bmpH(bmp), frame = F.frameSize(w, h, params.rotate);
    scale = Math.min(1, PREVIEW_MAX / Math.max(frame.w, frame.h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(frame.w * scale)); c.height = Math.max(1, Math.round(frame.h * scale));
    const g = c.getContext('2d', { willReadFrequently: true });
    const size = drawGeometry(g, w, h, scale, params);
    outW = c.width; outH = c.height; baseData = g.getImageData(0, 0, outW, outH);
    const v = view(); v.width = outW; v.height = outH;
    $('fxSize').textContent = `${Math.round(frame.w)} × ${Math.round(frame.h)} px`;
    render();
  }
  function render() {
    raf = 0; if (!baseData) return;
    const g = view().getContext('2d');
    if (comparing || F.isNeutral(params)) { g.putImageData(baseData, 0, 0); return; }
    const img = new ImageData(new Uint8ClampedArray(baseData.data), outW, outH);
    F.applyAdjustments(img.data, params); F.sharpen(img.data, outW, outH, params.sharpen);
    g.putImageData(img, 0, 0);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

  /* ───────── file in / out ───────── */
  async function load(list) {
    const f = [...list].find(x => x.type.startsWith('image/')); if (!f) return;
    try { bmp = await decodeImage(f); } catch (e) { toast('This photo cannot be opened'); return; }
    name = f.name; params = F.normalize({}); committed = F.normalize({}); undo = []; redo = [];
    $('fxDrop').hidden = true; view().hidden = false; $('fxTools').hidden = false; $('fxFields').disabled = false;
    syncPanel(); rebuildBase();
  }
  async function save() {
    if (!bmp) return;
    const btn = $('fxSave'), label = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
    await new Promise(r => setTimeout(r, 30));
    try {
      const w = bmpW(bmp), h = bmpH(bmp), frame = F.frameSize(w, h, params.rotate);
      const c = document.createElement('canvas'); c.width = frame.w; c.height = frame.h;
      const g = c.getContext('2d', { willReadFrequently: true });
      const type = $('fxFormat').value;
      if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      drawGeometry(g, w, h, 1, params);
      if (!F.isNeutral(params)) { const img = g.getImageData(0, 0, c.width, c.height); F.applyAdjustments(img.data, params); F.sharpen(img.data, c.width, c.height, params.sharpen); g.putImageData(img, 0, 0); }
      downloadBlob(await canvasToBlob(c, type, type === 'image/png' ? undefined : $('fxQuality').value / 100), `${baseName(name)}_fixed.${extForType(type)}`);
      toast('Saved');
    } catch (e) { toast('Could not save: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  function init() {
    buildPanel(); syncPanel();
    $('fxInput').addEventListener('change', e => { load(e.target.files); e.target.value = ''; });
    $('fxDrop').addEventListener('click', e => { e.preventDefault(); $('fxInput').click(); });
    bindDrop($('fxStage'), load);
    $('fxUndo').onclick = doUndo; $('fxRedo').onclick = doRedo;
    $('fxReset').onclick = () => { params = F.normalize({}); commit(); syncPanel(); rebuildBase(); };
    const cmp = $('fxCompare'), on = v => () => { comparing = v; schedule(); };
    cmp.addEventListener('pointerdown', on(true)); ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(ev => cmp.addEventListener(ev, on(false)));
    document.addEventListener('keydown', e => {
      if (!$('page-fixer').classList.contains('active') || !(e.ctrlKey || e.metaKey) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range') return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
    });
    document.addEventListener('paste', e => { if ($('page-fixer').classList.contains('active') && e.clipboardData.files.length) load(e.clipboardData.files); });
  }
  init();
  return { get params() { return { ...params }; }, load, autoFix, save, undo: doUndo, redo: doRedo, get ready() { return !!bmp; } };
})();
