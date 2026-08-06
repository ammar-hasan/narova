'use strict';
/* Semantic element compiler.
 *
 * Transforms renderer-independent `scene.elements` into:
 *   - scene.three (Three.js config for HyperFrames WebGL)
 *   - scene.body (HTML overlay for 2D text/shapes on top of 3D)
 *   - scene.visual (portable visual tree for no-browser fallback)
 *
 * This is the primary authoring model per the Narova Flexible Visual System
 * spec. scene.body and scene.three remain available for expert use; elements
 * are the recommended path for agents and new projects.
 *
 * Element types:
 *   camera, light, 3d-object, model, character, text, shape, image,
 *   video, effect, group
 *
 * Action types (semantic, renderer-independent):
 *   appear, disappear, move, rotate, scale, draw, speak, react, follow,
 *   transform, orbit, revolve
 *
 * Timing: actions bind to narration cues (0-based turn index) or scene time.
 */

const PRIMITIVE_KINDS = new Set([
  'cube', 'sphere', 'cylinder', 'plane', 'torus', 'cone', 'ring',
  'icosahedron', 'dodecahedron', 'octahedron', 'tetrahedron', 'torusKnot',
]);
const LIGHT_KINDS = new Set(['ambient', 'directional', 'point', 'spot', 'hemisphere']);
const ACTION_TYPES = new Set([
  'appear', 'disappear', 'move', 'rotate', 'scale', 'draw', 'speak',
  'react', 'follow', 'transform', 'orbit', 'revolve',
]);
const TWO_D_ELEMENTS = new Set(['text', 'shape', 'image', 'video']);
const THREE_D_ELEMENTS = new Set(['camera', 'light', '3d-object', 'model']);

function esc(v) { return JSON.stringify(v); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pad(n) { return n < 10 ? '0' + n : String(n); }

/* Resolve an action's trigger time relative to scene start.
 * at: number (seconds offset) | { cue: N, offset?: number } | null (scene start) */
function resolveActionAt(at, sceneStart) {
  if (at == null) return sceneStart;
  if (typeof at === 'number') return sceneStart + at;
  if (typeof at === 'object' && at.cue != null) {
    // cue is the narration turn index (0-based); approximate 2s per turn
    return `(${sceneStart}+${at.cue}*2+${at.offset || 0})`;
  }
  return sceneStart;
}

/* Convert a semantic element action to a GSAP/Three.js animation spec. */
function actionToAnim(action) {
  switch (action.type) {
    case 'rotate': {
      const axis = action.axis || 'y';
      return {
        property: `rotation.${axis}`,
        from: action.from || 0,
        to: action.to != null ? action.to : Math.PI * 2,
        duration: action.duration || 2,
        ease: action.ease || 'power2.inOut',
        at: action.at,
      };
    }
    case 'move': {
      const coord = action.to;
      if (!Array.isArray(coord) || coord.length < 3) return null;
      return [
        { property: 'position.x', from: action.from?.[0] || 0, to: coord[0], duration: action.duration || 1, ease: action.ease || 'power2.out', at: action.at },
        { property: 'position.y', from: action.from?.[1] || 0, to: coord[1], duration: action.duration || 1, ease: action.ease || 'power2.out', at: action.at },
        { property: 'position.z', from: action.from?.[2] || 0, to: coord[2], duration: action.duration || 1, ease: action.ease || 'power2.out', at: action.at },
      ];
    }
    case 'scale': {
      const s = action.to != null ? action.to : 1.5;
      return { property: 'scale', from: action.from || 1, to: s, duration: action.duration || 1, ease: action.ease || 'power2.out', at: action.at };
    }
    case 'appear':
    case 'disappear':
      return { property: 'opacity', from: action.type === 'appear' ? 0 : 1, to: action.type === 'appear' ? 1 : 0, duration: action.duration || 0.6, ease: 'power2.out', at: action.at };
    case 'orbit':
    case 'revolve':
      return { property: 'rotation.y', from: 0, to: Math.PI * 2, duration: action.duration || 6, ease: 'none', at: action.at };
    default:
      return null;
  }
}

/* Compile 3D elements into a scene.three config. */
function compileThreeScene(elements, characters) {
  const three = { camera: null, lights: [], objects: [], background: null, fog: null };

  for (const el of elements) {
    if (el.type === 'camera') {
      three.camera = {
        position: el.position || [0, 0, 5],
        lookAt: el.lookAt || [0, 0, 0],
        fov: el.fov || 45,
        near: el.near,
        far: el.far,
      };
    } else if (el.type === 'light') {
      three.lights.push({
        type: el.kind || 'ambient',
        color: el.color,
        intensity: el.intensity,
        position: el.position,
        distance: el.distance,
        decay: el.decay,
        groundColor: el.groundColor,
      });
    } else if (el.type === '3d-object' || el.type === 'model') {
      const obj = {
        type: el.kind || (el.type === 'model' ? 'model' : 'cube'),
        color: el.color,
        position: el.position,
        rotation: el.rotation,
        scale: el.scale,
        size: el.size,
        wireframe: el.wireframe,
        src: el.src,
        animate: [],
      };
      if (el.actions) {
        for (const action of el.actions) {
          const anim = actionToAnim(action);
          if (anim) {
            if (Array.isArray(anim)) obj.animate.push(...anim);
            else obj.animate.push(anim);
          }
        }
      }
      three.objects.push(obj);
    } else if (el.type === 'character') {
      const char = characters && el.ref ? characters[el.ref] : null;
      if (char) {
        three.objects.push(compileCharacterElement(el, char));
      }
    } else if (el.type === 'effect') {
      // Effects: particles, fog, post-processing — stub for now
      if (el.kind === 'fog' && el.color) {
        three.fog = { color: el.color, near: el.near || 1, far: el.far || 50 };
      }
    } else if (el.type === 'group' && el.children) {
      for (const child of el.children) {
        const result = compileThreeScene([child], characters);
        if (result.objects.length) three.objects.push(...result.objects);
        if (result.lights.length) three.lights.push(...result.lights);
      }
    }
  }

  if (three.background == null && elements.some(e => e.type === 'camera')) {
    // Default dark background for 3D scenes
  }
  if (elements.some(e => e.type === 'effect' && e.kind === 'background')) {
    const bg = elements.find(e => e.type === 'effect' && e.kind === 'background');
    three.background = bg.color || '#0a0a1a';
  }

  // Remove empty arrays / nulls
  if (!three.camera && !three.objects.length && !three.lights.length) return null;
  return three;
}

function compileCharacterElement(el, char) {
  return {
    type: 'model',
    src: char.model || char.src,
    position: el.position || char.defaultPosition || char.position || [0, -1, 0],
    rotation: el.rotation || char.defaultRotation || char.rotation || [0, 0, 0],
    scale: el.scale || [1, 1, 1],
    color: el.color,
    animate: (el.actions || []).map(actionToAnim).filter(Boolean).flat(),
  };
}

/* Compile 2D elements into an HTML body string. */
function compile2dBody(elements, characters) {
  const parts = [];
  let entryIndex = 0;

  for (const el of elements) {
    if (el.type === 'text') {
      parts.push(compileText(el, entryIndex++));
    } else if (el.type === 'shape') {
      parts.push(compileShape(el, entryIndex++));
    } else if (el.type === 'image') {
      parts.push(compileImage(el, entryIndex++));
    } else if (el.type === 'video') {
      parts.push(compileVideo(el, entryIndex++));
    } else if (el.type === 'group' && el.children) {
      const inner = compile2dBody(el.children, characters);
      parts.push(`<div class="s-center" style="gap:${esc(el.gap || 16)}px">${inner}</div>`);
      entryIndex++;
    }
  }

  return parts.join('\n');
}

/* Compute cue attributes for a 2D element based on its actions. */
function cueAttrs(el) {
  if (!el.actions) return '';
  const appear = el.actions.find(a => a.type === 'appear');
  if (!appear) return '';
  let cue = '';
  let delay = '';
  if (appear.at) {
    if (typeof appear.at === 'object' && appear.at.cue != null) {
      cue = ` data-cue="${appear.at.cue}"`;
      if (appear.at.offset) delay = ` data-delay="${appear.at.offset}"`;
    } else if (typeof appear.at === 'number') {
      delay = ` data-delay="${appear.at}"`;
    }
  }
  return ` class="cue"${cue}${delay}`;
}

function compileText(el, index) {
  const attrs = cueAttrs(el);
  const tag = el.tag || 'p';
  const style = el.style || {};
  let styleStr = '';
  if (style.fontSize) styleStr += `font-size:${style.fontSize}px;`;
  if (style.color) styleStr += `color:${style.color};`;
  if (style.fontWeight) styleStr += `font-weight:${style.fontWeight};`;
  if (style.textAlign) styleStr += `text-align:${style.textAlign};`;
  if (style.letterSpacing) styleStr += `letter-spacing:${style.letterSpacing}em;`;
  if (style.maxWidth) styleStr += `max-width:${style.maxWidth}px;`;
  const cls = el.class || '';
  return `<${tag}${attrs}${styleStr ? ` style="${styleStr}"` : ''}${cls ? ` class="${cls}"` : ''}>${escHtml(el.content || '')}</${tag}>`;
}

function compileShape(el, index) {
  const attrs = cueAttrs(el);
  const style = el.style || {};
  let css = '';
  if (style.width) css += `width:${style.width}px;`;
  if (style.height) css += `height:${style.height}px;`;
  if (style.background) css += `background:${style.background};`;
  if (style.radius) css += `border-radius:${style.radius}px;`;
  if (style.border) css += `border:${style.border};`;
  return `<div${attrs} style="${css}"></div>`;
}

function compileImage(el, index) {
  const attrs = cueAttrs(el);
  const style = el.style || {};
  let css = '';
  if (style.width) css += `width:${style.width}px;`;
  if (style.height) css += `height:${style.height}px;`;
  if (style.objectFit) css += `object-fit:${style.objectFit};`;
  return `<img src="${esc(el.src || '')}"${attrs}${css ? ` style="${css}"` : ''}>`;
}

function compileVideo(el, index) {
  const attrs = cueAttrs(el);
  const style = el.style || {};
  let css = '';
  if (style.width) css += `width:${style.width}px;`;
  if (style.height) css += `height:${style.height}px;`;
  return `<video src="${esc(el.src || '')}"${attrs}${css ? ` style="${css}"` : ''} muted loop playsinline></video>`;
}

/* Resolve scenes with elements config into the internal representation.
 * This is called during schema resolution. */
function resolveElementsScene(scene, config) {
  if (!scene.elements || !Array.isArray(scene.elements)) return scene;

  const characters = config.characters || {};
  const compiled = compileThreeScene(scene.elements, characters);
  const twoDBody = compile2dBody(scene.elements, characters);

  const result = { ...scene };

  if (compiled) {
    result.three = { ...compiled, ...(scene.three || {}) };
  }

  // 2D elements become HTML overlays on top of the 3D scene
  if (twoDBody) {
    if (compiled) {
      // Mixed 2D/3D: 2D elements overlay on top of the 3D canvas
      // Use absolute positioning so text floats over the 3D background
      const overlay = `<div class="narova-elements-overlay" style="position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:5%;pointer-events:none">${twoDBody}</div>`;
      result.body = (typeof scene.body === 'string' ? scene.body + overlay : overlay);
    } else {
      // Pure 2D: elements compile to body HTML
      // Wrap in center layout so text fits the scenebody centering
      const wrapper = `<div class="s-center">${twoDBody}</div>`;
      result.body = (typeof scene.body === 'string' && scene.body.trim()
        ? scene.body + '\n' + wrapper
        : wrapper);
    }
  }

  delete result.elements; // Consumed — not needed downstream
  return result;
}

/* Validate elements in a scene for schema.js */
function validateElements(elements, at, errors) {
  if (!Array.isArray(elements)) {
    errors.push(`${at}.elements: expected an array`);
    return;
  }
  elements.forEach((el, i) => {
    const ea = `${at}.elements[${i}]`;
    if (!el || typeof el !== 'object') { errors.push(`${ea}: expected an object`); return; }

    const validTypes = new Set(['camera', 'light', '3d-object', 'model', 'character',
      'text', 'shape', 'image', 'video', 'effect', 'group']);
    if (!validTypes.has(el.type)) {
      errors.push(`${ea}.type: expected ${[...validTypes].join('|')}`);
    }

    if (el.type === 'light' && !LIGHT_KINDS.has(el.kind)) {
      errors.push(`${ea}.kind: expected ${[...LIGHT_KINDS].join('|')}`);
    }
    if (((el.type === '3d-object') || el.type === 'model') && el.kind && !PRIMITIVE_KINDS.has(el.kind) && el.kind !== 'model') {
      errors.push(`${ea}.kind: expected ${[...PRIMITIVE_KINDS].join('|')} or "model"`);
    }
    if (el.type === 'text' && typeof el.content !== 'string' && !el.content) {
      errors.push(`${ea}.content: text content required`);
    }
    if ((el.type === 'image' || el.type === 'model' || el.type === 'video')
        && typeof el.src !== 'string') {
      errors.push(`${ea}.src: source path required`);
    }
    if (el.type === 'character' && typeof el.ref !== 'string') {
      errors.push(`${ea}.ref: character ID required`);
    }
    if (el.actions) {
      if (!Array.isArray(el.actions)) errors.push(`${ea}.actions: expected an array`);
      else el.actions.forEach((a, ai) => {
        if (!a || typeof a !== 'object') { errors.push(`${ea}.actions[${ai}]: expected an object`); return; }
        if (!ACTION_TYPES.has(a.type)) {
          errors.push(`${ea}.actions[${ai}].type: expected ${[...ACTION_TYPES].join('|')}`);
        }
      });
    }
    if (el.type === 'group' && el.children) {
      validateElements(el.children, `${ea}.children`, errors);
    }
  });
}

function hasElements(config) {
  return config.scenes.some(s => !!s.elements);
}

module.exports = {
  resolveElementsScene,
  validateElements,
  hasElements,
  PRIMITIVE_KINDS, LIGHT_KINDS, ACTION_TYPES,
};
