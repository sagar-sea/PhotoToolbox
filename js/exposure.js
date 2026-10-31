/* Exposure maths for the "What if?" simulator. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Exposure = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const log2 = Math.log2;

  // Slider index <-> value. All sliders move in 1/3-stop steps.
  const APERTURE = { min: 0, max: 30 };        // f/1.0 .. f/32
  const SHUTTER  = { min: -15, max: 39 };      // 30s .. 1/8000s
  const ISO      = { min: -3, max: 27 };       // ISO 50 .. 51200
  const apertureAt = k => Math.pow(2, k / 6);
  const shutterAt  = j => Math.pow(2, -j / 3);
  const isoAt      = m => 100 * Math.pow(2, m / 3);
  const apertureIndex = n => Math.round(6 * log2(n));
  const shutterIndex  = t => Math.round(-3 * log2(t));
  const isoIndex      = s => Math.round(3 * log2(s / 100));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /** Brightness change in stops (EV) going from setting a to setting b. +1 = twice as bright. */
  function deltaEV(a, b) {
    return log2(b.t / a.t) + log2(b.iso / a.iso) + 2 * log2(a.n / b.n);
  }

  /** Shutter time that keeps brightness the same after changing aperture and/or ISO. */
  function compensateShutter(orig, n1, iso1) {
    return orig.t * (orig.iso / iso1) * Math.pow(n1 / orig.n, 2);
  }
  /** ISO that keeps brightness the same after changing aperture and/or shutter. */
  function compensateISO(orig, n1, t1) {
    return orig.iso * (orig.t / t1) * Math.pow(n1 / orig.n, 2);
  }

  // The numbers printed on real cameras. Third-stop maths gives 5.657 or 1/512; cameras say f/5.6 and 1/500.
  const STD_APERTURES = [1, 1.1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3.2, 3.5, 4, 4.5, 5, 5.6, 6.3, 7.1, 8, 9, 10, 11, 13, 14, 16, 18, 20, 22, 25, 29, 32];
  const STD_SHUTTERS = [8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 200, 160, 125, 100, 80, 60, 50, 40, 30, 25, 20, 15, 13, 10, 8, 6, 5, 4, 3, 2.5];
  const STD_ISOS = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200];
  const nearestStd = (list, v, tol) => { let best = null; for (const x of list) if (best === null || Math.abs(Math.log(x / v)) < Math.abs(Math.log(best / v))) best = x; return Math.abs(Math.log(best / v)) <= tol ? best : null; };

  function formatShutter(t) {
    if (!isFinite(t) || t <= 0) return '-';
    if (t >= 0.95) return (t >= 10 ? Math.round(t) : Math.round(t * 10) / 10) + 's';
    const d = 1 / t, std = nearestStd(STD_SHUTTERS, d, 0.04);
    return '1/' + (std !== null ? std : Math.round(d)) + 's';
  }
  function formatAperture(n) {
    const std = nearestStd(STD_APERTURES, n, 0.03);
    return 'f/' + (std !== null ? std : (n < 10 ? (Math.round(n * 10) / 10) : Math.round(n)));
  }
  function formatISO(s) { const std = nearestStd(STD_ISOS, s, 0.03); return 'ISO ' + (std !== null ? std : Math.round(s)); }
  function formatDistance(mm) {
    if (!isFinite(mm)) return '∞';
    const m = mm / 1000;
    return m < 1 ? (m * 100).toFixed(0) + ' cm' : m.toFixed(m < 10 ? 2 : 1) + ' m';
  }

  /** Crop factor from the lens focal length and the 35mm equivalent (both from EXIF). */
  function cropFactor(focal, focal35) {
    return focal && focal35 ? focal35 / focal : null;
  }

  /** Depth of field in mm. Circle of confusion scales with sensor size (0.029 mm for full frame). */
  function depthOfField({ focal, n, distanceMm, crop }) {
    const c = 0.029 / (crop || 1);
    const H = (focal * focal) / (n * c) + focal;
    const s = distanceMm;
    const near = (s * (H - focal)) / (H + s - 2 * focal);
    const far = s >= H ? Infinity : (s * (H - focal)) / (H - s);
    return { near, far, total: far - near, hyperfocal: H, coc: c };
  }

  /** Diameter of the diffraction (Airy) disc in mm for green light, compared to the blur limit. */
  function diffraction(n, crop) {
    const airy = 2.44 * 0.00055 * n;
    const c = 0.029 / (crop || 1);
    return { airy, coc: c, soft: airy > c };
  }

  /** Longest shutter that is usually safe when hand-holding (1 / equivalent focal length). */
  function handheldLimit(focal35) { return focal35 ? 1 / focal35 : null; }

  const SUBJECTS = [
    { name: 'Person standing', speed: 0.2 },
    { name: 'Walking', speed: 1.4 },
    { name: 'Jogging', speed: 3 },
    { name: 'Cyclist', speed: 7 },
    { name: 'Bird in flight', speed: 10 },
    { name: 'Car at 54 km/h', speed: 15 },
  ];
  /**
   * A subject crossing the frame at `speed` m/s smears during the exposure.
   * Frame width at the subject is about distance x 36 / focal(35mm). Result is in pixels of a 4000 px wide image.
   */
  function motionBlur({ t, speed, distanceM, focal35 }) {
    if (!focal35) return null;
    const frameWidthM = distanceM * 36 / focal35;
    const fraction = (speed * t) / frameWidthM;
    const px4000 = fraction * 4000;
    return { fraction, px4000, frozen: px4000 <= 4, slight: px4000 <= 12 };
  }

  /** Same brightness, other apertures: what shutter would be needed at the given ISO. */
  function equivalents(orig, iso) {
    return [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22].map(n => ({ n, t: compensateShutter(orig, n, iso), iso }));
  }

  const sRGBtoLin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; sRGBtoLin[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function linToSRGB(v) { v = v < 0 ? 0 : v > 1 ? 1 : v; return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }

  /** Approximate sensor noise strength (0-255 units) for an ISO. A teaching model, not a calibration. */
  const noiseSigma = iso => 1.2 * Math.sqrt(iso / 100);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rand) {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Re-exposes RGBA pixels in linear light (gain = 2^ev) and adds extra noise when ISO goes up.
   * Returns clipping stats so the UI can say "12% of the picture would be blown out".
   * Mutates `data` (Uint8ClampedArray).
   */
  function applyExposure(data, { ev = 0, isoFrom = 100, isoTo = 100, seed = 7 } = {}) {
    const gain = Math.pow(2, ev);
    const extra = Math.sqrt(Math.max(0, noiseSigma(isoTo) ** 2 - noiseSigma(isoFrom) ** 2));
    const rand = mulberry32(seed);
    let hi = 0, lo = 0;
    const px = data.length / 4;
    const lut = new Float32Array(256);                // one pow() per level instead of one per pixel
    for (let i = 0; i < 256; i++) lut[i] = linToSRGB(sRGBtoLin[i] * gain);
    for (let i = 0; i < data.length; i += 4) {
      let y = 0;
      const n = extra ? gauss(rand) * extra : 0;
      for (let c = 0; c < 3; c++) {
        const v = lut[data[i + c]];
        const w = 1.3 - 0.6 * (v / 255);       // noise shows more in shadows
        data[i + c] = v + n * w;
        y += data[i + c];
      }
      y /= 3;
      if (y >= 250) hi++; else if (y <= 5) lo++;
    }
    return { highlightsClipped: hi / px, shadowsCrushed: lo / px };
  }

  /** Plain-English brightness verdict. */
  function describeEV(ev) {
    const a = Math.abs(ev);
    if (a < 0.17) return 'About the same brightness';
    const dir = ev > 0 ? 'brighter' : 'darker';
    if (a < 0.5) return 'Slightly ' + dir;
    return (Math.round(a * 10) / 10) + ' stop' + (Math.round(a * 10) / 10 === 1 ? '' : 's') + ' ' + dir;
  }

  return { APERTURE, SHUTTER, ISO, apertureAt, shutterAt, isoAt, apertureIndex, shutterIndex, isoIndex, clamp,
    deltaEV, compensateShutter, compensateISO, formatShutter, formatAperture, formatISO, formatDistance,
    cropFactor, depthOfField, diffraction, handheldLimit, SUBJECTS, motionBlur, equivalents,
    noiseSigma, applyExposure, describeEV };
});
