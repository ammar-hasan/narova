'use strict';

/* Provider-neutral visual scene tree.
 *
 * `scene.body` remains the unrestricted HyperFrames surface. `scene.visual`
 * is the portable subset both bundled renderers understand. Keeping this
 * contract data-only makes it safe to persist in manifest.json and lets a
 * project carry a richer HyperFrames body beside a browserless fallback. */

const NODE_TYPES = new Set([
  'group', 'stack', 'rect', 'circle', 'line', 'path', 'text', 'image', 'svg',
  'progress',
]);
const ENTERS = new Set(['none', 'fade', 'rise', 'slide-left', 'slide-right', 'zoom', 'pop']);
const ANIMATED_PROPERTIES = new Set(['x', 'y', 'scale', 'rotate', 'opacity', 'width', 'height', 'progress']);
const EASES = new Set(['linear', 'in', 'out', 'in-out', 'back']);

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateVisual(root, at = 'visual') {
  const errors = [];
  const seen = new Set();

  function visit(node, where) {
    if (!plainObject(node)) {
      errors.push(`${where}: expected an object`);
      return;
    }
    if (seen.has(node)) {
      errors.push(`${where}: circular visual trees are not supported`);
      return;
    }
    seen.add(node);
    if (!NODE_TYPES.has(node.type)) {
      errors.push(`${where}.type: expected ${[...NODE_TYPES].join('|')}`);
    }
    if (node.style != null && !plainObject(node.style)) {
      errors.push(`${where}.style: expected an object`);
    }
    if (node.type === 'text' && typeof node.text !== 'string') {
      errors.push(`${where}.text: string required`);
    }
    if (node.type === 'image' && typeof node.src !== 'string') {
      errors.push(`${where}.src: image source required`);
    }
    if (node.type === 'svg' && typeof node.src !== 'string' && typeof node.markup !== 'string') {
      errors.push(`${where}: svg needs src or markup`);
    }
    if (node.type === 'path' && typeof node.d !== 'string') {
      errors.push(`${where}.d: SVG path data required`);
    }
    if (node.enter != null) {
      const enter = typeof node.enter === 'string' ? { type: node.enter } : node.enter;
      if (!plainObject(enter) || !ENTERS.has(enter.type || 'fade')) {
        errors.push(`${where}.enter: expected ${[...ENTERS].join('|')} or an options object`);
      } else {
        validateAt(enter.at, `${where}.enter.at`, errors);
        validateDuration(enter.duration, `${where}.enter.duration`, errors);
      }
    }
    if (node.animate != null) {
      if (!Array.isArray(node.animate)) {
        errors.push(`${where}.animate: expected an array`);
      } else node.animate.forEach((animation, i) => {
        const aw = `${where}.animate[${i}]`;
        if (!plainObject(animation)) {
          errors.push(`${aw}: expected an object`);
          return;
        }
        if (!ANIMATED_PROPERTIES.has(animation.property)) {
          errors.push(`${aw}.property: expected ${[...ANIMATED_PROPERTIES].join('|')}`);
        }
        if (!Number.isFinite(animation.from) || !Number.isFinite(animation.to)) {
          errors.push(`${aw}: numeric from and to are required`);
        }
        validateAt(animation.at, `${aw}.at`, errors);
        validateDuration(animation.duration, `${aw}.duration`, errors, true);
        if (animation.ease != null && !EASES.has(animation.ease)) {
          errors.push(`${aw}.ease: expected ${[...EASES].join('|')}`);
        }
      });
    }
    if (node.children != null) {
      if (!Array.isArray(node.children)) errors.push(`${where}.children: expected an array`);
      else node.children.forEach((child, i) => visit(child, `${where}.children[${i}]`));
    }
    seen.delete(node);
  }

  visit(root, at);
  return errors;
}

function validateAt(value, at, errors) {
  if (value == null || Number.isFinite(value)) return;
  if (!plainObject(value)
      || !Number.isInteger(value.cue) || value.cue < 0
      || (value.offset != null && !Number.isFinite(value.offset))) {
    errors.push(`${at}: expected seconds or { cue: <0-based turn>, offset? }`);
  }
}

function validateDuration(value, at, errors, required = false) {
  if (value == null && !required) return;
  if (!Number.isFinite(value) || value <= 0) errors.push(`${at}: expected a positive number`);
}

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CSS_NAMES = {
  background: 'background', color: 'color', opacity: 'opacity', x: 'left', y: 'top',
  width: 'width', height: 'height', minWidth: 'min-width', minHeight: 'min-height',
  maxWidth: 'max-width', maxHeight: 'max-height', padding: 'padding', gap: 'gap',
  radius: 'border-radius', borderColor: 'border-color', borderWidth: 'border-width',
  fontSize: 'font-size', fontFamily: 'font-family', fontWeight: 'font-weight',
  lineHeight: 'line-height', letterSpacing: 'letter-spacing', textAlign: 'text-align',
  direction: 'direction', overflow: 'overflow', objectFit: 'object-fit',
  justify: 'justify-content', align: 'align-items', flex: 'flex',
};
const LENGTHS = new Set(['x', 'y', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'padding', 'gap', 'radius', 'borderWidth', 'fontSize', 'letterSpacing']);

function styleString(node) {
  const style = node.style || {};
  const out = [];
  if (node.type === 'stack') {
    out.push('display:flex');
    out.push(`flex-direction:${style.direction === 'row' ? 'row' : 'column'}`);
  }
  if (node.type === 'group') out.push('position:relative');
  if (node.type === 'circle') out.push('border-radius:50%');
  if (style.x != null || style.y != null || style.position === 'absolute') out.push('position:absolute');
  if (style.rotate != null || style.scale != null) {
    out.push(`transform:rotate(${Number(style.rotate || 0)}deg) scale(${Number(style.scale || 1)})`);
  }
  for (const [key, value] of Object.entries(style)) {
    if (value == null || key === 'direction' && node.type === 'stack' || key === 'position'
        || key === 'rotate' || key === 'scale' || key === 'fontFile' || key === 'fit') continue;
    const css = CSS_NAMES[key];
    if (!css) continue;
    if (key === 'background' && value && typeof value === 'object' && value.type === 'linear' && Array.isArray(value.stops)) {
      const stops = value.stops.map(stop => `${stop.color} ${Number(stop.at) * 100}%`).join(',');
      out.push(`background:linear-gradient(${Number(value.angle == null ? 135 : value.angle)}deg,${stops})`);
      continue;
    }
    if (typeof value === 'object') continue;
    const rendered = typeof value === 'number' && LENGTHS.has(key) ? `${value}px` : String(value);
    out.push(`${css}:${rendered}`);
  }
  if (style.fit) out.push(`object-fit:${style.fit}`);
  return out.join(';');
}

function enterAttrs(node) {
  if (!node.enter) return '';
  const enter = typeof node.enter === 'string' ? { type: node.enter } : node.enter;
  if ((enter.type || 'fade') === 'none') return '';
  const attrs = ['class="cue"'];
  if (enter.at && typeof enter.at === 'object') attrs.push(`data-cue="${enter.at.cue}"`);
  const offset = enter.at && typeof enter.at === 'object' ? enter.at.offset : (Number.isFinite(enter.at) ? enter.at : 0);
  if (offset) attrs.push(`data-delay="${offset}"`);
  return ' ' + attrs.join(' ');
}

function visualToHtml(root) {
  function render(node) {
    const style = styleString(node);
    const attrs = `${style ? ` style="${esc(style)}"` : ''}${enterAttrs(node)}`;
    if (node.type === 'text') return `<div dir="auto"${attrs}>${esc(node.text)}</div>`;
    if (node.type === 'image') return `<img src="${esc(node.src)}"${attrs}>`;
    if (node.type === 'svg') {
      if (node.markup) return `<div${attrs}>${node.markup}</div>`;
      return `<img src="${esc(node.src)}"${attrs}>`;
    }
    if (node.type === 'line') return `<div${attrs}></div>`;
    if (node.type === 'path') {
      const stroke = esc(node.style && node.style.stroke || 'currentColor');
      const fill = esc(node.style && node.style.fill || 'none');
      return `<svg viewBox="${esc(node.viewBox || '0 0 100 100')}"${attrs}><path d="${esc(node.d)}" stroke="${stroke}" fill="${fill}"></path></svg>`;
    }
    if (node.type === 'progress') {
      const value = Math.max(0, Math.min(1, Number(node.value == null ? 0 : node.value)));
      return `<div${attrs}><div style="height:100%;width:${value * 100}%;background:${esc(node.fill || 'currentColor')}"></div></div>`;
    }
    return `<div${attrs}>${(node.children || []).map(render).join('')}</div>`;
  }
  return render(root);
}

function materializeVisualBodies(config) {
  return {
    ...config,
    scenes: config.scenes.map(scene => ({
      ...scene,
      body: typeof scene.body === 'string' && (scene.body.length || !scene.visual)
        ? scene.body
        : visualToHtml(scene.visual),
    })),
  };
}

module.exports = {
  NODE_TYPES, ENTERS, ANIMATED_PROPERTIES, EASES,
  validateVisual, visualToHtml, materializeVisualBodies,
};
