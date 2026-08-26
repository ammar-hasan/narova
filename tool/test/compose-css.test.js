'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composeCss, DEFAULT_TOKENS, LIGHT_TOKENS } = require('../src/compose/css');

const size = { w: 1280, h: 720 };
const voices = { a: { color: '#ff7eb6' } };

test('dark mode is the default and uses neutral monochrome tokens', () => {
  const css = composeCss({}, voices, size);
  assert.match(css, /--bg:#101010/);
  assert.match(css, /--ink:#e8e8e8/);
  assert.match(css, /--track:rgba\(255,255,255,\.06\)/);
});

test('default font stacks are generic-only so composition stays network-free (NAR-002-026)', () => {
  for (const mode of ['dark', 'light']) {
    const css = composeCss({}, voices, size, '', mode);
    assert.match(css, /--mono:ui-monospace,monospace;/);
    assert.match(css, /--sans:system-ui,sans-serif;/);
    // No named family may appear in any default-emitted font token: the
    // HyperFrames compiler fetches every named family it finds from Google
    // Fonts, even when project CSS follows the system-only guidance.
    for (const named of ['Roboto', 'Consolas', 'Menlo', 'SF Mono', 'Segoe UI', 'Inter', 'Helvetica']) {
      assert.ok(!new RegExp(`--(?:mono|sans):[^;]*${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(css), `${mode}: ${named} must not appear in default font stacks`);
    }
  }
});

test('an explicit token override still replaces the default font stack', () => {
  const css = composeCss({ sans: 'Inter, system-ui, sans-serif' }, voices, size);
  assert.match(css, /--sans:Inter, system-ui, sans-serif;/);
  // Exactly one declaration — a later duplicate would defeat the override.
  assert.equal((css.match(/--sans:/g) || []).length, 1);
  assert.equal((css.match(/--mono:/g) || []).length, 1);
});

test('empty string font tokens fall back to the default chain, never a broken var', () => {
  for (const mode of ['dark', 'light']) {
    const css = composeCss({ sans: '', mono: '   ' }, voices, size, '', mode);
    assert.match(css, /--mono:ui-monospace,monospace;/);
    assert.match(css, /--sans:system-ui,sans-serif;/);
    assert.ok(!/--sans:;|--mono:;/.test(css), `${mode}: empty font token emitted`);
  }
});

test('light mode flips the field tokens in one switch', () => {
  const css = composeCss({}, voices, size, '', 'light');
  assert.match(css, /--bg:#f5f5f5/);
  assert.match(css, /--ink:#1a1a1a/);
  assert.match(css, /--panel:#ffffff/);
  assert.match(css, /--track:rgba\(0,0,0,\.06\)/);
  assert.match(css, /--capidle:#9e9e9e/);
});

test('user tokens override both dark and light bases', () => {
  assert.match(composeCss({ bg: '#123456' }, voices, size), /--bg:#123456/);
  assert.match(composeCss({ bg: '#123456' }, voices, size, '', 'light'), /--bg:#123456/);
});

test('no dark value is hardcoded outside token definitions', () => {
  for (const mode of ['dark', 'light']) {
    const css = composeCss({}, voices, size, '', mode);
    assert.ok(!/background:#161616/.test(css), `${mode}: chip background must be a token`);
    assert.ok(!/color:#6e6e6e/.test(css), `${mode}: caption idle color must be a token`);
    assert.ok(!/#1e1e1e 0%/.test(css), `${mode}: bg gradient must use tokens`);
    assert.ok(!/color:#f0f0f0/.test(css), `${mode}: dial on-text must be a token`);
  }
});

test('accent glows derive from the accent token, never a hardcoded teal', () => {
  for (const mode of ['dark', 'light']) {
    const css = composeCss({ accent: '#ff0000' }, voices, size, '', mode, true, true);
    assert.match(css, /rgba\(255,0,0,0\.12\)/, `${mode}: owner glow follows the accent`);
    assert.ok(!/rgba\(46,230,214/.test(css), `${mode}: no teal may survive an accent override`);
  }
});

test('every token key lands as a CSS var; LIGHT_TOKENS only overrides known keys', () => {
  for (const k of Object.keys(LIGHT_TOKENS)) {
    assert.ok(k in DEFAULT_TOKENS, `LIGHT_TOKENS.${k} must override a dark token, not invent one`);
  }
  const css = composeCss({}, voices, size, '', 'light');
  assert.match(css, /--deep:#e0e0e0/);
  assert.match(css, /--halo:#ededed/);
});

test('theme.css is appended last so it can override the base', () => {
  const css = composeCss({}, voices, size, '.x{color:red}');
  assert.ok(css.trimEnd().endsWith('.x{color:red}'));
});

test('layout patterns remain an explicit opt-in at the CSS assembly boundary', () => {
  assert.doesNotMatch(composeCss({}, voices, size), /\.s-title\{/);
  assert.match(composeCss({}, voices, size, '', 'dark', true, true), /\.s-title\{/);
});

test('caption plate and size are authored overrides while defaults emit no override', () => {
  const baseline = composeCss({}, voices, size);
  assert.equal((baseline.match(/\.caption2\{font-size:/g) || []).length, 1);
  assert.doesNotMatch(baseline, /\.caption2\{background:/);
  for (const mode of ['dark', 'light']) {
    const explicit = composeCss({}, voices, size, '', mode, true, false, false, { plate: true, size: 22 });
    assert.match(explicit, /\.caption2\{font-size:22px\}/);
    assert.match(explicit, /\.caption2\{--ink:#f4f7fb;background:rgba\(3,7,14,\.86\)/);
  }
  const overridden = composeCss({}, voices, size, '.caption2{--ink:#ff00ff}', 'light', true, false, false, { plate: true });
  assert.ok(overridden.trimEnd().endsWith('.caption2{--ink:#ff00ff}'));
});

test('zero-style canvas is full-frame with no centering, gutter, max-width, or caption reserve', () => {
  const css = composeCss({}, voices, size, '', 'dark', true, false, false);
  assert.match(css, /\.canvas,\.scenebody\{position:absolute;inset:0\}/);
  assert.doesNotMatch(css, /\.canvas\{[^}]*padding-bottom:/);
  assert.doesNotMatch(css, /\.canvas\{[^}]*justify-content:center/);
  assert.doesNotMatch(css, /\.scenebody\{[^}]*max-width:/);
  assert.doesNotMatch(css, /\.chrome\{[^}]*padding:/);
});

test('safeLayout explicitly restores centering, gutter, max-width, and caption reserve', () => {
  const css = composeCss({ colw: '1180px' }, voices, size, '', 'dark', true, false, true);
  assert.match(css, /--colw:1180px/);
  assert.match(css, /\.chrome\{[^}]*padding:clamp\(16px,3\.1vw,32px\)/);
  assert.match(css, /\.canvas\{[^}]*justify-content:center[^}]*padding-bottom:var\(--cap-pad,\s*clamp\(84px,15vh,170px\)\)/);
  assert.match(css, /\.scenebody\{[^}]*max-width:var\(--colw,1000px\)/);
});

test('safeLayout does not reserve captions when visual captions are disabled', () => {
  const css = composeCss({}, voices, size, '', 'dark', false, false, true);
  assert.match(css, /\.canvas\{[^}]*padding-bottom:0\}/);
});

test('karaoke keeps the historical active-word look, scoped to its preset class', () => {
  const css = composeCss({}, voices, size);
  assert.match(css, /\.cap-preset-karaoke \.cap-w\.active\{color:inherit;transform:translateY\(-2px\) scale\(1\.05\)\}/);
  assert.match(css, /\.cap-w\.active\{opacity:1;/);
  assert.ok(!/\.cap-w\.active\{opacity:1;transform/.test(css),
    'the unscoped transform is gone — other presets drive transform via timeline tweens');
});

test('slam, pop, rise presets ship built-in styles', () => {
  const css = composeCss({}, voices, size);
  assert.match(css, /\.cap-preset-slam \.cap-w\.active\{font-weight:900\}/);
  assert.match(css, /\.cap-preset-pop \.cap-w\{opacity:\.35\}/);
  assert.match(css, /\.cap-preset-rise \.cap-w\.active\{transform:translateY\(-3px\);box-shadow:0 \.1em 0 currentColor\}/);
});

test('subtitle preset is genuinely neutral: no speaker UI, no voice color, no glow', () => {
  const css = composeCss({}, voices, size);
  // Speaker label + equalizer bar are hidden in subtitle mode.
  assert.match(css, /\.cap-preset-subtitle \.spk\{display:none\}/);
  // Active/upcoming/past words all render as plain ink with no glow.
  assert.match(css, /\.cap-preset-subtitle \.cap-w\.active\{color:var\(--ink\);opacity:\.92;text-shadow:none\}/);
  // The subtitle override MUST come after the per-voice active rule so it wins
  // the equal-specificity tie (otherwise active subtitle words inherit the
  // speaker color + glow and the preset is not neutral).
  const voiceIdx = css.indexOf('.cap-w.a.active{color:#ff7eb6');
  const subIdx = css.indexOf('.cap-preset-subtitle .cap-w.active');
  assert.ok(voiceIdx > -1, 'voice active rule present');
  assert.ok(subIdx > voiceIdx, 'subtitle override emitted after the voice rule');
});

test('emphasis keywords use the accent token, composing with every preset', () => {
  const css = composeCss({}, voices, size);
  assert.match(css, /\.cap-w\.kw\{[^}]*text-decoration-color:var\(--accent\)/);
  assert.ok(!/\.cap-preset-[a-z]+ \.cap-w\.kw/.test(css), 'kw is preset-agnostic');
});

test('mark layer styles use theme tokens only (mode-aware by construction)', () => {
  for (const mode of ['dark', 'light']) {
    const css = composeCss({}, voices, size, '', mode);
    assert.match(css, /\.marklayer\{position:absolute;inset:0;pointer-events:none\}/);
    assert.match(css, /\.marklayer \.mark\{fill:none;stroke:var\(--accent\)/);
    assert.match(css, /\.marklayer \.markhl\{fill:var\(--accent\);opacity:\.26\}/);
  }
});

test('broll video covers the scene and sits below chrome z-index', () => {
  const css = composeCss({}, voices, size);
  assert.match(css, /\.broll\{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0/);
});

test('unqualified root clip paints full-frame cover at full opacity (regression: was .52)', () => {
  const css = composeCss({}, voices, size);
  const broll = css.slice(css.indexOf('.broll{'), css.indexOf('}', css.indexOf('.broll{')) + 1);
  assert.match(broll, /opacity:1/);
  assert.doesNotMatch(broll, /opacity:\.52/);
});

test('series badge uses theme tokens for brand-consistent color', () => {
  const css = composeCss({}, voices, size);
  assert.match(css, /\.series-badge\{[^}]*color:var\(--accent\)/);
  assert.match(css, /\.series-badge\{[^}]*border:1px solid var\(--accent-dim\)/);
});
