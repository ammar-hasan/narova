'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveConfig } = require('../src/schema');
const { composeData } = require('../src/compose/data');
const { composeDoc } = require('../src/compose/html');
const { composeCss } = require('../src/compose/css');
const { compose } = require('../src/compose');
const { compile } = require('../src/manifest');
const { plan, STAGE, formatPlan } = require('../src/plan');
const { check } = require('../src/check');
const {
  capturePaths,
  captureConfigHash,
  captureTimingHash,
  captureSynthesisHash,
  captureStatus,
  captureWalkthrough,
  exploreWalkthrough,
  cursorScript,
  redactDiagnostic,
  resolveStepTime,
  safeUrl,
  safeStateName,
  walkthroughSpan,
  replaceDir,
  targetArgs,
} = require('../src/walkthrough');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function rawProject() {
  return {
    title: 'Walkthrough Test',
    size: '16:9',
    voices: {
      a: { label: 'Narrator', speaker: 'en_US-ryan-high' },
    },
    walkthroughs: {
      demo: {
        url: 'https://example.com/app?access_token=do-not-persist',
        title: 'Example workspace',
        viewport: { w: 1440, h: 900 },
        ready: { load: 'domcontentloaded', timeout: 40000 },
        preRoll: 0.4,
        postRoll: 0.6,
        cursor: { travelMs: 250, color: '#d9ff57' },
        steps: [
          {
            at: { scene: 'intro', cue: 0, offset: 0.5 },
            action: 'click',
            target: { role: 'button', name: 'Create project' },
          },
          {
            at: 2,
            action: 'fill',
            target: { label: 'Project name' },
            value: 'Secret demo value',
          },
          {
            at: { scene: 'result', offset: 0.2 },
            action: 'wait',
            text: 'Ready',
            screenshot: 'ready-state',
          },
        ],
      },
    },
    scenes: [
      {
        id: 'intro',
        body: '<p>Build a project in seconds.</p>',
        walkthrough: 'demo',
        vo: [{ who: 'a', text: 'Create a project.' }],
      },
      {
        id: 'result',
        body: '<p>Everything is ready.</p>',
        walkthrough: {
          id: 'demo',
          layout: 'full',
          fit: 'cover',
          opacity: 0.9,
          position: { x: 0.4, y: 0.6 },
        },
        vo: [{ who: 'a', text: 'And see the result.' }],
      },
    ],
  };
}

function makeProject(raw = rawProject()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-walkthrough-'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  return { dir, config: resolveConfig(raw, {}, dir) };
}

const timings = () => ({
  intro: {
    dur: 3,
    turns: [0.2],
    words: [{ w: 'Create', t0: 0.2, t1: 0.6, who: 'a', si: 0 }],
  },
  result: {
    dur: 4,
    turns: [0.1],
    words: [{ w: 'Ready', t0: 0.1, t1: 0.5, who: 'a', si: 0 }],
  },
});

function writeFreshCapture(config, timingData, recording = Buffer.from('fake-webm')) {
  const paths = capturePaths(config, 'demo');
  fs.mkdirSync(paths.states, { recursive: true });
  fs.writeFileSync(paths.recording, recording);
  const span = walkthroughSpan(config, 'demo', timingData);
  const steps = config.walkthroughs.demo.steps.map((step, index) => {
    const evidence = step.action === 'screenshot'
      || (step.screenshot !== false
        && (step.screenshot != null || config.walkthroughs.demo.screenshots));
    let screenshot = null;
    let screenshotSha256 = null;
    if (evidence) {
      const name = safeStateName(index, step);
      const contents = Buffer.from(`png-${index}`);
      fs.writeFileSync(path.join(paths.states, name), contents);
      screenshot = `states/${name}`;
      screenshotSha256 = sha256(contents);
    }
    const planned = resolveStepTime(step, span);
    return {
      index,
      action: step.action,
      planned,
      started: planned,
      actionAt: planned,
      completed: planned,
      driftMs: 0,
      ...(screenshot ? { screenshot, screenshotSha256 } : {}),
    };
  });
  const manifest = {
    version: '1.0',
    id: 'demo',
    variant: config.variant || null,
    recording: 'recording.webm',
    recordingSha256: sha256(recording),
    configHash: captureConfigHash(config, 'demo'),
    synthesisHash: captureSynthesisHash(config),
    timingHash: captureTimingHash(config, 'demo', timingData),
    media: { width: 1440, height: 900, duration: 8, codec: 'vp8', fps: '10/1' },
    timeline: {
      preRoll: 0.4,
      readyLead: 0,
      sourceOrigin: 0.4,
      postRoll: 0.6,
      originScene: 'intro',
      duration: 7,
      scenes: [
        { id: 'intro', start: 0, dur: 3 },
        { id: 'result', start: 3, dur: 4 },
      ],
    },
    steps,
  };
  manifest.timelineSha256 = sha256(
    require('../src/providers').stableStringify(manifest.timeline),
  );
  fs.writeFileSync(paths.manifest, JSON.stringify(manifest, null, 2));
  return { paths, manifest };
}

test('schema resolves a driver-neutral walkthrough and scene presentation', () => {
  const { config } = makeProject();
  const flow = config.walkthroughs.demo;
  assert.equal(flow.driver, 'agent-browser');
  assert.deepEqual(flow.viewport, { w: 1440, h: 900 });
  assert.equal(flow.ready.timeout, 40000);
  assert.deepEqual(flow.steps[0].target, { role: 'button', name: 'Create project' });
  assert.deepEqual(flow.steps[0].at, { scene: 'intro', cue: 0, offset: 0.5 });
  assert.deepEqual(config.scenes[0].walkthrough, {
    id: 'demo',
    layout: 'window',
    fit: 'contain',
    opacity: 1,
    position: { x: 0.5, y: 0.5 },
  });
  assert.equal(config.scenes[1].walkthrough.layout, 'full');
});

test('schema resolves path-like profiles from the project root and preserves named profiles', () => {
  const raw = rawProject();
  raw.walkthroughs.demo.profile = 'browser-profiles/demo';
  const { dir, config } = makeProject(raw);
  assert.equal(
    config.walkthroughs.demo.profile,
    path.join(dir, 'browser-profiles', 'demo'),
  );

  const named = rawProject();
  named.walkthroughs.demo.profile = 'Default';
  assert.equal(makeProject(named).config.walkthroughs.demo.profile, 'Default');
});

test('schema aggregates unsafe walkthrough recipes and cross-flow anchors', () => {
  const raw = rawProject();
  raw.walkthroughs.demo.url = 'javascript:alert(1)';
  raw.walkthroughs.demo.session = '';
  raw.walkthroughs.demo.ready = { url: 'https://user:password@example.com/ready' };
  raw.walkthroughs.demo.steps.push({
    at: 1,
    action: 'wait',
    url: 'https://other:credential@example.com/done',
  });
  raw.walkthroughs.demo.steps[0].target = { role: 'button' };
  raw.walkthroughs.demo.steps[1] = {
    at: { scene: 'missing', cue: 99 },
    action: 'wait',
    text: '',
  };
  raw.scenes[0].clip = 'assets/also.mp4';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-walkthrough-bad-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'also.mp4'), 'video');
  assert.throws(() => resolveConfig(raw, {}, dir), error => {
    assert.match(error.message, /expected http\(s\) or file URL/);
    assert.match(error.message, /session: must be a non-empty string/);
    assert.match(error.message, /ready\.url: credentials must not be embedded/);
    assert.match(error.message, /steps\[3\]\.url: credentials must not be embedded/);
    assert.match(error.message, /name: required with a role locator/);
    assert.match(error.message, /"missing" is not a scene id/);
    assert.match(error.message, /text: must be a non-empty string/);
    assert.match(error.message, /cannot use both clip and walkthrough/);
    return true;
  });
});

test('schema validates select values, visible media, and anchors against the selected variant', () => {
  const emptySelect = rawProject();
  emptySelect.walkthroughs.demo.steps = [{
    at: 0,
    action: 'select',
    target: { css: '#workspace' },
    value: [],
  }];
  assert.throws(
    () => makeProject(emptySelect),
    /select needs a string or non-empty string array/,
  );

  const invisible = rawProject();
  invisible.scenes[0].walkthrough = { id: 'demo', opacity: 0 };
  assert.throws(
    () => makeProject(invisible),
    /opacity: must be greater than 0 and at most 1/,
  );

  const variantRaw = rawProject();
  variantRaw.walkthroughs.demo.steps[0].at = { scene: 'intro', cue: 1 };
  variantRaw.variants = [{
    id: 'two-turns',
    scene: {
      body: '<p>Variant.</p>',
      vo: [
        { who: 'a', text: 'First.' },
        { who: 'a', text: 'Second.' },
      ],
    },
  }];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-walkthrough-variant-anchor-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const variant = resolveConfig(variantRaw, { variant: 'two-turns' }, dir);
  assert.equal(variant.walkthroughs.demo.steps[0].at.cue, 1);
  assert.throws(() => resolveConfig(variantRaw, {}, dir), /turns 0\.\.0/);
});

test('walkthrough target commands prefer semantic locators and cursor is isolated', () => {
  assert.deepEqual(
    targetArgs({ role: 'button', name: 'Save', exact: true }, 'click'),
    ['find', 'role', 'button', 'click', '--name', 'Save', '--exact'],
  );
  assert.deepEqual(
    targetArgs({ css: '#email' }, 'fill', 'person@example.com'),
    ['fill', '#email', 'person@example.com'],
  );
  const script = cursorScript({ color: '#d9ff57', travelMs: 250 });
  assert.match(script, /attachShadow/);
  assert.match(script, /pointerEvents: 'none'/);
  assert.match(script, /transition:transform 250ms/);
  assert.match(script, /narova-ripple \.6s ease-out/);
  assert.match(script, /addEventListener\('pointerdown', pulse, true\)/);
  assert.ok(!/Math\.random|setInterval/.test(script));
  const diagnostic = redactDiagnostic(
    'failed at https://example.com/app?token=do-not-persist with Secret demo value',
    ['fill', '#name', 'Secret demo value'],
  );
  assert.ok(!diagnostic.includes('do-not-persist'));
  assert.ok(!diagnostic.includes('Secret demo value'));
  assert.equal(
    safeUrl('https://alice:secret@example.com/app?token=hidden'),
    'https://example.com/app?<redacted>',
  );
  assert.ok(!redactDiagnostic(
    'failed https://alice:secret@example.com/app?token=hidden',
  ).includes('secret'));
  assert.equal(
    redactDiagnostic(
      'Timed out waiting for **/dashboard?token=secret-token',
      ['wait', '--url', '**/dashboard?token=secret-token'],
    ),
    'Timed out waiting for <redacted>',
  );
});

test('explore opens the declared source and leaves a named session available', () => {
  const { config } = makeProject();
  const { config: otherProject } = makeProject();
  const calls = [];
  const spawn = (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === '--version') return { status: 0, stdout: 'agent-browser 0.33.0\n' };
    if (args.includes('snapshot')) return { status: 0, stdout: '- button "Create project" [ref=e1]\n' };
    return { status: 0, stdout: '' };
  };
  const result = exploreWalkthrough(config, 'demo', {
    agentBrowser: '/fake/agent-browser',
    spawn,
  });
  const other = exploreWalkthrough(otherProject, 'demo', {
    agentBrowser: '/fake/agent-browser',
    spawn,
  });
  assert.match(result.session, /^narova-walkthrough-test-demo-[a-f0-9]{10}$/);
  assert.notEqual(result.session, other.session, 'default sessions are isolated per project');
  assert.match(result.snapshot, /Create project/);
  assert.ok(calls.some(call => call.includes('open') && call.includes(config.walkthroughs.demo.url)));
  assert.ok(calls.some(call => call.includes('viewport') && call.includes('1440')));
  assert.ok(!calls.some(call => call.includes('close')), 'exploration session intentionally stays open');
});

test('capture runs timed actions, writes an auditable take, and detects staleness', () => {
  const raw = rawProject();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-walkthrough-policy-capture-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(
    path.join(dir, 'walkthrough-policy.json'),
    JSON.stringify({
      default: 'deny',
      allow: [
        'launch', 'close', 'viewport', 'recording_start', 'recording_stop',
        'navigate', 'snapshot', 'getbyrole', 'getbylabel',
        'click', 'fill', 'interact', 'wait', 'evaluate', 'screenshot',
        'keyboard',
      ],
    }),
  );
  raw.walkthroughs.demo.actionPolicy = 'walkthrough-policy.json';
  const config = resolveConfig(raw, {}, dir);
  const calls = [];
  const logs = [];
  let clock = 0;
  const spawn = (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === '--version') return { status: 0, stdout: 'agent-browser 0.33.0\n' };
    const record = args.lastIndexOf('record');
    if (record >= 0 && args[record + 1] === 'start') {
      fs.mkdirSync(path.dirname(args[record + 2]), { recursive: true });
      fs.writeFileSync(args[record + 2], 'captured-webm');
    }
    const screenshot = args.lastIndexOf('screenshot');
    if (screenshot >= 0) {
      fs.mkdirSync(path.dirname(args[screenshot + 1]), { recursive: true });
      fs.writeFileSync(args[screenshot + 1], 'png');
    }
    const wait = args.lastIndexOf('wait');
    if (wait >= 0 && /^\d+$/.test(args[wait + 1] || '')) clock += Number(args[wait + 1]) / 1000;
    else clock += 0.01;
    return { status: 0, stdout: '' };
  };

  const result = captureWalkthrough(config, 'demo', timings(), {
    agentBrowser: '/fake/agent-browser',
    spawn,
    now: () => clock,
    skipToolCheck: true,
    scratchDir: path.join(dir, '.capture-work'),
    inspectRecording: () => ({
      duration: 8,
      width: 1440,
      height: 900,
      codec: 'vp8',
      fps: '10/1',
    }),
    log: line => logs.push(line),
  });

  assert.ok(fs.existsSync(result.recording));
  assert.equal(result.manifest.steps.length, 3);
  assert.ok(result.manifest.steps.every(step => Math.abs(step.driftMs) <= 30));
  assert.equal(result.manifest.url, 'https://example.com/app');
  assert.ok(result.manifest.urlHash);
  const manifestText = fs.readFileSync(capturePaths(config, 'demo').manifest, 'utf8');
  assert.ok(!manifestText.includes('Secret demo value'));
  assert.ok(!manifestText.includes('do-not-persist'));
  assert.ok(!logs.join('\n').includes('Secret demo value'));
  assert.ok(!logs.join('\n').includes('do-not-persist'));
  assert.equal(captureStatus(config, 'demo', timings()).ok, true);
  assert.equal(captureStatus(config, 'demo').reason, 'narration timings unavailable');
  assert.ok(calls.some(call => call.includes('record') && call.includes('start')));
  assert.ok(calls.some(call => call.includes('record') && call.includes('stop')));
  assert.ok(calls.some(call => call.includes('find') && call.includes('role')));
  const recordStart = calls.findIndex(
    call => call.includes('record') && call.includes('start'),
  );
  const cursorInstalls = calls
    .map((call, index) => ({ call, index }))
    .filter(({ call, index }) => index > recordStart
      && call.includes('eval')
      && call.some(arg => String(arg).includes('__narova_cursor_host__')));
  const firstRecordedAction = calls.findIndex(
    (call, index) => index > recordStart && call.includes('find'),
  );
  const cursorInstall = cursorInstalls[0].index;
  assert.equal(cursorInstalls.length, config.walkthroughs.demo.steps.length,
    'cursor is reinstalled before every step so full navigations cannot remove it');
  assert.ok(cursorInstall > recordStart, 'cursor is installed in the current recorded document');
  assert.ok(calls[cursorInstall].includes('--action-policy'),
    'cursor setup respects the configured action policy');
  assert.ok(calls.some(call => call.includes('--action-policy')
    && call.includes('find') && call.includes('click')),
  'user-authored actions remain policy-gated');
  assert.ok(cursorInstall < firstRecordedAction, 'cursor is installed before recorded actions');
  const firstClick = calls.findIndex(
    (call, index) => index > cursorInstall && call.includes('find') && call.includes('click'),
  );
  assert.ok(calls.slice(firstClick + 1, cursorInstalls[1].index).some(
    call => call.includes('wait') && call.some(arg => /^\d+$/.test(String(arg))),
  ), 'the next cursor install follows the bulk wait, after a delayed navigation can settle');
  assert.ok(!calls.some(call => call.includes('--init-script')),
    'capture does not repeatedly register an init script on every driver command');
  assert.ok(
    calls.slice(recordStart + 1).some(call => call.includes('wait') && call.includes('--load')),
    'readiness is re-applied inside agent-browser’s fresh recording context',
  );
  assert.ok(!logs.join('\n').includes('__narova_cursor_host__'));
  const echoedEval = redactDiagnostic(
    `failed expression: ${cursorScript(config.walkthroughs.demo.cursor)}`,
    ['--session', 'demo', 'eval', cursorScript(config.walkthroughs.demo.cursor)],
  );
  assert.equal(echoedEval, '<redacted eval diagnostic>');
  assert.equal(result.manifest.timeline.readyLead, 0.01);
  assert.equal(result.manifest.timeline.sourceOrigin, 0.41);

  fs.writeFileSync(result.recording, 'tampered');
  assert.equal(captureStatus(config, 'demo', timings()).reason, 'recording content changed');
  fs.writeFileSync(result.recording, 'captured-webm');

  const tamperedManifest = JSON.parse(manifestText);
  tamperedManifest.timeline.scenes[0].start = 99;
  fs.writeFileSync(capturePaths(config, 'demo').manifest, JSON.stringify(tamperedManifest));
  assert.equal(captureStatus(config, 'demo', timings()).reason, 'capture trim map changed');
  fs.writeFileSync(capturePaths(config, 'demo').manifest, manifestText);

  const changedRaw = rawProject();
  changedRaw.walkthroughs.demo.steps[1].value = 'a different input';
  const changedConfig = resolveConfig(changedRaw, {}, dir);
  assert.equal(captureStatus(changedConfig, 'demo', timings()).reason, 'walkthrough recipe changed');

  const changedTiming = timings();
  changedTiming.result.dur = 4.5;
  assert.equal(captureStatus(config, 'demo', changedTiming).reason, 'narration timings changed');

  const changedNarrationRaw = rawProject();
  changedNarrationRaw.scenes[0].vo[0].text = 'Narration changed after the last successful synth.';
  changedNarrationRaw.walkthroughs.demo.actionPolicy = 'walkthrough-policy.json';
  const changedNarration = resolveConfig(changedNarrationRaw, {}, dir);
  assert.equal(
    captureStatus(changedNarration, 'demo', timings()).reason,
    'narration synthesis inputs changed',
  );

  const incomplete = { intro: timings().intro };
  assert.doesNotThrow(() => captureStatus(config, 'demo', incomplete));
  assert.equal(captureStatus(config, 'demo', incomplete).reason, 'narration timings are incomplete');

  const evidenceManifest = fs.readFileSync(capturePaths(config, 'demo').manifest, 'utf8');
  const firstEvidence = result.manifest.steps.find(step => step.screenshot);
  fs.rmSync(path.join(result.dir, firstEvidence.screenshot));
  assert.equal(
    captureStatus(config, 'demo', timings()).reason,
    'capture screenshot evidence is missing or changed',
  );
  fs.writeFileSync(
    path.join(result.dir, firstEvidence.screenshot),
    Buffer.from('png'),
  );

  const missingActions = JSON.parse(evidenceManifest);
  missingActions.steps = [];
  fs.writeFileSync(capturePaths(config, 'demo').manifest, JSON.stringify(missingActions));
  assert.equal(
    captureStatus(config, 'demo', timings()).reason,
    'capture action evidence is incomplete',
  );
});

test('capture degrades to policy-gated actions when evaluate is denied', () => {
  const raw = rawProject();
  raw.walkthroughs.demo.steps = [raw.walkthroughs.demo.steps[0]];
  raw.walkthroughs.demo.screenshots = false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-walkthrough-denied-cursor-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const policy = path.join(dir, 'walkthrough-policy.json');
  fs.writeFileSync(policy, JSON.stringify({ default: 'deny', allow: ['click'] }));
  raw.walkthroughs.demo.actionPolicy = 'walkthrough-policy.json';
  const config = resolveConfig(raw, {}, dir);
  const calls = [];
  const logs = [];
  let clock = 0;
  const spawn = (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === '--version') return { status: 0, stdout: 'agent-browser 0.33.0\n' };
    const record = args.lastIndexOf('record');
    if (record >= 0 && args[record + 1] === 'start') {
      fs.mkdirSync(path.dirname(args[record + 2]), { recursive: true });
      fs.writeFileSync(args[record + 2], 'captured-webm');
    }
    const wait = args.lastIndexOf('wait');
    if (wait >= 0 && /^\d+$/.test(args[wait + 1] || '')) {
      clock += Number(args[wait + 1]) / 1000;
    } else {
      clock += 0.01;
    }
    if (args.includes('eval')) {
      return {
        status: 1,
        stderr: "✗ Action 'evaluate' denied by policy: Action 'evaluate' is not in the allow list",
      };
    }
    return { status: 0, stdout: '' };
  };

  assert.doesNotThrow(() => captureWalkthrough(config, 'demo', timings(), {
    agentBrowser: '/fake/agent-browser',
    spawn,
    now: () => clock,
    skipToolCheck: true,
    scratchDir: path.join(dir, '.capture-work'),
    inspectRecording: () => ({
      duration: 8,
      width: 1440,
      height: 900,
      codec: 'vp8',
      fps: '10/1',
    }),
    log: line => logs.push(line),
  }));
  assert.equal(calls.filter(call => call.includes('eval')).length, 1);
  assert.ok(calls.some(call => call.includes('--action-policy')
    && call.includes('find') && call.includes('click')));
  assert.ok(!calls.some(call => call.includes('find') && call.includes('hover')));
  assert.match(logs.join('\n'), /cursor disabled: action policy denies evaluate/);
});

test('capture and status reject timings from stale synthesis output', () => {
  const { dir, config } = makeProject();
  writeFreshCapture(config, timings());
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, '.audio-fingerprint'), 'stale\n');
  assert.equal(
    captureStatus(config, 'demo', timings(), { outDir: out }).reason,
    'narration synthesis is stale',
  );
  assert.throws(
    () => captureWalkthrough(config, 'demo', timings(), { outDir: out }),
    /narration synthesis is stale/,
  );

  fs.writeFileSync(path.join(out, '.audio-fingerprint'), `${captureSynthesisHash(config)}\n`);
  assert.equal(captureStatus(config, 'demo', timings(), { outDir: out }).ok, true);
});

test('pre-roll absorbs cursor travel for an action at narration origin', () => {
  const raw = rawProject();
  raw.walkthroughs.demo.steps = [{
    at: 0,
    action: 'click',
    target: { role: 'button', name: 'Create project' },
  }];
  const { dir, config } = makeProject(raw);
  let clock = 0;
  const spawn = (bin, args) => {
    if (args[0] === '--version') return { status: 0, stdout: 'agent-browser 0.33.0\n' };
    const record = args.lastIndexOf('record');
    if (record >= 0 && args[record + 1] === 'start') {
      fs.mkdirSync(path.dirname(args[record + 2]), { recursive: true });
      fs.writeFileSync(args[record + 2], 'captured-webm');
    }
    const screenshot = args.lastIndexOf('screenshot');
    if (screenshot >= 0) {
      fs.mkdirSync(path.dirname(args[screenshot + 1]), { recursive: true });
      fs.writeFileSync(args[screenshot + 1], 'png');
    }
    const wait = args.lastIndexOf('wait');
    if (wait >= 0 && /^\d+$/.test(args[wait + 1] || '')) {
      clock += Number(args[wait + 1]) / 1000;
    } else {
      clock += 0.01;
    }
    return { status: 0, stdout: '' };
  };
  const result = captureWalkthrough(config, 'demo', timings(), {
    agentBrowser: '/fake/agent-browser',
    spawn,
    now: () => clock,
    skipToolCheck: true,
    scratchDir: path.join(dir, '.origin-work'),
    inspectRecording: () => ({
      duration: 8, width: 1440, height: 900, codec: 'vp8', fps: '10/1',
    }),
    log: () => {},
  });
  assert.ok(Math.abs(result.manifest.steps[0].driftMs) <= 30);

  const insufficientRaw = rawProject();
  insufficientRaw.walkthroughs.demo.preRoll = 0.1;
  insufficientRaw.walkthroughs.demo.steps = raw.walkthroughs.demo.steps;
  const insufficient = resolveConfig(insufficientRaw, {}, dir);
  assert.throws(
    () => captureWalkthrough(insufficient, 'demo', timings(), {
      agentBrowser: '/fake/agent-browser',
      spawn,
      now: () => clock,
      skipToolCheck: true,
      scratchDir: path.join(dir, '.short-origin-work'),
      inspectRecording: () => ({
        duration: 8, width: 1440, height: 900, codec: 'vp8', fps: '10/1',
      }),
      log: () => {},
    }),
    /needs at least 0\.250s preRoll/,
  );
});

test('a missing timing after the final walkthrough scene does not stale the take', () => {
  const { dir, config } = makeProject();
  writeFreshCapture(config, timings());
  const raw = rawProject();
  raw.scenes.push({ id: 'tail', body: '<p>Done.</p>', dur: 1, vo: [] });
  const withSilentTail = resolveConfig(raw, {}, dir);
  assert.equal(captureStatus(withSilentTail, 'demo', timings()).ok, true);
});

test('compose trims one continuous capture per scene and renders a browser shell', () => {
  const { config } = makeProject();
  writeFreshCapture(config, timings());
  const data = composeData(config, timings());
  const html = composeDoc(config, config.size, data, '');

  assert.match(html, /id="walkthrough-intro"[^>]*data-start="0"[^>]*data-duration="3"[^>]*data-media-start="0\.4"/);
  assert.match(html, /id="walkthrough-result"[^>]*data-start="3"[^>]*data-duration="4"[^>]*data-media-start="3\.4"/);
  assert.match(html, /class="walkthrough-media walkthrough-window"/);
  assert.match(html, /class="walkthrough-media walkthrough-full"/);
  assert.match(html, /class="walkthrough-shell"/);
  assert.match(html, /Example workspace/);
  assert.ok(!/id="walkthrough-[^"]+"[^>]*\bloop\b/.test(html));
  assert.ok(html.indexOf('id="walkthrough-intro"') < html.indexOf('id="scene-intro"'));
  const css = composeCss(config.theme, config.voices, config.size);
  assert.match(css, /\.walkthrough-window\{[^}]*height:calc\(/);
  assert.match(css, /\.scene\.walkthrough-layout-full::after\{[^}]*linear-gradient/);
});

test('compose refuses missing captures and succeeds once hashes match', () => {
  const { dir, config } = makeProject();
  const out = path.join(dir, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'RIFFfake');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings()));
  assert.throws(() => compose(config, out), /capture is stale or missing/);

  writeFreshCapture(config, timings());
  fs.writeFileSync(path.join(out, '.audio-fingerprint'), `${captureSynthesisHash(config)}\n`);
  const result = compose(config, out);
  const html = fs.readFileSync(path.join(result.dir, 'index.html'), 'utf8');
  assert.match(html, /data-media-start="0\.4"/);
  assert.ok(fs.existsSync(path.join(result.dir, 'assets', 'walkthroughs', 'demo', 'recording.webm')));
});

test('manifest redacts typed values but preserves walkthrough structure', () => {
  const raw = rawProject();
  raw.walkthroughs.demo.ready = {
    url: 'https://example.com/ready?auth=ready-secret',
    timeout: 40000,
  };
  raw.walkthroughs.demo.steps.push({
    at: 2.5,
    action: 'wait',
    url: 'https://example.com/done?auth=wait-secret',
  });
  const { config } = makeProject(raw);
  const manifest = compile(config, { toolVersion: '0.13.0' });
  assert.equal(manifest.walkthroughs.demo.driver, 'agent-browser');
  assert.equal(manifest.walkthroughs.demo.steps[1].value, '<redacted>');
  assert.ok(manifest.walkthroughs.demo.steps[1].valueHash);
  assert.equal(manifest.scenes[0].walkthrough.id, 'demo');
  assert.ok(!JSON.stringify(manifest).includes('Secret demo value'));
  assert.ok(!JSON.stringify(manifest).includes('do-not-persist'));
  assert.ok(!JSON.stringify(manifest).includes('ready-secret'));
  assert.ok(!JSON.stringify(manifest).includes('wait-secret'));
  assert.equal(manifest.walkthroughs.demo.url, 'https://example.com/app');
  assert.equal(manifest.walkthroughs.demo.ready.url, 'https://example.com/ready');
  assert.equal(manifest.walkthroughs.demo.steps.at(-1).url, 'https://example.com/done');
  assert.ok(manifest.walkthroughs.demo.urlHash);

  // Defense in depth: serialization strips userinfo even if an already
  // resolved config object is mutated by an API caller after validation.
  config.walkthroughs.demo.url = 'https://alice:secret@example.com/app?token=x';
  config.walkthroughs.demo.ready.url = 'https://bob:password@example.com/ready?token=y';
  const defensive = compile(config, { toolVersion: '0.13.0' });
  assert.equal(defensive.walkthroughs.demo.url, 'https://example.com/app');
  assert.equal(defensive.walkthroughs.demo.ready.url, 'https://example.com/ready');
  assert.ok(!JSON.stringify(defensive).includes('alice'));
  assert.ok(!JSON.stringify(defensive).includes('password'));
});

test('planner marks recipe/script changes for recapture but layout-only changes do not', () => {
  const { dir, config } = makeProject();
  writeFreshCapture(config, timings());
  const previous = path.join(dir, 'manifest.json');
  fs.writeFileSync(previous, JSON.stringify(compile(config, { toolVersion: '0.13.0' })));
  fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify(timings()));
  fs.writeFileSync(
    path.join(dir, '.audio-fingerprint'),
    `${captureSynthesisHash(config)}\n`,
  );

  const recipeRaw = rawProject();
  recipeRaw.walkthroughs.demo.steps[1].value = 'changed';
  const recipe = plan(previous, resolveConfig(recipeRaw, {}, dir), { toolVersion: '0.13.0' });
  assert.equal(recipe.level.label, STAGE.CAPTURE.label);
  assert.equal(recipe.level.capture, true);
  assert.match(formatPlan(recipe), /walkthrough capture/);

  const scriptRaw = rawProject();
  scriptRaw.scenes[0].vo[0].text = 'A longer line changes the narration timing.';
  const script = plan(previous, resolveConfig(scriptRaw, {}, dir), { toolVersion: '0.13.0' });
  assert.equal(script.level.capture, true);
  assert.equal(script.level.tts, true);

  const layoutRaw = rawProject();
  layoutRaw.scenes[0].walkthrough = { id: 'demo', layout: 'full' };
  const layout = plan(previous, resolveConfig(layoutRaw, {}, dir), { toolVersion: '0.13.0' });
  assert.equal(layout.level.label, STAGE.VISUAL.label);
  assert.equal(layout.level.capture, false);

  const titleRaw = rawProject();
  titleRaw.walkthroughs.demo.title = 'A different generated browser title';
  const title = plan(previous, resolveConfig(titleRaw, {}, dir), { toolVersion: '0.13.0' });
  assert.equal(title.level.label, STAGE.CONFIG.label);
  assert.equal(title.level.capture, false);
  assert.equal(captureConfigHash(config, 'demo'), captureConfigHash(resolveConfig(titleRaw, {}, dir), 'demo'));

  const renamedRaw = rawProject();
  renamedRaw.scenes[0].id = 'renamed-intro';
  renamedRaw.walkthroughs.demo.steps[0].at = 0.5;
  const renamed = plan(previous, resolveConfig(renamedRaw, {}, dir), { toolVersion: '0.13.0' });
  assert.equal(renamed.level.label, STAGE.FULL.label);
  assert.equal(renamed.level.capture, true);
  assert.equal(renamed.level.tts, true);

  const formatAndRecipeRaw = rawProject();
  formatAndRecipeRaw.size = '9:16';
  formatAndRecipeRaw.walkthroughs.demo.steps[0].target.name = 'Start project';
  const formatAndRecipe = plan(
    previous,
    resolveConfig(formatAndRecipeRaw, {}, dir),
    { toolVersion: '0.13.0' },
  );
  assert.equal(formatAndRecipe.level.label, STAGE.FULL.label);
  assert.equal(formatAndRecipe.level.capture, true);
});

test('planner preserves audio mixing when a bed and walkthrough recipe change together', () => {
  const { dir, config } = makeProject();
  const previous = path.join(dir, 'manifest.json');
  fs.writeFileSync(previous, JSON.stringify(compile(config, { toolVersion: '0.13.0' })));
  fs.writeFileSync(path.join(dir, 'assets', 'bed.wav'), 'fake-bed');
  const raw = rawProject();
  raw.bed = { file: 'assets/bed.wav', volume: 0.2 };
  raw.walkthroughs.demo.steps[0].target.name = 'Start project';
  const result = plan(previous, resolveConfig(raw, {}, dir), { toolVersion: '0.13.0' });
  assert.equal(result.level.label, STAGE.CAPTURE.label);
  assert.equal(result.level.capture, true);
  assert.equal(result.level.mix, true);
  assert.match(formatPlan(result), /mix → walkthrough capture/);
});

test('planner requires capture when walkthrough assets are missing from a changed assets root', () => {
  const { dir, config } = makeProject();
  writeFreshCapture(config, timings());
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(
    compile(config, { toolVersion: '0.13.0' }),
  ));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings()));
  fs.writeFileSync(
    path.join(out, '.audio-fingerprint'),
    `${captureSynthesisHash(config)}\n`,
  );
  const movedRaw = rawProject();
  movedRaw.assets = 'media';
  fs.mkdirSync(path.join(dir, 'media'));
  const moved = resolveConfig(movedRaw, {}, dir);
  const result = plan(
    path.join(out, 'manifest.json'),
    moved,
    { toolVersion: '0.13.0' },
  );
  assert.equal(result.level.label, STAGE.CONFIG.label);
  assert.equal(result.level.capture, true);
  assert.match(formatPlan(result), /walkthrough capture/);
});

test('planner treats capture freshness as independent and a fresh take clears recapture', () => {
  const { dir, config } = makeProject();
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const previous = path.join(out, 'manifest.json');
  fs.writeFileSync(previous, JSON.stringify(
    compile(config, { toolVersion: '0.13.0' }),
  ));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings()));
  fs.writeFileSync(
    path.join(out, '.audio-fingerprint'),
    `${captureSynthesisHash(config)}\n`,
  );

  const missing = plan(previous, config, { toolVersion: '0.13.0' });
  assert.equal(missing.level.label, STAGE.CAPTURE.label);
  assert.equal(missing.level.capture, true);
  assert.match(formatPlan(missing), /walkthrough capture/);

  writeFreshCapture(config, timings());
  const fresh = plan(previous, config, { toolVersion: '0.13.0' });
  assert.equal(fresh.level.label, STAGE.CONFIG.label);
  assert.equal(fresh.level.capture, false);
});

test('planner does not re-request a fresh recipe take before the manifest rebuilds', () => {
  const { dir, config } = makeProject();
  writeFreshCapture(config, timings());
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const previous = path.join(out, 'manifest.json');
  fs.writeFileSync(previous, JSON.stringify(
    compile(config, { toolVersion: '0.13.0' }),
  ));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings()));
  fs.writeFileSync(
    path.join(out, '.audio-fingerprint'),
    `${captureSynthesisHash(config)}\n`,
  );

  const changedRaw = rawProject();
  changedRaw.walkthroughs.demo.steps[1].value = 'freshly captured value';
  const changed = resolveConfig(changedRaw, {}, dir);
  writeFreshCapture(changed, timings(), Buffer.from('fresh-recipe-webm'));
  const recipe = plan(previous, changed, { toolVersion: '0.13.0' });
  assert.equal(recipe.level.label, STAGE.CONFIG.label);
  assert.equal(recipe.level.capture, false);

  const formatRaw = rawProject();
  formatRaw.size = '9:16';
  formatRaw.walkthroughs.demo.steps[1].value = 'fresh format take';
  const format = resolveConfig(formatRaw, {}, dir);
  writeFreshCapture(format, timings(), Buffer.from('fresh-format-webm'));
  const reformatted = plan(previous, format, { toolVersion: '0.13.0' });
  assert.equal(reformatted.level.label, STAGE.FULL.label);
  assert.equal(reformatted.level.capture, false);
});

test('planner preserves pending alignment capture across format and visual classifiers', () => {
  const { dir, config } = makeProject();
  writeFreshCapture(config, timings());
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const previous = path.join(out, 'manifest.json');
  fs.writeFileSync(previous, JSON.stringify(
    compile(config, { toolVersion: '0.13.0' }),
  ));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings()));
  fs.writeFileSync(
    path.join(out, '.audio-fingerprint'),
    `${captureSynthesisHash(config)}\n`,
  );

  const formatRaw = rawProject();
  formatRaw.align = true;
  formatRaw.size = '9:16';
  const format = plan(
    previous,
    resolveConfig(formatRaw, {}, dir),
    { toolVersion: '0.13.0' },
  );
  assert.equal(format.level.label, STAGE.FULL.label);
  assert.equal(format.level.capture, true);

  const visualRaw = rawProject();
  visualRaw.align = true;
  visualRaw.scenes[0].body = '<p>Alignment changes with this visual.</p>';
  const visual = plan(
    previous,
    resolveConfig(visualRaw, {}, dir),
    { toolVersion: '0.13.0' },
  );
  assert.equal(visual.level.label, STAGE.VISUAL.label);
  assert.equal(visual.level.capture, true);
});

test('planner preserves recapture when missing walkthrough media coincides with a visual edit', () => {
  const { dir, config } = makeProject();
  const { paths } = writeFreshCapture(config, timings());
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(
    compile(config, { toolVersion: '0.13.0' }),
  ));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings()));
  fs.writeFileSync(
    path.join(out, '.audio-fingerprint'),
    `${captureSynthesisHash(config)}\n`,
  );

  fs.unlinkSync(paths.recording);
  const editedRaw = rawProject();
  editedRaw.scenes[0].body = '<p>Updated walkthrough framing.</p>';
  const result = plan(
    path.join(out, 'manifest.json'),
    resolveConfig(editedRaw, {}, dir),
    { toolVersion: '0.13.0' },
  );

  assert.equal(result.level.label, STAGE.VISUAL.label);
  assert.equal(result.level.capture, true);
  assert.match(formatPlan(result), /walkthrough capture → compose/);
});

test('policy contents, narration variants, and destination staging are capture-safe', () => {
  const raw = rawProject();
  const { dir } = makeProject(raw);
  const policy = path.join(dir, 'walkthrough-policy.json');
  fs.writeFileSync(policy, '{"default":"allow"}');
  raw.walkthroughs.demo.actionPolicy = 'walkthrough-policy.json';
  raw.variants = [{
    id: 'alternate',
    scene: {
      body: '<p>Alternate hook.</p>',
      vo: [{ who: 'a', text: 'A longer alternate narration.' }],
    },
  }];
  const base = resolveConfig(raw, {}, dir);
  const previous = path.join(dir, 'policy-before.json');
  fs.writeFileSync(previous, JSON.stringify(compile(base, { toolVersion: '0.13.0' })));
  const firstHash = captureConfigHash(base, 'demo');
  fs.writeFileSync(policy, '{"default":"deny"}');
  const tightened = resolveConfig(raw, {}, dir);
  assert.notEqual(captureConfigHash(tightened, 'demo'), firstHash);
  assert.ok(compile(tightened).walkthroughs.demo.actionPolicyHash);
  assert.equal(
    plan(previous, tightened, { toolVersion: '0.13.0' }).level.label,
    STAGE.CAPTURE.label,
  );

  const variant = resolveConfig(raw, { variant: 'alternate' }, dir);
  assert.notEqual(capturePaths(base, 'demo').dir, capturePaths(variant, 'demo').dir);
  assert.match(capturePaths(variant, 'demo').assetRecording, /\/variants\/alternate\/recording\.webm$/);
  writeFreshCapture(variant, timings());
  const variantHtml = composeDoc(variant, variant.size, composeData(variant, timings()), '');
  assert.match(variantHtml, /assets\/walkthroughs\/demo\/variants\/alternate\/recording\.webm/);

  const source = path.join(dir, 'source-take');
  const destination = path.join(dir, 'captures', 'demo');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(source, 'recording.webm'), 'new');
  fs.writeFileSync(path.join(destination, 'recording.webm'), 'old');
  replaceDir(source, destination);
  assert.equal(fs.readFileSync(path.join(destination, 'recording.webm'), 'utf8'), 'new');
  assert.ok(fs.existsSync(source), 'source scratch stays available until the caller cleans it');
});

test('capture drift is sampled immediately before the real action', () => {
  const { dir, config } = makeProject();
  let clock = 0;
  const spawn = (bin, args) => {
    if (args[0] === '--version') return { status: 0, stdout: 'agent-browser 0.33.0\n' };
    const record = args.lastIndexOf('record');
    if (record >= 0 && args[record + 1] === 'start') {
      fs.mkdirSync(path.dirname(args[record + 2]), { recursive: true });
      fs.writeFileSync(args[record + 2], 'captured-webm');
    }
    const screenshot = args.lastIndexOf('screenshot');
    if (screenshot >= 0) {
      fs.mkdirSync(path.dirname(args[screenshot + 1]), { recursive: true });
      fs.writeFileSync(args[screenshot + 1], 'png');
    }
    const wait = args.lastIndexOf('wait');
    if (wait >= 0 && /^\d+$/.test(args[wait + 1] || '')) clock += Number(args[wait + 1]) / 1000;
    else if (args.includes('hover')) clock += 0.5;
    else clock += 0.01;
    return { status: 0, stdout: '' };
  };
  const capture = captureWalkthrough(config, 'demo', timings(), {
    agentBrowser: '/fake/agent-browser',
    spawn,
    now: () => clock,
    skipToolCheck: true,
    scratchDir: path.join(dir, '.drift-work'),
    inspectRecording: () => ({
      duration: 8, width: 1440, height: 900, codec: 'vp8', fps: '10/1',
    }),
    log: () => {},
  });
  assert.ok(capture.manifest.steps[0].driftMs >= 500);
  assert.ok(capture.manifest.steps[0].actionAt >= capture.manifest.steps[0].planned + 0.5);
});

test('release check treats walkthrough media as visual but requires a fresh capture', () => {
  const raw = rawProject();
  raw.scenes[0].body = '';
  const { config } = makeProject(raw);
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  let ok;
  try { ok = check(config, { release: true }); }
  finally { console.log = original; }
  assert.equal(ok, false);
  assert.ok(lines.some(line => /walkthrough "demo": recording missing/.test(line)));
  assert.ok(!lines.some(line => /scene "intro".*black frame/.test(line)));
});
