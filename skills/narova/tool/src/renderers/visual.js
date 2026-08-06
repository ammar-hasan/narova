'use strict';

/* Provider-neutral visual scene tree.
 *
 * `scene.body` remains the unrestricted HyperFrames surface. `scene.visual`
 * is the portable subset both bundled renderers understand. Keeping this
 * contract data-only makes it safe to persist in manifest.json and lets a
 * project carry a richer HyperFrames body beside a browserless fallback. */

const NODE_TYPES = new Set([
  'group', 'stack', 'rect', 'circle', 'line', 'path', 'text', 'image', 'svg',
  'progress', 'counter', 'canvas3d', 'model3d',
]);
const ENTERS = new Set(['none', 'fade', 'rise', 'slide-left', 'slide-right', 'zoom', 'pop']);
const ANIMATED_PROPERTIES = new Set(['x', 'y', 'scale', 'rotate', 'opacity', 'width', 'height', 'progress']);
const EASES = new Set(['linear', 'none', 'in', 'out', 'in-out', 'back',
  'power1.in', 'power1.out', 'power1.inOut', 'power2.in', 'power2.out', 'power2.inOut',
  'power3.in', 'power3.out', 'power3.inOut', 'power4.in', 'power4.out', 'power4.inOut',
  'back.in', 'back.out', 'back.inOut', 'elastic.in', 'elastic.out', 'elastic.inOut',
  'bounce.in', 'bounce.out', 'bounce.inOut', 'expo.in', 'expo.out', 'expo.inOut',
  'circ.in', 'circ.out', 'circ.inOut', 'sine.in', 'sine.out', 'sine.inOut',
]);
const MARKS = new Set(['underline', 'circle', 'box', 'highlight']);
const DRIFTS = new Set(['in', 'out', 'left', 'right', 'up', 'pano']);

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const LIGHT_TYPES = new Set(['ambient', 'directional', 'point', 'spot', 'hemisphere']);
const PRIMITIVE_TYPES = new Set(['cube', 'sphere', 'cylinder', 'plane', 'torus', 'cone', 'ring', 'icosahedron', 'dodecahedron', 'octahedron', 'tetrahedron', 'torusKnot', 'model']);

function validateThreeConfig(three, at, errors) {
  if (three.camera != null) {
    const c = three.camera;
    const ca = `${at}.camera`;
    if (c.fov != null && (typeof c.fov !== 'number' || c.fov <= 0 || c.fov > 179)) errors.push(`${ca}.fov: must be 1–179`);
    if (c.position != null && (!Array.isArray(c.position) || c.position.length !== 3 || c.position.some(v => !Number.isFinite(v)))) {
      errors.push(`${ca}.position: expected [x, y, z]`);
    }
    if (c.lookAt != null && (!Array.isArray(c.lookAt) || c.lookAt.length !== 3 || c.lookAt.some(v => !Number.isFinite(v)))) {
      errors.push(`${ca}.lookAt: expected [x, y, z]`);
    }
    if (c.near != null && (typeof c.near !== 'number' || c.near <= 0)) errors.push(`${ca}.near: must be positive`);
    if (c.far != null && (typeof c.far !== 'number' || c.far <= 0)) errors.push(`${ca}.far: must be positive`);
  }
  if (three.lights != null) {
    if (!Array.isArray(three.lights)) errors.push(`${at}.lights: expected an array`);
    else three.lights.forEach((l, i) => {
      const la = `${at}.lights[${i}]`;
      if (!l || typeof l !== 'object') { errors.push(`${la}: expected an object`); return; }
      if (!LIGHT_TYPES.has(l.type)) errors.push(`${la}.type: expected ${[...LIGHT_TYPES].join('|')}`);
      if (l.color != null && typeof l.color !== 'string') errors.push(`${la}.color: expected a hex string`);
      if (l.intensity != null && (typeof l.intensity !== 'number' || l.intensity < 0)) errors.push(`${la}.intensity: must be non-negative`);
      if ((l.type === 'directional' || l.type === 'point' || l.type === 'spot') && l.position != null) {
        if (!Array.isArray(l.position) || l.position.length !== 3 || l.position.some(v => !Number.isFinite(v))) {
          errors.push(`${la}.position: expected [x, y, z]`);
        }
      }
    });
  }
  if (three.objects != null) {
    if (!Array.isArray(three.objects)) errors.push(`${at}.objects: expected an array`);
    else three.objects.forEach((obj, i) => {
      const oa = `${at}.objects[${i}]`;
      if (!obj || typeof obj !== 'object') { errors.push(`${oa}: expected an object`); return; }
      if (!PRIMITIVE_TYPES.has(obj.type)) errors.push(`${oa}.type: expected ${[...PRIMITIVE_TYPES].join('|')}`);
      if (obj.type === 'model' && typeof obj.src !== 'string') errors.push(`${oa}.src: model file required for type "model"`);
      if (obj.color != null && typeof obj.color !== 'string') errors.push(`${oa}.color: expected a hex string`);
      if (obj.position != null && (!Array.isArray(obj.position) || obj.position.length !== 3 || obj.position.some(v => !Number.isFinite(v)))) {
        errors.push(`${oa}.position: expected [x, y, z]`);
      }
      if (obj.rotation != null && (!Array.isArray(obj.rotation) || obj.rotation.length !== 3 || obj.rotation.some(v => !Number.isFinite(v)))) {
        errors.push(`${oa}.rotation: expected [x, y, z] in radians`);
      }
      if (obj.scale != null) {
        const s = obj.scale;
        const ok = Array.isArray(s) ? (s.length === 3 && s.every(v => Number.isFinite(v) && v > 0))
          : (Number.isFinite(s) && s > 0);
        if (!ok) errors.push(`${oa}.scale: expected [x, y, z] or a positive number`);
      }
      if (obj.animate != null) {
        if (Array.isArray(obj.animate)) {
          obj.animate.forEach((anim, ai) => validateObjectAnimation(anim, `${oa}.animate[${ai}]`, errors));
        } else {
          validateObjectAnimation(obj.animate, `${oa}.animate`, errors);
        }
      }
      if (obj.keyframes != null) {
        if (!Array.isArray(obj.keyframes)) errors.push(`${oa}.keyframes: expected an array`);
        else obj.keyframes.forEach((kf, ki) => validateKeyframe(kf, `${oa}.keyframes[${ki}]`, errors));
      }
    });
  }
  if (three.background != null && typeof three.background !== 'string' && (typeof three.background !== 'object' || Array.isArray(three.background))) {
    errors.push(`${at}.background: expected a hex color string or { type, ... }`);
  }
  if (three.fog != null) {
    const f = three.fog;
    if (typeof f !== 'object' || Array.isArray(f)) errors.push(`${at}.fog: expected an object`);
    else {
      if (f.color != null && typeof f.color !== 'string') errors.push(`${at}.fog.color: expected a hex string`);
      if (f.near != null && typeof f.near !== 'number') errors.push(`${at}.fog.near: expected a number`);
      if (f.far != null && typeof f.far !== 'number') errors.push(`${at}.fog.far: expected a number`);
    }
  }
}

const ANIM_PROPS_3D = new Set(['position.x', 'position.y', 'position.z', 'rotation.x', 'rotation.y', 'rotation.z', 'scale.x', 'scale.y', 'scale.z', 'scale', 'opacity']);

function validateObjectAnimation(anim, at, errors) {
  if (!anim || typeof anim !== 'object') { errors.push(`${at}: expected an object`); return; }
  if (!ANIM_PROPS_3D.has(anim.property)) errors.push(`${at}.property: expected ${[...ANIM_PROPS_3D].join('|')}`);
  if (!Number.isFinite(anim.from) || !Number.isFinite(anim.to)) errors.push(`${at}: from and to must be numbers`);
  if (anim.duration != null && (!Number.isFinite(anim.duration) || anim.duration <= 0)) errors.push(`${at}.duration: must be positive`);
  if (anim.ease != null && !EASES.has(anim.ease)) errors.push(`${at}.ease: expected ${[...EASES].join('|')}`);
  if (anim.at != null) validateAt(anim.at, `${at}.at`, errors);
}

function validateKeyframe(kf, at, errors) {
  if (!kf || typeof kf !== 'object') { errors.push(`${at}: expected an object`); return; }
  if (!ANIM_PROPS_3D.has(kf.property)) errors.push(`${at}.property: expected ${[...ANIM_PROPS_3D].join('|')}`);
  if (!Number.isFinite(kf.to)) errors.push(`${at}.to: must be a number`);
  if (kf.duration != null && (!Number.isFinite(kf.duration) || kf.duration <= 0)) errors.push(`${at}.duration: must be positive`);
  if (kf.ease != null && !EASES.has(kf.ease)) errors.push(`${at}.ease: expected ${[...EASES].join('|')}`);
  if (kf.at != null) validateAt(kf.at, `${at}.at`, errors);
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
    if (node.type === 'model3d' && typeof node.src !== 'string') {
      errors.push(`${where}.src: model source (.glb, .gltf) required`);
    }
    if (node.type === 'canvas3d') {
      if (!node.three || typeof node.three !== 'object') {
        errors.push(`${where}.three: 3D scene config required for canvas3d`);
      } else {
        validateThreeConfig(node.three, `${where}.three`, errors);
      }
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
    if (node.type === 'model3d') {
      const src = esc(node.src || '');
      const color = esc((node.style && node.style.color) || '#ffffff');
      return `<div data-model3d data-model-src="${src}" data-model-color="${color}"${attrs}></div>`;
    }
    if (node.type === 'canvas3d') {
      const threeData = node.three ? esc(JSON.stringify(node.three)) : '{}';
      const canvasId = `three-${Math.random().toString(36).slice(2, 9)}`;
      return `<canvas id="${canvasId}" class="narova-three-canvas" data-three="${threeData}" data-three-id="${canvasId}"${attrs}></canvas>`;
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
  LIGHT_TYPES, PRIMITIVE_TYPES, ANIM_PROPS_3D,
  validateVisual, validateThreeConfig, visualToHtml, dataAttrs, materializeVisualBodies,
};
