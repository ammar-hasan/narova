'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  collectMainAuthorJavaScript,
  preflightAuthorJavaScript,
  renderMainAuthorJavaScript,
} = require('../src/author-js');

function project(overrides = {}) {
  return {
    renderer: 'hyperframes',
    choreography: '',
    imports: {},
    scenes: [{ id: 'one', dur: 2 }],
    ...overrides,
  };
}

test('exact classic-script preflight attributes the real top-level-return defect', () => {
  assert.throws(
    () => preflightAuthorJavaScript(project({ choreography: 'if (!sc) { return; }' })),
    error => error.code === 'NAROVA_AUTHOR_JS_SYNTAX'
      && error.source === 'config.choreography'
      && error.line === 1
      && error.column === 12
      && /Illegal return statement/.test(error.message),
  );
});

test('the same return remains valid in the existing scene-script function context', () => {
  assert.doesNotThrow(() => preflightAuthorJavaScript(project({
    scenes: [{ id: 'one', dur: 2, _scriptFileContents: 'if (!sc) { return; }' }],
  })));
});

test('preflight accepts uncommon syntax and dynamic selectors without executing code', () => {
  delete globalThis.__narovaPreflightTouched;
  const code = `
class PrivateCounter { #n = 1; static { this.kind = 'free'; } value(){ return this.#n; } }
const selector = \`[data-kind="\${PrivateCounter.kind}"]\`;
globalThis.__narovaPreflightTouched = document.querySelector(selector);
tl.to(selector, { x: new PrivateCounter().value() }, 0);`;
  assert.doesNotThrow(() => preflightAuthorJavaScript(project({ choreography: code })));
  assert.equal(globalThis.__narovaPreflightTouched, undefined, 'compile preflight must never execute author code');
});

test('cue helper globals do not reserve authored lexical names', () => {
  assert.doesNotThrow(() => preflightAuthorJavaScript(project({
    choreography: 'let sentenceCue = 1; const wordCue = 2; tl.set({}, { x: sentenceCue + wordCue }, 0);',
  })));
});

test('shared classic-script scope is preserved and cross-source conflicts are attributed', () => {
  const config = project({
    choreography: 'const sharedName = 1;',
    scenes: [{ id: 'one', dur: 2, _choreographyFileContents: 'const sharedName = 2;' }],
  });
  assert.throws(() => preflightAuthorJavaScript(config), /scene "one" choreographyFile at 1:/);
});

test('source collection and emission retain the existing execution order without wrappers', () => {
  const config = project({
    choreography: 'projectCall();',
    imports: { shared: { file: 'shared.js', contents: 'importCall();' } },
    scenes: [{
      id: 'one', dur: 2,
      _choreographyFileContents: 'sceneCall();',
      _scriptFileContents: 'scriptCall();',
    }],
  });
  const blocks = collectMainAuthorJavaScript(config);
  assert.deepEqual(blocks.map(block => block.source), [
    'config.choreography',
    'scene "one" choreographyFile',
    'scene "one" scriptFile',
    'import "shared"',
  ]);
  const emitted = renderMainAuthorJavaScript(blocks).code;
  assert.ok(emitted.indexOf('projectCall()') < emitted.indexOf('sceneCall()'));
  assert.ok(emitted.indexOf('sceneCall()') < emitted.indexOf('scriptCall()'));
  assert.ok(emitted.indexOf('scriptCall()') < emitted.indexOf('importCall()'));
  assert.equal((emitted.match(/\(function\(\)\{/g) || []).length, 1,
    'only scene scriptFile keeps its already-public function wrapper');
});

test('raw Three module preflight uses its function context and attributes syntax errors', () => {
  assert.doesNotThrow(() => preflightAuthorJavaScript(project({
    scenes: [{ id: 'raw', dur: 2, _threeModuleContents: 'if (!scene) return;' }],
  })));
  assert.throws(() => preflightAuthorJavaScript(project({
    scenes: [{ id: 'raw', dur: 2, _threeModuleContents: 'const broken = ;' }],
  })), error => error.source === 'scene "raw" threeModule'
    && error.line === 1
    && /Unexpected token/.test(error.message));
});

test('browserless projects do not gate JavaScript they never emit', () => {
  assert.doesNotThrow(() => preflightAuthorJavaScript(project({
    renderer: 'no-browser',
    choreography: 'if (!sc) { return; }',
  })));
});
