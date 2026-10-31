/* Logo fitting: measures the visible part of a logo and scales an uploaded logo to match the built-in one. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LogoFit = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Bounding box of the pixels that can actually be seen (alpha above `minAlpha`), from RGBA data.
   * A logo with no transparency, or no visible pixel at all, counts as filling its whole image.
   */
  function visibleBounds(data, w, h, minAlpha = 16) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > minAlpha) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w, h };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /**
   * Where to draw an uploaded logo so its visible part fills the same space as the reference logo's visible part.
   * `box` is where the reference logo is drawn (x, y, w, h in output pixels); `ref` and `logo` are
   * { w, h, bounds } in their own image pixels. The logo is scaled to fit inside the reference's visible area
   * (never cropped, aspect ratio kept) and centred in it. Returns the draw rectangle for the whole image,
   * plus `visible`, the rectangle its visible part ends up in.
   */
  function fitToReference(logo, ref, box) {
    const g = box.w / ref.w;
    const rx = box.x + ref.bounds.x * g, ry = box.y + ref.bounds.y * g, rw = ref.bounds.w * g, rh = ref.bounds.h * g;
    const s = Math.min(rw / logo.bounds.w, rh / logo.bounds.h);
    const vw = logo.bounds.w * s, vh = logo.bounds.h * s;
    const vx = rx + (rw - vw) / 2, vy = ry + (rh - vh) / 2;
    return { x: vx - logo.bounds.x * s, y: vy - logo.bounds.y * s, w: logo.w * s, h: logo.h * s, visible: { x: vx, y: vy, w: vw, h: vh } };
  }

  return { visibleBounds, fitToReference };
});
