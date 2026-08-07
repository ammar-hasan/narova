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

/* Deterministic seeded PRNG (mulberry32). Generates the same sequence of
 * pseudo-random numbers from the same seed. Used for particle positions so the
 * same project + scene + object produces identical layouts across builds.
 * The seed is derived during compose from the scene id and object index.
 * An explicit per-object seed (obj.prngSeed) overrides the default. */
function prngJs(seed) {
  // mulberry32: fast, 32-bit state, deterministic
  return `function(){var s=${seed >>> 0};return function(){s|=0;s=s+0x6D2B79F5|0;var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)|0;return((t^t>>>14)>>>0)/4294967296;}}()`;
}
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

/* Material cache key: color + wireframe + opacity + PBR props. */
function materialKey(obj) {
  const extra = obj._cacheKey || '';
  return `${obj.color || '#ffffff'}|${obj.wireframe ? 1 : 0}|${obj.opacity ?? 1}${extra ? '|' + extra : ''}`;
}

/* PBR surface properties shared by every material factory. */
function pbrPropsJs(obj) {
  const parts = [];
  if (obj.roughness != null) parts.push(`roughness:${obj.roughness}`);
  if (obj.metalness != null) parts.push(`metalness:${obj.metalness}`);
  if (obj.emissive) parts.push(`emissive:${esc(obj.emissive)}`);
  if (obj.emissiveIntensity != null) parts.push(`emissiveIntensity:${obj.emissiveIntensity}`);
  return parts.join(',');
}

/* Build a cache-key fragment that includes PBR props so materials that differ
 * only in roughness/metalness/emissive don't collide in the shared cache. */
function pbrCacheKey(obj) {
  let k = '';
  const pbr = pbrPropsJs(obj);
  if (pbr) k = pbr.replace(/:/g, '=').replace(/"/g, '');
  return k;
}

/* A material that will be opacity-animated must NOT come from the shared cache
 * — tweening one mesh's material would mutate every same-keyed mesh. Emit a
 * fresh per-mesh material instead (identical shader, isolated uniforms). */
function meshMaterialJs(obj, animateOpacity) {
  if (animateOpacity) {
    const color = obj.color || '#ffffff';
    const wf = obj.wireframe ? 'true' : 'false';
    const opacity = obj.opacity ?? 1;
    const pbr = pbrPropsJs(obj);
    const pbrPart = pbr ? ',' + pbr : '';
    return `new THREE.MeshStandardMaterial({color:${esc(color)},wireframe:${wf},opacity:${opacity},transparent:true${pbrPart}})`;
  }
  obj._cacheKey = pbrCacheKey(obj);
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
  const pbr = pbrPropsJs(obj);
  const pbrPart = pbr ? ',' + pbr : '';
  return `_m(${esc(materialKey(obj))},function(){return new THREE.MeshStandardMaterial({color:${esc(color)},wireframe:${wf},opacity:${opacity}${transparent}${pbrPart}})})`;
}

function animationTweens(objVar, obj, sceneStart, turns) {
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
        // Resolve cue to the measured turn start time (scene-local seconds).
        // turns[] is the measured turn start array from timings.json.
        const cueIndex = anim.at.cue;
        if (turns && Array.isArray(turns) && cueIndex >= 0 && cueIndex < turns.length) {
          at = sceneStart + turns[cueIndex] + (anim.at.offset || 0);
        } else {
          // Fallback: approximate ~2s per turn for planning/pre-synthesis.
          at = `(${sceneStart}+${cueIndex}*2+${anim.at.offset || 0})`;
        }
      } else if (typeof anim.at === 'number') {
        at = `${sceneStart}+${anim.at}`;
      }
    }
    if (anim.wait != null) {
      at = typeof at === 'number' ? at + anim.wait : `(${at}+${anim.wait})`;
    }
    const loop = anim.loop ? ',repeat:-1' : '';
    const parts = prop.split('.');
    if (parts.length === 2) {
      const axis = parts[1];
      if (axis === 'x' || axis === 'y' || axis === 'z') {
        // Use fromTo so the authored `from` is honored, not just the resting
        // position. Defaults to the authored position when `from` is unset.
        const from = Number.isFinite(anim.from) ? anim.from : 'undefined';
        js += `tl.fromTo(${objVar}.${parts[0]},{${axis}:${from === 'undefined' ? `Number(${objVar}.${parts[0]}.${axis})` : from}},{${axis}:${anim.to},duration:${duration},ease:${esc(ease)}${loop}},${at});`;
      }
    } else if (prop === 'scale') {
      const from = Number.isFinite(anim.from) ? anim.from : 1;
      js += `tl.fromTo(${objVar}.scale,{x:${from},y:${from},z:${from}},{x:${anim.to},y:${anim.to},z:${anim.to},duration:${duration},ease:${esc(ease)}${loop}},${at});`;
    } else if (prop === 'opacity') {
      // Opacity must work on a single mesh AND on a group/instanced mesh (a
      // Group has no .material — the old code threw here). Walk the object
      // tree and drive every descendant material's opacity from the tween,
      // which GSAP evaluates deterministically on each seek.
      const from = Number.isFinite(anim.from) ? anim.from : 1;
      const to = Number.isFinite(anim.to) ? anim.to : 0;
      js += `function _fade_${ai}(o,v){o.traverse(function(n){if(n.material){n.material.transparent=true;n.material.opacity=v;}});}`;
      js += `_fade_${ai}(${objVar},${from});`;
      js += `tl.fromTo({t:${from}},{t:${from}},{t:${to},duration:${duration},ease:${esc(ease)}${loop},onUpdate:function(){_fade_${ai}(${objVar},this.targets[0].t);}},${at});`;
    }
  });
  return js;
}

const TEXTURE_MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];

/* Generate loading code for texture maps on an object. Textures are loaded
 * before frame 0 through the `_pending` promise gating, same as glTF models. */
function textureLoadJs(varName, obj) {
  let code = '';
  for (const mapType of TEXTURE_MAPS) {
    const src = obj[mapType];
    if (!src || typeof src !== 'string') continue;
    const assetPath = `assets/${path.basename(src)}`;
    code += `_pending.push(new Promise(function(_res){new THREE.TextureLoader().load(${esc(assetPath)},function(_tex){`;
    code += `_tex.colorSpace=THREE.SRGBColorSpace;`;
    code += `${varName}.material.${mapType}=_tex;`;
    code += `${varName}.material.needsUpdate=true;`;
    code += `_res();`;
    code += `},undefined,function(){_res();`;        // don't block on load failure
    code += `console.error('narova-three: texture load failed',${esc(assetPath)});`;
    code += `});}));`;
  }
  return code;
}

/* Collect all texture asset paths from a three config for copying. */
function collectTextureAssets(three) {
  const paths = [];
  for (const obj of (three.objects || [])) {
    for (const mapType of TEXTURE_MAPS) {
      if (typeof obj[mapType] === 'string') paths.push(obj[mapType]);
    }
  }
  return paths;
}

function threeSetupJs(sceneId, three, sceneStart, sceneDur, w, h, turns) {
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
  // Shadow maps: enabled only when at least one light or object requests them.
  const hasShadows = (three.lights || []).some(l => l.shadow) ||
    (three.objects || []).some(o => o.castShadow || o.receiveShadow ||
      (o.children || []).some(c => c.castShadow || c.receiveShadow));
  if (hasShadows) {
    js += `R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;`;
  }
  js += `var S=new THREE.Scene();`;
  // Shared geometry/material cache: identical primitives reuse one buffer and
  // one program — no per-mesh allocation, fewer draw calls.
  js += `var _geo={},_mat={};`;
  js += `function _g(k,f){return _geo[k]||(_geo[k]=f());}`;
  js += `function _m(k,f){return _mat[k]||(_mat[k]=f());}`;
  js += `var C=new THREE.PerspectiveCamera(${fov},${w}/${h},${near},${far});`;
  js += `C.position.set(${camPos[0]},${camPos[1]},${camPos[2]});`;
  js += `C.lookAt(${look[0]},${look[1]},${look[2]});`;
  // Camera animation: position, lookAt target, or fov (zoom).
  const camAnims = three.cameraAnimate
    ? (Array.isArray(three.cameraAnimate) ? three.cameraAnimate : [three.cameraAnimate])
    : [];
  if (camAnims.length) {
    js += `var _camTarget=new THREE.Object3D();_camTarget.position.set(${look[0]},${look[1]},${look[2]});S.add(_camTarget);`;
    camAnims.forEach((anim, ai) => {
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
      if (prop === 'fov') {
        const from = Number.isFinite(anim.from) ? anim.from : fov;
        js += `tl.fromTo(C,{fov:${from}},{fov:${anim.to},duration:${duration},ease:${esc(ease)},onUpdate:function(){C.updateProjectionMatrix();}},${at});`;
      } else if (prop === 'position.x' || prop === 'position.y' || prop === 'position.z') {
        const axis = prop.split('.')[1];
        const from = Number.isFinite(anim.from) ? anim.from : 'undefined';
        js += `tl.fromTo(C.position,{${axis}:${from === 'undefined' ? `C.position.${axis}` : from}},{${axis}:${anim.to},duration:${duration},ease:${esc(ease)}},${at});`;
      } else if (prop === 'lookAt.x' || prop === 'lookAt.y' || prop === 'lookAt.z') {
        const axis = prop.split('.')[1];
        const from = Number.isFinite(anim.from) ? anim.from : 'undefined';
        js += `tl.fromTo(_camTarget.position,{${axis}:${from === 'undefined' ? `_camTarget.position.${axis}` : from}},{${axis}:${anim.to},duration:${duration},ease:${esc(ease)}},${at});`;
        js += `C.lookAt(_camTarget.position);`;
      }
    });
    // If any lookAt animations present, bind the camera to the target on every frame.
    if (camAnims.some(a => a.property && a.property.startsWith('lookAt'))) {
      js += `var _origRender=_render;_render=function(){C.lookAt(_camTarget.position);_origRender();};`;
    }
  }
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

  // IBL environment map: loads an equirectangular texture, generates a
  // prefiltered PMREM, and sets it as scene.environment for PBR materials.
  if (three.envMap) {
    const envCfg = typeof three.envMap === 'string' ? { src: three.envMap } : three.envMap;
    const envSrc = `assets/${path.basename(envCfg.src)}`;
    const envIntensity = envCfg.intensity != null ? envCfg.intensity : 1;
    js += `_pending.push(new Promise(function(_res){new THREE.TextureLoader().load(${esc(envSrc)},function(_tex){`;
    js += `_tex.colorSpace=THREE.SRGBColorSpace;_tex.mapping=THREE.EquirectangularReflectionMapping;`;
    js += `var _pmrem=new THREE.PMREMGenerator(R);_pmrem.compileEquirectangularShader();`;
    js += `var _envMap=_pmrem.fromEquirectangular(_tex).texture;_pmrem.dispose();`;
    js += `S.environment=_envMap;S.environmentIntensity=${envIntensity};`;
    if (envCfg.background) js += `S.background=_envMap;`;
    js += `_res();},undefined,function(){_res();console.error('narova-three: envMap load failed');});}));`;
  }

  (three.lights || []).forEach((l, i) => {
    const c = l.color || '#ffffff';
    const int = l.intensity != null ? l.intensity : 1;
    if (l.type === 'ambient') {
      js += `S.add(new THREE.AmbientLight(${esc(c)},${int}));`;
    } else if (l.type === 'directional') {
      const p = l.position || [5, 5, 5];
      js += `var L${i}=new THREE.DirectionalLight(${esc(c)},${int});`;
      js += `L${i}.position.set(${p[0]},${p[1]},${p[2]});`;
      if (l.shadow) {
        const sm = l.shadowMapSize || 1024;
        const sc = l.shadowCamera || 10;
        js += `L${i}.castShadow=true;`;
        js += `L${i}.shadow.mapSize.width=${sm};L${i}.shadow.mapSize.height=${sm};`;
        js += `L${i}.shadow.camera.near=0.5;L${i}.shadow.camera.far=50;`;
        js += `L${i}.shadow.camera.left=-${sc};L${i}.shadow.camera.right=${sc};`;
        js += `L${i}.shadow.camera.top=${sc};L${i}.shadow.camera.bottom=-${sc};`;
        if (l.shadowBias != null) js += `L${i}.shadow.bias=${l.shadowBias};`;
      }
      js += `S.add(L${i});`;
    } else if (l.type === 'point') {
      const p = l.position || [0, 0, 0];
      js += `var L${i}=new THREE.PointLight(${esc(c)},${int},${l.distance || 0},${l.decay || 2});`;
      js += `L${i}.position.set(${p[0]},${p[1]},${p[2]});`;
      if (l.shadow) {
        const sm = l.shadowMapSize || 512;
        js += `L${i}.castShadow=true;`;
        js += `L${i}.shadow.mapSize.width=${sm};L${i}.shadow.mapSize.height=${sm};`;
        if (l.shadowBias != null) js += `L${i}.shadow.bias=${l.shadowBias};`;
      }
      js += `S.add(L${i});`;
    } else if (l.type === 'spot') {
      const p = l.position || [0, 5, 0];
      js += `var L${i}=new THREE.SpotLight(${esc(c)},${int});`;
      js += `L${i}.position.set(${p[0]},${p[1]},${p[2]});`;
      if (l.shadow) {
        const sm = l.shadowMapSize || 1024;
        js += `L${i}.castShadow=true;`;
        js += `L${i}.shadow.mapSize.width=${sm};L${i}.shadow.mapSize.height=${sm};`;
        if (l.shadowBias != null) js += `L${i}.shadow.bias=${l.shadowBias};`;
      }
      js += `S.add(L${i});`;
    } else if (l.type === 'hemisphere') {
      js += `S.add(new THREE.HemisphereLight(${esc(c)},${esc(l.groundColor || '#000000')},${int}));`;
    }
  });
  // AnimationMixer stack for playing glTF animation clips.
  const hasModelAnims = (three.objects || []).some(o => o.type === 'model' && o.playAnimations);
  if (hasModelAnims) js += `var _mixers=[];`;

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
      js += `${name}.add(g.scene);`;
      if (obj.playAnimations) {
        js += `if(g.animations&&g.animations.length){var ${name}Mixer=new THREE.AnimationMixer(${name});`;
        js += `${name}Mixer.clipAction(g.animations[0]).play();`;
        js += `_mixers.push({m:${name}Mixer,start:${fmt(sceneStart)}});}`;
      }
      js += `${animationTweens(name, obj, sceneStart, turns)}`;
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
        if (child.castShadow) js += `${cname}.castShadow=true;`;
        if (child.receiveShadow) js += `${cname}.receiveShadow=true;`;
        js += `${name}.add(${cname});`;
        js += textureLoadJs(cname, child);
        js += animationTweens(cname, child, sceneStart, turns);
      });
      js += animationTweens(name, obj, sceneStart, turns);
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
      js += `${name}.instanceMatrix.needsUpdate=true;`;
      if (obj.castShadow) js += `${name}.castShadow=true;`;
      if (obj.receiveShadow) js += `${name}.receiveShadow=true;`;
      js += `S.add(${name});`;
      js += textureLoadJs(name, obj);
      js += animationTweens(name, obj, sceneStart, turns);
    } else if (obj.type === 'particles') {
      const count = obj.count || 100;
      const spread = obj.spread || [1, 1, 1];
      const pcolor = obj.color || '#ffffff';
      const psize = obj.size || 0.1;
      const popacity = obj.opacity ?? 1;
      // Deterministic seed: derived from scene + object identity.
      // An explicit prngSeed on the object overrides the default.
      const pseed = obj.prngSeed != null ? obj.prngSeed
        : (hashString(sceneId + ':particles:' + i) >>> 0);
      js += `var ${name}Geo=new THREE.BufferGeometry();`;
      js += `var _pPos=new Float32Array(${count}*3);`;
      js += `var _rng=${prngJs(pseed)};`;
      js += `for(var _pi=0;_pi<${count};_pi++){_pPos[_pi*3]=(_rng()-0.5)*${spread[0]};_pPos[_pi*3+1]=_rng()*${spread[1]};_pPos[_pi*3+2]=(_rng()-0.5)*${spread[2]};}`;
      js += `${name}Geo.setAttribute('position',new THREE.BufferAttribute(_pPos,3));`;
      js += `var ${name}Mat=new THREE.PointsMaterial({color:${esc(pcolor)},size:${psize},transparent:${popacity < 1 ? 'true' : 'false'},opacity:${popacity},blending:THREE.AdditiveBlending,depthWrite:false});`;
      if (obj.texture) {
        const texPath = `assets/${path.basename(obj.texture)}`;
        js += `_pending.push(new Promise(function(_res){new THREE.TextureLoader().load(${esc(texPath)},function(_tex){${name}Mat.map=_tex;${name}Mat.needsUpdate=true;_res();},undefined,function(){_res();});}));`;
      }
      js += `var ${name}=new THREE.Points(${name}Geo,${name}Mat);`;
      const ppos = obj.position || [0, 0, 0];
      js += `${name}.position.set(${ppos[0]},${ppos[1]},${ppos[2]});`;
      js += `S.add(${name});`;
      if (obj.animated !== false) {
        js += `tl.to(${name}.rotation,{y:Math.PI*2,duration:${obj.rotateDuration || 8},ease:'none',repeat:-1},${fmt(sceneStart)});`;
      }
      js += animationTweens(name, obj, sceneStart, turns);
    } else {
      const pos = obj.position || [0, 0, 0];
      const rot = obj.rotation || [0, 0, 0];
      js += `var ${name}=new THREE.Mesh(${cachedGeometryJs(obj.type, obj)},${meshMaterialJs(obj, animatesOpacity(obj.animate))});`;
      js += `${name}.position.set(${pos[0]},${pos[1]},${pos[2]});`;
      js += `${name}.rotation.set(${rot[0]},${rot[1]},${rot[2]});${objectScaleJs(name, obj)}`;
      if (obj.castShadow) js += `${name}.castShadow=true;`;
      if (obj.receiveShadow) js += `${name}.receiveShadow=true;`;
      js += `S.add(${name});`;
      js += textureLoadJs(name, obj);
      js += animationTweens(name, obj, sceneStart);
    }
  });

  js += `var T={n:0};`;
  js += `function _render(){`;
  if (hasModelAnims) js += `var _t=tl.time();for(var _mi=0;_mi<_mixers.length;_mi++)_mixers[_mi].m.setTime(_t-_mixers[_mi].start);`;
  js += `R.render(S,C);}`;
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
  const turns = scData.turns || [];
  const canvas = `<canvas id="three-${scene.id}" class="narova-three-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>`;
  const setup = threeSetupJs(scene.id, scene.three, scData.start, scData.dur, w, h, turns);
  return `<div class="narova-three-scene" style="position:absolute;inset:0">${canvas}<script>${setup}</script></div>`;
}

/* scene.threeModule — the raw Three.js escape hatch.
 *
 * Builds the deterministic shell (WebGLRenderer + Scene + PerspectiveCamera,
 * tone-mapped, sRGB, pixelRatio 1, same capture-safe flags as the declarative
 * path) and then inlines the author's module body into the bootstrap scope.
 * The module runs with these names available:
 *
 *   THREE      the Three.js library (r185 global bundle)
 *   scene      the THREE.Scene (add your objects to it)
 *   camera     the THREE.PerspectiveCamera (move it freely)
 *   renderer   the THREE.WebGLRenderer
 *   tl         the paused GSAP timeline — register ALL tweens on it
 *              (frames are rendered by seeking tl; never drive your own rAF)
 *   seed       deterministic integer (project + scene hash) — derive PRNGs from it
 *   size       { w, h } render size in pixels
 *   duration   scene duration in seconds
 *   assets(name)   resolves a project asset filename to "assets/<name>"
 *   pending    array — push Promises for async loads (textures, models);
 *               the resting frame waits for all of them before painting
 *   onRender(fn)   register a per-frame callback (called on every timeline seek)
 *   narova     { prng(seed), cueTurn(i) } helpers
 *
 * Determinism contract (same as choreography): no Date, Math.random,
 * requestAnimationFrame, setTimeout, or fetch — check.js lints these.
 * Given the same project state + seed + assets, output reproduces exactly.
 *
 * Optional `scene.three` config (camera, toneMapping, fog, background, envMap,
 * lights) is still honored as the shell so authors can mix declarative setup
 * with raw code. If `scene.three` is absent, neutral defaults are used. */
function threeModuleSetupJs(sceneId, three, moduleContents, sceneStart, sceneDur, w, h, turns) {
  const cfg = three || {};
  const cam = cfg.camera || {};
  const fov = cam.fov || 45;
  const near = cam.near || 0.1;
  const far = cam.far || 100;
  const camPos = cam.position || [0, 0, 5];
  const look = cam.lookAt || [0, 0, 0];
  const tm = cfg.toneMapping || 'aces';
  const tmExpr = tm === 'aces' ? 'THREE.ACESFilmicToneMapping'
    : tm === 'agx' ? 'THREE.AgXToneMapping'
    : tm === 'neutral' ? 'THREE.NeutralToneMapping'
    : 'THREE.NoToneMapping';
  const exposure = Number.isFinite(cfg.exposure) ? cfg.exposure : 1;
  // Deterministic seed derived from the scene id (same scheme as particles).
  const seed = (hashString('threeModule:' + sceneId) >>> 0);

  let js = `(function(){var _try=0;function boot(){var tl=window.__timelines['main'];`;
  js += `if(!tl||!window.THREE){if(++_try>200){console.error('narova-three: THREE or GSAP timeline never became ready');return;}setTimeout(boot,50);return;}`;
  js += `var THREE=window.THREE;`;
  js += `var cvs=document.getElementById(${esc('three-' + sceneId)});`;
  js += `if(!cvs){cvs=document.getElementById(${esc(sceneId + '--three-' + sceneId)});}`;
  js += `cvs.style.width='100%';cvs.style.height='100%';`;
  js += `var renderer=new THREE.WebGLRenderer({canvas:cvs,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});`;
  js += `renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=${tmExpr};renderer.toneMappingExposure=${exposure};`;
  js += `renderer.setPixelRatio(1);renderer.setSize(${w},${h});`;
  js += `var scene=new THREE.Scene();`;
  js += `var camera=new THREE.PerspectiveCamera(${fov},${w}/${h},${near},${far});`;
  js += `camera.position.set(${camPos[0]},${camPos[1]},${camPos[2]});camera.lookAt(${look[0]},${look[1]},${look[2]});`;
  // Optional declarative shell: background, fog, lights (so authors can mix).
  if (cfg.background) {
    const bg = typeof cfg.background === 'string' ? cfg.background : (cfg.background.color || '#000000');
    js += `scene.background=new THREE.Color(${esc(bg)});`;
  }
  if (cfg.fog) {
    js += `scene.fog=new THREE.Fog(${esc(cfg.fog.color || '#000000')},${cfg.fog.near || 1},${cfg.fog.far || 50});`;
  }
  // Helpers exposed to the module.
  js += `var seed=${seed};`;
  js += `var size={w:${w},h:${h}};`;
  js += `var duration=${fmt(sceneDur)};`;
  js += `var pending=[];`;
  js += `function assets(name){return 'assets/'+name;}`;
  // Seeded mulberry32 PRNG factory (matches the declarative particles PRNG).
  js += `function narovaPrng(s){s=(s>>>0)||1;return function(){s=s+0x6D2B79F5|0;var t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)|0;return((t^t>>>14)>>>0)/4294967296;};}`;
  js += `var _turns=${esc(turns || [])};`;
  js += `var narova={prng:narovaPrng,cueTurn:function(i){return (i>=0&&i<_turns.length)?_turns[i]:0;}};`;
  // Per-frame render callbacks: the timeline driver calls _render() on every
  // seek; the default callback paints the scene. Modules may add callbacks
  // (e.g. to advance a procedural simulation) via onRender(fn).
  js += `var _renderFns=[function(){renderer.render(scene,camera);}];`;
  js += `function _render(){for(var i=0;i<_renderFns.length;i++){_renderFns[i]();}}`;
  js += `function onRender(fn){if(typeof fn==='function')_renderFns.push(fn);}`;
  // Author module body. Wrapped so a throw is reported, not swallowed, and
  // never silently produces a blank canvas.
  js += `try{`;
  js += `/* scene.threeModule: ${esc(sceneId)} */\n${moduleContents}\n`;
  js += `}catch(e){console.error('narova threeModule "${esc(sceneId)}" threw:',e);}`;
  // Frame driver: walk the timeline across the scene span, rendering on seek.
  js += `var T={n:0};tl.to(T,{n:${fmt(sceneDur * 30)},duration:${fmt(sceneDur)},ease:'none',onUpdate:_render},${fmt(sceneStart)});`;
  // Resting frame: wait for any module-pushed async loads, then paint. The
  // 3s timeout mirrors the declarative path so a hung load can't freeze the
  // composition.
  js += `Promise.all(pending).then(_render).catch(_render);`;
  js += `setTimeout(_render,3000);`;
  js += `}boot();})();`;
  return js;
}

function threeModuleSceneBody(scene, scData, w, h) {
  const turns = scData.turns || [];
  const canvas = `<canvas id="three-${scene.id}" class="narova-three-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"></canvas>`;
  const setup = threeModuleSetupJs(scene.id, scene.three, scene._threeModuleContents, scData.start, scData.dur, w, h, turns);
  return `<div class="narova-three-scene" style="position:absolute;inset:0">${canvas}<script>${setup}</script></div>`;
}

function hasThreeScenes(config) {
  return config.scenes.some(s => !!(s.three || s._threeModuleContents));
}

function hasThreeModules(config) {
  return config.scenes.some(s => !!s._threeModuleContents);
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

/* Simple string hash for deterministic seed derivation (djb2). */
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

module.exports = {
  THREE_VERSION, THREE_IMPORT, THREE_VENDOR_DIR, THREE_MODULE_SRC,
  threeHeadScripts, threeSetupJs, threeSceneBody, threeModuleSetupJs, threeModuleSceneBody,
  hasThreeScenes, hasThreeModels, hasThreeModules, collectModelAssets, collectTextureAssets,
};
