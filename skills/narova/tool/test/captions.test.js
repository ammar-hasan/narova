'use strict';
/* Caption export: timestamp formatting, cue shape, SRT/VTT syntax, file writer. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stamp, buildSrt, buildVtt, writeCaptions } = require('../src/captions');
const { resolveConfig } = require('../src/schema');

/* Two sentence groups, global time; g1.end === g2.start (touching cues). */
const data = {
  total: 6.5,
  scenes: [{ id: 's1', start: 0, dur: 6.5, turns: [0.16, 3.1] }],
  groups: [
    {
      who: 'a', label: 'narrator · A', start: 0.16, end: 3.1,
      words: [
        { w: 'Hello', t0: 0.16, t1: 0.6 },
        { w: 'there.', t0: 0.64, t1: 1.1 },
      ],
    },
    {
      who: 'b', label: 'narrator · B', start: 3.1, end: 6.5,
      words: [
        { w: 'Second', t0: 3.1, t1: 3.6 },
        { w: 'line.', t0: 3.7, t1: 4.2 },
      ],
    },
  ],
};

test('stamp formats HH:MM:SS with the requested millis separator', () => {
  assert.equal(stamp(0, ','), '00:00:00,000');
  assert.equal(stamp(0.16, ','), '00:00:00,160');
  assert.equal(stamp(3.1, '.'), '00:00:03.100');
  assert.equal(stamp(65.5, '.'), '00:01:05.500');
  assert.equal(stamp(3661.25, ','), '01:01:01,250');
  assert.equal(stamp(0.16, '.'), '00:00:00.160');
});

test('buildSrt numbers cues, uses comma millis, one cue per sentence group', () => {
  const srt = buildSrt(data);
  assert.equal(srt,
    '1\n00:00:00,160 --> 00:00:03,100\nHello there.\n' +
    '\n' +
    '2\n00:00:03,100 --> 00:00:06,500\nSecond line.\n');
});

test('buildVtt has the WEBVTT header, dot millis, no cue numbers needed', () => {
  const vtt = buildVtt(data);
  assert.equal(vtt,
    'WEBVTT\n\n' +
    '00:00:00.160 --> 00:00:03.100\nHello there.\n' +
    '\n' +
    '00:00:03.100 --> 00:00:06.500\nSecond line.\n');
});

test('cue text joins words with spaces — never word-per-word cues', () => {
  for (const out of [buildSrt(data), buildVtt(data)]) {
    assert.ok(!/\bHello\n/.test(out), 'each word must not become its own cue');
    assert.match(out, /Hello there\./);
  }
});

test('writeCaptions writes both files from config + out/timings.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-captions-'));
  const config = resolveConfig({
    voices: { a: { speaker: 'v1' } },
    scenes: [{ id: 's1', body: '<p>x</p>', vo: [{ who: 'a', text: 'Hello there.' }] }],
  }, {}, dir);
  fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify({
    s1: {
      dur: 1.1,
      turns: [0.16],
      words: [
        { w: 'Hello', t0: 0.16, t1: 0.6, who: 'a', si: 0 },
        { w: 'there.', t0: 0.64, t1: 1.1, who: 'a', si: 0 },
      ],
    },
  }));
  const r = writeCaptions(config, dir);
  assert.equal(r.cues, 1);
  assert.equal(fs.readFileSync(r.srt, 'utf8'),
    '1\n00:00:00,160 --> 00:00:01,100\nHello there.\n');
  assert.equal(fs.readFileSync(r.vtt, 'utf8'),
    'WEBVTT\n\n00:00:00.160 --> 00:00:01.100\nHello there.\n');
});

test('writeCaptions throws without timings.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-captions-'));
  assert.throws(() => writeCaptions({}, dir));
});
