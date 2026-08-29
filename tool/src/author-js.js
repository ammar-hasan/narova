'use strict';

/* Browser-authored JavaScript stays ordinary JavaScript. This module preserves
 * each logical source while composing the exact classic-script / function-body
 * shapes the browser receives, then asks Node's built-in parser to compile
 * those shapes without executing them. There is intentionally no AST rewrite,
 * sandbox, selector policy, complexity limit, or style judgement here. */
const vm = require('node:vm');
const path = require('node:path');
const { runtimeScript } = require('./compose/runtime');
const { threeModuleSetupJs } = require('./compose/three');

function browserRenderer(config) {
  const renderer = config && config.renderer;
  const name = typeof renderer === 'string'
    ? renderer
    : (renderer && typeof renderer.provider === 'string' ? renderer.provider : 'hyperframes');
  return name === 'hyperframes';
}

function jsImports(config) {
  return Object.entries((config && config.imports) || {}).filter(([, imported]) =>
    imported && imported.contents && path.extname(imported.file || '').toLowerCase() === '.js');
}

function collectMainAuthorJavaScript(config, opts = {}) {
  const blocks = [];
  if (config.choreography) {
    blocks.push({ source: 'config.choreography', context: 'classic-script', code: String(config.choreography) });
  }

  const allScenes = config.scenes || [];
  const scenes = opts.sceneIndex == null ? allScenes : [allScenes[opts.sceneIndex]].filter(Boolean);
  for (const scene of scenes) {
    if (scene._choreographyFileContents) {
      blocks.push({
        source: `scene "${scene.id}" choreographyFile`,
        context: 'classic-script',
        code: String(scene._choreographyFileContents),
      });
    }
    if (scene._scriptFileContents) {
      const measured = opts.data && (opts.data.scenes || []).find(item => item.id === scene.id);
      blocks.push({
        source: `scene "${scene.id}" scriptFile`,
        context: 'function-body',
        code: String(scene._scriptFileContents),
        sceneStart: opts.sceneIndex == null ? (measured ? measured.start : 0) : 0,
        sceneDur: measured ? measured.dur : (scene.dur || 0),
      });
    }
  }

  for (const [name, imported] of jsImports(config)) {
    blocks.push({
      source: `import "${name}"`,
      context: 'classic-script',
      code: String(imported.contents),
    });
  }
  return blocks;
}

function countLines(value) {
  return String(value).split('\n').length;
}

function renderMainAuthorJavaScript(blocks) {
  let code = '';
  let line = 1;
  const ranges = [];
  const append = value => {
    const text = String(value);
    code += text;
    line += countLines(text) - 1;
  };

  for (const block of blocks) {
    append(`\nwindow.__narovaAuthorState.source=${JSON.stringify(block.source)};\n`);
    if (block.context === 'function-body') {
      append(`(function(){\n  var _scStart=${block.sceneStart}, _scDur=${block.sceneDur};\n`);
      const startLine = line;
      append(block.code);
      const endLine = line;
      ranges.push({ ...block, startLine, endLine });
      append('\n})();\n');
    } else {
      const startLine = line;
      append(block.code);
      const endLine = line;
      ranges.push({ ...block, startLine, endLine });
      append('\n');
    }
  }
  return { code, ranges };
}

function authorReadyScript() {
  // The assignment is both the public registration signal expected by
  // HyperFrames and a write through the guarded accessor installed by the
  // runtime. The accessor remains in place so a later raw-module init failure
  // cannot masquerade as a valid timeline.
  return `
(function(){
  var boots=window.__narovaThreeBoots||[];
  for(var i=0;i<boots.length;i++)boots[i]();
  window.__narovaAuthorState.source=null;
  window.__narovaAuthorState.ready=true;
  window.__timelines['main']=tl;
  window.__narovaBuildingTimeline=null;
})();`;
}

function escapeInlineScript(code) {
  return String(code).replace(/<\/script/gi, '<\\/script');
}

function syntaxLocation(error, filename) {
  const stack = String(error && error.stack || '');
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = stack.match(new RegExp(`${escaped}:(\\d+)(?::(\\d+))?`));
  let column = match && match[2] ? Number(match[2]) : null;
  if (column == null) {
    const caret = stack.split('\n').find(line => /^\s*\^/.test(line));
    if (caret) column = caret.indexOf('^') + 1;
  }
  return { line: match ? Number(match[1]) : null, column };
}

function attributedSyntaxError(error, source, line, column) {
  const where = line == null ? '' : ` at ${line}${column == null ? '' : `:${column}`}`;
  const wrapped = new Error(`authored JavaScript syntax error in ${source}${where} — ${error.message}`);
  wrapped.code = 'NAROVA_AUTHOR_JS_SYNTAX';
  wrapped.source = source;
  if (line != null) wrapped.line = line;
  if (column != null) wrapped.column = column;
  wrapped.cause = error;
  return wrapped;
}

function compileMain(blocks) {
  if (!blocks.length) return;
  const rendered = renderMainAuthorJavaScript(blocks);
  const prefix = `var DATA={preset:'',groups:[],scenes:[],markers:{},total:0};\n${runtimeScript({ deferTimeline: true })}`;
  const full = escapeInlineScript(`${prefix}${rendered.code}${authorReadyScript()}`);
  const filename = 'narova-author-main.js';
  try {
    new vm.Script(full, { filename });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const location = syntaxLocation(error, filename);
    const prefixLines = countLines(prefix) - 1;
    const authoredLine = location.line == null ? null : location.line - prefixLines;
    const range = rendered.ranges.find(item =>
      authoredLine != null && authoredLine >= item.startLine && authoredLine <= item.endLine);
    const source = range ? range.source : blocks[blocks.length - 1].source;
    const localLine = range && authoredLine != null ? authoredLine - range.startLine + 1 : null;
    throw attributedSyntaxError(error, source, localLine, location.column);
  }
}

function compileThreeModule(scene) {
  if (!scene._threeModuleContents) return;
  const moduleContents = String(scene._threeModuleContents);
  const generated = escapeInlineScript(threeModuleSetupJs(
    scene.id, scene.three || null, moduleContents, 0, scene.dur || 1,
    320, 180, [], {}, { sentences: [], words: [] },
  ));
  const filename = `narova-author-three-${String(scene.id).replace(/[^a-z0-9_-]/gi, '_')}.js`;
  const marker = `/* scene.threeModule: ${JSON.stringify(scene.id)} */\n`;
  const markerAt = generated.indexOf(marker);
  const authorStart = markerAt < 0 ? null : countLines(generated.slice(0, markerAt + marker.length));
  try {
    new vm.Script(generated, { filename });
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const location = syntaxLocation(error, filename);
    const localLine = authorStart == null || location.line == null
      ? null
      : Math.max(1, location.line - authorStart + 1);
    throw attributedSyntaxError(error, `scene "${scene.id}" threeModule`, localLine, location.column);
  }
}

function preflightAuthorJavaScript(config, opts = {}) {
  if (!browserRenderer(config)) return;
  compileMain(collectMainAuthorJavaScript(config, opts));
  const scenes = opts.sceneIndex == null
    ? (config.scenes || [])
    : [(config.scenes || [])[opts.sceneIndex]].filter(Boolean);
  for (const scene of scenes) compileThreeModule(scene);
}

module.exports = {
  authorReadyScript,
  browserRenderer,
  collectMainAuthorJavaScript,
  escapeInlineScript,
  preflightAuthorJavaScript,
  renderMainAuthorJavaScript,
};
