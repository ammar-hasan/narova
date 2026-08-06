'use strict';
/* Three.js composition for narova. Generates managed <canvas> + <script>
 * blocks that drive a deterministic Three.js scene through the GSAP timeline.
 * HyperFrames renders these in a real Chromium browser with full WebGL. */

const path = require('path');

const THREE_VERSION = '0.149.0';
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.min.js`;
const THREE_LOCAL = 'assets/narova-three.min.js';
const GLTF_LOADER_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/js/loaders/GLTFLoader.js`;
const GLTF_LOADER_LOCAL = 'assets/narova-gltf-loader.js';

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
        js += `tl.to(${objVar}.${parts[0]},{${axis}:${anim.to},duration:${duration},ease:${esc(ease)}},${at});`;
      }
    } else if (prop === 'scale') {
      js += `tl.to(${objVar}.scale,{x:${anim.to},y:${anim.to},z:${anim.to},duration:${duration},ease:${esc(ease)}},${at});`;
    } else if (prop === 'opacity' && anim.from != null) {
      js += `${objVar}.material.opacity=${anim.from};${objVar}.material.transparent=true;`;
      js += `tl.to(${objVar}.material,{opacity:${anim.to},duration:${duration},ease:${esc(ease)}},${at});`;
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

  let js = `(function(){function boot(){var tl=window.__timelines['main'];if(!tl){setTimeout(boot,50);return;}`;
  js += `var cvs=document.getElementById(${esc('three-' + sceneId)});`;
  js += `if(!cvs){cvs=document.getElementById(${esc(sceneId + '--three-' + sceneId)});}`;
  js += `cvs.style.width='100%';cvs.style.height='100%';`;
  js += `var R=new THREE.WebGLRenderer({canvas:cvs,alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});`;
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
      js += `var ${name}=new THREE.Group();`;
      js += `${name}.position.set(${pos[0]},${pos[1]},${pos[2]});`;
      js += `${name}.rotation.set(${rot[0]},${rot[1]},${rot[2]});${objectScaleJs(name, obj)}`;
      js += `S.add(${name});`;
      const assetSrc = `assets/${path.basename(obj.src)}`;
      js += `new THREE.GLTFLoader().load(${esc(assetSrc)},function(g){`;
      js += `${name}.add(g.scene);${animationTweens(name, obj, sceneStart)}`;
      js += `},undefined,function(){${name}.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:${esc(obj.color || '#ff6363')},wireframe:true})));});`;
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
        js += `var ${cname}=new THREE.Mesh(${cachedGeometryJs(child.type, child)},${cachedMaterialJs(child)});`;
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
      js += `var ${name}=new THREE.InstancedMesh(${cachedGeometryJs(obj.type, obj)},${cachedMaterialJs(obj)},${obj.instances.length});`;
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
      const color = obj.color || '#ffffff';
      const wf = obj.wireframe ? 'true' : 'false';
      js += `var ${name}=new THREE.Mesh(${cachedGeometryJs(obj.type, obj)},${cachedMaterialJs(obj)});`;
      js += `${name}.position.set(${pos[0]},${pos[1]},${pos[2]});`;
      js += `${name}.rotation.set(${rot[0]},${rot[1]},${rot[2]});${objectScaleJs(name, obj)}`;
      js += `S.add(${name});`;
      js += animationTweens(name, obj, sceneStart);
    }
  });

  js += `var T={n:0};`;
  js += `tl.to(T,{n:${fmt(sceneDur*30)},duration:${fmt(sceneDur)},ease:'none',onUpdate:function(){R.render(S,C);}},${fmt(sceneStart)});`;
  js += `R.render(S,C);`;
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
  THREE_CDN, THREE_LOCAL, GLTF_LOADER_CDN, GLTF_LOADER_LOCAL,
  threeSetupJs, threeSceneBody, hasThreeScenes, hasThreeModels,
  collectModelAssets,
};
