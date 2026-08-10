'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { beatReviewTimes, motionReviewTimes } = require('../src/review-times');

test('motion review samples start, middle, and end of every scene', () => {
  const data = { total: 30, scenes: [
    { id: 'a', start: 0, dur: 10 },
    { id: 'b', start: 10, dur: 20 },
  ] };
  assert.deepEqual(motionReviewTimes(data), [1, 5, 9, 12, 20, 28]);
});

test('beat review samples arrival and resolved state of every narration group', () => {
  const data = {
    total: 12,
    scenes: [{ id: 'film', start: 0, dur: 12 }],
    groups: [
      { start: 0.2, end: 4.2 },
      { start: 4.2, end: 8.2 },
      { start: 8.2, end: 12 },
    ],
    markers: {},
  };
  assert.deepEqual(beatReviewTimes(data), [0.4, 4, 4.4, 8, 8.4, 11.8]);
});

test('beat review includes both sides of markers and motion coverage for silent scenes', () => {
  const data = {
    total: 10,
    scenes: [{ id: 'silent', start: 0, dur: 10 }],
    groups: [],
    markers: { reveal: 5 },
  };
  assert.deepEqual(beatReviewTimes(data), [1, 4.9, 5, 5.1, 9]);
});

test('beat review clamps short boundary groups and deduplicates times', () => {
  const data = {
    total: 1,
    scenes: [{ id: 'short', start: 0, dur: 1 }],
    groups: [{ start: 0, end: 0.3 }, { start: 0.3, end: 1 }],
    markers: { start: 0 },
  };
  assert.deepEqual(beatReviewTimes(data), [0, 0.1, 0.2, 0.5, 0.8]);
});
