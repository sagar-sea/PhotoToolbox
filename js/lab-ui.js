/* Learning Lab screen: draws the layered sample scene and wires lessons and challenges (logic lives in lab.js). */

const LabUI = (() => {
  const L = Lab, E = Exposure;
  const KEY = 'phototools.lab.v1';
  const W = 720, H = 480, PAD = 60, LW = W + 2 * PAD, LH = H + 2 * PAD;

  let st = L.defaultState(), mode = 'learn', lessonId = L.LESSONS[0].id, challengeId = null, balanceMode = 'off';
  let hintsShown = 0, lastWinId = null;
  let progress = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || { stars: {} }; } catch (e) { return { stars: {} }; } })();
  const saveProgress = () => { try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* storage blocked */ } };

  /* ───────── the sample scene, drawn once as three depth layers ───────── */
  let layers = null;
  const canvasOf = () => { const c = document.createElement('canvas'); c.width = LW; c.height = LH; return c; };
  function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function drawFar() {
    const c = canvasOf(), g = c.getContext('2d'), horizon = PAD + H * 0.52;
    const sky = g.createLinearGradient(0, 0, 0, horizon); sky.addColorStop(0, '#4f9ad6'); sky.addColorStop(1, '#d4e9f3');
    g.fillStyle = sky; g.fillRect(0, 0, LW, horizon + 2);
    const sunX = PAD + W * 0.78, sunY = PAD + H * 0.2, glow = g.createRadialGradient(sunX, sunY, 8, sunX, sunY, 120);
    glow.addColorStop(0, 'rgba(255,244,200,.95)'); glow.addColorStop(1, 'rgba(255,244,200,0)'); g.fillStyle = glow; g.fillRect(0, 0, LW, horizon);
    g.fillStyle = '#fff6d6'; g.beginPath(); g.arc(sunX, sunY, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.8)';
    for (const [x, y, s] of [[0.18, 0.12, 1], [0.42, 0.2, 0.8], [0.62, 0.1, 0.7]]) for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(PAD + W * x + i * 26 * s, PAD + H * y + (i % 2) * 7, 38 * s, 15 * s, 0, 0, Math.PI * 2); g.fill(); }
    const r = rng(11), range = (base, amp, color, snow) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, horizon + 2);
      let x = 0, peaks = [];
      while (x <= LW) { const y = base - amp * (0.35 + 0.65 * r()); g.lineTo(x, y); peaks.push([x, y]); x += 40 + r() * 50; }
      g.lineTo(LW, horizon + 2); g.closePath(); g.fill();
      if (snow) { g.fillStyle = 'rgba(255,255,255,.9)'; for (const [px, py] of peaks) if (py < base - amp * 0.8) { g.beginPath(); g.moveTo(px, py); g.lineTo(px - 14, py + 20); g.lineTo(px + 14, py + 20); g.closePath(); g.fill(); } }
    };
    range(horizon - 6, 120, '#7f9bb8', true); range(horizon + 4, 70, '#4f7d86', false);
    const meadow = g.createLinearGradient(0, horizon, 0, LH); meadow.addColorStop(0, '#8dbb6d'); meadow.addColorStop(1, '#5f9249');
    g.fillStyle = meadow; g.fillRect(0, horizon, LW, LH - horizon);
    return c;
  }
  function drawMid() {
    const c = canvasOf(), g = c.getContext('2d'), road0 = PAD + H * 0.64, road1 = PAD + H * 0.76, cx = PAD + W * 0.5;
    g.fillStyle = '#6b6258'; g.fillRect(0, road0, LW, road1 - road0);
    g.fillStyle = 'rgba(255,255,255,.7)'; for (let x = -20; x < LW; x += 70) g.fillRect(x, (road0 + road1) / 2 - 2, 38, 4);
    const r = 36, wy = road1 - r - 4;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const wx of [cx - 62, cx + 62]) {                       // wheels
      g.strokeStyle = '#1d1a16'; g.lineWidth = 6; g.beginPath(); g.arc(wx, wy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(29,26,22,.45)'; g.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + Math.cos(a) * r, wy + Math.sin(a) * r); g.stroke(); }
    }
    g.strokeStyle = '#135e63'; g.lineWidth = 6;                  // frame
    const bb = [cx - 4, wy + 2], seat = [cx - 36, wy - 54], bar = [cx + 50, wy - 58];
    g.beginPath(); g.moveTo(cx - 62, wy); g.lineTo(...bb); g.lineTo(...seat); g.lineTo(cx - 62, wy); g.moveTo(...seat); g.lineTo(...bar); g.lineTo(...bb); g.moveTo(...bar); g.lineTo(cx + 62, wy); g.stroke();
    g.strokeStyle = '#2a2420'; g.lineWidth = 12; g.beginPath(); g.moveTo(...seat); g.lineTo(cx + 14, wy - 40); g.lineTo(cx - 4, wy + 6); g.stroke();   // leg
    g.strokeStyle = '#d8412b'; g.lineWidth = 24; g.beginPath(); g.moveTo(cx - 34, wy - 66); g.lineTo(cx + 24, wy - 106); g.stroke();              // jersey
    g.strokeStyle = '#e8b896'; g.lineWidth = 9; g.beginPath(); g.moveTo(cx + 22, wy - 102); g.lineTo(...bar); g.stroke();                         // arm
    g.fillStyle = '#e8b896'; g.beginPath(); g.arc(cx + 38, wy - 122, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#135e63'; g.beginPath(); g.arc(cx + 38, wy - 125, 15, Math.PI, Math.PI * 2); g.fill();                                         // helmet
    return c;
  }
  function drawNear() {
    const c = canvasOf(), g = c.getContext('2d'), r = rng(5);
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {                               // grass blades
      const x = r() * LW, h = 40 + r() * 70; g.strokeStyle = `hsl(${95 + r() * 30} 45% ${28 + r() * 14}%)`; g.lineWidth = 2 + r() * 2;
      g.beginPath(); g.moveTo(x, LH); g.quadraticCurveTo(x + (r() - 0.5) * 30, LH - h * 0.6, x + (r() - 0.5) * 40, LH - h); g.stroke();
    }
    const flowers = []; for (let i = 0; i < 16; i++) flowers.push({ x: PAD * 0.4 + r() * (LW - PAD * 0.8), y: PAD + H * (0.74 + r() * 0.2), s: 16 + r() * 22, daisy: r() > 0.55 });
    flowers.sort((a, b) => a.y - b.y);
    for (const f of flowers) {
      g.strokeStyle = '#3f7a35'; g.lineWidth = 4; g.beginPath(); g.moveTo(f.x, LH); g.lineTo(f.x + 3, f.y); g.stroke();
      const petals = f.daisy ? 10 : 5;
      for (let i = 0; i < petals; i++) { const a = i / petals * Math.PI * 2; g.fillStyle = f.daisy ? '#fffdf5' : '#d8412b'; g.beginPath(); g.ellipse(f.x + Math.cos(a) * f.s * 0.55, f.y + Math.sin(a) * f.s * 0.55, f.s * 0.5, f.s * (f.daisy ? 0.18 : 0.42), a, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = f.daisy ? '#f2b705' : '#2a1a12'; g.beginPath(); g.arc(f.x, f.y, f.s * 0.28, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#3d7a35'; g.beginPath(); g.ellipse(26, LH - 20, 80, 26, -0.5, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(LW - 20, LH - 10, 90, 28, 0.5, 0, Math.PI * 2); g.fill();
    return c;
  }
  const ensureLayers = () => layers || (layers = { far: drawFar(), mid: drawMid(), near: drawNear() });

  /* ───────── effects ───────── */
  const hasFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
  const tmp = () => { const c = document.createElement('canvas'); c.width = LW; c.height = LH; return c; };
  function blur(src, sigma) {
    if (sigma < 0.4) return src;
    const out = tmp(), g = out.getContext('2d');
    if (hasFilter) { g.filter = `blur(${sigma.toFixed(2)}px)`; g.drawImage(src, 0, 0); g.filter = 'none'; return out; }
    const k = Math.max(1, Math.round(sigma * 0.9)), small = document.createElement('canvas');   // fallback: shrink then enlarge
    small.width = Math.ceil(LW / k); small.height = Math.ceil(LH / k);
    small.getContext('2d').drawImage(src, 0, 0, small.width, small.height); g.imageSmoothingQuality = 'high'; g.drawImage(small, 0, 0, LW, LH); return out;
  }
  function smear(src, px) {
    if (px < 1) return src;
    const out = tmp(), g = out.getContext('2d'), n = Math.min(26, Math.max(3, Math.ceil(px / 1.5)));
    for (let i = 0; i < n; i++) { g.globalAlpha = 1 / (i + 1); g.drawImage(src, (i / (n - 1) - 0.5) * px, 0); }
    return out;
  }

  const view = () => $('labCanvas');
  function render() {
    const canvas = view(); if (!canvas || !$('page-lab').classList.contains('active')) return;   // nothing to draw while hidden
    const ls = ensureLayers(), m = L.metrics(st), ex = L.SCENE.exaggeration, zoom = st.focal / 50;
    const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
    const g = comp.getContext('2d');
    for (const key of ['far', 'mid', 'near']) {
      let src = ls[key];
      if (key === 'mid') src = smear(src, Math.min(110, m.riderSmear4000 * W / L.SCENE.realPx * 1.8));
      src = blur(src, Math.min(34, m.layers[key].px720 * ex / 2));
      g.save(); g.translate(W / 2, H / 2); g.scale(zoom, zoom); g.drawImage(src, -LW / 2, -LH / 2); g.restore();
    }
    const soften = Math.max(m.shake4000 * W / L.SCENE.realPx * 2.2, m.diffractionSoft ? 0.9 : 0);
    let final = comp;
    if (soften > 0.4) { const t = tmp(); t.width = W; t.height = H; const tg = t.getContext('2d'); if (hasFilter) { tg.filter = `blur(${soften.toFixed(2)}px)`; tg.drawImage(comp, 0, 0); tg.filter = 'none'; final = t; } }
    const out = canvas.getContext('2d', { willReadFrequently: true });
    out.drawImage(final, 0, 0);
    const img = out.getImageData(0, 0, W, H);
    E.applyExposure(img.data, { ev: m.brightness, isoFrom: 100, isoTo: st.iso, seed: 7 });
    out.putImageData(img, 0, 0);
    paintBadges(m); paintSide(m);
  }
  let raf = 0; const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  function paintBadges(m) {
    $('labSettings').textContent = `${E.formatAperture(st.n)} · ${E.formatShutter(st.t)} · ${E.formatISO(st.iso)} · ${Math.round(st.focal)}mm`;
    const b = m.brightness, a = Math.abs(b), el = $('labBright');
    el.className = 'film-badge br ' + (a <= 0.5 ? 'ok' : a <= 1 ? 'mid' : 'bad');
    el.textContent = a <= 0.5 ? 'Exposure just right' : `${b > 0 ? 'Too bright' : 'Too dark'} ${b > 0 ? '+' : '−'}${a.toFixed(1)}`;
  }

  /* ───────── controls ───────── */
  const slider = (id, label, min, max, step) => `<div class="form-group"><label for="${id}">${label} <b class="val" id="${id}v"></b></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"></div>`;
  function buildControls() {
    $('labControls').innerHTML =
      slider('labA', term('aperture', 'Aperture'), E.APERTURE.min + 2, E.APERTURE.max - 2, 1) + slider('labS', term('shutter', 'Shutter'), E.SHUTTER.min, E.SHUTTER.max, 1) +
      slider('labI', term('iso', 'ISO'), E.ISO.min, E.ISO.max, 1) + slider('labZ', term('focal', 'Zoom'), 50, 135, 5) +
      `<div class="full">
        <span class="mini-field"><label for="labFocus">Focus on</label><select id="labFocus">${Object.entries(L.FOCUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></span>
        <span class="mini-field"><label for="labLight">Light</label><select id="labLight">${Object.entries(L.LIGHTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></span>
        <span class="mini-field"><label>Auto-balance</label><span class="seg" id="labBal"><button data-b="off" class="on">Off</button><button data-b="shutter">Shutter</button><button data-b="iso">ISO</button></span></span>
        <label class="check" style="margin:0"><input type="checkbox" id="labHand"> Hand-held</label>
      </div>`;
    const apply = (patch, changed) => { Object.assign(st, patch); if (balanceMode !== 'off' && changed !== (balanceMode === 'shutter' ? 't' : 'iso')) st = L.balance(st, balanceMode); sync(); schedule(); };
    $('labA').oninput = e => apply({ n: E.apertureAt(+e.target.value) }, 'n');
    $('labS').oninput = e => apply({ t: E.shutterAt(+e.target.value) }, 't');
    $('labI').oninput = e => apply({ iso: E.isoAt(+e.target.value) }, 'iso');
    $('labZ').oninput = e => apply({ focal: +e.target.value }, 'focal');
    $('labFocus').onchange = e => apply({ focus: e.target.value }, 'focus');
    $('labLight').onchange = e => apply({ light: e.target.value }, 'light');
    $('labHand').onchange = e => apply({ handheld: e.target.checked }, 'handheld');
    $('labBal').onclick = e => { const b = e.target.closest('button'); if (!b) return; setBalance(b.dataset.b); apply({}, 'bal'); };
  }
  function setBalance(b) { balanceMode = b; document.querySelectorAll('#labBal button').forEach(x => x.classList.toggle('on', x.dataset.b === b)); }
  function sync() {
    $('labA').value = E.apertureIndex(st.n); $('labS').value = E.shutterIndex(st.t); $('labI').value = E.isoIndex(st.iso); $('labZ').value = st.focal;
    $('labAv').textContent = E.formatAperture(st.n); $('labSv').textContent = E.formatShutter(st.t); $('labIv').textContent = E.formatISO(st.iso); $('labZv').textContent = Math.round(st.focal) + 'mm';
    $('labFocus').value = st.focus; $('labLight').value = st.light; $('labHand').checked = st.handheld;
    const ch = mode === 'challenge' && L.CHALLENGES.find(c => c.id === challengeId), lockHand = !!(ch && ch.lock && ch.lock.handheld);
    $('labHand').disabled = lockHand; $('labLight').disabled = mode === 'challenge';
  }

  /* ───────── lessons ───────── */
  const meter = (label, value, text, ratio, cls = '', center = false) =>
    `<div class="meter ${cls}"><div class="m-top"><span>${label}</span><b>${text}</b></div><div class="m-track">${center ? '<i class="m-mid"></i>' : ''}<i class="m-fill" style="${center ? `left:${ratio >= 0 ? 50 : 50 + ratio * 50}%;width:${Math.abs(ratio) * 50}%` : `left:0;width:${Math.min(1, ratio) * 100}%`}"></i></div></div>`;
  function paintSide(m) {
    if (mode === 'learn') {
      const lesson = L.LESSONS.find(l => l.id === lessonId), b = m.brightness;
      let html = '';
      if (lesson.meter === 'brightness') html = meter('Brightness', b, Math.abs(b) <= 0.5 ? 'Just right' : `${b > 0 ? 'Too bright' : 'Too dark'} (${b > 0 ? '+' : '−'}${Math.abs(b).toFixed(1)} stops)`, Math.max(-1, Math.min(1, b / 3)), Math.abs(b) <= 0.5 ? 'good' : 'warn', true);
      if (lesson.meter === 'background') { const v = m.layers.far.px4000; html = meter('Mountain blur', v, v < 2 ? 'Sharp' : v < 10 ? 'Soft' : 'Very soft', Math.min(1, v / 40)); }
      if (lesson.meter === 'motion') { const v = m.riderSmear4000; html = meter('Cyclist smear', v, v <= 4 ? 'Frozen' : v < 25 ? 'Slight blur' : 'Streaking', Math.min(1, v / 120), v <= 4 ? 'good' : ''); }
      if (lesson.meter === 'grain') html = meter('Grain compared with ISO 100', m.grain, `×${m.grain.toFixed(1)}`, Math.min(1, (m.grain - 1) / 7));
      if (lesson.meter === 'shake') html = meter('Camera shake', m.shake4000, m.shake4000 <= 3 ? 'Steady' : 'Shaky', Math.min(1, m.shake4000 / 40), m.shake4000 <= 3 ? 'good' : '') + `<p class="hint">Safe at ${E.formatShutter(m.safeShutter)} or faster.</p>`;
      $('lessonMeters').innerHTML = html + (lesson.meter !== 'brightness' ? meter('Brightness', b, Math.abs(b) <= 0.5 ? 'Just right' : `${b > 0 ? 'Too bright' : 'Too dark'}`, Math.max(-1, Math.min(1, b / 3)), Math.abs(b) <= 0.5 ? 'good' : 'warn', true) : '');
    } else paintChallenge();
  }
  function buildLessons() {
    $('lessonTabs').innerHTML = L.LESSONS.map((l, i) => `<button class="ch-card ls" data-lesson="${l.id}"><span class="ch-num">${String(i + 1).padStart(2, '0')}</span><span class="ch-title">${esc(l.title)}</span><span class="ls-task">${esc(l.task)}</span></button>`).join('');
    $('lessonTabs').onclick = e => { const b = e.target.closest('[data-lesson]'); if (b) pickLesson(b.dataset.lesson); };
  }
  function pickLesson(id) {
    lessonId = id; const l = L.LESSONS.find(x => x.id === id);
    st = { ...L.defaultState(), ...l.state }; setBalance(l.balance || 'off');
    document.querySelectorAll('#lessonTabs .ch-card').forEach(b => b.classList.toggle('on', b.dataset.lesson === id));
    sync(); schedule();
  }

  /* ───────── challenges ───────── */
  const stars = n => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;
  function buildChallenges() {
    const done = Object.values(progress.stars).filter(Boolean).length, total = Object.values(progress.stars).reduce((a, b) => a + b, 0);
    $('labProgress').innerHTML = `<span><b>${done}</b> of ${L.CHALLENGES.length} completed</span><span class="stars">★ ${total} / ${L.CHALLENGES.length * 3}</span>`;
    $('challengeList').innerHTML = L.CHALLENGES.map((c, i) => `<button class="ch-card${c.id === challengeId ? ' on' : ''}" data-ch="${c.id}"><span class="ch-num">${String(i + 1).padStart(2, '0')}</span><span class="ch-title">${esc(c.title)}</span><span class="ch-meta"><span class="lvl">${[1, 2, 3].map(n => `<i class="${n <= c.level ? 'on' : ''}"></i>`).join('')}</span>${stars(progress.stars[c.id] || 0)}</span></button>`).join('');
  }
  function pickChallenge(id) {
    const c = L.CHALLENGES.find(x => x.id === id); if (!c) return;
    challengeId = id; hintsShown = 0; lastWinId = null;
    st = { ...c.start }; setBalance('off'); buildChallenges(); sync(); schedule();
  }
  function paintChallenge() {
    const c = L.CHALLENGES.find(x => x.id === challengeId), panel = $('challengePanel');
    if (!c) { panel.innerHTML = '<p class="brief" style="margin:0">Pick a challenge above to begin.</p>'; return; }
    const r = L.evaluate(c, st), idx = L.CHALLENGES.indexOf(c), next = L.CHALLENGES[idx + 1];
    if (r.done && lastWinId !== c.id) {
      lastWinId = c.id;
      if (r.stars > (progress.stars[c.id] || 0)) { progress.stars[c.id] = r.stars; saveProgress(); toast(`Challenge complete: ${'★'.repeat(r.stars)}`); }
      buildChallenges();
    }
    if (!r.done) lastWinId = null;
    const row = (x, bonus) => { const on = x.ok && (!bonus || r.done); return `<li class="${on ? 'ok' : ''}${bonus ? ' bonus' : ''}"><span class="tick">${on ? '✓' : ''}</span>${esc(x.label)}<span class="val">${esc(x.value)}</span></li>`; };
    panel.innerHTML = `<h2>${esc(c.title)}</h2><p class="brief">${esc(c.brief)}</p>
      ${r.done ? `<div class="win"><b>Complete!</b>${stars(r.stars)}${next ? `<button class="btn btn-sm" data-next="${next.id}">Next challenge →</button>` : ''}</div>` : ''}
      <ul class="checklist"><li class="grp">Goals</li>${r.results.map(x => row(x)).join('')}<li class="grp">Bonus stars</li>${r.bonus.map(x => row(x, true)).join('')}</ul>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="chip-btn" data-hint>${hintsShown < c.hints.length ? 'Show a hint' : 'No more hints'}</button><button class="chip-btn" data-restart>Restart</button></div>
      ${hintsShown ? `<div class="hint-line">${c.hints.slice(0, hintsShown).map(esc).join('<br>')}</div>` : ''}
      ${c.lock && c.lock.handheld ? '<p class="lock-note" style="margin-top:10px">Hand-held is locked on for this one.</p>' : ''}`;
  }
  function wireChallenges() {
    $('challengeList').onclick = e => { const b = e.target.closest('[data-ch]'); if (b) pickChallenge(b.dataset.ch); };
    $('challengePanel').onclick = e => {
      const c = L.CHALLENGES.find(x => x.id === challengeId);
      if (e.target.closest('[data-hint]') && c && hintsShown < c.hints.length) { hintsShown++; paintChallenge(); }
      else if (e.target.closest('[data-restart]')) pickChallenge(challengeId);
      else { const n = e.target.closest('[data-next]'); if (n) pickChallenge(n.dataset.next); }
    };
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll('#labMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('labLearn').hidden = m !== 'learn'; $('labChallenge').hidden = m !== 'challenge';
    if (m === 'learn') { pickLesson(lessonId); } else { buildChallenges(); if (challengeId) pickChallenge(challengeId); else { st = L.defaultState(); setBalance('off'); sync(); schedule(); } }
  }

  function init() {
    buildControls(); buildLessons(); wireChallenges();
    $('labMode').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.mode !== mode) setMode(b.dataset.mode); };
    setMode('learn');
  }
  init();
  window.addEventListener('pageshow-tool', e => { if (e.detail === 'lab') schedule(); });
  if ($('page-lab').classList.contains('active')) schedule();
  return { get state() { return st; }, setState: s => { st = { ...st, ...s }; sync(); schedule(); }, render, metrics: () => L.metrics(st), setMode, pickChallenge, pickLesson };
})();
