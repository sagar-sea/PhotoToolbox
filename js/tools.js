/* Convert & Compress, Crop, Collage / Contact Sheet. */

/* ════════════ shared ════════════ */
function exifDateOf(file) {
  return exifr.parse(file, ['DateTimeOriginal', 'CreateDate']).then(t => {
    const d = t && (t.DateTimeOriginal || t.CreateDate);
    return d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '';
  }).catch(() => '');
}
function bitmapToCanvas(bmp, w, h, fill) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h); }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  return c;
}

/* ════════════ CONVERT & COMPRESS ════════════ */
const Convert = (() => {
  let items = [];                      // { file, name, date, result: {blob,w,h,name} | null }

  const targetEdge = () => {
    const p = $('cvPreset').value;
    return p === 'custom' ? Math.max(64, parseInt($('cvCustom').value) || 1920) : parseInt(p);
  };
  function toggleRows() {
    $('cvQualityRow').hidden = $('cvMode').value === 'target' || $('cvFormat').value === 'image/png';
    $('cvTargetRow').hidden = $('cvMode').value !== 'target' || $('cvFormat').value === 'image/png';
    $('cvCustomRow').hidden = $('cvPreset').value !== 'custom';
  }

  async function addFiles(list) {
    for (const f of [...list]) if (f.type.startsWith('image/')) items.push({ file: f, name: f.name, date: '', result: null });
    render();
    for (const it of items) if (!it.date) it.date = await exifDateOf(it.file);
  }

  async function encode(canvas, type, q) { return canvasToBlob(canvas, type, q); }

  async function convertOne(it, o, n) {
    const bmp = await decodeImage(it.file);
    let w = bmpW(bmp), h = bmpH(bmp);
    if (o.edge && Math.max(w, h) > o.edge) { const k = o.edge / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const fill = o.type === 'image/jpeg' ? '#ffffff' : null;       // JPEG has no transparency
    let canvas = bitmapToCanvas(bmp, w, h, fill), blob;
    if (o.type === 'image/png') blob = await encode(canvas, o.type);
    else if (o.mode === 'quality') blob = await encode(canvas, o.type, o.quality);
    else {
      const limit = o.targetKB * 1024;
      for (let shrink = 0; shrink < 7; shrink++) {
        let lo = 0.3, hi = 0.95, best = null;
        for (let i = 0; i < 7; i++) {                              // binary search the quality
          const mid = (lo + hi) / 2, b = await encode(canvas, o.type, mid);
          if (b.size <= limit) { best = b; lo = mid; } else hi = mid;
        }
        if (best) { blob = best; break; }
        w = Math.round(w * 0.85); h = Math.round(h * 0.85);       // still too big: make the picture smaller
        canvas = bitmapToCanvas(bmp, w, h, fill);
        blob = await encode(canvas, o.type, 0.3);
        if (blob.size <= limit) break;
      }
    }
    if (bmp.close) bmp.close();
    const name = fillPattern(o.pattern, { name: baseName(it.name), w, h, date: it.date, n }) + '.' + extForType(o.type);
    return { blob, w, h, name };
  }

  async function run() {
    if (!items.length) { toast('Add some photos first'); return; }
    const o = { type: $('cvFormat').value, mode: $('cvMode').value, quality: $('cvQuality').value / 100, targetKB: Math.max(10, parseInt($('cvTarget').value) || 300), edge: targetEdge(), pattern: $('cvPattern').value || '{name}' };
    $('cvRun').disabled = true;
    try {
      for (let i = 0; i < items.length; i++) {
        $('cvRun').textContent = `Converting ${i + 1} of ${items.length}…`;
        await new Promise(r => setTimeout(r, 0));
        try { items[i].result = await convertOne(items[i], o, i + 1); } catch (e) { items[i].result = { error: e.message }; }
      }
      const names = uniqueNames(items.map(i => i.result && i.result.name || ''));
      items.forEach((it, i) => { if (it.result && it.result.name) it.result.name = names[i]; });
    } finally { $('cvRun').disabled = false; $('cvRun').textContent = '⚡ Convert all'; }
    render();
  }

  function render() {
    const list = $('cvList');
    if (!items.length) { list.innerHTML = ''; $('cvTotals').textContent = ''; $('cvZip').hidden = true; return; }
    let before = 0, after = 0, done = 0;
    list.innerHTML = items.map((it, i) => {
      const r = it.result;
      if (r && r.blob) { before += it.file.size; after += r.blob.size; done++; }
      const saved = r && r.blob ? Math.round((1 - r.blob.size / it.file.size) * 100) : null;
      return `<div class="result-row"><div class="r-name"><strong>${esc(it.name)}</strong>
        <small>${formatBytes(it.file.size)}${r && r.blob ? ` → ${formatBytes(r.blob.size)} · ${r.w}×${r.h}` : ''}${r && r.error ? ' · <span class="v bad">' + esc(r.error) + '</span>' : ''}</small></div>
        ${saved != null ? `<span class="badge ${saved >= 0 ? '' : 'warn'}">${saved >= 0 ? '−' + saved : '+' + Math.abs(saved)}%</span><button class="chip-btn" data-dl="${i}">⬇</button>` : ''}
        <button class="remove-btn" data-rm="${i}" aria-label="Remove ${esc(it.name)}">×</button></div>`;
    }).join('');
    $('cvTotals').textContent = done ? `${done} converted: ${formatBytes(before)} → ${formatBytes(after)} (${Math.round((1 - after / before) * 100)}% smaller)` : `${items.length} image${items.length > 1 ? 's' : ''} ready`;
    $('cvZip').hidden = !done;
  }

  async function zip() {
    const ready = items.filter(i => i.result && i.result.blob);
    const z = new JSZip(); ready.forEach(i => z.file(i.result.name, i.result.blob));
    downloadBlob(await z.generateAsync({ type: 'blob', compression: 'STORE' }), 'converted_images.zip');
  }

  $('cvInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  bindDrop($('cvDrop'), addFiles);
  ['cvMode', 'cvFormat', 'cvPreset'].forEach(id => $(id).addEventListener('change', toggleRows));
  $('cvQuality').addEventListener('input', e => { $('cvQualityVal').textContent = e.target.value + '%'; });
  $('cvRun').addEventListener('click', run);
  $('cvClear').addEventListener('click', () => { items = []; render(); });
  $('cvZip').addEventListener('click', zip);
  $('cvList').addEventListener('click', e => {
    const dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
    if (dl) { const r = items[+dl.dataset.dl].result; downloadBlob(r.blob, r.name); }
    if (rm) { items.splice(+rm.dataset.rm, 1); render(); }
  });
  toggleRows();
  return { items };
})();

/* ════════════ CROP ════════════ */
const Crop = (() => {
  const canvas = $('crCanvas'), ctx = canvas.getContext('2d');
  let bmp = null, name = 'image', ox = 0, oy = 0, drag = null;     // (ox, oy): image centre offset from canvas centre, in canvas px

  const aspect = () => { const v = $('crAspect').value; return v === 'orig' ? (bmp ? bmpW(bmp) / bmpH(bmp) : 1) : parseFloat(v); };
  const zoom = () => $('crZoom').value / 100;
  function layout() {                                 // canvas shape follows the chosen aspect ratio
    const a = aspect();
    const maxW = 900, maxH = 640;                       // use the wide preview area, but keep it on screen
    canvas.width = Math.round(a >= 1 ? Math.min(maxW, maxH * a) : maxH * a);
    canvas.height = Math.round(canvas.width / a);
  }
  function scaleFor(cw, ch) { return Math.max(cw / bmpW(bmp), ch / bmpH(bmp)) * zoom(); }
  function clampOffsets(cw, ch) {
    const s = scaleFor(cw, ch), mx = Math.max(0, (bmpW(bmp) * s - cw) / 2), my = Math.max(0, (bmpH(bmp) * s - ch) / 2);
    ox = Math.max(-mx, Math.min(mx, ox)); oy = Math.max(-my, Math.min(my, oy));
  }
  function paint(c2, cw, ch, k) {                      // k scales canvas px to output px
    const s = scaleFor(cw, ch) * k, w = bmpW(bmp) * s, h = bmpH(bmp) * s;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(bmp, (cw * k - w) / 2 + ox * k, (ch * k - h) / 2 + oy * k, w, h);
  }
  function draw() {
    if (!bmp) { ctx.fillStyle = '#181819'; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    layout(); clampOffsets(canvas.width, canvas.height);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    paint(ctx, canvas.width, canvas.height, 1);
    if ($('crGrid').checked) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < 3; i++) { ctx.moveTo(canvas.width * i / 3, 0); ctx.lineTo(canvas.width * i / 3, canvas.height); ctx.moveTo(0, canvas.height * i / 3); ctx.lineTo(canvas.width, canvas.height * i / 3); }
      ctx.stroke();
    }
    const outW = parseInt($('crWidth').value) || 1080;
    $('crInfo').textContent = `${name}: ${bmpW(bmp)}×${bmpH(bmp)} → ${outW}×${Math.round(outW / aspect())} px`;
  }
  async function load(list) {
    const f = [...list].find(x => x.type.startsWith('image/')); if (!f) return;
    try { bmp = await decodeImage(f); } catch (e) { toast(e.message); return; }
    name = f.name; ox = oy = 0; $('crZoom').value = 100; $('crZoomVal').textContent = '100%'; $('crSave').disabled = false; draw();
  }
  async function save() {
    const w = Math.max(64, parseInt($('crWidth').value) || 1080), h = Math.max(1, Math.round(w / aspect()));
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const c2 = out.getContext('2d');
    if ($('crFormat').value === 'image/jpeg') { c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, h); }
    paint(c2, canvas.width, canvas.height, w / canvas.width);
    const type = $('crFormat').value;
    downloadBlob(await canvasToBlob(out, type, 0.92), `${baseName(name)}_crop_${w}x${h}.${extForType(type)}`);
  }
  $('crInput').addEventListener('change', e => load(e.target.files));
  bindDrop($('crDrop'), load);
  ['crAspect', 'crGrid', 'crWidth'].forEach(id => $(id).addEventListener('input', () => { if (id === 'crAspect') { ox = oy = 0; } draw(); }));
  $('crZoom').addEventListener('input', e => { $('crZoomVal').textContent = e.target.value + '%'; draw(); });
  $('crSave').addEventListener('click', save);
  canvas.addEventListener('pointerdown', e => { if (!bmp) return; drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return; const r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
    ox += (e.clientX - drag.x) * k; oy += (e.clientY - drag.y) * k; drag = { x: e.clientX, y: e.clientY }; draw();
  });
  const end = () => { drag = null; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.style.cursor = 'grab';
  draw();
  return {};
})();

/* ════════════ COLLAGE / CONTACT SHEET ════════════ */
const Collage = (() => {
  const canvas = $('coCanvas');
  let items = [];                       // { file, bmp, caption }

  async function addFiles(list) {
    for (const f of [...list]) {                 // copy: the input's FileList is emptied when the input is reset
      if (!f.type.startsWith('image/')) continue;
      try {
        const bmp = await decodeImage(f);
        const t = await exifr.parse(f, ['FNumber', 'ISO', 'ExposureTime', 'FocalLength']).catch(() => null) || {};
        const parts = [t.FNumber && Exposure.formatAperture(t.FNumber), t.ExposureTime && Exposure.formatShutter(t.ExposureTime), t.ISO && 'ISO ' + t.ISO, t.FocalLength && Math.round(t.FocalLength) + 'mm'].filter(Boolean);
        items.push({ file: f, bmp, info: parts.join('  ') });
      } catch (e) { toast(e.message); }
    }
    draw();
  }
  function luminance(hex) { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); }

  function layout(W) {
    const cols = +$('coCols').value, gap = +$('coGap').value * W / 2400, aspect = +$('coShape').value, cap = $('coCaption').value;
    const cellW = (W - gap * (cols + 1)) / cols, cellH = cellW / aspect;
    const lines = cap === 'exif' ? 2 : cap === 'name' ? 1 : 0, capH = lines ? cellW * 0.075 * lines + cellW * 0.03 : 0;
    const rows = Math.max(1, Math.ceil(items.length / cols));
    return { cols, gap, cellW, cellH, capH, cap, rows, H: Math.round(gap + rows * (cellH + capH + gap)) };
  }
  function render(c, W) {
    const L = layout(W), bg = $('coBg').value;
    c.width = W; c.height = L.H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    const fg = luminance(bg) > 140 ? '#222' : '#ddd';
    items.forEach((it, i) => {
      const x = L.gap + (i % L.cols) * (L.cellW + L.gap), y = L.gap + Math.floor(i / L.cols) * (L.cellH + L.capH + L.gap);
      const bw = bmpW(it.bmp), bh = bmpH(it.bmp);
      const s = $('coFit').value === 'cover' ? Math.max(L.cellW / bw, L.cellH / bh) : Math.min(L.cellW / bw, L.cellH / bh);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, L.cellW, L.cellH); ctx.clip();
      ctx.drawImage(it.bmp, x + (L.cellW - bw * s) / 2, y + (L.cellH - bh * s) / 2, bw * s, bh * s);
      ctx.restore();
      if (L.cap !== 'none') {
        const fs = L.cellW * 0.055;
        ctx.fillStyle = fg; ctx.textBaseline = 'top'; ctx.font = `${fs}px 'DM Sans', sans-serif`;
        const fit = t => { let s2 = t; while (ctx.measureText(s2).width > L.cellW && s2.length > 4) s2 = s2.slice(0, -2); return s2 === t ? t : s2 + '…'; };
        ctx.fillText(fit(it.file.name), x, y + L.cellH + fs * 0.5);
        if (L.cap === 'exif' && it.info) { ctx.globalAlpha = 0.65; ctx.fillText(fit(it.info), x, y + L.cellH + fs * 1.7); ctx.globalAlpha = 1; }
      }
    });
  }
  function draw() {
    const W = Math.max(600, parseInt($('coWidth').value) || 2400);
    if (!items.length) { canvas.width = 800; canvas.height = 300; const c = canvas.getContext('2d'); c.fillStyle = '#181819'; c.fillRect(0, 0, 800, 300); $('coPng').disabled = $('coPdf').disabled = true; return; }
    render(canvas, Math.min(W, 1100));
    $('coInfo').textContent = `${items.length} photo${items.length > 1 ? 's' : ''} · export size ${W} × ${layout(W).H} px`;
    $('coPng').disabled = $('coPdf').disabled = false;
  }
  async function exportSheet(type) {
    const W = Math.max(600, parseInt($('coWidth').value) || 2400), c = document.createElement('canvas');
    render(c, W);
    if (type === 'png') { downloadBlob(await canvasToBlob(c, 'image/png'), 'contact-sheet.png'); return; }
    const jpg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
    downloadBlob(new Blob([makePdf(jpg, c.width, c.height)], { type: 'application/pdf' }), 'contact-sheet.pdf');
  }

  /** One-page PDF that holds a single JPEG (written by hand, no library). Page size is the image at 0.24 pt/px. */
  function makePdf(jpg, w, h) {
    const enc = new TextEncoder(), pw = +(w * 0.24).toFixed(2), ph = +(h * 0.24).toFixed(2);
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    const parts = [], offsets = [];
    let size = 0;
    const push = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); size += u.length; };
    const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Contents 5 0 R /Resources << /XObject << /Im0 4 0 R >> >> >>`);
    offsets[4] = size; push('4 0 obj\n'); push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream\nendobj\n');
    obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const xref = size;
    push('xref\n0 6\n0000000000 65535 f \n');
    for (let i = 1; i <= 5; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const out = new Uint8Array(size); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  $('coInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  bindDrop($('coDrop'), addFiles);
  ['coCols', 'coGap', 'coShape', 'coFit', 'coCaption', 'coBg', 'coWidth'].forEach(id => $(id).addEventListener('input', () => {
    $('coColsVal').textContent = $('coCols').value; $('coGapVal').textContent = $('coGap').value + 'px'; draw();
  }));
  $('coPng').addEventListener('click', () => exportSheet('png'));
  $('coPdf').addEventListener('click', () => exportSheet('pdf'));
  draw();
  return { makePdf };
})();
