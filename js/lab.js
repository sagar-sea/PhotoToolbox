/* Learning Lab logic: a layered sample scene, its physics, lessons and challenges. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./exposure.js'));
  else root.Lab = factory(root.Exposure);
})(typeof self !== 'undefined' ? self : this, function (E) {

  /* The sample scene: flowers (2 m), a cyclist crossing at 7 m/s (6 m) and mountains (200 m). */
  const SCENE = {
    sensorMm: 36,                       // full-frame width
    subjectSpeed: 7,                    // m/s, cyclist moving sideways
    depthsMm: { near: 2000, mid: 6000, far: 200000 },
    previewPx: 720, realPx: 4000,       // preview width and the "real photo" width used for pixel numbers
    exaggeration: 2.5,                  // the preview blurs a bit more than real life so it is visible at 720 px
  };
  const LIGHTS = {
    sun:    { label: 'Sunny day',    ev: 15 },
    cloud:  { label: 'Cloudy day',   ev: 12 },
    indoor: { label: 'Bright room',  ev: 8 },
    night:  { label: 'Night street', ev: 4 },
  };
  const FOCUS = { near: 'Flowers', mid: 'Cyclist', far: 'Mountains' };

  const defaultState = () => ({ light: 'sun', n: 8, t: E.shutterAt(27), iso: 100, focal: 50, focus: 'mid', handheld: false });

  /** Brightness compared with a correct exposure, in stops. + is too bright, - is too dark. */
  function brightnessStops(st) {
    const cameraEV = Math.log2(st.n * st.n / st.t) - Math.log2(st.iso / 100);
    return LIGHTS[st.light].ev - cameraEV;
  }

  /** Size (mm on the sensor) of the blur circle for something at distance dMm when the lens is focused at the focus distance. */
  function blurCircleMm(st, dMm) {
    const s = SCENE.depthsMm[st.focus], f = st.focal;
    if (Math.abs(dMm - s) < 1) return 0;
    return f * f * Math.abs(dMm - s) / (st.n * dMm * (s - f));
  }

  function metrics(st) {
    const layers = {};
    for (const k of Object.keys(SCENE.depthsMm)) {
      const c = blurCircleMm(st, SCENE.depthsMm[k]);
      layers[k] = { mm: c, px4000: c / SCENE.sensorMm * SCENE.realPx, px720: c / SCENE.sensorMm * SCENE.previewPx };
    }
    const mb = E.motionBlur({ t: st.t, speed: SCENE.subjectSpeed, distanceM: SCENE.depthsMm.mid / 1000, focal35: st.focal });
    return {
      brightness: brightnessStops(st),
      layers,
      riderSmear4000: mb.px4000,
      shake4000: st.handheld ? Math.min(60, Math.max(0, st.t * st.focal - 1) * 8) : 0,   // slower than 1/focal-length shakes
      safeShutter: 1 / st.focal,
      grain: Math.sqrt(st.iso / 100),
      diffractionSoft: E.diffraction(st.n, 1).soft,
    };
  }

  /** Changes shutter or ISO so the picture is correctly bright again (snapped to 1/3 stops). */
  function balance(st, mode) {
    const out = { ...st }, ev = LIGHTS[st.light].ev;
    if (mode === 'shutter') {
      const t = st.n * st.n * 100 / (st.iso * Math.pow(2, ev));
      out.t = E.shutterAt(E.clamp(E.shutterIndex(t), E.SHUTTER.min, E.SHUTTER.max));
    } else if (mode === 'iso') {
      const iso = 100 * st.n * st.n / (st.t * Math.pow(2, ev));
      out.iso = E.isoAt(E.clamp(E.isoIndex(iso), E.ISO.min, E.ISO.max));
    }
    return out;
  }

  /* ───────── criteria used by the challenges ───────── */
  const fmtStops = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1);
  const px = v => (v < 10 ? v.toFixed(1) : Math.round(v)) + ' px';
  const crit = (id, label, test, show) => ({ id, label, test, show });
  const C = {
    exposure: tol => crit('exposure', 'Brightness just right', m => Math.abs(m.brightness) <= tol, m => fmtStops(m.brightness) + ' stops'),
    riderSharp: max => crit('riderSharp', 'Cyclist looks sharp', m => m.riderSmear4000 <= max, m => px(m.riderSmear4000) + ' smear'),
    riderStreak: (min, max) => crit('riderStreak', 'Cyclist streaks nicely', m => m.riderSmear4000 >= min && m.riderSmear4000 <= max, m => px(m.riderSmear4000) + ' smear'),
    farBlurred: min => crit('farBlurred', 'Mountains blurred', m => m.layers.far.px4000 >= min, m => px(m.layers.far.px4000) + ' blur'),
    midBlurred: min => crit('midBlurred', 'Cyclist blurred', m => m.layers.mid.px4000 >= min, m => px(m.layers.mid.px4000) + ' blur'),
    nearSharp: max => crit('nearSharp', 'Flowers sharp enough', m => m.layers.near.px4000 <= max, m => px(m.layers.near.px4000) + ' blur'),
    midSharp: max => crit('midSharp', 'Cyclist in focus', m => m.layers.mid.px4000 <= max, m => px(m.layers.mid.px4000) + ' blur'),
    farSharp: max => crit('farSharp', 'Mountains sharp enough', m => m.layers.far.px4000 <= max, m => px(m.layers.far.px4000) + ' blur'),
    noShake: () => crit('noShake', 'No camera shake', m => m.shake4000 <= 3, m => px(m.shake4000) + ' shake'),
    noDiffraction: () => crit('noDiffraction', 'Opening not too small', m => !m.diffractionSoft, m => (m.diffractionSoft ? 'too small' : 'fine')),
    isoAtMost: v => crit('iso' + v, 'ISO ' + v + ' or lower', (m, st) => st.iso <= v * 1.01, (m, st) => E.formatISO(st.iso)),
    shutterFaster: d => crit('fast' + d, 'Shutter 1/' + d + ' or faster', (m, st) => st.t <= 1 / d * 1.01, (m, st) => E.formatShutter(st.t)),
    apertureWide: n => crit('wide' + n, 'Opening f/' + n + ' or wider', (m, st) => st.n <= n * 1.01, (m, st) => E.formatAperture(st.n)),
    apertureSmall: n => crit('small' + n, 'Opening f/' + n + ' or smaller', (m, st) => st.n >= n * 0.99, (m, st) => E.formatAperture(st.n)),
  };

  const start = (o) => ({ ...defaultState(), ...o });
  const CHALLENGES = [
    { id: 'just-right', title: 'Just right', level: 1, brief: 'It is a sunny day and the photo is far too bright. Fix the exposure.',
      start: start({ light: 'sun', n: 2, t: 1 / 60, iso: 400 }),
      required: [C.exposure(0.3)], bonus: [C.isoAtMost(100), C.shutterFaster(250)],
      hints: ['Close the aperture to a bigger f-number, or use a faster shutter.', 'Lower the ISO to 100 first, then balance with the shutter.'] },
    { id: 'portrait', title: 'Melt the mountains', level: 1, brief: 'Keep the cyclist in focus and blur the mountains behind.',
      start: start({ light: 'sun', n: 16, t: 1 / 125, iso: 100 }),
      required: [C.exposure(0.5), C.midSharp(2), C.farBlurred(10)], bonus: [C.isoAtMost(200), C.apertureWide(2.8)],
      hints: ['A wider opening (smaller f-number) blurs the background.', 'Wide opening lets in lots of light: use a faster shutter or "Auto-balance".'] },
    { id: 'freeze', title: 'Freeze the cyclist', level: 2, brief: 'Stop the cyclist in mid-air on a cloudy day.',
      start: start({ light: 'cloud', n: 8, t: 1 / 125, iso: 100 }),
      required: [C.exposure(0.5), C.riderSharp(4)], bonus: [C.isoAtMost(400), C.apertureSmall(2)],
      hints: ['You need a very fast shutter: 1/1600 or faster.', 'A fast shutter lets in little light. Open the aperture or raise the ISO.'] },
    { id: 'streak', title: 'Silky streak', level: 2, brief: 'Make the cyclist a soft streak while the day stays bright.',
      start: start({ light: 'sun', n: 8, t: 1 / 500, iso: 100 }),
      required: [C.exposure(0.5), C.riderStreak(40, 150)], bonus: [C.isoAtMost(100), C.apertureSmall(11)],
      hints: ['Slow the shutter to around 1/100.', 'A slow shutter lets in too much light in sun. Use a tiny opening and the lowest ISO.'] },
    { id: 'all-sharp', title: 'Sharp everywhere', level: 2, brief: 'Keep the flowers, cyclist and mountains all sharp.',
      start: start({ light: 'sun', n: 2.8, t: 1 / 2000, iso: 100 }),
      required: [C.exposure(0.5), C.midSharp(3), C.nearSharp(6), C.farSharp(6), C.noDiffraction()], bonus: [C.isoAtMost(100), C.shutterFaster(60)],
      hints: ['Focus on the cyclist and use a small opening around f/16.', 'Do not go past f/16: very tiny openings soften the picture.'] },
    { id: 'dim-room', title: 'Steady in the dark', level: 3, brief: 'Hand-held on a night street. No shake, and not too grainy.',
      start: start({ light: 'night', n: 8, t: 1 / 30, iso: 100, handheld: true }), lock: { handheld: true },
      required: [C.exposure(0.5), C.noShake(), C.isoAtMost(6400)], bonus: [C.isoAtMost(1600), C.apertureWide(1.4)],
      hints: ['Hand-held needs a shutter faster than 1/focal length (1/50 at 50 mm).', 'Open the aperture wide, then raise the ISO until the brightness is right.'] },
    { id: 'flowers', title: 'Flower portrait', level: 3, brief: 'Focus on the flowers and turn everything behind into soft colour.',
      start: start({ light: 'cloud', n: 16, t: 1 / 60, iso: 100, focus: 'mid', handheld: true }), lock: { handheld: true },
      required: [C.exposure(0.5), C.noShake(), C.isoAtMost(400), C.midBlurred(10), C.farBlurred(20), crit('flowerFocus', 'Flowers in focus', m => m.layers.near.px4000 <= 1, m => px(m.layers.near.px4000) + ' blur')],
      bonus: [C.isoAtMost(200), C.apertureWide(2.8)],
      hints: ['Set Focus to Flowers first.', 'A wide opening blurs everything behind the flowers.'] },
    { id: 'sharp-rider', title: 'Sharp rider, soft hills', level: 3, brief: 'Freeze the cyclist and still blur the mountains. Hand-held.',
      start: start({ light: 'cloud', n: 8, t: 1 / 250, iso: 100, handheld: true }), lock: { handheld: true },
      required: [C.exposure(0.5), C.riderSharp(4), C.farBlurred(8), C.isoAtMost(800), C.noShake()], bonus: [C.isoAtMost(400), C.apertureWide(2.8)],
      hints: ['You need a fast shutter (1/1600) AND a wide opening.', 'Wide opening plus fast shutter: raise the ISO a little to balance.'] },
  ];

  /** Checks a challenge against the current settings. */
  function evaluate(ch, st) {
    const m = metrics(st);
    const run = (list, required) => list.map(c => ({ id: c.id, label: c.label, ok: !!c.test(m, st), value: c.show(m, st), required }));
    const results = run(ch.required, true), bonus = run(ch.bonus, false);
    const done = results.every(r => r.ok);
    return { results, bonus, done, stars: done ? Math.min(3, 1 + bonus.filter(b => b.ok).length) : 0, metrics: m };
  }

  /** Brute-force search over the settings (used by the tests to prove each challenge can be won). */
  function solve(ch) {
    let best = null;
    const focuses = ch.lock && ch.lock.focus ? [ch.start.focus] : Object.keys(FOCUS);
    for (let a = E.APERTURE.min + 2; a <= E.APERTURE.max; a++) {
      for (let s = E.SHUTTER.min; s <= E.SHUTTER.max; s += 1) {
        for (let i = E.ISO.min; i <= E.ISO.max; i++) {
          for (const focus of focuses) {
            const st = { ...ch.start, n: E.apertureAt(a), t: E.shutterAt(s), iso: E.isoAt(i), focus };
            const r = evaluate(ch, st);
            if (r.done && (!best || r.stars > best.stars)) { best = { stars: r.stars, state: st }; if (best.stars === 3) return best; }
          }
        }
      }
    }
    return best;
  }

  /* ───────── lessons ───────── */
  const LESSONS = [
    { id: 'light', title: 'Brightness', task: 'Make it look right. Change one setting, then balance it with another.',
      state: { light: 'sun', n: 8, t: E.shutterAt(21), iso: 100 }, meter: 'brightness' },
    { id: 'blur', title: 'Background blur', task: 'Open the aperture and watch the mountains melt away.',
      state: { light: 'sun', n: 11, t: E.shutterAt(24), iso: 100, focus: 'mid' }, balance: 'shutter', meter: 'background' },
    { id: 'motion', title: 'Freeze or flow', task: 'Speed up the shutter to freeze the cyclist. Slow it down to streak.',
      state: { light: 'cloud', n: 4, t: E.shutterAt(15), iso: 100, focus: 'mid' }, balance: 'iso', meter: 'motion' },
    { id: 'grain', title: 'Grain', task: 'Raise the ISO in the dark and look closely at the speckles.',
      state: { light: 'night', n: 2, t: E.shutterAt(9), iso: 400, focus: 'mid' }, balance: 'shutter', meter: 'grain' },
    { id: 'shake', title: 'Shaky hands', task: 'Hold the camera in your hands and slow the shutter.',
      state: { light: 'cloud', n: 5.6, t: E.shutterAt(18), iso: 200, focus: 'mid', handheld: true }, balance: 'iso', meter: 'shake' },
  ];

  return { SCENE, LIGHTS, FOCUS, defaultState, brightnessStops, blurCircleMm, metrics, balance, CHALLENGES, LESSONS, evaluate, solve };
});
