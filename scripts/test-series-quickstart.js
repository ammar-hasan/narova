'use strict';
// Real documented starter check. Uses a ready local runtime; acquires no models.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-series-quickstart-'));
const evidence = path.join(root, 'evidence'); fs.mkdirSync(evidence);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
const shim = path.join(root, 'bin'); fs.mkdirSync(shim);
fs.writeFileSync(path.join(shim, 'narova'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(repo, 'tool/bin/narova.js'))} "$@"\n`, { mode: 0o755 });
const env = { ...process.env, PATH: shim + path.delimiter + process.env.PATH, NAROVA_FIRST_RUN: '0' };
const run = (exe, args) => {
  const r = spawnSync(exe, args, { cwd: root, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr || r.stdout || r.error?.message);
  return r;
};
const guide = fs.readFileSync(path.join(repo, 'skills/narova/references/series.md'), 'utf8');
const start = guide.split('## Start with two episodes\n')[1].split('## Build one episode\n')[0];
const blocks = [...start.matchAll(/```sh\n([\s\S]*?)\n```/g)].map(m => m[1]);
assert.equal(blocks.length, 2);
fs.writeFileSync(path.join(root, 'starter.sh'), blocks[0] + '\n');
const results = { root, guideSha256: hash(path.join(repo, 'skills/narova/references/series.md')), checks: [], videos: [] };
const pass = description => { results.checks.push(description); console.log('PASS ' + description); };
const episode = id => path.join(root, 'course/episodes', id);
const binding = id => path.join(episode(id), '.narova-series/current');
function capture(id, name, color) {
  const video = path.join(episode(id), 'out/video.mp4');
  const probe = JSON.parse(run('ffprobe', ['-v','error','-show_streams','-show_format','-of','json',video]).stdout);
  const stream = probe.streams.find(s => s.codec_type === 'video');
  assert.equal(Number(probe.format.duration), 1); assert.equal(stream.width, 320); assert.equal(stream.height, 180);
  const frame = spawnSync('ffmpeg', ['-v','error','-ss','0.5','-i',video,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 8 * 1024 * 1024 });
  assert.equal(frame.status, 0, String(frame.stderr));
  const pixel = (x,y) => [...frame.stdout.subarray((y*320+x)*3,(y*320+x)*3+3)];
  const shared = pixel(60,90), local = pixel(260,90);
  assert.ok(shared.every((v,i) => Math.abs(v-color[i]) <= 3), JSON.stringify(shared));
  assert.ok(local.every((v,i) => Math.abs(v-[0,102,255][i]) <= 3), JSON.stringify(local));
  fs.copyFileSync(video, path.join(evidence, name+'.mp4'));
  run('ffmpeg',['-v','error','-y','-ss','0.5','-i',video,'-frames:v','1',path.join(evidence,name+'.png')]);
  const value = { id, name, sha256: hash(video), seconds:Number(probe.format.duration), width:stream.width, height:stream.height, sharedRGB:shared, localRGB:local };
  results.videos.push(value); return value.sha256;
}
try {
  const first = run('sh', ['starter.sh']); fs.writeFileSync(path.join(evidence, 'starter.stdout'), first.stdout); fs.writeFileSync(path.join(evidence, 'starter.stderr'), first.stderr);
  const initial = capture('intro','initial',[0,170,102]);
  assert.equal(fs.existsSync(path.join(episode('practice'),'out')), false);
  assert.equal(fs.existsSync(binding('practice')), false);
  pass('verbatim minimal starter builds only Intro with shared green and local blue SVGs');
  const localHash = hash(path.join(episode('intro'),'assets/local.svg'));
  const originalRevision = JSON.parse(fs.readFileSync(path.join(binding('intro'),'binding.json'))).revision;
  const sourceLogo = path.join(root,'course/media/logo.svg');
  fs.writeFileSync(sourceLogo, fs.readFileSync(sourceLogo,'utf8').replace('#00aa66','#ee3366'));
  const commands = blocks[1].split('\n').filter(line => line.startsWith('narova ')); assert.equal(commands.length, 3);
  for (const [index, command] of commands.entries()) {
    const receipt = run('sh',['-c',command]); fs.writeFileSync(path.join(evidence,`command-${index}.json`),JSON.stringify({ command, status:receipt.status, stdout:receipt.stdout, stderr:receipt.stderr },null,2));
    if (index === 0) {
      assert.equal(capture('intro','repeat',[0,170,102]),initial);
      assert.equal(JSON.parse(fs.readFileSync(path.join(binding('intro'),'binding.json'))).revision,originalRevision);
      assert.equal(fs.existsSync(binding('practice')),false);
      pass('documented repeat keeps saved logo and revision after source change');
    } else if (index === 1) {
      capture('practice','practice',[238,51,102]); pass('documented first Practice build takes changed shared logo with local blue SVG');
    } else {
      assert.notEqual(capture('intro','updated',[238,51,102]),initial);
      assert.equal(hash(path.join(episode('practice'),'out/video.mp4')),results.videos[2].sha256);
      assert.equal(hash(path.join(episode('intro'),'assets/local.svg')),localHash);
      pass('documented explicit Intro update preserves Practice video and local asset');
    }
  }
  for (const id of ['intro','practice']) for (const release of [false,true]) {
    const receipt = run('narova',['check','--project',episode(id),...(release ? ['--release'] : [])]);
    assert.equal(/must live under project assets\//.test(receipt.stdout+receipt.stderr),false);
  }
  pass('actual normal/release CLI checks accept the documented retained SVG paths');
  results.status = 'pass';
} catch(error) { results.status = 'fail'; results.error = error.stack; throw error; }
finally { fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(results,null,2)+'\n'); console.log('Evidence: '+path.join(evidence,'results.json')); }
