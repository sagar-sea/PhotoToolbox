/* Pixel analysis helpers: histogram, palette, sharpness and exposure checks. Pure functions on RGBA arrays. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Analysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /** 256-bin histograms for R, G, B and luma. */
  function histogram(data) {
    const h = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), y: new Uint32Array(256) };
    for (let i = 0; i < data.length; i += 4) {
      h.r[data[i]]++; h.g[data[i + 1]]++; h.b[data[i + 2]]++;
      h.y[Math.round(luma(data[i], data[i + 1], data[i + 2]))]++;
    }
    return h;
  }

  /** Dominant colours: bucket to 4 bits per channel, then merge near neighbours. */
  function palette(data, count = 5) {
    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      let b = buckets.get(key);
      if (!b) { b = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, b); }
      b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
    }
    const all = [...buckets.values()].sort((a, b) => b.n - a.n)
      .map(b => ({ n: b.n, r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n) }));
    const picked = [];
    for (const c of all) {
      if (picked.every(p => Math.hypot(p.r - c.r, p.g - c.g, p.b - c.b) > 48)) picked.push(c);
      if (picked.length === count) break;
    }
    const total = data.length / 4;
    return picked.map(c => ({ hex: '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join(''), share: c.n / total }));
  }

  /** Variance of the Laplacian on a grey copy: higher = more fine detail. Compare only at similar image sizes. */
  function sharpness(data, width, height) {
    const g = new Float32Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) g[p] = luma(data[i], data[i + 1], data[i + 2]);
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const p = y * width + x;
        const l = g[p - 1] + g[p + 1] + g[p - width] + g[p + width] - 4 * g[p];
        sum += l; sumSq += l * l; n++;
      }
    }
    if (!n) return 0;
    const mean = sum / n;
    return sumSq / n - mean * mean;
  }

  /** Exposure facts from a luma histogram. */
  function exposureStats(histY) {
    let total = 0, sum = 0, dark = 0, bright = 0;
    for (let i = 0; i < 256; i++) {
      const n = histY[i];
      total += n; sum += n * i;
      if (i <= 8) dark += n;
      if (i >= 247) bright += n;
    }
    if (!total) return { mean: 0, darkShare: 0, brightShare: 0 };
    return { mean: sum / total, darkShare: dark / total, brightShare: bright / total };
  }

  /** Plain-English findings about a photo. `sharp` expects a value measured at ~512 px on the long edge. */
  function lint({ mean, darkShare, brightShare }, sharp) {
    const notes = [];
    if (mean < 60) notes.push({ kind: 'warn', title: 'Too dark', text: 'The photo is dark overall. Next time, let in more light: use a brighter place, a lower shutter speed or a higher ISO.' });
    else if (mean > 190) notes.push({ kind: 'warn', title: 'Too bright', text: 'The photo is very bright overall. Next time, let in less light: use a faster shutter speed or a lower ISO.' });
    else notes.push({ kind: 'ok', title: 'Brightness is good', text: 'The photo is not too dark and not too bright.' });
    if (brightShare > 0.05) notes.push({ kind: 'warn', title: 'Some parts are pure white', text: Math.round(brightShare * 100) + '% of the picture is completely white, so no detail is left there (for example a washed-out sky). That detail cannot be brought back.' });
    if (darkShare > 0.1) notes.push({ kind: 'warn', title: 'Some parts are pure black', text: Math.round(darkShare * 100) + '% of the picture is completely black, so the detail in the shadows is lost.' });
    if (sharp != null) {
      if (sharp < 25) notes.push({ kind: 'warn', title: 'Might be blurry', text: 'There is very little fine detail. The photo may be out of focus, or the camera moved. A plain wall or sky can also look like this.' });
      else if (sharp < 80) notes.push({ kind: 'info', title: 'A bit soft', text: 'Some parts look soft. Zoom in to check whether the main subject is sharp.' });
      else notes.push({ kind: 'ok', title: 'Looks sharp', text: 'There is plenty of fine detail, so the photo looks sharp.' });
    }
    return notes;
  }

  /**
   * Explains a brightness histogram in everyday words.
   * Returns { summary, regions: {dark, mid, bright} (shares 0-1), points: [sentences] }.
   */
  function describeHistogram(histY) {
    let total = 0, dark = 0, mid = 0, bright = 0, edgeLow = 0, edgeHigh = 0;
    for (let i = 0; i < 256; i++) {
      const n = histY[i]; total += n;
      if (i < 64) dark += n; else if (i < 192) mid += n; else bright += n;
      if (i <= 5) edgeLow += n; if (i >= 250) edgeHigh += n;
    }
    if (!total) return { summary: 'No pixels to analyse.', regions: { dark: 0, mid: 0, bright: 0 }, points: [] };
    const r = { dark: dark / total, mid: mid / total, bright: bright / total };
    const pct = v => Math.round(v * 100) + '%';
    let summary;
    if (r.mid >= 0.6) summary = 'Most of your photo is in the middle: not too dark and not too bright. That is a well-balanced picture.';
    else if (r.dark > 0.5) summary = 'Most of your photo is dark. That is fine for a night scene or a moody picture, but it may be too dark if you wanted a bright photo.';
    else if (r.bright > 0.5) summary = 'Most of your photo is bright. That is fine for a sunny or airy picture, but very bright areas can lose detail.';
    else if (r.dark > 0.25 && r.bright > 0.25) summary = 'Your photo has both strong darks and strong brights, so it has a lot of contrast.';
    else summary = 'Your photo uses a mix of dark, middle and bright tones.';
    const points = [];
    if (edgeHigh / total > 0.02) points.push('The tall bar at the far right means ' + pct(edgeHigh / total) + ' of the picture is pure white. Detail in those areas is gone.');
    if (edgeLow / total > 0.02) points.push('The tall bar at the far left means ' + pct(edgeLow / total) + ' of the picture is pure black. Detail in those areas is gone.');
    if (!points.length) points.push('Nothing is piled up against the left or right edge, so the photo keeps detail in both the darkest and brightest places.');
    return { summary, regions: r, points };
  }

  return { histogram, palette, sharpness, exposureStats, lint, describeHistogram, luma };
});
