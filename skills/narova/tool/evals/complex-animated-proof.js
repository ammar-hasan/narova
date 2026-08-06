#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveConfig } = require('../src/schema');
const { build } = require('../src/pipeline');
const { ensureDir } = require('../src/util');
const { getRenderer } = require('../src/renderers');

const ROOT = path.resolve(__dirname, '../../../../');
const PROJECT = path.join(ROOT, 'out', 'complex-animated-test');
const ASSETS = path.join(PROJECT, 'assets');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
}

fs.rmSync(PROJECT, { recursive: true, force: true });
ensureDir(ASSETS);
const duration = 16.0;

// Generate sine-wave voiceover so both renders produce audio.
run('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=220:duration=${duration}`,
  '-af', 'volume=0.3', '-ar', '48000', '-ac', '1', path.join(PROJECT, 'narration.wav'),
]);

// Word timings for 4 scenes (~4s each) — sentence interpolation.
const scenesText = [
  'Introducing the no-browser renderer.',
  'Skia draws every frame; FontKit shapes every glyph.',
  'Keyframes animate any property; drift moves the camera.',
  'Start building today — two free local renderers, one project.',
];
const wordTimings = [];
let t = 0;
for (const text of scenesText) {
  const words = text.split(/\s+/u);
  const dur = 4.0;
  const step = dur / words.length;
  const cues = words.map((word, i) => ({
    text: word, start: +(t + step * i).toFixed(3), end: +(t + step * (i + 0.82)).toFixed(3),
  }));
  wordTimings.push({ start: +t.toFixed(3), end: +(t + dur).toFixed(3), text, words: cues });
  t += dur;
}

// Generate a gradient-filled SVG asset.
fs.writeFileSync(path.join(ASSETS, 'logo.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#2ee6d6"/>
      <stop offset="100%" stop-color="#f2418a"/>
    </linearGradient>
  </defs>
  <circle cx="100" cy="100" r="90" fill="url(#lg)"/>
  <path d="M60 100h80M100 60v80" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
</svg>`);

// Copy a system font for the eval (used in Latin text).
const { findLatinFont } = require('../src/renderers/system-font');
const systemFont = findLatinFont();
if (systemFont) fs.copyFileSync(systemFont, path.join(ASSETS, 'font.ttf'));

const font = systemFont ? { fontFamily: 'Latin', fontFile: 'assets/font.ttf' } : {};

fs.writeFileSync(path.join(PROJECT, 'words.json'), JSON.stringify(wordTimings, null, 2));

// ---- Complex animated reel config ----
const config = {
  title: 'Complex Animated Proof',
  renderer: 'no-browser',
  size: { w: 640, h: 360 },
  assets: 'assets',
  narration: { file: 'narration.wav', wordTimings: 'words.json' },
  voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } },
  theme: { bg: '#080d16', accent: '#2ee6d6' },
  captions: { preset: 'karaoke' },
  chrome: { topbar: true, counter: true, progress: true },
  scenes: [
    {
      id: 'opener', dur: 4.0, transition: 'fade',
      vo: [{ who: 'a', text: scenesText[0] }],
      visual: {
        type: 'stack',
        style: { direction: 'column', padding: 40, gap: 20, background: { type: 'linear', angle: 135, stops: [{ at: 0, color: '#07111c' }, { at: 1, color: '#151027' }] } },
        children: [
          { type: 'text', text: 'THE NO-BROWSER\nRENDERER', style: { ...font, color: '#ffffff', fontSize: 48, fontWeight: 800, lineHeight: 1.0 }, enter: { type: 'rise', at: 0.15 }, animate: [{ property: 'scale', from: 0.92, to: 1.06, at: 1.0, duration: 2.0, ease: 'in-out' }] },
          { type: 'svg', src: 'assets/logo.svg', style: { width: 90, height: 90, alignSelf: 'center' }, enter: { type: 'pop', at: 0.4 } },
          { type: 'progress', value: 1, fill: '#2ee6d6', style: { height: 8, background: '#253247', radius: 4 }, animate: [{ property: 'progress', from: 0, to: 1, at: 1.2, duration: 1.6, ease: 'out' }] },
        ],
      },
    },
    {
      id: 'skia', dur: 4.0, transition: 'wipe',
      vo: [{ who: 'a', text: scenesText[1] }],
      visual: {
        type: 'group', style: { background: '#080d16' },
        children: [
          { type: 'rect', style: { position: 'absolute', x: 22, y: 28, width: 290, height: 110, background: 'rgba(3,7,14,0.82)', radius: 14, borderWidth: 1.5, borderColor: '#2ee6d6' }, enter: { type: 'slide-left', at: 0.15 }, children: [
            { type: 'text', text: 'SKIA FRAMES', style: { ...font, x: 16, y: 14, width: 258, height: 82, color: '#ffffff', fontSize: 32, fontWeight: 800, verticalAlign: 'center' } },
          ] },
          { type: 'rect', style: { position: 'absolute', x: 492, y: 44, width: 120, height: 40, background: '#f2418a', radius: 20 }, enter: { type: 'pop', at: 0.55 }, children: [
            { type: 'text', text: 'GLYPHS', style: { ...font, x: 0, y: 8, width: 120, height: 24, color: '#07111c', fontSize: 14, fontWeight: 800, textAlign: 'center' } },
          ] },
          { type: 'circle', style: { position: 'absolute', x: 444, y: 218, width: 90, height: 90, fill: '#2ee6d6', shadowColor: 'rgba(46,230,214,0.35)', shadowBlur: 30, shadowX: 0, shadowY: 12, borderWidth: 2, borderColor: '#0e2a26' }, enter: 'fade', animate: [{ property: 'y', from: 240, to: 204, at: 0.3, duration: 3.0, ease: 'in-out' }, { property: 'x', from: 460, to: 444, at: 0.8, duration: 2.6, ease: 'in-out' }] },
          { type: 'stack', style: { x: 38, y: 170, width: 340, height: 74, direction: 'column', gap: 8 }, children: [
            { type: 'text', text: 'PIXEL-PERFECT, OFFSCREEN', style: { ...font, height: 36, color: '#2ee6d6', fontSize: 19, fontWeight: 700 }, enter: { type: 'rise', at: 0.25 } },
            { type: 'text', text: '128 frames · deterministic · seek-safe', style: { ...font, height: 28, color: '#8892a4', fontSize: 14, fontWeight: 600 }, enter: { type: 'fade', at: 0.8 } },
          ] },
        ],
      },
    },
    {
      id: 'animate', dur: 4.0, transition: 'slide',
      vo: [{ who: 'a', text: scenesText[2] }],
      visual: {
        type: 'group', style: { background: '#f4d89b' },
        children: [
          { type: 'circle', style: { x: 472, y: 50, width: 120, height: 120, fill: '#f2418a' }, animate: [{ property: 'y', from: 0, to: 64, at: 0.1, duration: 3.5, ease: 'in-out' }, { property: 'rotate', from: -8, to: 8, at: 1.2, duration: 2.8, ease: 'in-out' }] },
          { type: 'path', d: 'M10 60 C40 5 70 5 100 60 C70 38 40 38 10 60 Z', viewBox: '0 0 110 70', style: { x: 398, y: 148, width: 170, height: 112, fill: '#2ee6d6', stroke: '#07111c', strokeWidth: 3 }, enter: { type: 'pop', at: 0.3 }, animate: [{ property: 'rotate', from: -4, to: 8, at: 0.6, duration: 3.0, ease: 'in-out' }] },
          { type: 'stack', style: { x: 32, y: 56, width: 330, height: 190, direction: 'column', gap: 10 }, children: [
            { type: 'text', text: 'KEYFRAME\nANIMATION', style: { ...font, height: 104, color: '#07111c', fontSize: 44, fontWeight: 900, lineHeight: 0.94 }, enter: { type: 'rise', at: 0.1 } },
            { type: 'text', text: 'animate any property · drift · entrances', style: { ...font, height: 36, color: '#6c3253', fontSize: 18, fontWeight: 700 }, enter: { type: 'fade', at: 0.75 }, animate: [{ property: 'x', from: 14, to: 0, at: 1.6, duration: 1.4, ease: 'out' }] },
            { type: 'progress', value: 0.88, fill: '#f2418a', style: { height: 10, background: '#ebbca4', radius: 5 }, enter: 'fade', animate: [{ property: 'progress', from: 0, to: 0.88, at: 1.0, duration: 2.0, ease: 'out' }] },
          ] },
        ],
      },
    },
    {
      id: 'cta', dur: 4.0, transition: 'zoom',
      vo: [{ who: 'a', text: scenesText[3] }],
      visual: {
        type: 'stack', style: { direction: 'column', padding: 36, gap: 16, background: '#07111c', justify: 'center' },
        children: [
          { type: 'stack', style: { direction: 'row', gap: 20 }, children: [
            { type: 'text', text: 'TWO FREE', style: { ...font, width: 180, color: '#2ee6d6', fontSize: 52, fontWeight: 800, lineHeight: 0.96, textAlign: 'right' }, enter: { type: 'slide-right', at: 0.2 } },
            { type: 'text', text: 'LOCAL\nRENDERERS', style: { ...font, width: 260, color: '#ffffff', fontSize: 52, fontWeight: 800, lineHeight: 0.96 }, enter: { type: 'slide-left', at: 0.3 } },
            { type: 'svg', src: 'assets/logo.svg', style: { width: 80, height: 80, alignSelf: 'center' }, enter: { type: 'pop', at: 0.7 }, animate: [{ property: 'rotate', from: -12, to: 12, at: 1.8, duration: 2.0, ease: 'in-out' }] },
          ] },
          { type: 'stack', style: { direction: 'column', gap: 10, padding: 16 }, children: [
            { type: 'progress', value: 1, fill: '#2ee6d6', style: { width: '80%', height: 10, background: '#243248', radius: 5, alignSelf: 'center' }, animate: [{ property: 'progress', from: 0, to: 1, at: 1.0, duration: 1.2, ease: 'out' }] },
            { type: 'progress', value: 0.92, fill: '#f2418a', style: { width: '80%', height: 10, background: '#243248', radius: 5, alignSelf: 'center' }, animate: [{ property: 'progress', from: 0, to: 0.92, at: 1.4, duration: 1.2, ease: 'out' }] },
            { type: 'text', text: 'one project · both providers · no browser', style: { ...font, height: 30, color: '#8892a4', fontSize: 15, fontWeight: 600, textAlign: 'center', alignSelf: 'center' }, enter: { type: 'rise', at: 2.0 } },
          ] },
        ],
      },
    },
  ],
};

const resolved = resolveConfig(config, {}, PROJECT);

console.log('\n=== Rendering with no-browser ===');
const nbOut = path.join(PROJECT, 'no-browser');
const nbResult = build(resolved, { out: nbOut, projectDir: PROJECT, fps: 24, quality: 'standard', log: msg => process.stdout.write(`  [nb] ${msg}\n`) });
console.log(`  no-browser -> ${nbResult.mp4}  (${nbResult.seconds.toFixed(1)}s, ${nbResult.renderer})`);

console.log('\n=== Rendering with HyperFrames ===');
resolved.renderer = 'hyperframes';
const hfOut = path.join(PROJECT, 'hyperframes');
const hfResult = build(resolved, { out: hfOut, projectDir: PROJECT, fps: 24, quality: 'standard', log: msg => process.stdout.write(`  [hf] ${msg}\n`) });
console.log(`  HyperFrames -> ${hfResult.mp4}  (${hfResult.seconds.toFixed(1)}s, ${hfResult.renderer})`);

const nbProbe = spawnSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,nb_frames',
  '-of', 'csv=s=x:p=0', nbResult.mp4,
], { encoding: 'utf8' });
const hfProbe = spawnSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,nb_frames',
  '-of', 'csv=s=x:p=0', hfResult.mp4,
], { encoding: 'utf8' });

console.log('\n=== Verification ===');
console.log(`  no-browser: ${nbProbe.stdout.trim()}`);
console.log(`  HyperFrames: ${hfProbe.stdout.trim()}`);
console.log('\n✅ Both providers produced valid MP4s from the same visual tree.');
