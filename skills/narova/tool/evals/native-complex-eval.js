#!/usr/bin/env node
'use strict';

/* Real browserless production proof. It deliberately combines distinct video
 * idioms instead of testing one template: brand opener, product playback,
 * cartoon motion, and multilingual data storytelling. All media is local. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveConfig } = require('../src/schema');
const { build } = require('../src/pipeline');
const { check } = require('../src/check');
const { shotsWithRenderer } = require('../src/renderers');
const { probe, ensureDir } = require('../src/util');

const ROOT = path.resolve(__dirname, '../../../../');
const PROJECT = path.join(ROOT, 'out', 'native-complex-eval');
const ASSETS = path.join(PROJECT, 'assets');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function write(file, value) {
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}

// This source VTT is sentence-timed, not word-timed. Interpolation exercises
// karaoke rendering without pretending that these are forced-alignment data.
function interpolatedWords(text, start, end) {
  const words = text.split(/\s+/u);
  const step = (end - start) / words.length;
  return words.map((word, i) => ({ text: word, start: +(start + step * i).toFixed(3), end: +(start + step * (i + 0.82)).toFixed(3) }));
}

function parseVtt(file) {
  const stamp = value => {
    const parts = value.trim().split(':').map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  };
  const cues = [];
  for (const block of fs.readFileSync(file, 'utf8').replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    const timing = lines.findIndex(line => line.includes('-->'));
    if (timing < 0) continue;
    const [start, end] = lines[timing].split('-->').map(stamp);
    const text = lines.slice(timing + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) cues.push({ start, end, text, words: interpolatedWords(text, start, end) });
  }
  return cues;
}

fs.rmSync(PROJECT, { recursive: true, force: true });
ensureDir(ASSETS);

// The shipped reel and its paired VTT are treated exactly like a custom
// narrator plus supplied transcript. Never invent captions for borrowed audio.
const transcriptCues = parseVtt(path.join(ROOT, 'docs/assets/narova-skill-reel.vtt')).slice(0, 5);
if (transcriptCues.length !== 5 || transcriptCues[0].text !== 'Stop building narrated videos frame by frame.') {
  throw new Error('native complex eval could not verify the shipped narrator transcript');
}
const duration = transcriptCues.at(-1).end;
run('ffmpeg', [
  '-y', '-loglevel', 'error', '-i', path.join(ROOT, 'docs/assets/narova-skill-reel.mp4'),
  '-t', String(duration), '-vn', '-ar', '48000', '-ac', '1', path.join(PROJECT, 'narrator.wav'),
]);
run('ffmpeg', [
  '-y', '-loglevel', 'error', '-ss', '8', '-i', path.join(ROOT, 'docs/assets/narova-product-walkthrough-demo.mp4'),
  '-t', '4', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', path.join(ASSETS, 'product.mp4'),
]);
run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=120:duration=${duration}`, '-af', 'volume=0.22', '-ar', '48000', path.join(ASSETS, 'bed.wav')]);
run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.16', '-af', 'afade=t=out:st=0.04:d=0.12', '-ar', '48000', path.join(ASSETS, 'ping.wav')]);
// Use a caption-free local raster so the proof contains exactly one visible
// subtitle system: Narova's karaoke layer.
run('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'gradients=s=480x720:c0=0x07111c:c1=0x2ee6d6:nb_colors=4:seed=3',
  '-frames:v', '1', path.join(ASSETS, 'local-art.png'),
]);
fs.copyFileSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', path.join(ASSETS, 'DejaVuSans.ttf'));
fs.copyFileSync(
  require.resolve('@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-700-normal.woff2'),
  path.join(ASSETS, 'NotoSansArabic.woff2'),
);
write(path.join(ASSETS, 'mark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#2ee6d6"/><stop offset="1" stop-color="#f2418a"/></linearGradient></defs>
  <path d="M70 8 129 42v67L70 143 11 109V42Z" fill="url(#g)"/>
  <path d="M42 74h56M70 46v56" stroke="#07111c" stroke-width="13" stroke-linecap="round"/>
</svg>`);

write(path.join(PROJECT, 'words.json'), transcriptCues);

const font = { fontFamily: 'Narova Sans', fontFile: 'assets/DejaVuSans.ttf' };
const urduFont = { fontFamily: 'Noto Sans Arabic', fontFile: 'assets/NotoSansArabic.woff2', language: 'urd' };
const config = resolveConfig({
  title: 'Narova Native · Complex Proof',
  renderer: 'native',
  size: { w: 640, h: 360 },
  assets: 'assets',
  narration: {
    file: 'narrator.wav', wordTimings: 'words.json',
    process: { highpass: 70, compressor: { threshold: 0.14, ratio: 2 } },
  },
  voices: { a: { speaker: 'custom-file', color: '#2ee6d6', label: 'custom narrator' } },
  theme: { bg: '#070b13', accent: '#2ee6d6' },
  captions: { preset: 'karaoke', emphasis: ['Narova', 'captions', 'graphics', 'project'] },
  bed: { file: 'assets/bed.wav', volume: 0.035, fadeIn: 0.4, fadeOut: 1.2 },
  sfx: [
    { file: 'assets/ping.wav', at: 3.2, volume: 0.26 },
    { file: 'assets/ping.wav', at: 5.8, volume: 0.24 },
    { file: 'assets/ping.wav', at: 9.2, volume: 0.22 },
  ],
  scenes: [
    {
      id: 'opener', dur: 3.2, transition: 'fade',
      vo: [{ who: 'a', text: transcriptCues[0].text }],
      visual: {
        type: 'stack', style: {
          direction: 'row', padding: 38, gap: 26,
          background: { type: 'linear', from: [0, 0], to: ['100%', '100%'], stops: [{ at: 0, color: '#07111c' }, { at: 1, color: '#151027' }] },
        },
        children: [
          { type: 'stack', style: { direction: 'column', gap: 8 }, children: [
            { type: 'text', text: 'TWO LOCAL\nRENDERERS', style: { ...font, color: '#ffffff', fontSize: 44, fontWeight: 800, lineHeight: 0.98 }, enter: { type: 'rise', at: 0.15 } },
            { type: 'text', text: 'HyperFrames + Narova Native', style: { ...font, height: 34, color: '#2ee6d6', fontSize: 18, fontWeight: 700 }, enter: { type: 'fade', at: 0.8 } },
            { type: 'progress', value: 1, fill: '#f2418a', style: { height: 8, background: '#253247', radius: 4 }, enter: 'fade', animate: [{ property: 'progress', from: 0, to: 1, at: 1.1, duration: 1.4, ease: 'out' }] },
          ] },
          { type: 'svg', src: 'assets/mark.svg', style: { width: 180, height: 180, alignSelf: 'center', fit: 'contain' }, enter: { type: 'pop', at: 0.4 }, animate: [{ property: 'rotate', from: -8, to: 8, at: 1.6, duration: 1.8, ease: 'in-out' }] },
        ],
      },
    },
    {
      id: 'playback', dur: 2.6, transition: 'wipe', clip: 'assets/product.mp4',
      vo: [{ who: 'a', text: transcriptCues[1].text }],
      visual: {
        type: 'group', children: [
          { type: 'rect', style: { position: 'absolute', x: 24, y: 50, width: 292, height: 66, background: 'rgba(3,7,14,0.88)', radius: 13, borderWidth: 1, borderColor: '#2ee6d6' }, enter: { type: 'slide-left', at: 0.2 }, children: [
            { type: 'text', text: 'REAL PRODUCT PLAYBACK', style: { ...font, x: 17, y: 12, width: 258, height: 42, color: '#ffffff', fontSize: 21, fontWeight: 800, verticalAlign: 'center' } },
          ] },
          { type: 'rect', style: { position: 'absolute', x: 492, y: 52, width: 118, height: 36, background: '#f2418a', radius: 18 }, enter: { type: 'pop', at: 0.55 }, children: [
            { type: 'text', text: 'LOCAL MP4', style: { ...font, x: 0, y: 8, width: 118, height: 24, color: '#07111c', fontSize: 13, fontWeight: 800, textAlign: 'center' } },
          ] },
        ],
      },
    },
    {
      id: 'cartoon', dur: 3.4, transition: 'slide',
      vo: [{ who: 'a', text: transcriptCues[2].text }],
      visual: {
        type: 'group', style: { background: '#f4d89b' }, children: [
          { type: 'circle', style: { x: 442, y: 58, width: 110, height: 110, fill: '#f2418a' }, animate: [{ property: 'y', from: 0, to: 92, at: 0.1, duration: 3.5, ease: 'in-out' }] },
          { type: 'path', d: 'M12 70 C42 5 78 5 108 70 C78 42 42 42 12 70 Z', viewBox: '0 0 120 80', style: { x: 390, y: 142, width: 160, height: 112, fill: '#2ee6d6', stroke: '#07111c', strokeWidth: 3 }, enter: { type: 'pop', at: 0.25 }, animate: [{ property: 'rotate', from: -6, to: 6, at: 0.4, duration: 3.2, ease: 'in-out' }] },
          { type: 'stack', style: { x: 38, y: 62, width: 320, height: 184, direction: 'column', gap: 9 }, children: [
            { type: 'text', text: 'CARTOON\nMOTION', style: { ...font, height: 112, color: '#07111c', fontSize: 48, fontWeight: 900, lineHeight: 0.92 }, enter: { type: 'rise', at: 0.15 } },
            { type: 'text', text: 'shapes · paths · deterministic keyframes', style: { ...font, height: 34, color: '#6c3253', fontSize: 17, fontWeight: 700 }, enter: { type: 'fade', at: 0.85 } },
          ] },
        ],
      },
    },
    {
      id: 'data', dur: 7.2, transition: 'zoom',
      vo: [
        { who: 'a', text: transcriptCues[3].text },
        { who: 'a', text: transcriptCues[4].text },
      ],
      visual: {
        type: 'stack', style: { direction: 'row', padding: 34, gap: 28, background: '#07111c' }, children: [
          { type: 'image', src: 'assets/local-art.png', drift: 'in', style: { width: 214, height: 246, radius: 18, overflow: 'hidden', fit: 'cover', borderWidth: 2, borderColor: '#2ee6d6' }, enter: { type: 'zoom', at: 0.2 } },
          { type: 'stack', style: { direction: 'column', gap: 10 }, children: [
            { type: 'text', text: 'FREE · LOCAL · MULTILINGUAL', style: { ...font, height: 34, color: '#2ee6d6', fontSize: 17, fontWeight: 800 }, enter: { type: 'fade', at: 0.1 } },
            { type: 'text', text: 'ہر کہانی،\nاپنی زبان میں', style: { ...urduFont, direction: 'rtl', textAlign: 'right', height: 108, color: '#ffffff', fontSize: 36, fontWeight: 700, lineHeight: 1.25 }, enter: { type: 'rise', at: 0.35 } },
            { type: 'stack', style: { direction: 'column', gap: 9 }, children: [
              { type: 'progress', value: 0.92, fill: '#2ee6d6', style: { height: 14, background: '#243248', radius: 7 }, animate: [{ property: 'progress', from: 0, to: 0.92, at: 0.7, duration: 1.0, ease: 'out' }] },
              { type: 'progress', value: 0.74, fill: '#f2418a', style: { height: 14, background: '#243248', radius: 7 }, animate: [{ property: 'progress', from: 0, to: 0.74, at: 0.9, duration: 1.1, ease: 'out' }] },
              { type: 'progress', value: 0.84, fill: '#f4d89b', style: { height: 14, background: '#243248', radius: 7 }, animate: [{ property: 'progress', from: 0, to: 0.84, at: 1.1, duration: 1.2, ease: 'out' }] },
            ] },
          ] },
        ],
      },
    },
  ],
}, {}, PROJECT);

if (!check(config, { release: true, outDir: path.join(PROJECT, 'out') })) {
  throw new Error('native complex eval failed the release check');
}

const result = build(config, {
  out: path.join(PROJECT, 'out'), projectDir: PROJECT,
  fps: 24, quality: 'standard', log: console.log,
});
const renderedSrt = fs.readFileSync(path.join(PROJECT, 'out', 'captions.srt'), 'utf8');
for (const cue of transcriptCues) {
  if (!renderedSrt.includes(cue.text)) throw new Error(`native captions lost narrator transcript cue: ${cue.text}`);
}
const renderedCueTimings = [...renderedSrt.matchAll(/^(\d\d:\d\d:\d\d,\d{3}) --> (\d\d:\d\d:\d\d,\d{3})$/gm)];
if (renderedCueTimings.length !== transcriptCues.length
    || renderedCueTimings.some(match => match[1] === match[2])) {
  throw new Error(`native captions expected ${transcriptCues.length} nonzero cues, got ${renderedCueTimings.length}`);
}
if (fs.existsSync(path.join(result.project, '.frames'))) {
  throw new Error('native renderer retained its temporary frame sequence');
}
const times = [1.6, 4.5, 7.5, 12.8];
const shots = shotsWithRenderer(config, path.join(PROJECT, 'out'), times);
if (fs.existsSync(path.join(shots.project, '.snapshot-clips'))) {
  throw new Error('native snapshots retained temporary decoded clip data');
}
run('ffmpeg', [
  '-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', path.join(shots.dir, '*.png'),
  '-filter_complex', 'scale=480:-1,tile=2x2:padding=8:margin=8:color=#07111c',
  '-frames:v', '1', path.join(PROJECT, 'contact-sheet.jpg'),
]);

const summary = {
  ok: true,
  renderer: result.renderer,
  video: result.mp4,
  seconds: probe(result.mp4),
  transcriptCues: transcriptCues.length,
  transcriptSource: 'paired-vtt',
  wordTimingSource: 'sentence-interpolation',
  snapshots: shots.dir,
  contactSheet: path.join(PROJECT, 'contact-sheet.jpg'),
};
write(path.join(PROJECT, 'result.json'), summary);
console.log(JSON.stringify(summary, null, 2));
