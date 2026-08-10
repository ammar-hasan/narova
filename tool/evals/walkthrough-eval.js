#!/usr/bin/env node
'use strict';
/* Real walkthrough eval.
 *
 * Exercises the actual optional adapter against a local interactive product
 * fixture: semantic exploration/click/type, WebM recording, evidence frames,
 * capture hashes, composition trimming, and HyperFrames snapshots. It avoids
 * TTS/network variability by supplying a measured-shape timings fixture and a
 * generated silent WAV.
 *
 * Run: npm run eval:walkthrough
 * Keep artifacts: NAROVA_EVAL_KEEP=1 npm run eval:walkthrough */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { resolveConfig } = require('../src/schema');
const { captureWalkthrough, captureStatus } = require('../src/walkthrough');
const { compose } = require('../src/compose');
const { runHf } = require('../src/hf');
const { commitFingerprint } = require('../src/pipeline');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'product-app');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForServer(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const attempt = () => {
      const request = http.get(`http://127.0.0.1:${port}/`, response => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else reject(new Error(`fixture server returned ${response.statusCode}`));
      });
      request.on('error', error => {
        if (Date.now() >= deadline) reject(error);
        else setTimeout(attempt, 80);
      });
    };
    attempt();
  });
}

function timingFixture() {
  return {
    create: {
      dur: 3.2,
      turns: [0.15],
      words: [
        { w: 'Create', t0: 0.15, t1: 0.45, who: 'a', si: 0 },
        { w: 'a', t0: 0.46, t1: 0.55, who: 'a', si: 0 },
        { w: 'project.', t0: 0.56, t1: 1, who: 'a', si: 0 },
      ],
    },
    result: {
      dur: 3,
      turns: [0.12],
      words: [
        { w: 'Everything', t0: 0.12, t1: 0.55, who: 'a', si: 0 },
        { w: 'is', t0: 0.56, t1: 0.68, who: 'a', si: 0 },
        { w: 'ready.', t0: 0.69, t1: 1.05, who: 'a', si: 0 },
      ],
    },
  };
}

function rawConfig(url) {
  return {
    title: 'Orbit product walkthrough eval',
    size: '16:9',
    voices: { a: { label: 'Narrator', speaker: 'en_US-ryan-high' } },
    captions: { preset: 'karaoke', emphasis: ['ready'] },
    walkthroughs: {
      orbit: {
        url,
        title: 'Orbit · Acme workspace',
        actionPolicy: 'walkthrough-policy.json',
        allowedDomains: ['127.0.0.1'],
        viewport: { w: 1200, h: 760 },
        ready: { text: 'New project', timeout: 10000 },
        preRoll: 0.4,
        postRoll: 0.6,
        cursor: { enabled: true, travelMs: 280, color: '#ff3d81' },
        steps: [
          {
            at: 0.55,
            action: 'click',
            target: { role: 'button', name: 'New project' },
          },
          {
            at: 1.25,
            action: 'type',
            target: { label: 'Project name' },
            value: 'Launch plan',
          },
          {
            at: 2.35,
            action: 'click',
            target: { role: 'button', name: 'Create project' },
          },
          {
            at: { scene: 'result', offset: 0.25 },
            action: 'wait',
            text: 'Project ready',
            screenshot: 'project-ready',
          },
        ],
      },
    },
    scenes: [
      {
        id: 'create',
        walkthrough: 'orbit',
        body: '<div class="eyebrow reveal">From idea to workspace</div>',
        vo: [{ who: 'a', text: 'Create a project and give it a clear name.' }],
      },
      {
        id: 'result',
        walkthrough: { id: 'orbit', layout: 'full', fit: 'cover', opacity: 0.92 },
        body: '<div class="s-foot ok reveal">One action. A ready workspace.</div>',
        vo: [{ who: 'a', text: 'The workspace is ready before the sentence ends.' }],
      },
    ],
  };
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-walkthrough-eval-'));
  const port = await freePort();
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: FIXTURE_DIR,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let passed = false;
  try {
    await waitForServer(port);
    fs.mkdirSync(path.join(temp, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(temp, 'walkthrough-policy.json'),
      JSON.stringify({
        default: 'deny',
        allow: [
          'launch', 'close', 'viewport', 'recording_start', 'recording_stop',
          'navigate', 'snapshot', 'getbyrole', 'getbylabel',
          'click', 'fill', 'interact', 'wait', 'get', 'evaluate', 'screenshot',
          'keyboard',
        ],
      }),
    );
    const config = resolveConfig(rawConfig(`http://127.0.0.1:${port}/`), {}, temp);
    const timings = timingFixture();
    const out = path.join(temp, 'out');
    fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings, null, 2));

    const wav = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'anullsrc=r=48000:cl=mono', '-t', '6.2',
      path.join(out, 'audio', 'full.wav'),
    ]);
    assert.equal(wav.status, 0, 'ffmpeg should generate the eval narration bed');
    commitFingerprint(config, out);

    const capture = captureWalkthrough(config, 'orbit', timings, {
      outDir: out,
      log: line => process.stdout.write(`${line}\n`),
    });
    const status = captureStatus(config, 'orbit', timings, { outDir: out });
    assert.equal(status.ok, true, status.reason);
    assert.equal(capture.manifest.media.width, 1200);
    assert.equal(capture.manifest.media.height, 760);
    assert.ok(capture.manifest.media.duration >= 6.55);
    assert.ok(Math.max(...capture.manifest.steps.map(step => Math.abs(step.driftMs))) < 500);
    assert.equal(capture.manifest.steps.length, 4);
    assert.ok(fs.readdirSync(path.join(capture.dir, 'states')).filter(name => name.endsWith('.png')).length >= 4);
    assert.ok(!fs.readFileSync(path.join(capture.dir, 'capture.json'), 'utf8').includes('Launch plan'));

    const composition = compose(config, out);
    const html = fs.readFileSync(path.join(composition.dir, 'index.html'), 'utf8');
    assert.match(
      html,
      new RegExp(`data-media-start="${capture.manifest.timeline.sourceOrigin}"`),
    );
    assert.match(
      html,
      new RegExp(
        `data-media-start="${Math.round(
          (capture.manifest.timeline.sourceOrigin + 3.2) * 1000,
        ) / 1000}"`,
      ),
    );
    assert.ok(!/id="walkthrough-[^"]+"[^>]*\bloop\b/.test(html));

    runHf([
      'snapshot',
      '--at', '1.7,4.5',
      '-o', 'snapshots/walkthrough-eval',
    ], composition.dir);
    const snapshotRoot = path.join(composition.dir, 'snapshots');
    const images = [];
    const walk = dir => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.png$/i.test(entry.name)) images.push(full);
      }
    };
    walk(snapshotRoot);
    assert.ok(images.length >= 2, 'HyperFrames should render two QA frames');
    assert.ok(images.every(file => fs.statSync(file).size > 5000), 'QA frames should contain rendered UI');

    const rendered = path.join(out, 'walkthrough-eval.mp4');
    runHf([
      'render',
      '--output', path.join('..', path.basename(rendered)),
      '--fps', '30',
      '--quality', 'draft',
      '--video-frame-format', 'png',
    ], composition.dir);
    assert.ok(fs.existsSync(rendered), 'HyperFrames should render an MP4');
    const mediaProbe = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      rendered,
    ], { encoding: 'utf8' });
    assert.equal(mediaProbe.status, 0);
    const renderedMedia = JSON.parse(mediaProbe.stdout);
    const video = renderedMedia.streams.find(stream => stream.codec_type === 'video');
    const audio = renderedMedia.streams.find(stream => stream.codec_type === 'audio');
    assert.deepEqual([video.width, video.height], [1280, 720]);
    assert.ok(audio, 'render should retain narration audio');
    assert.ok(Math.abs(Number(renderedMedia.format.duration) - 6.2) < 0.25);
    const blackDetect = spawnSync('ffmpeg', [
      '-hide_banner', '-i', rendered,
      '-vf', 'blackdetect=d=0.5:pix_th=0.02',
      '-an', '-f', 'null', '-',
    ], { encoding: 'utf8' });
    assert.ok(!/black_duration:(?:0\.[5-9]|[1-9])/.test(blackDetect.stderr || ''),
      'render should not contain a half-second black frame');

    passed = true;
    process.stdout.write(`\nPASS walkthrough eval\n`);
    process.stdout.write(`  recording: ${capture.recording}\n`);
    process.stdout.write(`  media: ${capture.manifest.media.width}x${capture.manifest.media.height} · ${capture.manifest.media.duration.toFixed(2)}s\n`);
    process.stdout.write(`  max action drift: ${Math.max(...capture.manifest.steps.map(step => Math.abs(step.driftMs)))}ms\n`);
    process.stdout.write(`  QA frames: ${images.length}\n`);
    process.stdout.write(`  MP4: ${renderedMedia.format.duration}s · ${video.width}x${video.height} · audio=${Boolean(audio)}\n`);
    process.stdout.write(`  artifacts: ${temp}\n`);
  } finally {
    server.kill('SIGTERM');
    if (!process.env.NAROVA_EVAL_KEEP) {
      fs.rmSync(temp, { recursive: true, force: true });
    } else if (!passed) {
      process.stderr.write(`eval artifacts kept after failure: ${temp}\n`);
    }
  }
}

main().catch(error => {
  process.stderr.write(`FAIL walkthrough eval: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
