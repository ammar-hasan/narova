'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composeCss, DEFAULT_TOKENS, LIGHT_TOKENS } = require('../src/compose/css');

const size = { w: 1280, h: 720 };
const voices = { a: { color: '#ff7eb6' } };

test('dark mode is the default and keeps the classic palette', () => {
  const css = composeCss({}, voices, size);
  assert.match(css, /--bg:#080d16/);
  assert.match(css, /--ink:#eaf1fb/);
  assert.match(css, /--track:rgba\(255,255,255,\.06\)/);
});

test('light mode flips the field tokens in one switch', () => {
  const css = composeCss({}, voices, size, '', 'light');
  assert.match(css, /--bg:#f7f9fd/);
  assert.match(css, /--ink:#0f1c2e/);
  assert.match(css, /--panel:#ffffff/);
  assert.match(css, /--track:rgba\(15,28,46,\.08\)/);
  assert.match(css, /--capidle:#93a1bb/);
});

test('user tokens override both dark and light bases', () => {
  assert.match(composeCss({ bg: '#123456' }, voices, size), /--bg:#123456/);
  assert.match(composeCss({ bg: '#123456' }, voices, size, '', 'light'), /--bg:#123456/);
});

test('no dark value is hardcoded outside token definitions', () => {
  for (const mode of ['dark', 'light']) {
    const css = composeCss({}, voices, size, '', mode);
    assert.ok(!/background:#0c1526/.test(css), `${mode}: chip background must be a token`);
    assert.ok(!/color:#5f6f8e/.test(css), `${mode}: caption idle color must be a token`);
    assert.ok(!/#10203a 0%/.test(css), `${mode}: bg gradient must use tokens`);
    assert.ok(!/color:#04140f/.test(css), `${mode}: dial on-text must be a token`);
  }
});

test('accent glows derive from the accent token, never a hardcoded teal', () => {
  for (const mode of ['dark', 'light']) {
    const css = composeCss({ accent: '#ff0000' }, voices, size, '', mode);
    assert.match(css, /rgba\(255,0,0,0\.12\)/, `${mode}: owner glow follows the accent`);
    assert.ok(!/rgba\(46,230,214/.test(css), `${mode}: no teal may survive an accent override`);
  }
});

test('every token key lands as a CSS var; LIGHT_TOKENS only overrides known keys', () => {
  for (const k of Object.keys(LIGHT_TOKENS)) {
    assert.ok(k in DEFAULT_TOKENS, `LIGHT_TOKENS.${k} must override a dark token, not invent one`);
  }
  const css = composeCss({}, voices, size, '', 'light');
  assert.match(css, /--deep:#dde5f2/);
  assert.match(css, /--halo:#e7edf8/);
});

test('theme.css is appended last so it can override the base', () => {
  const css = composeCss({}, voices, size, '.x{color:red}');
  assert.ok(css.trimEnd().endsWith('.x{color:red}'));
});
