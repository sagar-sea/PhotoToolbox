/* Small readers for EXIF text: the UserComment field and the camera name. Pure functions, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ExifText = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /** Turns whatever the EXIF reader gave us (text, bytes or a list of numbers) into a list of byte values. */
  function toBytes(value) {
    if (typeof value === 'string') return Array.from(value, ch => ch.charCodeAt(0) & 0xff);
    if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    if (Array.isArray(value)) return value.map(n => Number(n) & 0xff);
    return [];
  }

  const label = bytes => String.fromCharCode(...bytes.slice(0, 8).map(b => b || 0x20)).trim().toUpperCase();

  function utf16(bytes) {
    if (bytes.length < 2) return '';
    let little = bytes[0] !== 0 && bytes[1] === 0;                       // "H\0" is little-endian, "\0H" is big-endian
    let start = 0;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { little = true; start = 2; }
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) { little = false; start = 2; }
    let out = '';
    for (let i = start; i + 1 < bytes.length; i += 2) out += String.fromCharCode(little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    return out;
  }

  function decodeBytes(bytes, how) {
    const u8 = Uint8Array.from(bytes);
    try { return new TextDecoder(how, { fatal: false }).decode(u8); } catch (e) { return String.fromCharCode(...bytes); }
  }

  /**
   * The comment as readable text. Returns '' when there is nothing to read: a missing field,
   * or only the encoding label followed by blanks, which many cameras write as a placeholder.
   */
  function decodeUserComment(value) {
    const bytes = toBytes(value);
    if (bytes.length === 0) return '';
    const known = ['ASCII', 'UNICODE', 'JIS'];
    const tag = label(bytes);
    let body = bytes, kind = 'utf-8';
    if (known.includes(tag) || bytes.slice(0, 8).every(b => b === 0)) {
      body = bytes.slice(8);
      kind = tag === 'UNICODE' ? 'utf-16' : tag === 'JIS' ? 'shift_jis' : 'utf-8';
    }
    const text = kind === 'utf-16' ? utf16(body) : decodeBytes(body, kind);
    return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  }

  /** "Canon EOS R6", not "Canon Canon EOS R6": many cameras already put the brand in the model name. */
  function cameraName(make, model) {
    const mk = String(make ?? '').trim(), md = String(model ?? '').trim();
    if (!mk) return md;
    if (!md) return mk;
    const first = mk.split(/\s+/)[0].toLowerCase();                       // "NIKON CORPORATION" starts with "nikon"
    return md.toLowerCase().startsWith(first) ? md : `${mk} ${md}`;
  }

  return { decodeUserComment, cameraName };
});
