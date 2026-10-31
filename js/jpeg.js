/* Lossless JPEG helpers (no re-encoding): list segments, strip all metadata, keep orientation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Jpeg = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  function isJpeg(bytes) { return bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8; }

  /** Marker segments before the image data starts. Each: { marker, start, end, name }. */
  function segments(bytes) {
    if (!isJpeg(bytes)) throw new Error('Not a JPEG');
    const out = [];
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p] !== 0xFF) throw new Error('Bad JPEG marker at ' + p);
      const marker = bytes[p + 1];
      if (marker === 0xDA) { out.push({ marker, start: p, end: bytes.length, name: 'SOS' }); break; }
      if (marker === 0xFF) { p++; continue; }
      const len = (bytes[p + 2] << 8) | bytes[p + 3];
      const end = p + 2 + len;
      out.push({ marker, start: p, end, name: segmentName(bytes, marker, p + 4) });
      p = end;
    }
    return out;
  }

  function ascii(bytes, from, n) { let s = ''; for (let i = from; i < from + n && i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; }

  function segmentName(bytes, marker, dataStart) {
    if (marker === 0xE1) return ascii(bytes, dataStart, 4) === 'Exif' ? 'EXIF' : (ascii(bytes, dataStart, 28).startsWith('http://ns.adobe.com/xap') ? 'XMP' : 'APP1');
    if (marker === 0xE2) return ascii(bytes, dataStart, 11) === 'ICC_PROFILE' ? 'ICC' : 'APP2';
    if (marker === 0xED) return 'IPTC';
    if (marker === 0xFE) return 'COMMENT';
    if (marker >= 0xE0 && marker <= 0xEF) return 'APP' + (marker - 0xE0);
    return 'M' + marker.toString(16).toUpperCase();
  }

  /** A tiny EXIF block that carries only the orientation tag (so a stripped photo still shows upright). */
  function orientationOnlyExif(orientation) {
    return Uint8Array.from([
      0xFF, 0xE1, 0x00, 0x22,                         // APP1, length 34
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,             // "Exif\0\0"
      0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, // big-endian TIFF header
      0x00, 0x01,                                     // one entry
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xFF, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,                         // no next IFD
    ]);
  }

  /**
   * Returns a new Uint8Array without EXIF, XMP, IPTC, comments or other APPn data.
   * ICC colour profiles are kept so colours do not shift. Pixel data is copied untouched.
   */
  function strip(bytes, { keepOrientation = null } = {}) {
    const segs = segments(bytes);
    const parts = [bytes.subarray(0, 2)];
    if (keepOrientation && keepOrientation > 1 && keepOrientation <= 8) parts.push(orientationOnlyExif(keepOrientation));
    let tailStart = bytes.length;
    for (const s of segs) {
      if (s.name === 'SOS') { tailStart = s.start; break; }
      const drop = (s.marker >= 0xE1 && s.marker <= 0xEF && s.name !== 'ICC') || s.marker === 0xFE;
      if (!drop) parts.push(bytes.subarray(s.start, s.end));
    }
    parts.push(bytes.subarray(tailStart));
    let total = 0; for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  return { isJpeg, segments, strip, orientationOnlyExif };
});
