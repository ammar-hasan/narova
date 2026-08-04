'use strict';

/* Provider-neutral visual scene tree.
 *
 * `scene.body` remains the unrestricted HyperFrames surface. `scene.visual`
 * is the portable subset both bundled renderers understand. Keeping this
 * contract data-only makes it safe to persist in manifest.json and lets a
 * project carry a richer HyperFrames body beside a browserless fallback. */

const NODE_TYPES = new Set([
  'group', 'stack', 'rect', 'circle', 'line', 'path', 'text', 'image', 'svg',
  'progress', 'counter',
]);
const ENTERS = new Set(['none', 'fade', 'rise', 'slide-left', 'slide-right', 'zoom', 'pop']);
const ANIMATED_PROPERTIES = new Set(['x', 'y', 'scale', 'rotate', 'opacity', 'width', 'height', 'progress']);
const EASES = new Set(['linear', 'in', 'out', 'in-out', 'back']);
const MARKS = new Set(['underline', 'circle', 'box', 'highlight']);
const DRIFTS = new Set(['in', 'out', 'left', 'right', 'up', 'pano']);

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
    if (node.type === 'counter' && !Number.isFinite(node.target)) {
      errors.push(`${where}.target: numeric counter target required`);
    }
    if (node.style && node.style.mark && !MARKS.has(node.style.mark)) {
      errors.push(`${where}.style.mark: expected ${[...MARKS].join('|')}`);
    }
    if (node.drift != null && !DRIFTS.has(node.drift)) {
      errors.push(`${where}.drift: expected ${[...DRIFTS].join('|')}`);
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
  alignSelf: 'align-self',
};
const LENGTHS = new Set(['x', 'y', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'padding', 'gap', 'radius', 'borderWidth', 'fontSize', 'letterSpacing', 'shadowX', 'shadowY', 'shadowBlur']);

function gradientAngleFromVector(frame, from, to) {
  // Convert normalised from/to vectors to a CSS gradient angle (0deg = to top).
  const fx = (typeof from[0] === 'string') ? parseFloat(from[0]) * frame.w / 100 : (+from[0] || 0);
  const fy = (typeof from[1] === 'string') ? parseFloat(from[1]) * frame.h / 100 : (+from[1] || 0);
  const tx = (typeof to[0] === 'string') ? parseFloat(to[0]) * frame.w / 100 : (+to[0] || frame.w);
  const ty = (typeof to[1] === 'string') ? parseFloat(to[1]) * frame.h / 100 : (+to[1] || frame.h);
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return 135;
  // CSS angle: arctan2 of sin, -cos... actually angle of the gradient line.
  // The gradient runs perpendicular to the colour-stop line.
  const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
  // Normalise to [0, 360) like CSS.
  return Math.round(((angle % 360) + 360) % 360);
}

function styleString(node) {
  const style = node.style || {};
  const out = [];
  if (node.type === 'stack') {
    out.push('display:flex');
    out.push(`flex-direction:${style.direction === 'row' ? 'row' : 'column'}`);
  }
  if (node.type === 'group') out.push('position:relative');
  if (node.type === 'circle') out.push('border-radius:50%');
  if (node.type === 'text') {
    out.push('display:flex');
    const va = style.verticalAlign || 'top';
    out.push(`align-items:${va === 'center' ? 'center' : va === 'bottom' ? 'flex-end' : 'flex-start'}`);
  }
  if (style.x != null || style.y != null || style.position === 'absolute') out.push('position:absolute');
  if (style.rotate != null || style.scale != null) {
    out.push(`transform:rotate(${Number(style.rotate || 0)}deg) scale(${Number(style.scale || 1)})`);
  }
  if (style.shadowColor) {
    const sx = +style.shadowX || 0;
    const sy = +style.shadowY || 8;
    const blur = +style.shadowBlur || 16;
    out.push(`box-shadow:${sx}px ${sy}px ${blur}px ${style.shadowColor}`);
  }
  if (style.maxLines) {
    out.push(`overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${+style.maxLines}`);
  }
  for (const [key, value] of Object.entries(style)) {
    if (value == null || key === 'direction' && node.type === 'stack' || key === 'position'
        || key === 'rotate' || key === 'scale' || key === 'fontFile' || key === 'fit'
        || key === 'shadowColor' || key === 'shadowBlur' || key === 'shadowX' || key === 'shadowY'
        || key === 'verticalAlign' || key === 'maxLines' || key === 'grow' || key === 'mark') continue;
    const css = CSS_NAMES[key];
    if (!css) continue;
    if (key === 'background' && value && typeof value === 'object' && value.type === 'linear' && Array.isArray(value.stops)) {
      let angle = 135;
      if (value.angle != null) {
        angle = value.angle;
      } else if (value.from || value.to) {
        const fr = value.from || [0, 0], to = value.to || [1, 1];
        angle = gradientAngleFromVector({ w: 100, h: 100 }, fr, to);
      }
      const stops = value.stops.map(stop => `${stop.color} ${Number(stop.at) * 100}%`).join(',');
      out.push(`background:linear-gradient(${angle}deg,${stops})`);
      continue;
    }
    if (typeof value === 'object') continue;
    const rendered = typeof value === 'number' && LENGTHS.has(key) ? `${value}px` : String(value);
    out.push(`${css}:${rendered}`);
  }
  if (style.fit) out.push(`object-fit:${style.fit}`);
  return out.join(';');
}

function dataAttrs(node) {
  const attrs = [];
  const style = node.style || {};

  // Entrance timing (class="cue" is the HyperFrames reveal trigger).
  if (node.enter) {
    const enter = typeof node.enter === 'string' ? { type: node.enter } : node.enter;
    if ((enter.type || 'fade') !== 'none') {
      attrs.push('class="cue"');
      if (enter.at && typeof enter.at === 'object') attrs.push(`data-cue="${enter.at.cue}"`);
      const offset = enter.at && typeof enter.at === 'object' ? enter.at.offset : (Number.isFinite(enter.at) ? enter.at : 0);
      if (offset) attrs.push(`data-delay="${offset}"`);
    }
  }

  // Timed animators (processed in HyperFrames' per-scene loop at trigger time).
  if (style.grow) attrs.push('data-grow');
  if (style.mark && MARKS.has(style.mark)) attrs.push(`data-mark="${style.mark}"`);

  // Scene-spanning animator (HyperFrames animates it over the full scene duration).
  if (node.drift && DRIFTS.has(node.drift)) attrs.push(`data-drift="${node.drift}"`);

  return attrs.length ? ' ' + attrs.join(' ') : '';
}

function enterAttrs(node) {
  return dataAttrs(node);
}

function visualToHtml(root) {
  function render(node) {
    const style = styleString(node);
    const attrs = `${style ? ` style="${esc(style)}"` : ''}${dataAttrs(node)}`;
    if (node.type === 'text') return `<div dir="auto"${attrs}>${esc(node.text)}</div>`;
    if (node.type === 'image') return `<img src="${esc(node.src)}"${attrs}>`;
    if (node.type === 'svg') {
      if (node.markup) return `<div${attrs}>${node.markup}</div>`;
      return `<img src="${esc(node.src)}"${attrs}>`;
    }
    if (node.type === 'circle') {
      const fill = esc(node.style && (node.style.fill || node.style.background) || '#ffffff');
      const stroke = node.style && node.style.borderColor ? esc(node.style.borderColor) : '';
      const sw = node.style && node.style.borderWidth ? ` stroke-width="${+node.style.borderWidth}"` : '';
      return `<svg viewBox="0 0 100 100"${attrs}><circle cx="50" cy="50" r="49" fill="${fill}"${stroke ? ` stroke="${stroke}"${sw}` : ''}/></svg>`;
    }
    if (node.type === 'line') {
      const stroke = esc(node.style && (node.style.stroke || node.style.color || '#ffffff'));
      const sw = node.style && node.style.strokeWidth ? +node.style.strokeWidth : 3;
      return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" data-draw${attrs}><line x1="0" y1="0" x2="100" y2="100" stroke="${stroke}" stroke-width="${sw}"/></svg>`;
    }
    if (node.type === 'path') {
      const stroke = esc(node.style && node.style.stroke || 'currentColor');
      const fill = esc(node.style && node.style.fill || 'none');
      return `<svg viewBox="${esc(node.viewBox || '0 0 100 100')}" data-draw${attrs}><path d="${esc(node.d)}" stroke="${stroke}" fill="${fill}"></path></svg>`;
    }
    if (node.type === 'progress') {
      const h = (node.style && node.style.height) ? `${+node.style.height}px` : '8px';
      const bg = esc((node.style && node.style.background) || '#253247');
      const fill = esc(node.fill || (node.style && node.style.color) || '#2ee6d6');
      const r = (node.style && node.style.radius) ? `${+node.style.radius}px` : '4px';
      return `<div${attrs} style="height:${h};background:${bg};border-radius:${r}"><div data-grow style="height:100%;width:100%;background:${fill};border-radius:${r};transform-origin:left center"></div></div>`;
    }
    if (node.type === 'counter') {
      const target = Number(node.target == null ? 0 : node.target);
      const suffix = esc(node.suffix || '');
      const decimals = (Number.isFinite(node.decimals) && node.decimals >= 0) ? node.decimals : (Number.isInteger(target) ? 0 : 1);
      return `<span data-count="${target}" data-count-suffix="${suffix}"${attrs}>${(0).toFixed(decimals)}${suffix}</span>`;
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
  NODE_TYPES, ENTERS, ANIMATED_PROPERTIES, EASES, MARKS, DRIFTS,
  validateVisual, visualToHtml, dataAttrs, materializeVisualBodies,
};
