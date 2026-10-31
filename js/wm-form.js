/* Watermark Studio settings form, built from a table of controls. Ids, defaults and ranges live here, in one place. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WmForm = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const FONTS = [["'Segoe UI', sans-serif", 'Segoe UI'], ["'DM Sans', sans-serif", 'DM Sans'], ['Georgia, serif', 'Georgia'], ["'Courier New', monospace", 'Courier New'], ['Impact, sans-serif', 'Impact'], ['Arial, sans-serif', 'Arial']];

  /* Each control: kind, id, label and its defaults. `row` groups controls that sit side by side. */
  const SPEC = {
    logoLook: [
      { kind: 'range', id: 'logoSize', label: 'Logo Size', min: 5, max: 30, value: 5, unit: '%' },
      { kind: 'range', id: 'logoOpacity', label: 'Logo Opacity', min: 10, max: 100, value: 100, unit: '%' },
      { row: [{ kind: 'number', id: 'logoOffsetX', label: 'Logo Offset X', value: 24, hint: true }, { kind: 'number', id: 'logoOffsetY', label: 'Logo Offset Y', value: -24, hint: true }] },
      { kind: 'rule' },
      { kind: 'text', id: 'watermarkText', label: 'Watermark Text (Bottom Right)', placeholder: '© YourBrand 2025', value: 'First Name | Class #' },
      { kind: 'select', id: 'watermarkFont', label: 'Font', options: FONTS },
      { row: [{ kind: 'range', id: 'textSize', label: 'Font Size', min: 10, max: 72, value: 24, unit: '' }, { kind: 'range', id: 'textOpacity', label: 'Opacity', min: 10, max: 100, value: 100, unit: '%' }] },
      { kind: 'color', id: 'textColor', label: 'Text Color', value: '#ffffff' },
      { kind: 'toggle', id: 'textShadow', label: 'Text Shadow', text: 'Add drop shadow for readability', on: true, plain: true },
      { row: [{ kind: 'number', id: 'textOffsetX', label: 'Text Offset X', value: -24, hint: true }, { kind: 'number', id: 'textOffsetY', label: 'Text Offset Y', value: -24, hint: true }] },
      { kind: 'range', id: 'wmPadding', label: 'Padding from Edge', min: 5, max: 50, value: 16, unit: 'px' },
    ],
    resize: [
      { kind: 'toggle', id: 'enableResize', text: 'Enable Resize', on: true, gap: 8 },
      { kind: 'select', id: 'resizeMode', label: 'Resize Mode', selected: 'width', options: [['width', 'By Width'], ['height', 'By Height'], ['both', 'Exact (Width × Height)'], ['percent', 'Percentage']] },
      { row: [{ kind: 'number', id: 'resizeWidth', label: 'Width (px)', value: 2048, min: 10, max: 10000 }, { kind: 'number', id: 'resizeHeight', label: 'Height (px)', value: 800, min: 10, max: 10000 }], rowId: 'resizeDims' },
      { kind: 'range', id: 'resizePercent', label: 'Scale Percentage', min: 10, max: 200, value: 100, unit: '%', groupId: 'resizePercentGroup', hidden: true },
      { kind: 'toggle', id: 'keepAspect', text: 'Keep aspect ratio', on: true },
    ],
    border: [
      { kind: 'toggle', id: 'enableBorder', text: 'Enable Border', on: true, gap: 16 },
      { kind: 'range', id: 'borderWidth', label: 'Border Width', min: 1, max: 80, value: 6, unit: 'px' },
      { kind: 'color', id: 'borderColor', label: 'Border Color', value: '#ffffff' },
      { kind: 'select', id: 'borderStyle', label: 'Border Style', options: [['solid', 'Solid'], ['double', 'Double (inner line)'], ['shadow', 'Inset Shadow']] },
      { kind: 'range', id: 'innerLineWidth', label: 'Inner Line Width', min: 1, max: 10, value: 2, unit: 'px', groupId: 'doubleLineGroup', hidden: true },
    ],
    output: [
      { kind: 'rule' },
      { kind: 'select', id: 'outputFormat', label: 'Output Format', options: [['image/jpeg', 'JPEG'], ['image/png', 'PNG'], ['image/webp', 'WebP']] },
      { kind: 'range', id: 'outputQuality', label: 'JPEG Quality', min: 50, max: 100, value: 100, unit: '%', groupId: 'qualityGroup' },
      { kind: 'action', id: 'wmProcess', text: ' ⚡ Process All Images ' },
    ],
  };

  const attrs = o => Object.entries(o).filter(([, v]) => v !== undefined && v !== false).map(([k, v]) => v === true ? ` ${k}` : ` ${k}="${v}"`).join('');
  const group = (inner, extra = {}) => `<div class="form-group"${attrs(extra)}>${inner}</div>`;
  const BUILD = {
    rule: () => '<hr class="divider">',
    range: c => group(`<label>${c.label}</label><div class="range-row"><input${attrs({ type: 'range', id: c.id, min: c.min, max: c.max, value: c.value, 'data-unit': c.unit })}><span id="${c.id}Val">${c.value}${c.unit}</span></div>`, { id: c.groupId, style: c.hidden ? 'display:none;' : undefined }),
    number: c => group(`<label>${c.label}</label><input${attrs({ type: 'number', id: c.id, value: c.value, placeholder: c.hint ? c.value : undefined, min: c.min, max: c.max })}>`),
    text: c => group(`<label>${c.label}</label><input${attrs({ type: 'text', id: c.id, placeholder: c.placeholder, value: c.value })}>`),
    select: c => group(`<label>${c.label}</label><select id="${c.id}">${c.options.map(([v, t]) => `<option value="${v}"${v === c.selected ? ' selected' : ''}>${t}</option>`).join('')}</select>`),
    color: c => group(`<label>${c.label}</label><div class="color-row"><input${attrs({ type: 'color', id: c.id + 'Picker', value: c.value })}><input${attrs({ type: 'text', id: c.id + 'Hex', value: c.value, placeholder: c.value })}></div>`),
    toggle: c => {
      const box = `<label class="checkbox-row"${c.gap ? ` style="margin-bottom:${c.gap}px;"` : ''}><input type="checkbox" id="${c.id}"${c.on ? ' checked' : ''}><span>${c.text}</span></label>`;
      return group(c.plain ? `<label>${c.label}</label>${box}` : box);
    },
    action: c => `<button class="btn" type="button" id="${c.id}" style="width:100%;">${c.text}</button>`,
  };
  const build = c => c.row ? `<div class="grid2"${c.rowId ? ` id="${c.rowId}"` : ''}>${c.row.map(build).join('')}</div>` : BUILD[c.kind](c);

  /** The markup for one named part of the form. */
  const html = name => SPEC[name].map(build).join('');

  /** Fills every `[data-wm-fields]` placeholder in the page, then removes the placeholder. */
  function mount(doc) {
    doc.querySelectorAll('[data-wm-fields]').forEach(el => {
      const name = el.dataset.wmFields;
      if (el.hasAttribute('data-wm-inside')) { el.innerHTML = html(name); el.removeAttribute('data-wm-fields'); el.removeAttribute('data-wm-inside'); }
      else { el.insertAdjacentHTML('beforebegin', html(name)); el.remove(); }
    });
  }

  return { SPEC, html, mount };
});
