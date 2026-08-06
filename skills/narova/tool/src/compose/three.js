'use strict';
/* Three.js composition for narova. Generates an import-map + ESM bootstrap and
 * managed <canvas> + <script> blocks that drive a deterministic Three.js scene
 * through the GSAP timeline. HyperFrames renders these in a real Chromium
 * browser with full WebGL.
 *
 * Three.js is pinned to r185 and VENDORED locally (tool/vendor/three/) as ESM —
 * the UMD core was dropped after r149, so ESM + import map is the only modern
 * path. Rendering never hits a CDN. */

const path = require('path');

const THREE_VERSION = '0.185.0';
// ESM distribution, vendored under tool/vendor/three/. HyperFrames' render
// runtime detects WebGL canvases and probes a canonical `/assets/three.core.js`
// for its three adapter, and its compiler bundles imported ESM with esbuild —
// three's unminified module re-exports have circular imports that break esbuild.
// `build/three.core.js` is the flattened full core (all renderers, one file,
// no circular re-exports), safe for the compiler to consume. We serve it at the
// canonical path so both our import and HyperFrames' probe hit the same file.
// (The minified three.core.min.js is only a math/objects subset — no WebGL.)
const THREE_IMPORT = './assets/three.core.js';
const THREE_VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor', 'three');
const THREE_MODULE_SRC = path.join(THREE_VENDOR_DIR, 'three.global.js');

/* The <head> snippet: three is served as a CLASSIC global script (an IIFE
 * bundle exposing window.THREE) rather than ESM. This is deliberate: HyperFrames'
 * render runtime detects WebGL canvases, probes /assets/three.core.js for its
 * three adapter, and its compiler runs esbuild over imported ESM — three's
 * module re-exports have circular imports that esbuild rejects, and a dynamic
 * import gets tree-shaken to a stub. A classic global script is opaque to the
 * compiler, so it is left alone. */
function threeHeadScripts() {
  return `\n  <script src="${THREE_IMPORT}"></script>\n`;
}

function esc(v) { return JSON.stringify(v); }
function fmt(n) { return String(Math.round(n * 1000) / 1000); }

function primitiveGeometry(type, obj) {
  const s = obj.size != null ? obj.size : 1;
  const w = Array.isArray(s) ? s[0] : s;
  const h = Array.isArray(s) ? (s[1] || w) : s;
  const d = Array.isArray(s) ? (s[2] || w) : s;
  switch (type) {
    case 'cube': return `new THREE.BoxGeometry(${w},${h},${d})`;
    case 'sphere': return `new THREE.SphereGeometry(${w},32,32)`;
    case 'cylinder': return `new THREE.CylinderGeometry(${w},${w},${h*2},32)`;
    case 'plane': return `new THREE.PlaneGeometry(${w},${h})`;
    case 'torus': return `new THREE.TorusGeometry(${w},${w*0.3},16,32)`;
    case 'cone': return `new THREE.ConeGeometry(${w},${h*2},32)`;
    case 'ring': return `new THREE.RingGeometry(${w*0.5},${w},32)`;
    case 'icosahedron': return `new THREE.IcosahedronGeometry(${w},0)`;
    case 'dodecahedron': return `new THREE.DodecahedronGeometry(${w},0)`;
    case 'octahedron': return `new THREE.OctahedronGeometry(${w},0)`;
    case 'tetrahedron': return `new THREE.TetrahedronGeometry(${w},0)`;
    case 'torusKnot': return `new THREE.TorusKnotGeometry(${w},${w*0.25},64,8)`;
    default: return 'new THREE.BoxGeometry(1,1,1)';
  }
}

function objectScaleJs(name, obj) {
  const scl = obj.scale;
  if (scl == null) return '';
  if (Array.isArray(scl)) return `${name}.scale.set(${scl[0]},${scl[1]},${scl[2]});`;
  return `${name}.scale.setScalar(${scl});`;
}

/* Geometry cache key: primitive type + size params uniquely identify the
 * buffer, so identical primitives share one geometry. */
function geometryKey(type, obj) {
  return `${type}${JSON.stringify(obj.size ?? null)}`;
}

/* Material cache key: color + wireframe + opacity. */
function materialKey(obj) {
  return `${obj.color || '#ffffff'}|${obj.wireframe ? 1 : 0}|${obj.opacity ?? 1}`;
}

/* A material that will be opacity-animated must NOT come from the shared cache
 * — tweening one mesh's material would mutate every same-keyed mesh. Emit a
 * fresh per-mesh material instead (identical shader, isolated uniforms). */
function meshMaterialJs(obj, animateOpacity) {
  if (animateOpacity) {
    const color = obj.color || '#ffffff';
    const wf = obj.wireframe ? 'true' : 'false';
    const opacity = obj.opacity ?? 1;
    return `new THREE.MeshStandardMaterial({color:${esc(color)},wireframe:${wf},opacity:${opacity},transparent:true})`;
  }
  return cachedMaterialJs(obj);
}

function animatesOpacity(anims) {
  if (!anims) return false;
  const list = Array.isArray(anims) ? anims : [anims];
  return list.some(a => a && a.property === 'opacity');
}

/* `_g("<key>",function(){return new THREE.X()})` — shared geometry lookup. */
function cachedGeometryJs(type, obj) {
  return `_g(${esc(geometryKey(type, obj))},function(){return ${primitiveGeometry(type, obj)}})`;
}

/* `_m("<key>",function(){return new THREE.MeshStandardMaterial({...})})`. */
function cachedMaterialJs(obj) {
  const color = obj.color || '#ffffff';
  const wf = obj.wireframe ? 'true' : 'false';
  const opacity = obj.opacity ?? 1;
  const transparent = opacity < 1 ? ',transparent:true' : '';
  return `_m(${esc(materialKey(obj))},function(){return new THREE.MeshStandardMaterial({color:${esc(color)},wireframe:${wf},opacity:${opacity}${transparent}})})`;
}

function animationTweens(objVar, obj, sceneStart) {
  const anims = obj.animate
    ? (Array.isArray(obj.animate) ? obj.animate : [obj.animate])
    : (obj.keyframes || []);
  if (!anims.length) return '';

  let js = '';
  anims.forEach((anim, ai) => {
    const prop = anim.property;
    const duration = anim.duration || 2;
    const ease = anim.ease || 'power2.inOut';
    let at = sceneStart;
    if (anim.at != null) {
      if (typeof anim.at === 'object' && anim.at.cue != null) {
        at = `(${sceneStart}+${anim.at.cue}*2+${anim.at.offset || 0})`;
      } else if (typeof anim.at === 'number') {
        at = `${sceneStart}+${anim.at}`;
      }
    }
    const parts = prop.split('.');
    if (parts.length === 2) {
      const axis = parts[1];
      if (axis === 'x' || axis === 'y' || axis === 'z') {
        // Use fromTo so the authored `from` is honored, not just the resting
        // position. Defaults to the authored position when `from` is unset.
        const from = Number.isFinite(anim.from) ? anim.from : 'undefined';
        js += `tl.fromTo(${objVar}.${parts[0]},{${axis}:${from === 'undefined' ? `Number(${objVar}.${parts[0]}.${axis})` : from}},{${axis}:${anim.to},duration:${duration},ease:${esc(ease)}},${at});`;
      }
    } else if (prop === 'scale') {
      const from = Number.isFinite(anim.from) ? anim.from : 1;
      js += `tl.fromTo(${objVar}.scale,{x:${from},y:${from},z:${from}},{x:${anim.to},y:${anim.to},z:${anim.to},duration:${duration},ease:${esc(ease)}},${at});`;
    } else if (prop === 'opacity') {
      // Opacity must work on a single mesh AND on a group/instanced mesh (a
      // Group has no .material — the old code threw here). Walk the object
      // tree and drive every descendant material's opacity from the tween,
      // which GSAP evaluates deterministically on each seek.
      const from = Number.isFinite(anim.from) ? anim.from : 1;
      const to = Number.isFinite(anim.to) ? anim.to : 0;
      js += `function _fade_${ai}(o,v){o.traverse(function(n){if(n.material){n.material.transparent=true;n.material.opacity=v;}});}`;
      js += `_fade_${ai}(${objVar},${from});`;
      js += `tl.fromTo({t:${from}},{t:${from}},{t:${to},duration:${duration},ease:${esc(ease)},onUpdate:function(){_fade_${ai}(${objVar},this.targets[0].t);}},${at});`;
    }
  });
  return js;
}

function threeSetupJs(sceneId, three, sceneStart, sceneDur, w, h) {
  const cam = three.camera || {};
  const fov = cam.fov || 45;
  const near = cam.near || 0.1;
  const far = cam.far || 100;
  const camPos = cam.position || [0, 0, 5];
  const look = cam.lookAt || [0, 0, 0];

  // Tone mapping + color space: default to ACES filmic for a video look. The
  // output color space is sRGB (the only sane target for h264). r185 (the
  // vendored ESM build) offers ACES, AgX, Neutral, and linear.
  const tm = three.toneMapping || 'aces';
  const tmExpr = tm === 'aces' ? 'THREE.ACESFilmicToneMapping'
    : tm === 'agx' ? 'THREE.AgXToneMapping'
    : tm === 'neutral' ? 'THREE.NeutralToneMapping'
    : 'THREE.NoToneMapping';
  const exposure = Number.isFinite(three.exposure) ? three.exposure : 1;

  // boot(): wait for the ESM bootstrap (window.THREE) and the GSAP timeline
  // (built after DOM parse) with a bounded number of attempts — an unbounded
  // poll would hang the renderer forever.
  let js = `(function(){var _try=0;function boot(){var tl=window.__timelines['main'];`;
  js += `if(!tl||!window.THREE){if(++_try>200){console.error('narova-three: THREE or GSAP timeline never became ready');return;}setTimeout(boot,50);return;}`;
  js += `var THREE=window.THREE;`;
  js += `var cvs=document.getElementById(${esc('three-' + sceneId)});`;
  js += `if(!cvs){cvs=document.getElementById(${esc(sceneId + '--three-' + sceneId)});}`;
  js += `cvs.style.width='100%';cvs.style.height='100%';`;
  js += `var R=new THREE.WebGLRenderer({canvas:cvs,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});`;
  js += `R.outputColorSpace=THREE.SRGBColorSpace;R.toneMapping=${tmExpr};R.toneMappingExposure=${exposure};`;
  js += `R.setPixelRatio(1);R.setSize(${w},${h});`;
  js += `var S=new THREE.Scene();`;
  // Shared geometry/material cache: identical primitives reuse one buffer and
  // one program — no per-mesh allocation, fewer draw calls.
  js += `var _geo={},_mat={};`;
  js += `function _g(k,f){return _geo[k]||(_geo[k]=f());}`;
  js += `function _m(k,f){return _mat[k]||(_mat[k]=f());}`;
  js += `var C=new THREE.PerspectiveCamera(${fov},${w}/${h},${near},${far});`;
  js += `C.position.set(${camPos[0]},${camPos[1]},${camPos[2]});`;
  js += `C.lookAt(${look[0]},${look[1]},${look[2]});`;
  // Pending model loads; the render driver waits for all of them before frame 0.
  js += `var _pending=[];`;

  if (three.background) {
    if (typeof three.background === 'string') {
      js += `S.background=new THREE.Color(${esc(three.background)});`;
    } else if (three.background && typeof three.background === 'object' && three.background.type === 'color') {
      js += `S.background=new THREE.Color(${esc(three.background.color || '#000000')});`;
    }
  }

  if (three.fog) {
    const fog = three.fog;
    js += `S.fog=new THREE.Fog(${esc(fog.color || '#000000')},${fog.near || 1},${fog.far || 50});`;
  }

  (three.lights || []).forEach((l, i) => {
    const c = l.color || '#ffffff';
    const int = l.intensity != null ? l.intensity : 1;
    if (l.type === 'ambient') {
      js += `S.add(new THREE.AmbientLight(${esc(c)},${int}));`;
    } else if (l.type === 'directional') {
      const p = l.position || [5, 5, 5];
      js += `var L${i}=new THREE.DirectionalLight(${esc(c)},${int});L${i}.position.set(${p[0]},${p[1]},${p[2]});S.add(L${i});`;
    } else if (l.type === 'point') {
      const p = l.position || [0, 0, 0];
      js += `var L${i}=new THREE.PointLight(${esc(c)},${int},${l.distance || 0},${l.decay || 2});L${i}.position.set(${p[0]},${p[1]},${p[2]});S.add(L${i});`;
    } else if (l.type === 'spot') {
      const p = l.position || [0, 5, 0];
      js += `var L${i}=new THREE.SpotLight(${esc(c)},${int});L${i}.position.set(${p[0]},${p[1]},${p[2]});S.add(L${i});`;
    } else if (l.type === 'hemisphere') {
      js += `S.add(new THREE.HemisphereLight(${esc(c)},${esc(l.groundColor || '#000000')},${int}));`;
    }
  });

  (three.objects || []).forEach((obj, i) => {
    const pos = obj.position || [0, 0, 0];
    const rot = obj.rotation || [0, 0, 0];
    const name = `O${i}`;

    if (obj.type === 'model') {
      // Deterministic glTF: prefetch the file to an ArrayBuffer, then parse.
      // GLTFLoader.load() fires an XHR mid-scene — the model could pop in
      // after frame 0. parseAsync keeps loading under our control, and the
      // render driver below is gated on _ready() resolving after every model
      // has been parsed, so frame 0 always shows the assembled scene.
      js += `var ${name}=new THREE.Group();`;
      js += `${name}.position.set(${pos[0]},${pos[1]},${pos[2]});`;
      js += `${name}.rotation.set(${rot[0]},${rot[1]},${rot[2]});${objectScaleJs(name, obj)}`;
      js += `S.add(${name});`;
      const assetSrc = `assets/${path.basename(obj.src)}`;
      js += `_pending.push(fetch(${esc(assetSrc)}).then(function(r){if(!r.ok)throw new Error('gltf '+${esc(assetSrc)}+' '+r.status);return r.arrayBuffer();}).then(function(buf){`;
      js += `return new THREE.GLTFLoader().parseAsync(buf,${esc(assetSrc)}).then(function(g){`;
      js += `${name}.add(g.scene);${animationTweens(name, obj, sceneStart)}`;
      js += `});}).catch(function(e){console.error('narova-three: model load failed',e);` +
        `${name}.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:${esc(obj.color || '#ff6363')},wireframe:true})));` +
        `}));`;
    } else if (obj.type === 'group') {
      // A reusable group of relative parts (e.g. a character built from
      // primitives). Group-level position/rotation/scale + animations apply
      // to the whole assembly; parts are children in local coordinates.
      js += `var ${name}=new THREE.Group();`;
      js += `${name}.position.set(${pos[0]},${pos[1]},${pos[2]});`;
      js += `${name}.rotation.set(${rot[0]},${rot[1]},${rot[2]});${objectScaleJs(name, obj)}`;
      js += `S.add(${name});`;
      (obj.children || []).forEach((child, ci) => {
        const cname = `${name}_p${ci}`;
        const cpos = child.position || [0, 0, 0];
        const crot = child.rotation || [0, 0, 0];
        const childAnims = child.animate
          ? (Array.isArray(child.animate) ? child.animate : [child.animate])
          : [];
        js += `var ${cname}=new THREE.Mesh(${cachedGeometryJs(child.type, child)},${meshMaterialJs(child, animatesOpacity(childAnims))});`;
        js += `${cname}.position.set(${cpos[0]},${cpos[1]},${cpos[2]});`;
        js += `${cname}.rotation.set(${crot[0]},${crot[1]},${crot[2]});${objectScaleJs(cname, child)}`;
        js += `${name}.add(${cname});`;
        js += animationTweens(cname, child, sceneStart);
      });
      js += animationTweens(name, obj, sceneStart);
    } else if (obj.instances && Array.isArray(obj.instances) && obj.instances.length) {
      // InstancedMesh: N copies of the same primitive share one draw call.
      // Each instance gets its own transform matrix; the whole object can
      // still be animated as one unit (group-level tween on the mesh).
      js += `var ${name}=new THREE.InstancedMesh(${cachedGeometryJs(obj.type, obj)},${meshMaterialJs(obj, animatesOpacity(obj.animate))},${obj.instances.length});`;
      js += `var _d=new THREE.Object3D();`;
      obj.instances.forEach((inst, ii) => {
        const ip = inst.position || [0, 0, 0];
        const ir = inst.rotation || [0, 0, 0];
        const is = inst.scale || [1, 1, 1];
        js += `_d.position.set(${ip[0]},${ip[1]},${ip[2]});_d.rotation.set(${ir[0]},${ir[1]},${ir[2]});_d.scale.set(${is[0]},${is[1]},${is[2]});_d.updateMatrix();${name}.setMatrixAt(${ii},_d.matrix);`;
      });
      js += `${name}.instanceMatrix.needsUpdate=true;S.add(${name});`;
      js += animationTweens(name, obj, sceneStart);
    } else {
      const pos = obj.position || [0, 0, 0];
      const rot = obj.rotation || [0, 0, 0];
      js += `var ${name}=new THREE.Mesh(${cachedGeometryJs(obj.type, obj)},${meshMaterialJs(obj, animatesOpacity(obj.animate))});`;
      js += `${name}.position.set(${pos[0]},${pos[1]},${pos[2]});`;
      js += `${name}.rotation.set(${rot[0]},${rot[1]},${rot[2]});${objectScaleJs(name, obj)}`;
      js += `S.add(${name});`;
      js += animationTweens(name, obj, sceneStart);
    }
  });

  js += `var T={n:0};`;
  js += `function _render(){R.render(S,C);}`;
  js += `tl.to(T,{n:${fmt(sceneDur*30)},duration:${fmt(sceneDur)},ease:'none',onUpdate:_render},${fmt(sceneStart)});`;
  // Wait for any glTF loads (frame 0 must show the assembled scene), then
  // render the resting frame. If a model hangs, still render after a timeout
  // rather than freezing the composition.
  js += `Promise.all(_pending).then(function(){_render();}).catch(function(){_render();});`;
  js += `setTimeout(_render,3000);`;
  js += `}boot();})();`;
  return js;
}

function threeSceneBody(scene, scData, w, h) {
  const canvas = `<canvas id="three-${scene.id}" class="narova-three-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>`;
  const setup = threeSetupJs(scene.id, scene.three, scData.start, scData.dur, w, h);
  return `<div class="narova-three-scene" style="position:absolute;inset:0">${canvas}<script>${setup}</script></div>`;
}

function hasThreeScenes(config) {
  return config.scenes.some(s => !!s.three);
}

function hasThreeModels(config) {
  return config.scenes.some(s =>
    s.three && s.three.objects && s.three.objects.some(o => o.type === 'model'),
  );
}

/* Collect model asset paths from scene.three configs so compose can copy them. */
function collectModelAssets(config) {
  const paths = [];
  for (const s of config.scenes) {
    if (!s.three || !s.three.objects) continue;
    for (const obj of s.three.objects) {
      if (obj.type === 'model' && obj.src && typeof obj.src === 'string') {
        paths.push(obj.src);
      }
    }
  }
  return paths;
}

module.exports = {
  THREE_VERSION, THREE_IMPORT, THREE_VENDOR_DIR, THREE_MODULE_SRC,
  threeHeadScripts, threeSetupJs, threeSceneBody, hasThreeScenes, hasThreeModels,
  collectModelAssets,
};
