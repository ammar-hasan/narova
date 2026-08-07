'use strict';

/* Browserless local renderer: provider-neutral visuals -> Skia PNG frames ->
 * FFmpeg MP4. HTML/CSS is intentionally not interpreted. Unsupported input is
 * rejected before a frame is written so a fallback can never silently lower
 * an approved HyperFrames composition. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDir, probe, sh, which } = require('../util');
const { composeData } = require('../compose/data');
const { validateVisual } = require('./visual');

const PROVIDER_VERSION = '1.0.0';
const TRANSITIONS = new Set(['fade', 'wipe', 'slide', 'zoom']);

function canvasModule() {
  try { return require('@napi-rs/canvas'); }
  catch (error) {
    const toolDir = path.resolve(__dirname, '../..');
    const wrapped = new Error(`no-browser renderer needs @napi-rs/canvas; run \`npm install --prefix ${toolDir}\`, then retry`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function fontkitModule() {
  try { return require('fontkit'); }
  catch (error) {
    const toolDir = path.resolve(__dirname, '../..');
    const wrapped = new Error(`no-browser complex-script text needs fontkit; run \`npm install --prefix ${toolDir}\`, then retry`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function defaultArabicFont() {
  try {
    return require.resolve('@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff2');
  } catch (error) {
    const toolDir = path.resolve(__dirname, '../..');
    const wrapped = new Error(`no-browser Arabic-script text needs the bundled Noto Sans Arabic font; run \`npm install --prefix ${toolDir}\`, then retry`);
    wrapped.cause = error;
    throw wrapped;
  }
}

function defaultLatinFont() {
  try {
    return require.resolve('@fontsource/noto-sans-arabic/files/noto-sans-arabic-latin-700-normal.woff2');
  } catch (error) {
    const toolDir = path.resolve(__dirname, '../..');
    const wrapped = new Error(`no-browser mixed-script text needs the bundled Noto Sans Arabic latin subset; run \`npm install --prefix ${toolDir}\`, then retry`);
    wrapped.cause = error;
    throw wrapped;
  }
}

const ARABIC_SCRIPT = /[\u0600-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;

function validateConfig(config) {
  const errors = [];
  for (let i = 0; i < config.scenes.length; i++) {
    const scene = config.scenes[i];
    if (!scene.visual) {
      errors.push(`config.scenes[${i}].visual: required by no-browser renderer (HTML body is HyperFrames-only)`);
    } else errors.push(...validateVisual(scene.visual, `config.scenes[${i}].visual`));
    if (scene.walkthrough && !scene.clip) {
      errors.push(`config.scenes[${i}].walkthrough: captured walkthrough composition is not supported by no-browser yet; provide scene.clip as the explicit full-frame fallback`);
    }
    if (!TRANSITIONS.has(scene.transition || 'fade')) {
      errors.push(`config.scenes[${i}].transition: no-browser supports ${[...TRANSITIONS].join('|')}`);
    }
  }
  if (errors.length) throw new Error('No-browser renderer cannot compose this project:\n  - ' + errors.join('\n  - '));
}

function slug(value) {
  return String(value || 'narova').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'narova';
}

function timingsFor(config, outDir) {
  const timingsPath = path.join(outDir, 'timings.json');
  if (!fs.existsSync(timingsPath)) {
    throw new Error('compose needs out/timings.json and out/audio/full.wav — run `narova synth` first');
  }
  const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  if (config.narrationSource && Array.isArray(config.narrationSource.wordTimings)) {
    const cues = config.narrationSource.wordTimings;
    let cursor = 0;
    for (const scene of config.scenes) {
      const entry = timings[scene.id] || (timings[scene.id] = { dur: scene.dur || 0 });
      const end = Math.round((cursor + entry.dur) * 1e6) / 1e6;
      entry.turns = entry.turns || [];
      entry.words = cues.filter(cue => cue.start < end - 1e-6 && cue.end > cursor + 1e-6)
        .flatMap((cue, si) => (cue.words || []).map(word => ({
          w: word.text || word.w || '',
          t0: Math.max(0, word.start - cursor),
          t1: Math.max(0, word.end - cursor),
          who: cue.who || scene.vo[0]?.who || Object.keys(config.voices)[0] || 'a',
          si,
        })));
      cursor = end;
    }
  }
  for (const scene of config.scenes) {
    const entry = timings[scene.id];
    if (entry) {
      entry.turns = entry.turns || [];
      entry.words = entry.words || [];
    }
  }
  return timings;
}

function copyAudio(config, outDir, noBrowserDir) {
  const mix = path.join(outDir, 'audio', 'mix.wav');
  const full = path.join(outDir, 'audio', 'full.wav');
  const external = config.narrationSource && config.narrationSource.file;
  const source = fs.existsSync(mix) ? mix : (external && fs.existsSync(external) ? external : full);
  if (!source || !fs.existsSync(source)) {
    throw new Error('no-browser compose needs narration audio — run `narova synth` first');
  }
  const audioDir = ensureDir(path.join(noBrowserDir, 'audio'));
  fs.copyFileSync(source, path.join(audioDir, 'narration.wav'));
}

function compose(config, outDir) {
  validateConfig(config);
  ensureDir(outDir);
  const timings = timingsFor(config, outDir);
  const data = composeData(config, timings);
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('no-browser-')) {
      fs.rmSync(path.join(outDir, entry.name), { recursive: true, force: true });
    }
  }
  const noBrowserDir = ensureDir(path.join(outDir, `no-browser-${slug(config.title)}`));
  const assetsDir = ensureDir(path.join(noBrowserDir, 'assets'));
  if (config.assetsDir) fs.cpSync(config.assetsDir, assetsDir, { recursive: true });

  const scenes = config.scenes.map(scene => {
    let clip = null;
    if (scene.clip) {
      const source = path.resolve(config.projectDir, scene.clip);
      const ext = path.extname(source) || '.mp4';
      clip = `assets/clip-${scene.id}${ext}`;
      fs.copyFileSync(source, path.join(noBrowserDir, clip));
    }
    return {
      id: scene.id,
      visual: scene.visual,
      transition: scene.transition || 'fade',
      clip,
    };
  });
  copyAudio(config, outDir, noBrowserDir);

  const project = {
    protocol: 'narova-renderer-provider/v1',
    provider: 'no-browser',
    providerVersion: PROVIDER_VERSION,
    title: config.title,
    size: config.size,
    fps: 30,
    theme: config.theme || {},
    mode: config.mode || 'dark',
    chrome: config.chrome || {},
    voices: config.voices || {},
    captions: config.captions || {},
    scenes,
    timeline: data,
  };
  fs.writeFileSync(path.join(noBrowserDir, 'project.json'), JSON.stringify(project, null, 2) + '\n');
  return { dir: noBrowserDir, project: noBrowserDir, total: data.total, scenes: data.scenes.length };
}

function readProject(dir) {
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) throw new Error(`no-browser project missing: ${file}; run narova compose first`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function n(value, total, fallback = 0) {
  if (typeof value === 'string' && /^-?[0-9.]+%$/.test(value)) return parseFloat(value) * total / 100;
  return Number.isFinite(value) ? value : fallback;
}

function padding(value) {
  if (Array.isArray(value)) {
    if (value.length === 2) return { t: +value[0] || 0, r: +value[1] || 0, b: +value[0] || 0, l: +value[1] || 0 };
    if (value.length === 4) return { t: +value[0] || 0, r: +value[1] || 0, b: +value[2] || 0, l: +value[3] || 0 };
  }
  const all = +value || 0;
  return { t: all, r: all, b: all, l: all };
}

function inset(box, pad) {
  return { x: box.x + pad.l, y: box.y + pad.t, w: Math.max(0, box.w - pad.l - pad.r), h: Math.max(0, box.h - pad.t - pad.b) };
}

function childRect(style, parent) {
  const width = n(style.width, parent.w, parent.w);
  const height = n(style.height, parent.h, parent.h);
  return { x: parent.x + n(style.x, parent.w, 0), y: parent.y + n(style.y, parent.h, 0), w: width, h: height };
}

function layoutTree(root, width, height, rootInset = {}) {
  const frames = new Map();
  function visit(node, box, forced = false, isRoot = false) {
    const style = node.style || {};
    const frame = forced ? box : childRect(style, box);
    frames.set(node, frame);
    let content = inset(frame, padding(style.padding));
    if (isRoot) {
      content = inset(content, {
        t: +rootInset.t || 0, r: +rootInset.r || 0,
        b: +rootInset.b || 0, l: +rootInset.l || 0,
      });
    }
    const children = node.children || [];
    if (!children.length) return;
    if (node.type !== 'stack') {
      children.forEach(child => visit(child, content));
      return;
    }
    const row = style.direction === 'row';
    const main = row ? 'width' : 'height';
    const cross = row ? 'height' : 'width';
    const available = row ? content.w : content.h;
    const crossAvailable = row ? content.h : content.w;
    const gap = n(style.gap, available, 0);
    let fixed = gap * Math.max(0, children.length - 1);
    let flexTotal = 0;
    const specs = children.map(child => {
      const cs = child.style || {};
      if (cs.position === 'absolute') return { absolute: true, child };
      if (cs[main] != null) {
        const value = n(cs[main], available, 0);
        fixed += value;
        return { child, value, flex: 0 };
      }
      const flex = Number.isFinite(cs.flex) && cs.flex > 0 ? cs.flex : 1;
      flexTotal += flex;
      return { child, value: 0, flex };
    });
    const remaining = Math.max(0, available - fixed);
    let cursor = row ? content.x : content.y;
    for (const spec of specs) {
      const cs = spec.child.style || {};
      if (spec.absolute) { visit(spec.child, content); continue; }
      const mainSize = spec.flex ? remaining * spec.flex / flexTotal : spec.value;
      const crossSize = cs[cross] == null ? crossAvailable : n(cs[cross], crossAvailable, crossAvailable);
      const align = cs.alignSelf || style.align || 'stretch';
      let crossOffset = 0;
      if (align === 'center') crossOffset = (crossAvailable - crossSize) / 2;
      else if (align === 'end') crossOffset = crossAvailable - crossSize;
      const childBox = row
        ? { x: cursor, y: content.y + crossOffset, w: mainSize, h: align === 'stretch' ? crossAvailable : crossSize }
        : { x: content.x + crossOffset, y: cursor, w: align === 'stretch' ? crossAvailable : crossSize, h: mainSize };
      visit(spec.child, childBox, true);
      cursor += mainSize + gap;
    }
  }
  visit(root, { x: 0, y: 0, w: width, h: height }, true, true);
  return frames;
}

function ease(name, t) {
  const x = Math.max(0, Math.min(1, t));
  if (name === 'linear') return x;
  if (name === 'in') return x * x * x;
  if (name === 'in-out') return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  if (name === 'back') {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
  return 1 - Math.pow(1 - x, 3);
}

function cueAt(at, scene) {
  if (Number.isFinite(at)) return at;
  if (at && Number.isInteger(at.cue)) return (scene.turns[at.cue] || 0) + (at.offset || 0);
  return 0.1;
}

function animatedState(node, localTime, scene) {
  const style = node.style || {};
  const state = {
    x: 0, y: 0, scale: Number.isFinite(style.scale) ? style.scale : 1,
    rotate: Number.isFinite(style.rotate) ? style.rotate : 0,
    opacity: Number.isFinite(style.opacity) ? style.opacity : 1,
    width: null, height: null, progress: node.value,
  };
  if (node.enter) {
    const enter = typeof node.enter === 'string' ? { type: node.enter } : node.enter;
    const type = enter.type || 'fade';
    const start = cueAt(enter.at, scene);
    const duration = enter.duration || 0.55;
    const p = ease(type === 'pop' ? 'back' : 'out', (localTime - start) / duration);
    if (localTime < start) state.opacity = 0;
    else if (localTime < start + duration) {
      if (type !== 'none') state.opacity *= p;
      if (type === 'rise') state.y += 26 * (1 - p);
      if (type === 'slide-left') state.x -= 60 * (1 - p);
      if (type === 'slide-right') state.x += 60 * (1 - p);
      if (type === 'zoom') state.scale *= 0.86 + 0.14 * p;
      if (type === 'pop') state.scale *= 0.65 + 0.35 * p;
    }
  }
  for (const animation of node.animate || []) {
    const start = cueAt(animation.at, scene);
    const p = ease(animation.ease || 'in-out', (localTime - start) / animation.duration);
    const value = animation.from + (animation.to - animation.from) * p;
    if (localTime >= start) state[animation.property] = value;
  }
  if (node.drift) {
    const p = Math.max(0, Math.min(1, localTime / scene.dur));
    if (node.drift === 'in') state.scale *= 1 + 0.1 * p;
    if (node.drift === 'out') state.scale *= 1.1 - 0.1 * p;
    if (node.drift === 'left') { state.scale *= 1.12; state.x += 30 - 60 * p; }
    if (node.drift === 'right') { state.scale *= 1.12; state.x += -30 + 60 * p; }
    if (node.drift === 'up') { state.scale *= 1.12; state.y += 24 - 48 * p; }
  }
  return state;
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(+radius || 0, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function gradientLine(frame, angle) {
  const rad = angle * Math.PI / 180;
  const dx = Math.sin(rad), dy = -Math.cos(rad);
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  const t = (Math.abs(frame.w * dx) + Math.abs(frame.h * dy)) / 2;
  return { x0: cx - dx * t, y0: cy - dy * t, x1: cx + dx * t, y1: cy + dy * t };
}

function paint(ctx, value, frame) {
  if (!value || typeof value === 'string') return value || 'transparent';
  if (value.type === 'linear' && Array.isArray(value.stops)) {
    let gradient;
    if (value.from || value.to) {
      const from = value.from || [0, 0], to = value.to || [1, 1];
      gradient = ctx.createLinearGradient(
        frame.x + n(from[0], frame.w), frame.y + n(from[1], frame.h),
        frame.x + n(to[0], frame.w, frame.w), frame.y + n(to[1], frame.h, frame.h),
      );
    } else {
      const line = gradientLine(frame, value.angle == null ? 135 : value.angle);
      gradient = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);
    }
    value.stops.forEach(stop => gradient.addColorStop(stop.at, stop.color));
    return gradient;
  }
  return value.color || 'transparent';
}

function imageFrom(canvas, source, baseDir, cache) {
  const key = source.markup ? `markup:${source.markup}` : path.resolve(baseDir, source.src);
  if (cache.has(key)) return cache.get(key);
  const image = new canvas.Image();
  if (source.markup) image.src = Buffer.from(source.markup);
  else image.src = fs.readFileSync(key);
  const isSvg = !!source.markup || /\.svg$/i.test(key);
  if (isSvg) {
    cache.set(key, image);
    return image;
  }
  // @napi-rs/canvas 1.x exposes raster dimensions synchronously but decodes
  // pixels asynchronously. Keep the renderer synchronous and deterministic by
  // asking FFmpeg (already a core Narova dependency) for RGBA once, then cache
  // an offscreen Skia canvas.
  const decoded = spawnSync('ffmpeg', [
    '-loglevel', 'error', '-i', key, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { encoding: null, maxBuffer: Math.max(16 * 1024 * 1024, image.width * image.height * 5) });
  if (decoded.error || decoded.status !== 0 || decoded.stdout.length !== image.width * image.height * 4) {
    throw new Error(`no-browser renderer could not decode raster image: ${key}`);
  }
  const surface = canvas.createCanvas(image.width, image.height);
  const pixels = new Uint8ClampedArray(decoded.stdout.buffer, decoded.stdout.byteOffset, decoded.stdout.byteLength);
  surface.getContext('2d').putImageData(new canvas.ImageData(pixels, image.width, image.height), 0, 0);
  cache.set(key, surface);
  return surface;
}

function fitImage(ctx, image, frame, fit = 'cover') {
  if (fit === 'fill') { ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h); return; }
  const scale = fit === 'contain'
    ? Math.min(frame.w / image.width, frame.h / image.height)
    : Math.max(frame.w / image.width, frame.h / image.height);
  const w = image.width * scale, h = image.height * scale;
  ctx.drawImage(image, frame.x + (frame.w - w) / 2, frame.y + (frame.h - h) / 2, w, h);
}

function wrapText(ctx, text, width) {
  const words = String(text).split(/\s+/u);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > width) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function fontSupports(font, text) {
  for (const character of String(text)) {
    if (/\s/u.test(character)) continue;
    if (!font.hasGlyphForCodePoint(character.codePointAt(0))) return false;
  }
  return true;
}

function shapingFont(node, env) {
  const style = node.style || {};
  const text = String(node.text || '');
  if (style.direction !== 'rtl') return null;
  const preferred = style.fontFile ? path.resolve(env.baseDir, style.fontFile) : null;
  const arabicFallback = ARABIC_SCRIPT.test(text) ? defaultArabicFont() : null;
  const latinFallback = defaultLatinFont();
  const candidates = [...new Set([preferred, arabicFallback, latinFallback].filter(Boolean))];
  if (!candidates.length) {
    throw new Error('no-browser complex-script text needs style.fontFile pointing to a font with the required glyphs');
  }
  const fontkit = fontkitModule();
  if (!env.fonts) env.fonts = new Map();
  for (const file of candidates) {
    if (!fs.existsSync(file)) throw new Error(`no-browser shaping font not found: ${file}`);
    let font = env.fonts.get(file);
    if (!font) { font = fontkit.openSync(file); env.fonts.set(file, font); }
    if (fontSupports(font, text)) return font;
  }
  // No single font in the chain covers every character (mixed-script text).
  // Returns null so the caller falls back to Skia canvas text, which does
  // automatic bidi + font fallback across the GlobalFonts-registered fonts
  // and system fonts. This prevents e.g. an Urdu caption ending in "!" from
  // failing the entire render.
  return null;
}

function shapeRun(font, text, style = {}) {
  const direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
  const language = style.language || (ARABIC_SCRIPT.test(text) ? 'urd' : null);
  return font.layout(text, [], null, language, direction);
}

function shapedLines(font, text, width, size, style) {
  const scale = size / font.unitsPerEm;
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) { lines.push(shapeRun(font, '', style)); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const run = shapeRun(font, candidate, style);
      if (line && run.advanceWidth * scale > width) {
        lines.push(shapeRun(font, line, style));
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(shapeRun(font, line, style));
  }
  return lines;
}

function drawGlyphRun(ctx, run, x, baseline, scale, env) {
  ctx.save();
  ctx.translate(x, baseline);
  ctx.scale(scale, -scale);
  let cursorX = 0, cursorY = 0;
  run.glyphs.forEach((glyph, index) => {
    const position = run.positions[index];
    ctx.save();
    ctx.translate(cursorX + position.xOffset, cursorY + position.yOffset);
    ctx.fill(new env.canvas.Path2D(glyph.path.toSVG()));
    ctx.restore();
    cursorX += position.xAdvance;
    cursorY += position.yAdvance;
  });
  ctx.restore();
}

function drawShapedText(ctx, node, frame, env, font, size) {
  const style = node.style || {};
  const scale = size / font.unitsPerEm;
  const lines = shapedLines(font, node.text, frame.w, size, style).slice(0, style.maxLines || 1000);
  const lineHeight = size * (+style.lineHeight || 1.25);
  const blockHeight = lines.length * lineHeight;
  const top = style.verticalAlign === 'center' ? frame.y + (frame.h - blockHeight) / 2 : frame.y;
  const align = style.textAlign || (style.direction === 'rtl' ? 'right' : 'left');
  lines.forEach((run, index) => {
    const width = run.advanceWidth * scale;
    const x = align === 'center'
      ? frame.x + (frame.w - width) / 2
      : (align === 'right' ? frame.x + frame.w - width : frame.x);
    const baseline = top + index * lineHeight + run.bbox.maxY * scale;
    drawGlyphRun(ctx, run, x, baseline, scale, env);
  });
}

function drawText(ctx, node, frame, env) {
  const style = node.style || {};
  const size = +style.fontSize || Math.max(18, frame.h * 0.35);
  const weight = style.fontWeight || 600;
  const family = style.fontFamily || 'sans-serif';
  ctx.fillStyle = style.color || '#ffffff';
  const font = shapingFont(node, env);
  if (font) {
    drawShapedText(ctx, node, frame, env, font, size);
    return;
  }
  ctx.font = `${weight} ${size}px ${JSON.stringify(family)}`;
  ctx.textBaseline = 'top';
  ctx.direction = style.direction === 'rtl' ? 'rtl' : 'ltr';
  const align = style.textAlign || (style.direction === 'rtl' ? 'right' : 'left');
  ctx.textAlign = align;
  const x = align === 'center' ? frame.x + frame.w / 2 : (align === 'right' ? frame.x + frame.w : frame.x);
  const lineHeight = size * (+style.lineHeight || 1.15);
  const lines = wrapText(ctx, node.text, frame.w).slice(0, style.maxLines || 1000);
  const blockHeight = lines.length * lineHeight;
  const y = style.verticalAlign === 'center' ? frame.y + (frame.h - blockHeight) / 2 : frame.y;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight, frame.w));
}

function drawNode(ctx, node, frames, localTime, scene, env) {
  const base = frames.get(node);
  const style = node.style || {};
  const state = animatedState(node, localTime, scene);
  const frame = {
    x: base.x + state.x, y: base.y + state.y,
    w: state.width == null ? base.w : state.width,
    h: state.height == null ? base.h : state.height,
  };
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, state.opacity));
  const cx = frame.x + frame.w / 2, cy = frame.y + frame.h / 2;
  ctx.translate(cx, cy); ctx.rotate(state.rotate * Math.PI / 180); ctx.scale(state.scale, state.scale); ctx.translate(-cx, -cy);
  if (style.shadowColor) {
    ctx.shadowColor = style.shadowColor; ctx.shadowBlur = +style.shadowBlur || 16;
    ctx.shadowOffsetX = +style.shadowX || 0; ctx.shadowOffsetY = +style.shadowY || 8;
  }
  if (style.overflow === 'hidden' || style.clip) {
    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, style.radius); ctx.clip();
  }
  if (style.background && node.type !== 'circle') {
    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, style.radius);
    ctx.fillStyle = paint(ctx, style.background, frame); ctx.fill();
  }
  if (style.borderWidth && node.type !== 'circle') {
    roundRect(ctx, frame.x, frame.y, frame.w, frame.h, style.radius);
    ctx.strokeStyle = style.borderColor || '#ffffff'; ctx.lineWidth = style.borderWidth; ctx.stroke();
  }

  if (node.type === 'circle') {
    ctx.beginPath(); ctx.arc(cx, cy, Math.min(frame.w, frame.h) / 2, 0, Math.PI * 2);
    ctx.fillStyle = paint(ctx, style.fill || style.background || '#ffffff', frame); ctx.fill();
    if (style.borderWidth) {
      ctx.strokeStyle = style.borderColor || '#ffffff';
      ctx.lineWidth = style.borderWidth;
      ctx.stroke();
    }
  } else if (node.type === 'line') {
    ctx.beginPath(); ctx.moveTo(frame.x, frame.y);
    ctx.lineTo(frame.x + frame.w, frame.y + frame.h);
    ctx.strokeStyle = style.stroke || style.color || '#ffffff'; ctx.lineWidth = +style.strokeWidth || 3; ctx.stroke();
  } else if (node.type === 'path') {
    const p = new env.canvas.Path2D(node.d);
    const view = String(node.viewBox || '0 0 100 100').trim().split(/\s+/).map(Number);
    ctx.save(); ctx.translate(frame.x, frame.y); ctx.scale(frame.w / (view[2] || 100), frame.h / (view[3] || 100));
    if (style.fill && style.fill !== 'none') { ctx.fillStyle = style.fill; ctx.fill(p); }
    if (style.stroke || !style.fill) { ctx.strokeStyle = style.stroke || '#ffffff'; ctx.lineWidth = +style.strokeWidth || 2; ctx.stroke(p); }
    ctx.restore();
  } else if (node.type === 'text') drawText(ctx, node, frame, env);
  else if (node.type === 'image' || node.type === 'svg') {
    const image = imageFrom(env.canvas, node, env.baseDir, env.images);
    fitImage(ctx, image, frame, style.fit || 'cover');
  } else if (node.type === 'progress') {
    const value = Math.max(0, Math.min(1, Number(state.progress == null ? node.value || 0 : state.progress)));
    roundRect(ctx, frame.x, frame.y, frame.w * value, frame.h, style.radius);
    ctx.fillStyle = node.fill || style.color || '#2ee6d6'; ctx.fill();
  }
  for (const child of node.children || []) drawNode(ctx, child, frames, localTime, scene, env);
  ctx.restore();
}

function activeScene(project, time) {
  for (let i = project.timeline.scenes.length - 1; i >= 0; i--) {
    const scene = project.timeline.scenes[i];
    if (time >= scene.start) return { timeline: scene, source: project.scenes[i], index: i };
  }
  return { timeline: project.timeline.scenes[0], source: project.scenes[0], index: 0 };
}

function transitionState(scene, localTime, index) {
  if (index === 0 || localTime >= 0.7) return { opacity: 1, x: 0, scale: 1, wipe: 1 };
  const p = ease('out', localTime / 0.7);
  if (scene.transition === 'slide') return { opacity: p, x: 90 * (1 - p), scale: 1, wipe: 1 };
  if (scene.transition === 'zoom') return { opacity: p, x: 0, scale: 1.08 - 0.08 * p, wipe: 1 };
  if (scene.transition === 'wipe') return { opacity: 1, x: 0, scale: 1, wipe: p };
  return { opacity: p, x: 0, scale: 1, wipe: 1 };
}

function drawCaptions(ctx, project, time, env) {
  const group = project.timeline.groups.find(g => time >= g.start && time < g.end);
  if (!group || !group.words.length) return;
  const width = project.size.w, height = project.size.h;
  const fontSize = Math.max(24, Math.round(width * 0.035));
  const paddingX = fontSize * 0.75, paddingY = fontSize * 0.42;
  const captionText = group.words.map(word => word.w).join(' ');
  const strongCharacters = [...captionText].filter(character => /[\p{L}\p{N}]/u.test(character));
  const rtl = strongCharacters.length > 0 && strongCharacters.every(character => ARABIC_SCRIPT.test(character));
  const shapedNode = { text: captionText, style: { direction: rtl ? 'rtl' : 'ltr' } };
  const font = rtl ? shapingFont(shapedNode, env) : null;
  const fontScale = font ? fontSize / font.unitsPerEm : null;
  ctx.save();
  ctx.font = `800 ${fontSize}px sans-serif`;
  const gap = fontSize * 0.24;
  const wordRuns = font ? group.words.map(word => shapeRun(font, word.w, shapedNode.style)) : null;
  const wordWidths = font
    ? wordRuns.map(run => run.advanceWidth * fontScale)
    : group.words.map(word => ctx.measureText(word.w).width);
  const maxContent = width * 0.82;
  const lines = [];
  let line = [], lineWidth = 0;
  wordWidths.forEach((wordWidth, index) => {
    const next = line.length ? lineWidth + gap + wordWidth : wordWidth;
    if (line.length && next > maxContent) { lines.push({ indexes: line, width: lineWidth }); line = []; lineWidth = 0; }
    lineWidth = line.length ? lineWidth + gap + wordWidth : wordWidth;
    line.push(index);
  });
  if (line.length) lines.push({ indexes: line, width: lineWidth });
  const contentWidth = Math.max(...lines.map(entry => entry.width));
  const boxWidth = Math.min(width * 0.9, contentWidth + paddingX * 2);
  const lineHeight = fontSize * 1.08;
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const x = (width - boxWidth) / 2, y = height - boxHeight - Math.max(22, height * 0.055);
  roundRect(ctx, x, y, boxWidth, boxHeight, fontSize * 0.42);
  ctx.fillStyle = 'rgba(3,7,14,0.86)'; ctx.fill();
  ctx.textBaseline = 'middle';
  const canvasRtl = rtl && !font;
  ctx.textAlign = canvasRtl ? 'right' : 'left';
  if (canvasRtl) ctx.direction = 'rtl';
  lines.forEach((entry, lineIndex) => {
    let cursor = rtl
      ? x + (boxWidth + entry.width) / 2
      : x + (boxWidth - entry.width) / 2;
    entry.indexes.forEach(i => {
      const word = group.words[i];
      const active = time >= word.t0 && time < word.t1;
      const past = time >= word.t1;
      const voice = project.voices[group.who] || {};
      ctx.fillStyle = active ? (voice.color || project.theme.accent || '#2ee6d6') : (past ? '#ffffff' : '#9ca8ba');
      if (font) {
        cursor -= wordWidths[i];
        const lineTop = y + paddingY + lineHeight * lineIndex;
        const baseline = lineTop + wordRuns[i].bbox.maxY * fontScale;
        drawGlyphRun(ctx, wordRuns[i], cursor, baseline, fontScale, env);
        cursor -= gap;
      } else {
        if (canvasRtl) cursor -= wordWidths[i];
        ctx.fillText(word.w, cursor, y + paddingY + lineHeight * (lineIndex + 0.5));
        cursor += canvasRtl ? -gap : (wordWidths[i] + gap);
      }
    });
  });
  ctx.restore();
}

function drawChrome(ctx, project, time, sceneIndex) {
  const chrome = project.chrome || {};
  const w = project.size.w, h = project.size.h;
  ctx.save();
  if (chrome.topbar !== false) {
    ctx.fillStyle = 'rgba(3,7,14,0.68)'; ctx.fillRect(0, 0, w, Math.max(34, h * 0.055));
    ctx.fillStyle = project.theme.accent || '#2ee6d6'; ctx.font = `700 ${Math.max(14, w * 0.014)}px sans-serif`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(project.title, w * 0.025, Math.max(17, h * 0.0275));
  }
  if (chrome.counter !== false) {
    ctx.fillStyle = 'rgba(3,7,14,0.72)'; roundRect(ctx, w - 86, 18, 64, 30, 15); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '700 14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${sceneIndex + 1}/${project.scenes.length}`, w - 54, 33);
  }
  if (chrome.progress !== false) {
    ctx.fillStyle = project.theme.accent || '#2ee6d6'; ctx.fillRect(0, h - 4, w * Math.min(1, time / project.timeline.total), 4);
  }
  ctx.restore();
}

function captionSafeInset(project) {
  if (!(project.timeline.groups || []).length) return 0;
  return Math.round(Math.min(170, Math.max(84, project.size.h * 0.26)) * 1000) / 1000;
}

function registerFonts(project, baseDir, canvas) {
  const refs = new Map();
  function visit(node) {
    const style = node.style || {};
    if (style.fontFile) refs.set(style.fontFamily || path.basename(style.fontFile, path.extname(style.fontFile)), style.fontFile);
    (node.children || []).forEach(visit);
  }
  project.scenes.forEach(scene => visit(scene.visual));
  // Register authored TTF/OTF fonts with Skia for the canvas-text fallback path.
  for (const [family, file] of refs) {
    const absolute = path.resolve(baseDir, file);
    if (!fs.existsSync(absolute)) throw new Error(`no-browser font file not found: ${absolute}`);
    if (/\.woff2?$/i.test(absolute)) continue; // FontKit handles webfonts for complex-script nodes.
    if (!canvas.GlobalFonts.registerFromPath(absolute, family)) throw new Error(`no-browser renderer could not register font: ${absolute}`);
  }
  // Register the bundled Noto Sans Arabic subset so Skia can shape Arabic
  // script in the canvas-text fallback path (e.g., mixed Urdu+Latin text).
  // System fonts handle Latin punctuation/digits on all real platforms.
  try {
    canvas.GlobalFonts.registerFromPath(defaultArabicFont(), 'Noto Sans Arabic');
  } catch {}
}

function extractClipFrames(project, projectDir, frameRoot, fps) {
  const result = new Map();
  try {
    project.scenes.forEach((scene, i) => {
      if (!scene.clip) return;
      const timeline = project.timeline.scenes[i];
      const file = path.join(frameRoot, `clip-${i}.rgba`);
      sh('ffmpeg', [
        '-y', '-loglevel', 'error', '-stream_loop', '-1', '-i', path.join(projectDir, scene.clip),
        '-t', String(timeline.dur), '-an', '-vf',
        `scale=${project.size.w}:${project.size.h}:force_original_aspect_ratio=increase,crop=${project.size.w}:${project.size.h},fps=${fps}`,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', file,
      ]);
      const frameBytes = project.size.w * project.size.h * 4;
      result.set(i, { file, frameBytes, frames: Math.floor(fs.statSync(file).size / frameBytes), fd: fs.openSync(file, 'r') });
    });
  } catch (error) {
    for (const descriptor of result.values()) fs.closeSync(descriptor.fd);
    throw error;
  }
  return result;
}

function drawRawFrame(ctx, canvas, descriptor, index, width, height) {
  const frame = Math.max(0, Math.min(descriptor.frames - 1, index));
  const pixels = Buffer.allocUnsafe(descriptor.frameBytes);
  const ownedFd = descriptor.fd == null;
  const fd = ownedFd ? fs.openSync(descriptor.file, 'r') : descriptor.fd;
  fs.readSync(fd, pixels, 0, descriptor.frameBytes, frame * descriptor.frameBytes);
  if (ownedFd) fs.closeSync(fd);
  const rgba = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  // drawImage, unlike putImageData, honors transition transforms, alpha, and
  // clipping. Decode onto a temporary Skia surface, then composite it.
  const surface = canvas.createCanvas(width, height);
  surface.getContext('2d').putImageData(new canvas.ImageData(rgba, width, height), 0, 0);
  ctx.drawImage(surface, 0, 0);
}

function renderCanvas(project, projectDir, time, env) {
  const canvas = env.canvas.createCanvas(project.size.w, project.size.h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = project.theme.bg || (project.mode === 'light' ? '#f4f6fa' : '#080d16');
  ctx.fillRect(0, 0, project.size.w, project.size.h);
  const current = activeScene(project, Math.min(time, Math.max(0, project.timeline.total - 0.0001)));
  const localTime = Math.max(0, time - current.timeline.start);
  const transition = transitionState(current.timeline, localTime, current.index);
  ctx.save();
  if (transition.wipe < 1) { ctx.beginPath(); ctx.rect(0, 0, project.size.w * transition.wipe, project.size.h); ctx.clip(); }
  ctx.globalAlpha = transition.opacity;
  const cx = project.size.w / 2, cy = project.size.h / 2;
  ctx.translate(cx + transition.x, cy); ctx.scale(transition.scale, transition.scale); ctx.translate(-cx, -cy);
  if (current.source.clip) {
    let descriptor;
    if (env.clipDirs && env.clipDirs.has(current.index)) {
      descriptor = env.clipDirs.get(current.index);
    } else if (env.snapshotClip) descriptor = env.snapshotClip(current, localTime);
    if (descriptor && descriptor.frames > 0) {
      drawRawFrame(ctx, env.canvas, descriptor, Math.floor(localTime * env.fps), project.size.w, project.size.h);
    }
  }
  // Keep root backgrounds and full-frame clips edge-to-edge, but constrain the
  // root's children to the same caption-safe region HyperFrames reserves.
  const frames = layoutTree(current.source.visual, project.size.w, project.size.h, {
    b: captionSafeInset(project),
  });
  drawNode(ctx, current.source.visual, frames, localTime, current.timeline, { ...env, baseDir: projectDir });
  ctx.restore();
  drawChrome(ctx, project, time, current.index);
  drawCaptions(ctx, project, time, env);
  return canvas;
}

function qualityOptions(quality) {
  if (quality === 'draft') return { crf: '28', preset: 'veryfast' };
  if (quality === 'high') return { crf: '16', preset: 'slow' };
  return { crf: '20', preset: 'medium' };
}

function render(config, outDir, opts = {}) {
  const composed = compose(config, outDir);
  const project = readProject(composed.dir);
  const canvas = canvasModule();
  registerFonts(project, composed.dir, canvas);
  const fps = Number(opts.fps || project.fps || 30);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error('no-browser renderer fps must be between 1 and 120');
  const frameRoot = path.join(composed.dir, '.frames');
  fs.rmSync(frameRoot, { recursive: true, force: true });
  const renderFrames = ensureDir(path.join(frameRoot, 'render'));
  let clipDirs = new Map();
  try {
    clipDirs = extractClipFrames(project, composed.dir, frameRoot, fps);
    const env = { canvas, fps, clipDirs, images: new Map(), fonts: new Map() };
    const totalFrames = Math.max(1, Math.ceil(project.timeline.total * fps));
    for (let frame = 0; frame < totalFrames; frame++) {
      const surface = renderCanvas(project, composed.dir, frame / fps, env);
      fs.writeFileSync(path.join(renderFrames, `${String(frame).padStart(6, '0')}.png`), surface.toBuffer('image/png'));
    }
    const name = opts.name || 'video.mp4';
    const output = path.join(outDir, name);
    const q = qualityOptions(opts.quality);
    sh('ffmpeg', [
      '-y', '-loglevel', 'error', '-framerate', String(fps), '-start_number', '0',
      '-i', path.join(renderFrames, '%06d.png'), '-i', path.join(composed.dir, 'audio', 'narration.wav'),
      '-t', String(project.timeline.total), '-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf,
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart', '-shortest', output,
    ]);
    return { ...composed, mp4: output, seconds: probe(output), frames: totalFrames };
  } finally {
    for (const descriptor of clipDirs.values()) fs.closeSync(descriptor.fd);
    if (!opts.keepFrames) fs.rmSync(frameRoot, { recursive: true, force: true });
  }
}

/* Render only the given scene frame-spans to video-only MP4s (one per span),
 * stored at span.spanFile. Used by the scene-level render cache: a build that
 * changes one scene renders only that scene's span here. Spans are encoded
 * without B-frames (-bf 0) and with a fixed timebase so the cache layer can
 * concatenate them losslessly with `ffmpeg -c copy` at the splice points.
 *
 * Each frame is produced by the same renderCanvas(project, dir, time, env)
 * call the full render uses at the absolute time t = frame/fps, so a span is
 * pixel-identical to the equivalent slice of a full render (chrome counter,
 * progress bar, and scene transitions all see the full project timeline). */
function renderSpans(config, outDir, spans, opts = {}) {
  const composed = compose(config, outDir);
  const project = readProject(composed.dir);
  const canvas = canvasModule();
  registerFonts(project, composed.dir, canvas);
  const fps = Number(opts.fps || project.fps || 30);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error('no-browser renderer fps must be between 1 and 120');
  const frameRoot = path.join(composed.dir, '.frames');
  fs.rmSync(frameRoot, { recursive: true, force: true });
  let clipDirs = new Map();
  try {
    clipDirs = extractClipFrames(project, composed.dir, frameRoot, fps);
    const env = { canvas, fps, clipDirs, images: new Map(), fonts: new Map() };
    const q = qualityOptions(opts.quality);
    const gop = Math.max(1, Math.round(fps));
    for (const span of spans) {
      const spanFrames = ensureDir(path.join(frameRoot, `span-${span.sceneIndex}`));
      for (let f = span.frameStart; f < span.frameEnd; f++) {
        const surface = renderCanvas(project, composed.dir, f / fps, env);
        const local = f - span.frameStart;
        fs.writeFileSync(path.join(spanFrames, `${String(local).padStart(6, '0')}.png`), surface.toBuffer('image/png'));
      }
      // Atomic temp + rename: a crash mid-encode never leaves a half-written
      // span that a later build might trust as a valid cache hit. The temp
      // keeps the .mp4 extension so ffmpeg infers the muxer format.
      ensureDir(path.dirname(span.spanFile));
      const tmp = span.spanFile + '.tmp.mp4';
      sh('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-framerate', String(fps), '-start_number', '0',
        '-i', path.join(spanFrames, '%06d.png'),
        '-vf', 'setsar=1',
        '-frames:v', String(span.frameCount),
        '-c:v', 'libx264', '-preset', q.preset, '-crf', q.crf,
        '-pix_fmt', 'yuv420p', '-g', String(gop), '-bf', '0',
        '-video_track_timescale', String(Math.round(fps * 1000)),
        tmp,
      ]);
      fs.renameSync(tmp, span.spanFile);
    }
    return { dir: composed.dir, spans };
  } finally {
    for (const descriptor of clipDirs.values()) fs.closeSync(descriptor.fd);
    if (!opts.keepFrames) fs.rmSync(frameRoot, { recursive: true, force: true });
  }
}

/* Split an already-rendered full MP4 into per-scene video-only spans. Used by
 * the cache fallback path: when a per-scene render fails and the build falls
 * back to a full renderer.render(), this repopulates the cache from that full
 * render so the next build can reuse spans. Output-seeking (-ss after -i) +
 * re-encode is frame-accurate; spans are encoded with the same no-B-frame
 * profile as renderSpans so they remain concat-safe. */
function splitSpans(srcMp4, spans, fps, outDir) {
  for (const span of spans) {
    ensureDir(path.dirname(span.spanFile));
    const tmp = span.spanFile + '.tmp.mp4';
    sh('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', srcMp4,
      '-ss', String(span.tStart), '-frames:v', String(span.frameCount),
      '-an',
      '-vf', 'setsar=1',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-g', String(Math.max(1, Math.round(fps))), '-bf', '0',
      '-video_track_timescale', String(Math.round(fps * 1000)),
      tmp,
    ]);
    fs.renameSync(tmp, span.spanFile);
  }
}

function shots(config, outDir, times) {
  const composed = compose(config, outDir);
  const project = readProject(composed.dir);
  const canvas = canvasModule();
  registerFonts(project, composed.dir, canvas);
  const dir = path.join(composed.dir, 'snapshots', 'review');
  fs.rmSync(dir, { recursive: true, force: true }); ensureDir(dir);
  const temp = ensureDir(path.join(composed.dir, '.snapshot-clips'));
  const env = {
    canvas, fps: project.fps || 30, images: new Map(), fonts: new Map(),
    snapshotClip(current, localTime) {
      const output = path.join(temp, `clip-${current.index}.rgba`);
      sh('ffmpeg', [
        '-y', '-loglevel', 'error', '-ss', String(localTime), '-i', path.join(composed.dir, current.source.clip),
        '-frames:v', '1', '-vf', `scale=${project.size.w}:${project.size.h}:force_original_aspect_ratio=increase,crop=${project.size.w}:${project.size.h}`,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', output,
      ]);
      return { file: output, frameBytes: project.size.w * project.size.h * 4, frames: 1 };
    },
  };
  try {
    times.forEach((time, i) => {
      const surface = renderCanvas(project, composed.dir, time, env);
      fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(3, '0')}-${time.toFixed(2)}s.png`), surface.toBuffer('image/png'));
    });
    return { dir, project: composed.dir };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = {
  name: 'no-browser',
  displayName: 'Narova No-Browser',
  providerVersion: PROVIDER_VERSION,
  protocol: 'narova-renderer-provider/v1',
  local: true,
  browserless: true,
  capabilities: {
    html: false,
    portableVisuals: true,
    css: false,
    video: true,
    svg: true,
    captions: true,
    snapshots: true,
    studio: false,
  },
  doctor() {
    let canvas = false;
    try { require.resolve('@napi-rs/canvas'); canvas = true; } catch {}
    let fontkit = false;
    try { require.resolve('fontkit'); fontkit = true; } catch {}
    let arabicFont = false;
    try { defaultArabicFont(); arabicFont = true; } catch {}
    const ffmpeg = !!which('ffmpeg');
    return {
      ok: canvas && ffmpeg && fontkit && arabicFont,
      checks: [
        { name: '@napi-rs/canvas', ok: canvas, detail: canvas ? 'installed' : `run npm install --prefix ${path.resolve(__dirname, '../..')}` },
        { name: 'fontkit', ok: fontkit, detail: fontkit ? 'installed (OpenType shaping)' : `run npm install --prefix ${path.resolve(__dirname, '../..')}` },
        { name: 'Noto Sans Arabic', ok: arabicFont, detail: arabicFont ? 'installed (Urdu/Arabic fallback)' : `run npm install --prefix ${path.resolve(__dirname, '../..')}` },
        { name: 'ffmpeg', ok: ffmpeg, detail: which('ffmpeg') || 'not found' },
        { name: 'browser', ok: true, detail: 'not required' },
      ],
    };
  },
  validate: validateConfig,
  compose,
  render,
  renderSpans,
  splitSpans,
  shots,
  /* Scene-level render cache. no-browser can render an arbitrary frame span,
   * so it gets full per-scene caching: only scenes whose cache key changed are
   * re-rendered, the rest are reused and concatenated. */
  cache: { mode: 'per-scene' },
  _internals: {
    layoutTree, animatedState, renderCanvas, qualityOptions,
    fontSupports, shapingFont, shapeRun, shapedLines, captionSafeInset, gradientLine,
  },
};
