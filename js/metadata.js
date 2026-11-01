/* Metadata page: batch table, single-photo report, privacy scan, tags, edit & clean, compare. */

const MetaApp = (() => {
  const photos = [];
  let nextId = 1, current = null, sortKey = 'date', sortDir = 1;
  const selected = new Set();

  const PARSE_OPTS = {
    tiff: true, ifd0: true, ifd1: false, exif: true, gps: true, interop: true, xmp: true, iptc: true, icc: true,
    jfif: true, ihdr: true, makerNote: false, userComment: true, mergeOutput: false,
    translateValues: true, reviveValues: true, sanitize: true, silentErrors: true,
  };

  /* ───────── parsing ───────── */
  const num = v => { if (Array.isArray(v)) v = v[0]; return typeof v === 'number' && isFinite(v) ? v : null; };
  const text = v => (v == null || v === '') ? null : (Array.isArray(v) ? v.join(', ') : String(v));

  function flatten(groups) {
    const flat = {};
    for (const g of ['ifd0', 'exif', 'gps', 'interop', 'xmp', 'iptc', 'jfif', 'ihdr', 'icc']) {
      const o = groups[g];
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (!(k in flat)) flat[k] = v;
    }
    return flat;
  }

  function summarize(f) {
    const spec = f.LensSpecification;
    const date = f.DateTimeOriginal || f.CreateDate || f.DateTime || null;
    return {
      make: text(f.Make), model: text(f.Model), software: text(f.Software),
      lens: text(f.LensModel || f.Lens), lensMake: text(f.LensMake), lensSerial: text(f.LensSerialNumber),
      lensSpec: Array.isArray(spec) && spec.length >= 2 ? `${spec[0]}–${spec[1]}mm` : null,
      date: date instanceof Date ? date : (date ? new Date(String(date).replace(/^(\d{4}):(\d\d):(\d\d)/, '$1-$2-$3')) : null),
      iso: num(f.ISO ?? f.ISOSpeedRatings), n: num(f.FNumber), t: num(f.ExposureTime),
      focal: num(f.FocalLength), focal35: num(f.FocalLengthIn35mmFormat ?? f.FocalLengthIn35mmFilm),
      width: num(f.ExifImageWidth ?? f.ImageWidth ?? f.PixelXDimension), height: num(f.ExifImageHeight ?? f.ImageHeight ?? f.PixelYDimension),
    };
  }

  const PRIVACY_RULES = [
    ['GPSLatitude', 'Location', 'Anyone who gets this photo can see where it was taken, such as your home or school.'],
    ['latitude', 'Location', 'Anyone who gets this photo can see where it was taken, such as your home or school.'],
    ['GPSAltitude', 'Height above sea level', 'Adds how high up you were when you took the photo.'],
    ['GPSDateStamp', 'Date from the satellite clock', 'Adds the exact date from the GPS satellite clock.'],
    ['BodySerialNumber', 'Camera serial number', 'A number that belongs only to your camera. It can be used to link your photos together.'],
    ['SerialNumber', 'Camera serial number', 'A number that belongs only to your camera. It can be used to link your photos together.'],
    ['InternalSerialNumber', 'Internal serial number', 'A number that belongs only to your camera.'],
    ['LensSerialNumber', 'Lens serial number', 'A number that belongs only to your lens.'],
    ['CameraOwnerName', 'Owner name', 'Contains the name of the camera owner.'],
    ['OwnerName', 'Owner name', 'Contains the name of the camera owner.'],
    ['Artist', 'Photographer name', 'Contains a person\'s name.'],
    ['Copyright', 'Copyright text', 'Often a name. Keep it if you want credit for your photo.'],
    ['creator', 'Creator name (extra info)', 'Contains the author\'s name.'],
    ['Creator', 'Creator name (extra info)', 'Contains the author\'s name.'],
    ['ImageUniqueID', 'Unique photo ID', 'A fixed ID number that can be used to track copies of this photo.'],
    ['HostComputer', 'Phone or computer name', 'Shows the name of the device that handled the photo.'],
    ['UserComment', 'Comment', 'Text someone typed in. It could say anything, including names or places.'],
    ['ImageDescription', 'Description', 'Text that may include names or places.'],
    ['DateTimeOriginal', 'Exact date and time', 'Shows exactly when you were there. Together with the location it can show your daily routine.'],
    ['Software', 'App or software used', 'Shows which app or phone software touched the file.'],
    ['City', 'City', 'Names the place.'], ['Sub-location', 'Place name', 'Names the place.'],
    ['By-line', 'Author name', 'Contains the author\'s name.'],
  ];
  function privacyScan(flat, gps) {
    const seen = new Set(), items = [];
    if (gps) { items.push({ label: 'Location', value: `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`, why: 'Anyone who gets this photo can see where it was taken, such as your home or school.', high: true }); seen.add('Location'); }
    for (const [key, label, why] of PRIVACY_RULES) {
      const v = flat[key];
      if (v == null || v === '' || seen.has(label)) continue;
      if (label === 'Location' || label === 'Altitude' && !gps) continue;
      seen.add(label);
      const val = v instanceof Date ? v.toLocaleString() : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      items.push({ label, value: val.slice(0, 120), why, high: /serial|owner|Location/i.test(label) });
    }
    return items;
  }

  /** The comment's exact bytes, for JPEGs. The reader's own text conversion damages non-English comments, so those are re-read here. */
  async function rawUserComment(file) {
    try {
      const head = new Uint8Array(await readAsArrayBuffer(file.slice(0, 262144)));
      let bin = ''; for (let i = 0; i < head.length; i += 8192) bin += String.fromCharCode(...head.subarray(i, i + 8192));
      return piexif.load(bin).Exif[piexif.ExifIFD.UserComment] ?? null;
    } catch (e) { return null; }                                  // not a JPEG, or no EXIF block piexif can read
  }

  async function loadFile(file) {
    const photo = { id: nextId++, file, name: file.name, url: URL.createObjectURL(file), groups: {}, flat: {}, gps: null, s: {}, privacy: [], error: null };
    try {
      const groups = await exifr.parse(file, PARSE_OPTS) || {};
      // the reader hands the comment back as its own top-level entry, in a raw form; read it as text and file it with the other shooting info
      if ('userComment' in groups) {
        let comment = groups.userComment;
        if (typeof comment === 'string' && (/^(UNICODE|JIS)/i.test(comment) || comment.includes('\ufffd'))) comment = (await rawUserComment(file)) ?? comment;
        groups.exif = { ...groups.exif, UserComment: ExifText.decodeUserComment(comment) }; delete groups.userComment;
      }
      photo.groups = groups;
      photo.flat = flatten(photo.groups);
      try {
        const g = await exifr.gps(file);
        if (g && isFinite(g.latitude) && isFinite(g.longitude)) photo.gps = g;
      } catch (e) { /* no GPS */ }
      photo.s = summarize(photo.flat);
      photo.privacy = privacyScan(photo.flat, photo.gps);
    } catch (e) {
      photo.error = e.message;
    }
    photo.crop = Exposure.cropFactor(photo.s.focal, photo.s.focal35);
    photo.bitmap = null;
    photo.getBitmap = async () => photo.bitmap || (photo.bitmap = await decodeImage(file));
    return photo;
  }

  const setCompact = on => $('uploadSection').classList.toggle('compact', on);

  async function addFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('image/') || /\.(heic|heif|tiff?|dng|cr2|nef|arw)$/i.test(f.name));
    if (!files.length) { $('metaError').innerHTML = '<div class="error">⚠️ Please choose picture files (like .jpg or .png).</div>'; return; }
    $('metaError').innerHTML = '';
    $('metaBusy').style.display = 'block';
    for (const [i, file] of files.entries()) {
      $('loadingText').textContent = `Reading photo ${i + 1} of ${files.length}…`;
      photos.push(await loadFile(file));
    }
    $('metaBusy').style.display = 'none';
    $('imageInput').value = '';
    setCompact(photos.length > 0);
    if (photos.length === 1 || (files.length === 1 && photos.length === 1)) openDetail(photos[0]);
    else showBatch();
  }

  /* ───────── formatting ───────── */
  const fmtDate = d => d && !isNaN(d) ? d.toLocaleString() : '';
  const dash = v => (v == null || v === '') ? '–' : v;
  function fmtTag(v) {
    if (v == null) return '';
    if (v === '') return '(empty)';
    if (v instanceof Date) return isNaN(v) ? String(v) : v.toISOString();
    if (v instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer)) return `[binary ${v.byteLength} bytes]`;
    if (Array.isArray(v)) return v.map(fmtTag).join(', ');
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
    return String(v);
  }
  const shutterStr = s => s.t ? Exposure.formatShutter(s.t) : null;
  const apertureStr = s => s.n ? Exposure.formatAperture(s.n) : null;

  /* ───────── batch view ───────── */
  const COLS = [
    ['name', 'File', p => p.name], ['camera', 'Camera', p => ExifText.cameraName(p.s.make, p.s.model)],
    ['lens', 'Lens', p => p.s.lens || ''], ['date', 'Taken', p => p.s.date ? p.s.date.getTime() : 0],
    ['iso', 'ISO', p => p.s.iso || 0], ['n', 'Aperture', p => p.s.n || 0], ['t', 'Shutter', p => p.s.t || 0],
    ['focal', 'Focal', p => p.s.focal || 0], ['gps', 'GPS', p => p.gps ? 1 : 0], ['privacy', 'Private items', p => p.privacy.length],
  ];

  function bar(label, count, max) {
    return `<div class="bar-row"><span>${esc(label)}</span><div class="bar"><i style="width:${max ? Math.round(count / max * 100) : 0}%"></i></div><b>${count}</b></div>`;
  }
  function bucketize(values, edges, labels) {
    const counts = labels.map(() => 0);
    for (const v of values) { if (v == null) continue; let i = edges.findIndex(e => v < e); if (i < 0) i = labels.length - 1; counts[i]++; }
    const max = Math.max(...counts, 1);
    return labels.map((l, i) => bar(l, counts[i], max)).join('');
  }
  function renderSummary() {
    const lenses = {};
    photos.forEach(p => { const l = p.s.lens || (p.s.focal ? 'Unknown lens' : null); if (l) lenses[l] = (lenses[l] || 0) + 1; });
    const topLens = Object.entries(lenses).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const withGps = photos.filter(p => p.gps).length;
    const withPrivate = photos.filter(p => p.privacy.some(i => i.high)).length;
    $('batchSummary').innerHTML = `
      <div class="summary-card"><h4>Zoom (35mm equivalent)</h4>${bucketize(photos.map(p => p.s.focal35 || p.s.focal), [24, 35, 70, 135, 300], ['Ultra-wide <24', 'Wide 24–35', 'Standard 35–70', 'Short tele 70–135', 'Tele 135–300', 'Long >300'])}</div>
      <div class="summary-card"><h4>ISO (light sensitivity)</h4>${bucketize(photos.map(p => p.s.iso), [200, 800, 3200, 6401], ['≤ 200 (clean)', '200–800', '800–3200', '> 3200 (noisy)'])}</div>
      <div class="summary-card"><h4>Lenses used</h4>${topLens.length ? topLens.map(([l, c]) => bar(l, c, topLens[0][1])).join('') : '<p class="hint">No lens information</p>'}</div>
      <div class="summary-card"><h4>Privacy</h4><p class="big">${withGps}<small> of ${photos.length} show where they were taken</small></p><p class="big">${withPrivate}<small> contain a location, camera number or name</small></p></div>`;
  }
  function renderTable() {
    const col = COLS.find(c => c[0] === sortKey) || COLS[3];
    const rows = [...photos].sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      if (typeof x !== 'string' && (!x || !y) && x !== y) return !x ? 1 : -1;     // missing values always sort last
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
    });
    const head = `<tr><th></th>${COLS.map(c => `<th data-sort="${c[0]}" class="sortable ${sortKey === c[0] ? 'sorted' : ''}">${c[1]}${sortKey === c[0] ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>`;
    $('fileTable').innerHTML = head + rows.map(p => `<tr data-id="${p.id}">
      <td><input type="checkbox" class="sel" ${selected.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)}"></td>
      <td><a href="#" class="open">${esc(p.name)}</a></td>
      <td>${esc(dash(ExifText.cameraName(p.s.make, p.s.model)))}</td><td>${esc(dash(p.s.lens))}</td>
      <td>${esc(dash(fmtDate(p.s.date)))}</td><td>${dash(p.s.iso)}</td><td>${dash(apertureStr(p.s))}</td><td>${dash(shutterStr(p.s))}</td>
      <td>${p.s.focal ? p.s.focal + 'mm' : '–'}</td><td>${p.gps ? '📍' : '–'}</td>
      <td>${p.privacy.length ? `<span class="badge ${p.privacy.some(i => i.high) ? 'warn' : ''}">${p.privacy.length}</span>` : '–'}</td></tr>`).join('');
  }
  function showBatch() {
    current = null;
    $('detailView').hidden = true; $('compareView').hidden = true;
    $('batchSection').hidden = photos.length === 0;
    $('batchCount').textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}`;
    $('btnCompare').disabled = selected.size !== 2;
    renderSummary(); renderTable();
  }

  function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCsv() {
    const head = ['File', 'Make', 'Model', 'Lens', 'Taken', 'ISO', 'Aperture', 'Shutter', 'FocalLength_mm', 'FocalLength35_mm', 'Width', 'Height', 'Latitude', 'Longitude', 'Software'];
    const lines = [head.join(',')];
    for (const p of photos) {
      const s = p.s;
      lines.push([p.name, s.make, s.model, s.lens, s.date && !isNaN(s.date) ? s.date.toISOString() : '', s.iso, s.n, s.t, s.focal, s.focal35, s.width, s.height, p.gps?.latitude, p.gps?.longitude, s.software].map(csvCell).join(','));
    }
    downloadText(lines.join('\n'), 'photo-metadata.csv', 'text/csv');
  }
  function exportJson(list = photos) {
    const out = list.map(p => ({ file: p.name, summary: p.s, gps: p.gps, privacyFindings: p.privacy, tags: JSON.parse(JSON.stringify(p.groups, (k, v) => v instanceof Uint8Array ? `[binary ${v.length} bytes]` : v)) }));
    downloadText(JSON.stringify(list.length === 1 ? out[0] : out, null, 2), list.length === 1 ? baseName(list[0].name) + '-metadata.json' : 'photo-metadata.json', 'application/json');
  }

  /* ───────── compare ───────── */
  function showCompare() {
    const [a, b] = photos.filter(p => selected.has(p.id));
    if (!a || !b) return;
    $('batchSection').hidden = true; $('detailView').hidden = true; $('compareView').hidden = false;
    const keys = [...new Set([...Object.keys(a.flat), ...Object.keys(b.flat)])].sort();
    const build = onlyDiff => keys.map(k => {
      const x = fmtTag(a.flat[k]), y = fmtTag(b.flat[k]);
      const diff = x !== y;
      if (onlyDiff && !diff) return '';
      return `<tr class="${diff ? 'diff' : ''}"><th>${esc(k)}</th><td>${esc(x.slice(0, 200))}</td><td>${esc(y.slice(0, 200))}</td></tr>`;
    }).join('');
    $('compareView').innerHTML = `
      <div class="toolbar"><button class="chip-btn" id="cmpBack">← All photos</button><span class="spacer"></span>
        <label class="check"><input type="checkbox" id="cmpOnly" checked> Show only what is different</label></div>
      <div class="compare-heads"><div><img src="${a.url}" alt=""><strong>${esc(a.name)}</strong></div><div><img src="${b.url}" alt=""><strong>${esc(b.name)}</strong></div></div>
      <div class="table-wrap"><table class="cmp"><thead><tr><th>Tag</th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead><tbody id="cmpBody">${build(true)}</tbody></table></div>`;
    $('cmpBack').onclick = showBatch;
    $('cmpOnly').onchange = e => { $('cmpBody').innerHTML = build(e.target.checked); };
  }

  /* ───────── detail view ───────── */
  function openDetail(p) {
    current = p;
    $('batchSection').hidden = true; $('compareView').hidden = true; $('detailView').hidden = false;
    $('btnBack').style.display = photos.length > 1 ? '' : 'none';
    $('detailName').textContent = p.name;
    $('previewImage').src = p.url;
    renderCards(p);
    document.querySelectorAll('.mtab').forEach(el => { el.innerHTML = ''; el.dataset.ready = ''; });
    selectTab(document.querySelector('#metaTabs .tab-btn.active')?.dataset.tab || 'overview');
    window.scrollTo({ top: 0 });
  }

  function renderCards(p) {
    const s = p.s;
    if (p.error) { $('detailCards').innerHTML = `<div class="error">⚠️ Could not read the hidden information: ${esc(p.error)}</div>`; return; }
    if (!Object.keys(p.flat).length) {
      $('detailCards').innerHTML = '<div class="error">This image has no hidden camera information. That is normal for screenshots, pictures saved from the web, and photos edited by some apps. The Image analysis tab still works.</div>';
      return;
    }
    const card = (h, v, key) => `<div class="camera-info-item"><h4>${key ? term(key, h) : esc(h)}</h4><p>${esc(dash(v))}</p></div>`;
    const pill = (label, key, value, tip) => value == null ? '' : `<span class="pill"${tip ? ` title="${esc(tip)}"` : ''}><small>${term(key, label)}</small><b>${esc(value)}</b></span>`;
    const zoomTxt = s.focal ? s.focal + 'mm' + (s.focal35 && Math.round(s.focal35) !== Math.round(s.focal) ? ` (${Math.round(s.focal35)}mm eq.)` : '') : null;
    $('detailCards').innerHTML = '<div class="camera-info">' +
      card('Camera', ExifText.cameraName(s.make, s.model)) + card('Lens', s.lens || s.lensSpec) +
      card('Taken', fmtDate(s.date)) + card('Software', s.software) +
      (s.n || s.t || s.iso || s.focal ? `<div class="camera-info-item settings-strip"><h4>Camera settings for this shot</h4><div class="pills">${pill('Aperture', 'aperture', apertureStr(s))}${pill('Shutter speed', 'shutter', shutterStr(s))}${pill('ISO', 'iso', s.iso)}${pill('Zoom', 'focal', zoomTxt, s.focal35 ? 'The 35mm equivalent tells you how it compares with a standard full-frame camera.' : '')}</div></div>` : '') +
      '</div>';
  }

  function selectTab(name) {
    document.querySelectorAll('#metaTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.mtab').forEach(el => el.classList.toggle('active', el.id === 'mt-' + name));
    const pane = $('mt-' + name);
    if (!pane.dataset.ready && current) {
      pane.dataset.ready = '1';
      ({ overview: renderOverview, whatif: p => WhatIf.render(p, pane), where: renderWhere, analysis: renderAnalysis, tags: renderTags, edit: renderEdit }[name]).call(null, current, pane);
    }
  }

  /* — overview: facts + plain-English reading — */
  function hint(kind, title, body, titleHtml) { return `<div class="hint-card ${kind}"><strong>${titleHtml || esc(title)}</strong><span>${esc(body)}</span></div>`; }
  function plainEnglish(p) {
    const s = p.s, out = [];
    if (s.t) {
      const t = s.t;
      const how = t <= 1 / 1000 ? 'an extremely short time. That freezes very fast things like birds or water splashes.'
        : t <= 1 / 250 ? 'a very short time. That is fast enough to freeze most sports and running people.'
        : t <= 1 / 60 ? 'a short time. That is fine for people standing still, but walking people may look a little blurry.'
        : t <= 1 / 4 ? 'a fairly long time. You need a tripod, and anything that moves will look smeared.'
        : 'a long time. You need a tripod, and moving things like water or car lights turn into streaks.';
      out.push(hint('', '', `The camera let light in for ${how}`, `${term('shutter', 'Shutter speed')}: ${esc(Exposure.formatShutter(t))}`));
      const lim = Exposure.handheldLimit(s.focal35 || s.focal);
      if (lim && t > lim * 1.4) out.push(hint('warn', 'Risk of a shaky photo', `At ${Math.round(s.focal35 || s.focal)}mm zoom, photos held in your hands are usually sharp only at ${Exposure.formatShutter(lim)} or faster. This photo used a slower speed, so a small hand shake could blur it.`));
    }
    if (s.n) {
      const d = s.n <= 2 ? 'very wide. Lots of light came in, and the background is very blurry, so the subject really stands out.'
        : s.n <= 5.6 ? 'fairly wide. The subject is sharp and the background is softly blurred.'
        : s.n <= 11 ? 'fairly small. Most of the scene, near and far, is sharp.'
        : 'very small. Everything is sharp from near to far, but such a tiny opening can make fine details a little soft.';
      out.push(hint('', '', `The lens opening was ${d}`, `${term('aperture', 'Aperture')}: ${esc(Exposure.formatAperture(s.n))}`));
    }
    if (s.iso) {
      const q = s.iso <= 200 ? 'The camera was not very sensitive to light, so the photo should look clean and smooth.'
        : s.iso <= 800 ? 'The photo should look clean, with very little grain.'
        : s.iso <= 3200 ? 'Expect some grain (tiny speckles), mostly in the dark parts.'
        : 'The camera was set to be very sensitive to light. That helps in the dark, but adds a lot of grain and takes away fine detail and colour.';
      out.push(hint(s.iso > 3200 ? 'warn' : '', '', q, `${term('iso', 'ISO')}: ${esc(s.iso)}`));
    }
    if (s.n && s.t && s.iso) {
      const ev100 = Math.log2(s.n * s.n / s.t) - Math.log2(s.iso / 100);
      const light = ev100 >= 14 ? 'bright sunshine' : ev100 >= 12 ? 'a bright cloudy day, or the shade on a sunny day' : ev100 >= 9 ? 'a very cloudy day or a sunset' : ev100 >= 6 ? 'a bright room indoors, or a street at dusk' : ev100 >= 3 ? 'a dim room or a street at night' : 'a very dark place, like the night sky';
      out.push(hint('', 'How bright was the place?', `From the settings, we can work out the place was about as bright as ${light}.`));
    }
    if (s.focal35) {
      const fov = 2 * Math.atan(36 / (2 * s.focal35)) * 180 / Math.PI;
      const like = s.focal35 < 24 ? 'a very wide view that fits a lot in' : s.focal35 < 40 ? 'a wide view, good for landscapes and rooms' : s.focal35 < 75 ? 'about what your own eyes see' : s.focal35 < 150 ? 'a gentle zoom, popular for portraits' : 'a strong zoom for faraway things';
      out.push(hint('', '', `This sees about ${Math.round(fov)}° of the scene from left to right. That is ${like}.`, `${term('focal', 'Zoom')}: ${Math.round(s.focal35)}mm`));
    }
    const f = p.flat;
    if (f.Flash) out.push(hint('', 'Flash', String(f.Flash)));
    if (f.WhiteBalance) out.push(hint('', 'Colour correction', `${f.WhiteBalance}. White balance is how the camera fixes the colours so white things look white.`));
    if (f.MeteringMode) out.push(hint('', 'How the light was measured', `${f.MeteringMode}. This is the way the camera checked how bright the scene was.`));
    if (f.ExposureProgram) out.push(hint('', 'Camera mode', `${f.ExposureProgram}.`));
    if (f.ExposureCompensation != null && f.ExposureCompensation !== 0) out.push(hint('', 'Brightness adjustment', `The photographer made this photo ${f.ExposureCompensation > 0 ? 'brighter' : 'darker'} than the camera would have chosen by itself (${f.ExposureCompensation > 0 ? '+' : ''}${f.ExposureCompensation} steps of light).`));
    return out;
  }
  function renderOverview(p, pane) {
    const s = p.s, f = p.flat;
    const mp = s.width && s.height ? (s.width * s.height / 1e6).toFixed(1) + ' megapixels' : null;
    const rows = [['File name', p.name], ['File size', formatBytes(p.file.size)], ['File type', p.file.type || '–'], ['Size in pixels', s.width && s.height ? `${s.width} × ${s.height}${mp ? ' (' + mp + ')' : ''}` : null],
      ['Rotation', f.Orientation], ['Colour space', f.ColorSpace], ['Lens maker', s.lensMake], ['Lens range', s.lensSpec], ['Lens serial number', s.lensSerial], ['Brightness adjustment', f.ExposureCompensation], ['Widest lens opening', f.MaxApertureValue ? 'f/' + (Math.pow(2, f.MaxApertureValue / 2)).toFixed(1) : null],
      ['Digital zoom', f.DigitalZoomRatio], ['Scene type', f.SceneCaptureType], ['Distance to subject', f.SubjectDistance ? f.SubjectDistance + ' m' : null]].filter(r => r[1] != null && r[1] !== '');
    pane.innerHTML = `<h3 class="sec">What the camera settings mean</h3><div class="hint-grid">${plainEnglish(p).join('') || '<p class="hint">This file does not contain enough camera information to explain.</p>'}</div>
      <h3 class="sec">File details</h3><div class="metadata-card"><div class="metadata-grid">${rows.map(r => `<div class="metadata-item"><strong>${esc(r[0])}</strong><span>${esc(String(r[1]))}</span></div>`).join('')}</div></div>`;
  }

  /* — location & privacy — */
  function renderWhere(p, pane) {
    const g = p.gps;
    let html = '';
    if (g) {
      const c = `${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)}`;
      const extra = [p.flat.GPSAltitude != null ? 'about ' + Math.round(p.flat.GPSAltitude) + ' m above sea level' : '', p.flat.GPSImgDirection != null ? 'camera facing ' + Math.round(p.flat.GPSImgDirection) + '° (0° is north, 90° is east)' : ''].filter(Boolean).join(' · ');
      html += `<h3 class="sec">Where was it taken?</h3>
        <div class="hint-card warn inline"><strong>This photo knows where it was taken.</strong><span>Anyone who gets the original file can find this place on a map.</span></div>
        <div class="gps-row"><code>${esc(c)}</code>
          <button class="chip-btn" id="gpsCopy">Copy location numbers</button>
          <a class="chip-btn" target="_blank" rel="noopener noreferrer" href="https://www.openstreetmap.org/?mlat=${g.latitude}&mlon=${g.longitude}#map=16/${g.latitude}/${g.longitude}">Open in OpenStreetMap ↗</a>
          <button class="chip-btn" id="mapLoad" title="The map comes from OpenStreetMap. Loading it tells that website which place you are looking at, so it only loads when you click.">🗺 Show map here</button></div>
        ${extra ? `<p class="hint">${esc(extra.charAt(0).toUpperCase() + extra.slice(1))}. The two numbers are latitude and longitude.</p>` : '<p class="hint">The two numbers are latitude and longitude.</p>'}
        <div id="mapBox" class="map-box"></div>`;
    } else html += '<div class="hint-card ok inline"><strong>No location stored. 👍</strong><span>This photo does not say where it was taken.</span></div>';

    // location and height are already shown above, so they are not repeated in the list
    const rest = p.privacy.filter(i => !(g && (i.label === 'Location' || i.label === 'Height above sea level')));
    if (rest.length) {
      html += `<h3 class="sec">Other private information in this photo</h3>
        <div class="priv-list">` +
        rest.map(i => `<div class="priv ${i.high ? 'high' : ''}"><strong>${esc(i.label)}</strong><code>${esc(i.value)}</code><span>${esc(i.why)}</span></div>`).join('') + '</div>';
    } else if (!g) {
      html += '<div class="hint-card ok inline"><strong>Good news: nothing private found.</strong><span>We did not find a location, camera serial number or name in this photo.</span></div>';
    }

    html += `<div class="clean-box"><div><h4>Make a clean copy</h4>
      <p class="hint">Saves a copy without the location, camera number, names or comments. Your original is not changed.</p>
      <label class="check"><input type="checkbox" id="keepOrient" checked> Keep the photo the right way up (recommended)</label></div>
      <div><button class="btn" id="btnStrip">⬇ Download clean copy</button></div></div>`;
    pane.innerHTML = html;

    if (g) {
      $('gpsCopy').onclick = () => navigator.clipboard.writeText(`${g.latitude}, ${g.longitude}`).then(() => toast('Location numbers copied'), () => toast('Copy failed'));
      $('mapLoad').onclick = () => {
        const box = $('mapBox'); box.innerHTML = '<div id="map" style="height:300px"></div>';
        L.Icon.Default.imagePath = 'vendor/images/';
        const map = L.map('map').setView([g.latitude, g.longitude], 15);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
        L.marker([g.latitude, g.longitude]).addTo(map);
        $('mapLoad').disabled = true;
      };
    }
    $('btnStrip').onclick = () => cleanCopy(p, $('keepOrient').checked);
  }

  async function cleanCopy(p, keepOrientation) {
    try {
      const buf = new Uint8Array(await readAsArrayBuffer(p.file));
      if (Jpeg.isJpeg(buf)) {
        let o = null; if (keepOrientation) { try { o = await exifr.orientation(p.file); } catch (e) { /* none */ } }
        downloadBlob(new Blob([Jpeg.strip(buf, { keepOrientation: o })], { type: 'image/jpeg' }), baseName(p.name) + '_clean.jpg');
        toast('Clean copy saved');
      } else {
        const bmp = await p.getBitmap();
        const c = document.createElement('canvas'); c.width = bmpW(bmp); c.height = bmpH(bmp); c.getContext('2d').drawImage(bmp, 0, 0);
        const type = p.file.type === 'image/webp' ? 'image/webp' : p.file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        downloadBlob(await canvasToBlob(c, type, 0.95), baseName(p.name) + '_clean.' + extForType(type));
        toast('Clean copy saved (re-encoded)');
      }
    } catch (e) { toast('Could not clean this file: ' + e.message); }
  }

  /* — image analysis — */
  async function renderAnalysis(p, pane) {
    pane.innerHTML = '<div class="busy"><div class="busy-ring"></div><p>Looking at the picture…</p></div>';
    let bmp;
    try { bmp = await p.getBitmap(); } catch (e) { pane.innerHTML = `<div class="error">This image cannot be opened by your browser (${esc(e.message)}).</div>`; return; }
    const scale = Math.min(1, 512 / Math.max(bmpW(bmp), bmpH(bmp)));
    const w = Math.max(1, Math.round(bmpW(bmp) * scale)), h = Math.max(1, Math.round(bmpH(bmp) * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const hist = Analysis.histogram(data), pal = Analysis.palette(data, 6), st = Analysis.exposureStats(hist.y);
    const notes = Analysis.lint(st, Analysis.sharpness(data, w, h));
    const d = Analysis.describeHistogram(hist.y);
    const pct = v => Math.round(v * 100) + '%';
    pane.innerHTML = `<h3 class="sec">Brightness chart (histogram)</h3>
      <p class="hint" style="margin:0 0 10px">Dark dots sit on the left, bright dots on the right. The taller the hill, the more dots.</p>
      <canvas id="histCanvas" width="720" height="260" class="hist" role="img" aria-label="Brightness chart of the photo"></canvas>
      <label class="check"><input type="checkbox" id="histColors"> Also show the colour lines (red, green and blue)</label>
      <div id="histLegend" class="legend-row" hidden><span><i style="background:#ff6b6b"></i>Red line: how bright the red light is</span><span><i style="background:#5dffb0"></i>Green line: how bright the green light is</span><span><i style="background:#6aa8ff"></i>Blue line: how bright the blue light is</span></div>
      <div class="hint-card ok"><strong>What this chart says about your photo</strong><span>${esc(d.summary)} ${esc(d.points.join(' '))}</span></div>
      <div class="tone-bar" aria-label="Share of dark, middle and bright areas"><div class="t-dark" style="flex:${d.regions.dark}">Dark ${pct(d.regions.dark)}</div><div class="t-mid" style="flex:${d.regions.mid}">Middle ${pct(d.regions.mid)}</div><div class="t-bright" style="flex:${d.regions.bright}">Bright ${pct(d.regions.bright)}</div></div>
      <h3 class="sec">Quality check</h3><div class="hint-grid">${notes.map(n => hint(n.kind === 'warn' ? 'warn' : n.kind === 'ok' ? 'ok' : '', n.title, n.text)).join('')}</div>
      <h3 class="sec">Main colours in your photo</h3><div class="swatches">${pal.map(c => `<button class="swatch" style="background:${c.hex}" data-hex="${c.hex}" title="Click to copy ${c.hex}"><span>${c.hex}<br>${Math.round(c.share * 100)}% of the photo</span></button>`).join('')}</div>`;
    const redraw = () => { const on = $('histColors').checked; $('histLegend').hidden = !on; drawHistogram($('histCanvas'), hist, { colors: on, edges: { low: d.regions, st } }); };
    $('histColors').onchange = redraw; redraw();
    pane.querySelectorAll('.swatch').forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.hex).then(() => toast('Copied ' + b.dataset.hex)));
  }

  /** Brightness chart with labelled zones, a black-to-white axis and optional colour lines. */
  function drawHistogram(canvas, h, opts = {}) {
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const L = 40, R = 10, T = 26, B = 46, pw = W - L - R, ph = H - T - B;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#181819'; ctx.fillRect(0, 0, W, H);
    // zones
    const zones = [['Shadows (dark)', 0, 64, 'rgba(255,255,255,0.00)'], ['Midtones (medium)', 64, 192, 'rgba(255,255,255,0.04)'], ['Highlights (bright)', 192, 256, 'rgba(255,255,255,0.00)']];
    ctx.font = '12px "DM Sans", sans-serif'; ctx.textAlign = 'center';
    for (const [name, a, b, fill] of zones) {
      const x0 = L + a / 256 * pw, x1 = L + b / 256 * pw;
      ctx.fillStyle = fill; ctx.fillRect(x0, T, x1 - x0, ph);
      ctx.fillStyle = '#9a9aa0'; ctx.fillText(name, (x0 + x1) / 2, T - 9);
    }
    ctx.strokeStyle = '#3a3a40'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    for (const v of [64, 192]) { const x = L + v / 256 * pw; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); }
    ctx.setLineDash([]);
    // axes
    ctx.strokeStyle = '#55555c'; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, T + ph); ctx.lineTo(L + pw, T + ph); ctx.stroke();
    // y label
    ctx.save(); ctx.translate(14, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = '#9a9aa0'; ctx.textAlign = 'center'; ctx.fillText('Number of dots (more ↑)', 0, 0); ctx.restore();
    // scale: ignore the very first/last bins so a pile-up at the edge does not flatten everything else
    let max = 1; for (let i = 2; i < 254; i++) max = Math.max(max, h.y[i], opts.colors ? Math.max(h.r[i], h.g[i], h.b[i]) : 0);
    const X = i => L + (i + 0.5) / 256 * pw, Y = v => T + ph - Math.min(1, v / max) * ph;
    const path = arr => { ctx.beginPath(); ctx.moveTo(X(0), T + ph); for (let i = 0; i < 256; i++) ctx.lineTo(X(i), Y(arr[i])); ctx.lineTo(X(255), T + ph); };
    path(h.y); ctx.fillStyle = 'rgba(232,255,71,0.30)'; ctx.fill(); ctx.strokeStyle = '#e8ff47'; ctx.lineWidth = 1.6; ctx.stroke();
    if (opts.colors) {
      for (const [arr, col] of [[h.r, '#ff6b6b'], [h.g, '#5dffb0'], [h.b, '#6aa8ff']]) { path(arr); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke(); }
    }
    // pile-ups at the edges are called out
    const total = h.y.reduce((a, b) => a + b, 0) || 1;
    const edge = (from, to) => { let n = 0; for (let i = from; i <= to; i++) n += h.y[i]; return n / total; };
    const callout = (x, align, text) => { ctx.fillStyle = '#ff6b6b'; ctx.textAlign = align; ctx.font = 'bold 12px "DM Sans", sans-serif'; ctx.fillText(text, x, T + 16); };
    if (edge(0, 5) > 0.02) callout(L + 6, 'left', '◀ pure black: ' + Math.round(edge(0, 5) * 100) + '%');
    if (edge(250, 255) > 0.02) callout(L + pw - 6, 'right', 'pure white: ' + Math.round(edge(250, 255) * 100) + '% ▶');
    // black -> white axis bar
    const g = ctx.createLinearGradient(L, 0, L + pw, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
    ctx.fillStyle = g; ctx.fillRect(L, T + ph + 6, pw, 12);
    ctx.strokeStyle = '#55555c'; ctx.strokeRect(L, T + ph + 6, pw, 12);
    ctx.font = '12px "DM Sans", sans-serif'; ctx.fillStyle = '#9a9aa0';
    ctx.textAlign = 'left'; ctx.fillText('Black', L, T + ph + 34);
    ctx.textAlign = 'center'; ctx.fillText('Brightness of each dot', L + pw / 2, T + ph + 34);
    ctx.textAlign = 'right'; ctx.fillText('White', L + pw, T + ph + 34);
  }

  /* — all tags — */
  const GROUP_NAMES = { ifd0: 'Main camera info', exif: 'Shooting settings', gps: 'Location (GPS)', interop: 'Compatibility info', xmp: 'Extra info (XMP)', iptc: 'Photographer info (IPTC)', icc: 'Colour profile', jfif: 'File format info', ihdr: 'PNG image info' };
  function renderTags(p, pane) {
    const groups = Object.entries(p.groups).filter(([, o]) => o && typeof o === 'object' && Object.keys(o).length);
    if (!groups.length) { pane.innerHTML = '<p class="hint">This file has no hidden information to list.</p>'; return; }
    pane.innerHTML = `<div class="toolbar"><input type="search" id="tagSearch" placeholder="Search (for example: ISO, lens, GPS)…"><span class="spacer"></span>
      <button class="chip-btn" id="tagJson">⬇ Save as JSON file</button><button class="chip-btn" id="tagCopy">Copy as text</button></div><div id="tagList"></div>`;
    const draw = q => {
      q = q.trim().toLowerCase();
      $('tagList').innerHTML = groups.map(([g, o]) => {
        const rows = Object.entries(o).filter(([k, v]) => !q || k.toLowerCase().includes(q) || fmtTag(v).toLowerCase().includes(q));
        if (!rows.length) return '';
        return `<div class="metadata-card"><h3>${esc(GROUP_NAMES[g] || g.toUpperCase())} <small>${rows.length} items</small></h3><div class="tag-table">${rows.map(([k, v]) => { const s = fmtTag(v); return `<div class="tag-row"><strong>${esc(k)}</strong><span title="${esc(s.slice(0, 600))}">${esc(s.length > 300 ? s.slice(0, 300) + '…' : s)}</span></div>`; }).join('')}</div></div>`;
      }).join('') || '<p class="hint">Nothing matches your search.</p>';
    };
    draw('');
    $('tagSearch').oninput = e => draw(e.target.value);
    $('tagJson').onclick = () => exportJson([p]);
    $('tagCopy').onclick = () => navigator.clipboard.writeText(JSON.stringify(p.flat, (k, v) => v instanceof Uint8Array ? `[binary ${v.length} bytes]` : v, 2)).then(() => toast('Copied'));
  }

  /* — edit & write back (JPEG only) — */
  const pad = n => String(n).padStart(2, '0');
  function parseExifDate(s) { const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; }
  function toExifDate(d) { return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
  const binStr = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
  const strBin = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };

  async function renderEdit(p, pane) {
    const buf = new Uint8Array(await readAsArrayBuffer(p.file));
    if (!Jpeg.isJpeg(buf)) { pane.innerHTML = '<p class="hint">Editing only works for JPEG photos. For other file types, use "Make a clean copy" on the Location &amp; privacy tab.</p>'; return; }
    if (typeof piexif === 'undefined') { pane.innerHTML = '<p class="error">The edit library did not load.</p>'; return; }
    let exif;
    try { exif = piexif.load(binStr(buf)); } catch (e) {
      // Never write a rebuilt EXIF block from nothing: that would silently drop the file's other tags.
      pane.innerHTML = `<div class="hint-card warn"><strong>This photo cannot be edited safely.</strong><span>Its hidden information is stored in an unusual way (${esc(e.message)}), so editing could damage it. You can still use "Make a clean copy" on the Location &amp; privacy tab.</span></div>`;
      return;
    }
    const zero = exif['0th'], ex = exif.Exif;
    pane.innerHTML = `<div class="edit-grid">
      <div class="form-group"><label>Photographer name</label><input type="text" id="edArtist" value="${esc(zero[piexif.ImageIFD.Artist] || '')}"></div>
      <div class="form-group"><label>Copyright text</label><input type="text" id="edCopy" value="${esc(zero[piexif.ImageIFD.Copyright] || '')}"></div>
      <div class="form-group wide"><label>Description</label><input type="text" id="edDesc" value="${esc(zero[piexif.ImageIFD.ImageDescription] || '')}"></div></div>
      <h3 class="sec">Fix the date and time</h3>
      <p class="hint">Was the camera clock wrong? Move the date and time of this photo forward (use a plus number) or backward (use a minus number). Example: if the photo shows a time 5 hours too late, type -5 in Hours.</p>
      <div class="edit-grid">
        <div class="form-group"><label>Days</label><input type="number" id="shDays" value="0"></div>
        <div class="form-group"><label>Hours</label><input type="number" id="shHours" value="0"></div>
        <div class="form-group"><label>Minutes</label><input type="number" id="shMins" value="0"></div></div>
      <p class="hint" id="shPreview"></p>
      <label class="check"><input type="checkbox" id="edGps"> Remove the location (GPS)</label>
      <label class="check"><input type="checkbox" id="edThumb"> Remove the tiny preview picture stored inside the file (thumbnail)</label>
      <div style="margin-top:14px"><button class="btn" id="edSave">⬇ Download edited copy</button></div>
      <p class="hint">The picture itself is not changed, so there is no loss in quality.</p>`;
    const origDate = parseExifDate(ex[piexif.ExifIFD.DateTimeOriginal] || zero[piexif.ImageIFD.DateTime]);
    const shift = () => ((+$('shDays').value || 0) * 1440 + (+$('shHours').value || 0) * 60 + (+$('shMins').value || 0)) * 60000;
    const upd = () => { $('shPreview').textContent = origDate ? `Time stored now: ${origDate.toLocaleString()}  →  new time: ${new Date(origDate.getTime() + shift()).toLocaleString()}` : 'This photo has no date and time stored, so there is nothing to move.'; };
    ['shDays', 'shHours', 'shMins'].forEach(id => $(id).oninput = upd); upd();

    $('edSave').onclick = () => {
      try {
        const e2 = JSON.parse(JSON.stringify(exif));
        const setOrDel = (ifd, tag, v) => { if (v) e2[ifd][tag] = v; else delete e2[ifd][tag]; };
        setOrDel('0th', piexif.ImageIFD.Artist, $('edArtist').value);
        setOrDel('0th', piexif.ImageIFD.Copyright, $('edCopy').value);
        setOrDel('0th', piexif.ImageIFD.ImageDescription, $('edDesc').value);
        const ms = shift();
        if (ms) {
          const move = (ifd, tag) => { const d = parseExifDate(e2[ifd][tag]); if (d) e2[ifd][tag] = toExifDate(new Date(d.getTime() + ms)); };
          move('0th', piexif.ImageIFD.DateTime); move('Exif', piexif.ExifIFD.DateTimeOriginal); move('Exif', piexif.ExifIFD.DateTimeDigitized);
        }
        if ($('edGps').checked) e2.GPS = {};
        if ($('edThumb').checked) { e2['1st'] = {}; delete e2.thumbnail; }
        const bytes = piexif.dump(e2);
        const out = piexif.insert(bytes, binStr(buf));
        downloadBlob(new Blob([strBin(out)], { type: 'image/jpeg' }), baseName(p.name) + '_edited.jpg');
        toast('Edited copy saved');
      } catch (err) { toast('Could not save the changes: ' + err.message); }
    };
  }

  /* ───────── wiring ───────── */
  function init() {
    $('imageInput').addEventListener('change', e => addFiles(e.target.files));
    bindDrop($('metaPickLabel'), addFiles);
    bindDrop($('page-metadata'), addFiles);          // drop anywhere on the page, not only on the bar
    document.addEventListener('paste', e => { if ($('page-metadata').classList.contains('active') && e.clipboardData.files.length) addFiles(e.clipboardData.files); });
    $('metaTabs').addEventListener('click', e => { const b = e.target.closest('.tab-btn'); if (b) selectTab(b.dataset.tab); });
    $('btnBack').onclick = showBatch;
    $('btnCsv').onclick = exportCsv; $('btnJson').onclick = () => exportJson();
    $('btnCompare').onclick = showCompare;
    $('btnClear').onclick = () => { setCompact(false); photos.forEach(p => URL.revokeObjectURL(p.url)); photos.length = 0; selected.clear(); current = null; $('batchSection').hidden = true; $('detailView').hidden = true; $('compareView').hidden = true; };
    $('fileTable').addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (th) { sortDir = sortKey === th.dataset.sort ? -sortDir : 1; sortKey = th.dataset.sort; renderTable(); return; }
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const p = photos.find(x => x.id === +tr.dataset.id);
      if (e.target.classList.contains('sel')) {
        e.target.checked ? selected.add(p.id) : selected.delete(p.id);
        $('btnCompare').disabled = selected.size !== 2; return;
      }
      if (e.target.closest('a.open')) { e.preventDefault(); openDetail(p); }
    });
  }
  init();
  return { photos, addFiles };
})();
