/* Photo Fixer maths: tone curves, colour, sharpening, auto-fix and geometry. Pure functions on RGBA arrays. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FixerCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const DEFAULTS = Object.freeze({
    exposure: 0,        // -2 .. 2 stops
    contrast: 0,        // -100 .. 100
    highlights: 0,      // -100 .. 100  (negative recovers bright areas)
    shadows: 0,         // -100 .. 100  (positive lifts dark areas)
    saturation: 0,      // -100 .. 100  (-100 is black and white)
    warmth: 0,          // -100 (cool) .. 100 (warm)
    sharpen: 0,         // 0 .. 100
    rotate: 0,          // quarter turns, 0..3
    flipH: false, flipV: false,
    straighten: 0,      // -15 .. 15 degrees
  });
  const RANGES = { exposure: [-2, 2], contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100], saturation: [-100, 100], warmth: [-100, 100], sharpen: [0, 100], straighten: [-15, 15] };
  const TONE_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'saturation', 'warmth', 'sharpen'];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function normalize(p) {
    const out = { ...DEFAULTS, ...p };
    for (const [k, [lo, hi]] of Object.entries(RANGES)) out[k] = clamp(Number(out[k]) || 0, lo, hi);
    out.rotate = ((Math.round(out.rotate) % 4) + 4) % 4;
    out.flipH = !!out.flipH; out.flipV = !!out.flipV;
    return out;
  }
  const isNeutral = p => TONE_KEYS.every(k => normalize(p)[k] === 0);
  const sameTone = (a, b) => TONE_KEYS.every(k => normalize(a)[k] === normalize(b)[k]);

  /* ───────── tone ───────── */
  const toLin = s => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4));
  const toSrgb = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

  /** One 256-entry curve (0..255 -> 0..255) shared by the three colour channels. */
  function buildToneLUT(p) {
    const q = normalize(p), lut = new Float32Array(256), gain = Math.pow(2, q.exposure);
    const sh = q.shadows / 100, hi = q.highlights / 100, ct = q.contrast / 100;
    let prev = 0;
    for (let i = 0; i < 256; i++) {
      let s = clamp(toSrgb(clamp(toLin(i / 255) * gain, 0, 1)), 0, 1);
      s += 0.18 * sh * 6.75 * s * (1 - s) * (1 - s);       // shadows: a bump centred on the dark tones
      s += 0.18 * hi * 6.75 * s * s * (1 - s);              // highlights: a bump centred on the bright tones
      s = clamp(s, 0, 1);
      if (ct > 0) { const k = 1.6 * ct; s = 0.5 + 0.5 * Math.tanh(k * (2 * s - 1)) / Math.tanh(k); }
      else if (ct < 0) s = 0.5 + (s - 0.5) * (1 + ct * 0.6);
      s = Math.max(prev, clamp(s, 0, 1));                   // curves never go backwards
      lut[i] = s * 255; prev = s;
    }
    return lut;
  }

  /** Applies tone, saturation and warmth in place. Returns the same array. */
  function applyAdjustments(data, p) {
    const q = normalize(p);
    const toneOn = q.exposure !== 0 || q.contrast !== 0 || q.highlights !== 0 || q.shadows !== 0;
    const sat = 1 + q.saturation / 100, w = q.warmth / 100;
    if (!toneOn && q.saturation === 0 && q.warmth === 0) return data;
    const lut = toneOn ? buildToneLUT(q) : null, rGain = 1 + 0.16 * w, bGain = 1 - 0.16 * w, gGain = 1 + 0.02 * w;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (lut) { r = lut[r]; g = lut[g]; b = lut[b]; }
      if (q.saturation !== 0) { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat; }
      if (w !== 0) { r *= rGain; g *= gGain; b *= bGain; }
      data[i] = r; data[i + 1] = g; data[i + 2] = b;       // Uint8ClampedArray clamps and rounds
    }
    return data;
  }

  /** Unsharp mask with a 3x3 blur. amount 0..100. */
  function sharpen(data, width, height, amount) {
    if (!amount) return data;
    const k = amount / 100 * 1.4, src = new Uint8ClampedArray(data);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const o = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const j = o + c;
          const blur = (src[j - 4 - width * 4] + src[j - width * 4] + src[j + 4 - width * 4] + src[j - 4] + src[j] + src[j + 4] + src[j - 4 + width * 4] + src[j + width * 4] + src[j + 4 + width * 4]) / 9;
          data[j] = src[j] + k * (src[j] - blur);
        }
      }
    }
    return data;
  }

  /** Suggests settings from the pixels: balance the brightness, add contrast if flat, a little colour. */
  function autoFix(data) {
    const hist = new Uint32Array(256); let n = 0;
    for (let i = 0; i < data.length; i += 4) { hist[Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])]++; n++; }
    if (!n) return normalize({});
    const pct = f => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * f) return i; } return 255; };
    const median = pct(0.5), low = pct(0.01), high = pct(0.99);
    const target = toLin(0.46), now = Math.max(toLin(Math.max(median, 3) / 255), 1e-4);
    const exposure = clamp(Math.round(Math.log2(target / now) * 0.8 * 10) / 10, -1.5, 1.5);
    const range = high - low;
    const contrast = range < 190 ? Math.round(clamp((190 - range) / 190 * 60, 0, 40)) : 0;
    const highlights = high >= 250 && exposure >= 0 ? -20 : 0;
    const shadows = low < 25 && exposure <= 0.3 ? 20 : 0;
    return normalize({ exposure, contrast, highlights, shadows, saturation: 10 });
  }

  /* ───────── geometry ───────── */
  const frameSize = (w, h, rotate) => (rotate % 2 ? { w: h, h: w } : { w, h });
  /** How much the picture must grow when tilted so no empty corners show. */
  function straightenScale(frameW, frameH, deg) {
    if (!deg) return 1;
    const a = Math.abs(deg) * Math.PI / 180;
    return (Math.cos(a) + Math.max(frameW / frameH, frameH / frameW) * Math.sin(a)) * 1.004;   // a hair extra so rounding never leaves a transparent corner
  }

  const LOOKS = {
    Vivid: { saturation: 28, contrast: 14 },
    Warm: { warmth: 42, exposure: 0.1, saturation: 6 },
    Cool: { warmth: -42, saturation: 4 },
    Mono: { saturation: -100, contrast: 22 },
    Fade: { contrast: -26, shadows: 26, saturation: -18 },
    Punch: { contrast: 30, highlights: -22, shadows: 22, sharpen: 30, saturation: 10 },
  };

  return { DEFAULTS, RANGES, TONE_KEYS, normalize, isNeutral, sameTone, buildToneLUT, applyAdjustments, sharpen, autoFix, frameSize, straightenScale, LOOKS };
});
