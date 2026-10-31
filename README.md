# Photo Toolbox

Browser-based photo tools. **Photos never leave your device**: everything runs locally in the page and there is no backend.

Inspired by [starmap1/PhotoTools](https://github.com/starmap1/PhotoTools) (a metadata viewer and watermark tool). This version adds the Learning Lab, Photo Fixer, a redesigned interface and a logo upload.

## Run it

```bash
npm start            # serves http://127.0.0.1:8777 (any static server works)
npm test             # unit tests for the pure logic (Node 20+, no dependencies)
```

Open `http://127.0.0.1:8777/`. Opening `index.html` directly also works, but offline install (PWA) needs http.

## Tools

| Page | What it does |
|---|---|
| **Metadata** | One photo for a full report, or many for a sortable table (CSV / JSON, summary charts, compare two photos). Tabs: Overview, What if…? (exposure sliders with estimated brightness, depth of field, motion blur, grain), Location & privacy (GPS, private data, lossless clean copy), Picture check (labelled histogram, colours, quality tips), Full list (every tag), Edit info (artist, copyright, clock shift, remove GPS). |
| **Learning Lab** | A built-in scene (flowers, a cyclist, mountains at different distances) that reacts to aperture, shutter, ISO, zoom, focus, light and hand-held shake. Five short lessons with a live meter, and **eight challenges** with a goal checklist, bonus stars (1–3), hints and progress saved in the browser. Uses the same exposure maths as What if…. |
| **Photo Fixer** | Exposure, contrast, highlights, shadows, saturation, warmth, sharpen, six one-click looks, Auto-fix, turn, mirror, flip, straighten, Undo/Redo, hold-to-compare, JPEG / PNG / WebP export at full size. Works on a copy. |
| **Watermark Studio** | Logo (**your own upload** or none) + text, 9-point anchors, drag-to-position live preview, tiled text, `{Artist} {Year} {Model}` tokens, resize, border, presets, name patterns, ZIP, and **Reset to original**. With no logo the output is byte-identical to the upstream app's. |
| **Convert** | JPEG / WebP / PNG, fixed quality or target file size, size presets, name patterns, ZIP. |
| **Crop** | Aspect presets (Instagram, 16:9, A4…), drag + zoom, thirds grid. |
| **Collage** | Photos on one sheet with names and shot info, PNG or PDF. |

## Layout

```
index.html        page shell (markup only)
css/style.css     the whole "Light Table" theme: warm paper, ink, film-strip header, one red accent
js/
  core.js         navigation, escaping, downloads, glossary tooltips
  exposure.js     exposure / depth-of-field / motion maths   (pure, tested)
  analysis.js     histogram, palette, sharpness              (pure, tested)
  jpeg.js         lossless JPEG metadata stripping           (pure, tested)
  lab.js          Learning Lab scene physics, lessons, challenges   (pure, tested)
  fixer-core.js   Photo Fixer tone, colour, sharpen, auto-fix, geometry   (pure, tested)
  metadata.js whatif.js   metadata page and what-if lab
  lab-ui.js fixer.js      Learning Lab and Photo Fixer screens
  logo-fit.js     measures a logo's visible part and fits it into the Logo Size square   (pure, tested)
  wm-form.js      the Watermark Studio settings form, built from one table of controls and defaults   (tested)
  watermark.js tools.js   watermark studio; convert, crop, collage
vendor/           exifr, JSZip, piexifjs, Leaflet, Fraunces + Figtree fonts (all bundled, so it works offline)
tests/            node --test (pure logic, plus checks that the page and offline list stay consistent)
assets/           app icon
sw.js, manifest.json   offline / installable
.github/workflows/test.yml   runs the tests on every push
```

## Logos in the Watermark Studio

The **Logo** control has two choices: **Upload logo** (browse for a file or drop one on the box) and **None**. The tool starts on None. Switching keeps your upload, so you can flip back and forth. Your logo is remembered in this browser only (when it is under about 300 KB); **Remove my saved logo** forgets it. **Reset to original** goes back to no logo.

The logo is scaled by its **visible** part: transparent padding around it is ignored, its shape is kept and nothing is cropped. The picture fits a square as wide as the Logo Size slider, so any logo of any size or padding looks as big as the slider says. The advice under the picker tells you when a logo would look soft at the current size or has a solid background. A PNG with a transparent background looks best.

## Publish on GitHub Pages

The site is plain static files with relative paths, so it works from a sub-folder such as `https://<user>.github.io/<repo>/`.

1. Create a repository and push this folder to it.
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`. Offline install works because Pages serves over HTTPS.

`.nojekyll` stops GitHub from processing the files, and `.github/workflows/test.yml` runs `npm test` on every push. After changing any file listed in `sw.js`, bump `VERSION` there so visitors get the new version.

## License and credits

[MIT](LICENSE). Vendored libraries (exifr, JSZip, piexifjs, Leaflet) and the Fraunces and Figtree fonts keep their own licenses. Inspired by [starmap1/PhotoTools](https://github.com/starmap1/PhotoTools).

## Design rules

No sticky or fixed panels (only the short "saved" toast floats), no inner scrollbars (wide tables drop columns on small screens), no intro banners. Technical words carry hover tooltips instead of helper paragraphs.

## Notes and limits

- The what-if preview is a physics-based estimate from the photo's own settings. Noise and highlight clipping are simplified models, not a camera simulation. Depth of field assumes focus at the distance slider and a circle of confusion scaled by the crop factor from EXIF.
- Missing EXIF values are replaced by clearly labelled example values.
- Metadata editing needs a JPEG whose EXIF layout `piexifjs` can read; otherwise the tool says so and writes nothing.
- HEIC/TIFF are read for metadata, but previews and analysis only work where the browser can decode them (Safari decodes HEIC).
- Everything, including fonts, is bundled locally. The only network request is the optional map, and only when you click it.
- The Learning Lab scene is an illustration with simplified physics. It exaggerates blur a little so it is visible on screen.
