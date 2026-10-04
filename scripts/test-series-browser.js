'use strict';
// Real browser proof for the retained glTF buffer and inlined module fixes.
// Uses the ordinary renderer prerequisites; does not acquire speech models.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const series = require('../tool/src/series');
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-series-browser-'));
const root = path.join(evidence, 'series');
const project = path.join(root, 'episode');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2)); };
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { evidence, checks: [], videos: [] };
function command(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 180000, env: { ...process.env, NAROVA_FIRST_RUN: '0' } });
  write(path.join(evidence, `command-${command.count++}.log`), JSON.stringify({ cmd, args, status: result.status, stdout: result.stdout, stderr: result.stderr }));
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
command.count = 0;
function frame(video, time, color) {
  const png = path.join(evidence, `${color}-${report.videos.length}.png`);
  command('ffmpeg', ['-y', '-v', 'error', '-ss', String(time), '-i', video, '-frames:v', '1', png]);
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  let pixels = 0;
  for (let i = 0; i < decoded.stdout.length; i += 3) {
    const [r, g, b] = decoded.stdout.subarray(i, i + 3);
    if (color === 'green' ? g > 100 && g > r * 1.5 && g > b * 1.5 : b > 100 && b > r * 1.5 && b > g * 1.5) pixels++;
  }
  assert.ok(pixels > 500, `Missing ${color} geometry: ${pixels} matching pixels`);
  return { png, sha256: digest(png), pixels };
}
try {
  console.log('Browser evidence: ' + evidence);
  const positions = Buffer.alloc(36); [-1, -1, 0, 1, -1, 0, 0, 1, 0].forEach((v, i) => positions.writeFloatLE(v, i * 4));
  write(path.join(root, 'models/mesh.bin'), positions);
  write(path.join(root, 'models/mesh.gltf'), { asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 36 }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }], materials: [{ doubleSided: true, emissiveFactor: [0, 1, 0], pbrMetallicRoughness: { baseColorFactor: [0, 1, 0, 1], metallicFactor: 0, roughnessFactor: 1 } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 });
  write(path.join(root, 'modules/main.js'), `pending.push(import('./helper.mjs').then(m=>scene.add(m.make(THREE))));`);
  write(path.join(root, 'modules/helper.mjs'), `export function make(T){return new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshBasicMaterial({color:'#0033ff'}));}`);
  const source = { format: series.FORMAT, id: 'browser', title: 'Browser fixtures', defaults: {}, resources: { model: { file: 'models/mesh.gltf', dependencies: ['models/mesh.bin'] }, module: { file: 'modules/main.js', dependencies: ['modules/helper.mjs'] } }, episodes: [{ id: 'one', title: 'One', project: 'episode' }] };
  write(path.join(root, 'series.config.json'), source);
  write(path.join(project, 'reel.config.json'), { title: 'Retained browser resources', size: { w: 320, h: 180 }, renderer: 'hyperframes', chrome: { topbar: false, counter: false, progress: false }, captions: false, scenes: [{ id: 'model', dur: 1.4, vo: [], three: { background: '#111111', objects: [{ type: 'model', src: series.FILES + 'models/mesh.gltf' }] } }, { id: 'module', dur: 1.4, vo: [], three: { background: '#111111' }, threeModule: series.FILES + 'modules/main.js' }] });
  write(path.join(project, 'creative-brief.md'), '# Creative brief\nStatus: ready\nAmbition: routine\n\nValidate transported browser resource paths.\n');
  series.bind(root, 'one', { resources: ['model', 'module'] });
  const packed = path.join(evidence, 'episode.narova');
  command(process.execPath, [path.resolve(__dirname, '../tool/bin/narova.js'), 'pack', '--project', project, '--output', packed, '--json']);
  const opened = path.join(evidence, 'opened'); require('../tool/src/project-archive').openArchive(packed, opened);
  fs.rmSync(path.join(root, 'models'), { recursive: true }); fs.rmSync(path.join(root, 'modules'), { recursive: true }); fs.rmSync(path.join(root, 'series.config.json'));
  const detached = path.join(evidence, 'detached'); series.detach(opened, detached);
  for (const directory of [opened, detached]) {
    command(process.execPath, [path.resolve(__dirname, '../tool/bin/narova.js'), 'build', '--project', directory, '--fps', '10', '--quality', 'draft', '--reuse', '--json']);
    const video = path.join(directory, 'out/video.mp4'); const probe = JSON.parse(command('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', video]));
    assert.ok(probe.streams.some(s => s.codec_type === 'video')); assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
    const model = frame(video, 0.7, 'green'), module = frame(video, 2.1, 'blue');
    report.videos.push({ file: video, sha256: digest(video), duration: Number(probe.format.duration), model, module });
    report.checks.push(`${path.basename(directory)} renders the external glTF buffer and source-relative dynamic import`);
    console.log('PASS ' + report.checks[report.checks.length - 1]);
  }
  write(path.join(evidence, 'results.json'), report);
} catch (error) { write(path.join(evidence, 'failed.json'), { error: error.stack, report }); console.error(error); process.exitCode = 1; }
