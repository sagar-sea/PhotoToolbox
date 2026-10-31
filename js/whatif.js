/* "What if…?" lab: change aperture, shutter, ISO, focal length or distance and see the likely result. */

const WhatIf = (() => {
  const E = Exposure;

  function render(photo, pane) {
    const s = photo.s;
    const assumed = [];
    const orig = {
      n: s.n || (assumed.push('aperture f/4'), 4),
      t: s.t || (assumed.push('shutter 1/125s'), 1 / 125),
      iso: s.iso || (assumed.push('ISO 100'), 100),
    };
    const focal = s.focal || (assumed.push('focal length 50mm'), 50);
    const crop = photo.crop || (s.focal ? (assumed.push('a full-frame sensor'), 1) : 1);
    const focal35 = s.focal35 || focal * crop;
    const distGuess = photo.flat.SubjectDistance > 0 ? Math.min(40, Math.max(0.3, photo.flat.SubjectDistance)) : null;

    const st = {
      a: E.apertureIndex(orig.n), s: E.shutterIndex(orig.t), i: E.isoIndex(orig.iso),
      zoom: 100, dist: distIndexFor(distGuess || 3), comp: 'none',
    };
    const aIdx0 = st.a, sIdx0 = st.s, iIdx0 = st.i;

    pane.innerHTML = `
      ${assumed.length ? `<div class="hint-card warn"><strong>This photo is missing some camera information.</strong><span>We used example values instead: ${esc(assumed.join(', '))}. The results are only examples.</span></div>` : ''}
      <div class="wi-layout">
        <div class="wi-controls">
          <div class="wi-chips" id="wiChips">
            <button class="chip-btn" data-sc="blur" title="Open the lens wide so the background gets blurry">Blur the background</button>
            <button class="chip-btn" data-sc="deep" title="Make the lens opening small so near and far things are both sharp">Keep everything sharp</button>
            <button class="chip-btn" data-sc="freeze" title="Use a very fast shutter to stop movement">Freeze movement</button>
            <button class="chip-btn" data-sc="dark" title="Raise the ISO so a faster shutter can be used. Costs grain.">Use high ISO</button>
            <button class="chip-btn" data-sc="reset" title="Go back to the settings of your real photo">Reset</button>
          </div>
          ${slider('wiA', term('aperture', 'Aperture (lens opening)'), E.APERTURE.min, E.APERTURE.max, 1, st.a, 'wiAv')}
          ${slider('wiS', term('shutter', 'Shutter speed'), E.SHUTTER.min, E.SHUTTER.max, 1, st.s, 'wiSv')}
          ${slider('wiI', term('iso', 'ISO (light sensitivity)'), E.ISO.min, E.ISO.max, 1, st.i, 'wiIv')}
          ${slider('wiZ', term('focal', 'Zoom (focal length)'), 50, 400, 5, st.zoom, 'wiZv')}
          ${slider('wiD', 'Distance to your subject', 0, 100, 1, st.dist, 'wiDv')}
          <div class="form-group"><label>Keep the brightness the same?</label>
            <div class="seg" id="wiComp">
              <button data-c="none" class="on">Off</button><button data-c="shutter">Use shutter</button><button data-c="iso">Use ISO</button>
            </div></div>
        </div>
        <div class="wi-view">
          <div class="wi-pair">
            <figure><canvas id="wiOrig"></canvas><figcaption>Your photo (as taken)</figcaption></figure>
            <figure><canvas id="wiNew"></canvas><figcaption id="wiNewCap">What if</figcaption></figure>
          </div>
          <div id="wiBright" class="wi-verdict"></div>
          <div id="wiOut" class="wi-out"></div>
        </div>
      </div>`;

    /* base pixels (kept small so sliders stay smooth) */
    let bmp = null;
    const cOrig = $('wiOrig'), cNew = $('wiNew');
    const MAX = 640;
    (async () => {
      try { bmp = await photo.getBitmap(); } catch (e) { $('wiBright').textContent = 'Your browser cannot open this image, so only the numbers are shown.'; }
      draw();
    })();

    function valueA() { return st.a === aIdx0 ? orig.n : E.apertureAt(st.a); }
    function valueS() { return st.s === sIdx0 ? orig.t : E.shutterAt(st.s); }
    function valueI() { return st.i === iIdx0 ? orig.iso : E.isoAt(st.i); }
    function distM() { return distFor(st.dist); }
    function sync() {
      $('wiA').value = st.a; $('wiS').value = st.s; $('wiI').value = st.i; $('wiZ').value = st.zoom; $('wiD').value = st.dist;
    }

    function compensate(changed) {
      if (st.comp === 'shutter' && changed !== 's') {
        st.s = E.clamp(E.shutterIndex(E.compensateShutter(orig, valueA(), valueI())), E.SHUTTER.min, E.SHUTTER.max);
      } else if (st.comp === 'iso' && changed !== 'i') {
        st.i = E.clamp(E.isoIndex(E.compensateISO(orig, valueA(), valueS())), E.ISO.min, E.ISO.max);
      }
    }

    function update(changed) {
      compensate(changed);
      sync();
      $('wiAv').textContent = E.formatAperture(valueA());
      $('wiSv').textContent = E.formatShutter(valueS());
      $('wiIv').textContent = E.formatISO(valueI());
      const f1 = focal * st.zoom / 100;
      $('wiZv').textContent = Math.round(f1) + 'mm' + (st.zoom === 100 ? ' (as shot)' : '');
      $('wiDv').textContent = E.formatDistance(distM() * 1000) + (distGuess && st.dist === distIndexFor(distGuess) ? ' (from photo)' : '');
      schedule();
    }

    let raf = 0;
    function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }

    function draw() {
      const cur = { n: valueA(), t: valueS(), iso: valueI() };
      const ev = E.deltaEV(orig, cur);
      const z = st.zoom / 100;
      let stats = { highlightsClipped: 0, shadowsCrushed: 0 };
      if (bmp) {
        const bw = bmpW(bmp), bh = bmpH(bmp), sc = Math.min(1, MAX / Math.max(bw, bh));
        const w = Math.round(bw * sc), h = Math.round(bh * sc);
        for (const c of [cOrig, cNew]) { c.width = w; c.height = h; }
        cOrig.getContext('2d').drawImage(bmp, 0, 0, w, h);
        const nctx = cNew.getContext('2d', { willReadFrequently: true });
        const cw = bw / Math.max(1, z), ch = bh / Math.max(1, z);        // zooming in crops the centre
        nctx.drawImage(bmp, (bw - cw) / 2, (bh - ch) / 2, cw, ch, 0, 0, w, h);
        const img = nctx.getImageData(0, 0, w, h);
        stats = E.applyExposure(img.data, { ev, isoFrom: orig.iso, isoTo: cur.iso });
        nctx.putImageData(img, 0, 0);
      }
      let msg = E.describeEV(ev);
      if (stats.highlightsClipped > 0.04) msg += `. About ${Math.round(stats.highlightsClipped * 100)}% of the picture would turn pure white, so the detail there would be lost.`;
      else if (stats.shadowsCrushed > 0.15) msg += `. About ${Math.round(stats.shadowsCrushed * 100)}% of the picture would turn pure black.`;
      $('wiBright').innerHTML = `<span class="v-big">${ev >= 0 ? '+' : '−'}${Math.abs(ev).toFixed(1)}</span> <span class="v-unit">${term('stop', 'steps of light')}</span><span class="v-msg">${esc(msg)}</span>`;
      $('wiNewCap').textContent = `With the new settings: ${E.formatAperture(cur.n)} · ${E.formatShutter(cur.t)} · ${E.formatISO(cur.iso)}${z !== 1 ? ' · ' + Math.round(focal * z) + 'mm' : ''}`;
      $('wiOut').innerHTML = outputs(cur, ev, z);
    }

    function outputs(cur, ev, z) {
      const f1 = focal * z, f351 = focal35 * z, d = distM();
      const dofO = E.depthOfField({ focal, n: orig.n, distanceMm: d * 1000, crop });
      const dofN = E.depthOfField({ focal: f1, n: cur.n, distanceMm: d * 1000, crop });
      const dofText = x => isFinite(x.far) ? `${E.formatDistance(x.near)} – ${E.formatDistance(x.far)}` : `${E.formatDistance(x.near)} – ∞`;
      const depthWord = x => !isFinite(x.far) ? 'everything farther away is sharp too' : E.formatDistance(x.total) + ' of sharp space';
      const dofChange = !isFinite(dofN.far) && isFinite(dofO.far) ? 'a lot bigger (more of the picture is sharp)' : isFinite(dofN.far) && !isFinite(dofO.far) ? 'a lot smaller (the background gets blurrier)' : (dofN.total > dofO.total * 1.15 ? 'bigger (more of the picture is sharp)' : dofN.total < dofO.total / 1.15 ? 'smaller (the background gets blurrier)' : 'about the same');

      const noiseRatio = E.noiseSigma(cur.iso) / E.noiseSigma(orig.iso);
      const noiseText = Math.abs(Math.log2(noiseRatio)) < 0.1 ? 'About the same amount of grain as your photo.' : noiseRatio > 1 ? `About ${noiseRatio.toFixed(1)} times more grain than your photo.` : `About ${(1 / noiseRatio).toFixed(1)} times less grain than your photo.`;

      const dif = E.diffraction(cur.n, crop), difO = E.diffraction(orig.n, crop);
      const lim = E.handheldLimit(f351);
      const shake = lim ? (cur.t > lim * 1.4 ? `<span class="v bad">Risky to hold in your hands. At ${Math.round(f351)}mm zoom, use ${E.formatShutter(lim)} or faster.</span>` : `<span class="v good">Fine to hold in your hands.</span>`) : '';

      const verdict = b => !b ? '–' : b.frozen ? '<span class="v good">Sharp</span>' : b.slight ? `<span class="v mid" title="Smears about ${Math.round(b.px4000)} pixels on a photo 4000 pixels wide">Slightly blurry</span>` : `<span class="v bad" title="Smears about ${Math.round(b.px4000)} pixels on a photo 4000 pixels wide">Blurry</span>`;
      const motionRows = E.SUBJECTS.map(sb => {
        const a = E.motionBlur({ t: orig.t, speed: sb.speed, distanceM: d, focal35 });
        const b = E.motionBlur({ t: cur.t, speed: sb.speed, distanceM: d, focal35: f351 });
        return `<tr><td>${sb.name}</td><td>${verdict(a)}</td><td>${verdict(b)}</td></tr>`;
      }).join('');


      const dist = E.formatDistance(d * 1000);
      const eqChips = E.equivalents(orig, orig.iso).map(r => `<span class="eq${Math.abs(Math.log2(r.n / cur.n)) < 0.2 ? ' cur' : ''}"><b>${E.formatAperture(r.n)}</b> ${E.formatShutter(r.t)}</span>`).join('');
      const more = html => `<details class="more"><summary>Why? / more info</summary>${html}</details>`;

      return `
      <div class="wi-card"><h4>${term('dof', 'Blurry background and sharp zone')}</h4>
        <p class="lead">Sharp zone: ${dofText(dofO)} <span class="arrow">→</span> <b>${dofText(dofN)}</b></p>
        <p>It gets <b>${dofChange}</b>.</p>${dofBar(dofO, dofN, d)}
        ${more(`<p class="hint">In your photo, things from ${dofText(dofO)} away look sharp (${depthWord(dofO)}). With the new settings, things from ${dofText(dofN)} away look sharp (${depthWord(dofN)}). A smaller sharp zone means a blurrier background. This assumes you focused on something ${dist} away. Use the distance slider to match your picture.</p>`)}</div>

      <div class="wi-card"><h4>Moving things and shaky hands</h4>
        <p class="lead">Shutter speed: ${E.formatShutter(orig.t)} <span class="arrow">→</span> <b>${E.formatShutter(cur.t)}</b></p>
        <p>${shake}</p>
        <table class="mini"><thead><tr><th>Moving sideways</th><th>Before</th><th>Now</th></tr></thead><tbody>${motionRows}</tbody></table>
        ${more(`<p class="hint">An estimate for something crossing the picture ${dist} away. Hover over a result to see how many pixels it smears. "Before" is your photo, "Now" is the new settings.</p>`)}</div>

      <div class="wi-card"><h4>${term('grain', 'Grain (speckles)')}</h4>
        <p class="lead">${esc(E.formatISO(orig.iso))} <span class="arrow">→</span> <b>${esc(E.formatISO(cur.iso))}</b></p>
        <p>${noiseText}</p>
        ${more(`<p class="hint">Doubling the ISO makes about 40% more grain. The preview only imitates grain, so a real camera will look a little different.</p>`)}</div>

      <div class="wi-card"><h4>${term('diffraction', 'Tiny-opening blur')}</h4>
        <p class="lead">${E.formatAperture(cur.n)}</p>
        <p>${dif.soft ? '<span class="v bad">Too small: fine details get a little soft.</span>' : '<span class="v good">Fine: no blur from the opening.</span>'}</p>
        ${more(`<p class="hint">Light bends around the edges of a very small opening and softens the picture. Most lenses are sharpest a few steps below their widest opening; very small openings (about f/16 and above) start to soften it. ${difO.soft !== dif.soft ? `Your real photo at ${E.formatAperture(orig.n)} ${difO.soft ? 'had this softness.' : 'did not have this problem.'}` : ''}</p>`)}</div>

      <div class="wi-card"><h4>Other ways to get the same brightness</h4>
        <div class="eq-grid">${eqChips}</div>
        ${more(`<p class="hint">Each pair (aperture and shutter speed) lets in the same amount of light as your photo at ${E.formatISO(orig.iso)}. Pick a wide opening for a blurry background, or a small one for a sharp scene. The highlighted one is closest to your current setting.</p>`)}</div>`;
    }

    function dofBar(o, n, focusM) {
      // The scale zooms to the zone around the focus distance so small differences are visible.
      const W = 300, ends = [o.near / 1000, n.near / 1000, focusM * 0.8];
      const fars = [o.far / 1000, n.far / 1000].filter(isFinite);
      const lo = Math.max(0.05, Math.min(...ends) * 0.9);
      const hiNat = Math.max(...fars, focusM * 1.25) * 1.1, hi = Math.min(hiNat, focusM * 8);
      const x = m => Math.max(0, Math.min(W, (m - lo) / (hi - lo) * W));
      const edge = b => isFinite(b.far) ? b.far / 1000 : hi;
      const band = (b, cls) => `<rect class="${cls}" x="${x(b.near / 1000).toFixed(1)}" y="${cls === 'o' ? 6 : 20}" width="${Math.max(2, x(edge(b)) - x(b.near / 1000)).toFixed(1)}" height="10" rx="3"/>`;
      const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => { const m = lo + (hi - lo) * f; return `<text x="${(f * W).toFixed(0)}" y="46" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}">${E.formatDistance(m * 1000)}</text>`; }).join('');
      const open = !isFinite(n.far) || !isFinite(o.far) ? '<text x="300" y="4" text-anchor="end">sharp all the way to the horizon →</text>' : '';
      return `<svg viewBox="0 0 ${W} 50" class="dof-bar" role="img" aria-label="Range of distances that look sharp">${band(o, 'o')}${band(n, 'n')}<line x1="${x(focusM)}" x2="${x(focusM)}" y1="2" y2="36"/>${ticks}${open}</svg>
        <p class="hint legend"><i class="o"></i> your photo <i class="n"></i> new settings <i class="f"></i> where you focused</p>`;
    }

    /* wiring */
    $('wiA').oninput = e => { st.a = +e.target.value; update('a'); };
    $('wiS').oninput = e => { st.s = +e.target.value; update('s'); };
    $('wiI').oninput = e => { st.i = +e.target.value; update('i'); };
    $('wiZ').oninput = e => { st.zoom = +e.target.value; update('z'); };
    $('wiD').oninput = e => { st.dist = +e.target.value; update('d'); };
    $('wiComp').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      st.comp = b.dataset.c;
      $('wiComp').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      update('none');
    };
    $('wiChips').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const sc = b.dataset.sc;
      const setComp = c => { st.comp = c; $('wiComp').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.c === c)); };
      const clampA = n => E.clamp(E.apertureIndex(n), E.APERTURE.min, E.APERTURE.max);
      if (sc === 'reset') { Object.assign(st, { a: aIdx0, s: sIdx0, i: iIdx0, zoom: 100 }); setComp('none'); update('none'); return; }
      st.a = aIdx0; st.s = sIdx0; st.i = iIdx0;
      if (sc === 'blur') { st.a = clampA(Math.min(orig.n, 1.8)); setComp('shutter'); update('a'); }
      else if (sc === 'deep') { st.a = clampA(11); setComp('shutter'); update('a'); }
      else if (sc === 'freeze') { st.s = E.clamp(E.shutterIndex(1 / 1000), E.SHUTTER.min, E.SHUTTER.max); setComp('iso'); update('s'); }
      else if (sc === 'dark') { st.i = E.clamp(E.isoIndex(6400), E.ISO.min, E.ISO.max); setComp('shutter'); update('i'); }
    };
    update('none');
  }

  function slider(id, label, min, max, step, value, valId) {
    return `<div class="form-group"><label for="${id}">${label} <b class="val" id="${valId}"></b></label>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
  }
  /** Distance slider is logarithmic: 0 → 0.3 m, 100 → 45 m. */
  const distFor = i => 0.3 * Math.pow(150, i / 100);
  const distIndexFor = m => Math.round(100 * Math.log(m / 0.3) / Math.log(150));

  return { render };
})();
