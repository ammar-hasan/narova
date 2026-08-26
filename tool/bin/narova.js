#!/usr/bin/env node
'use strict';
/* narova CLI — a scene script becomes a narrated, captioned video.
 * narova writes the words and the voice; HyperFrames draws the pictures.
 * Zero runtime deps: a tiny arg parser drives check / synth / compose / build /
 * preview / voices / doctor / init. */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { loadProjectConfig } = require('../src/config');
const { resolveConfig } = require('../src/schema');
const { synth, writeStageInputs, build, findPython, resolveReuse, compileTimeline, enrichTimeline } = require('../src/pipeline');
const { composeData } = require('../src/compose/data');
const { writeCaptions } = require('../src/captions');
const { runHf, previewUrl, startHfPreview, stopHfPreview, livePreviewPid, previewPort, previewPortIntent } = require('../src/hf');
const { initProject } = require('../src/init');
const { doctor } = require('../src/doctor');
const { check, critique } = require('../src/check');
const { judge, formatJudgement } = require('../src/judge');
const { interventionPlan, formatInterventionPlan } = require('../src/intervention-plan');
const {
  captureBranchExperiment, branchExperimentIdentity, verifyBranchExperiment,
  branchComparison, formatBranchComparison,
} = require('../src/branch-experiment');
const {
  prepareCaptionRepair, verifyCaptionRepair, formatCaptionRepair,
} = require('../src/caption-repair');
const { auditMotion, formatMotionAudit, auditProofFrames, formatProofAudit } = require('../src/motion-audit');
const { writeProofReceipt, verifyProofReceipt, clearProofReceipt, writeProofBundle, verifyProofBundle } = require('../src/proof-receipt');
const { hashFile } = require('../src/manifest');
const { beatReviewTimes, motionReviewTimes } = require('../src/review-times');
const { clipCoverage, formatCoverage, contactSheet, termExcerpts, silenceGaps, formatSilences, takeIndex, formatTakes, audioLevelFacts, formatAudioLevels } = require('../src/review-evidence');
const { ingest } = require('../src/ingest');
const {
  creditLines, creditEntries, formatCredits, downloadAsset, inferKind, readAssetLock, registerAsset,
  normalizeRegistrationMetadata, resolveProjectFile, unregisterAsset, verifyAssets,
  withAssetMutation,
} = require('../src/asset-registry');
const { collectProvenance, formatProvenance, recognizedLicense } = require('../src/provenance');
const { listStockProviders, resolveStock, searchStock } = require('../src/stock-providers');
const { generateKaraoke } = require('../src/karaoke');
const { retime } = require('../src/retime');
const { addSample, removeSample, listSamples } = require('../src/samples');
const { plan, loadCurrent, lastManifest, formatPlan } = require('../src/plan');
const revisions = require('../src/revisions');
const { save: saveRelease, list: listReleases, restore: restoreRelease, remove: removeRelease, saveBranch, readBranch, listBranches, setBranchStatus, setBranchRationale, releasePath, branchDir, resolveProjectDir, validBranchStatus, publishStagedBranch, branchRevision, projectIdentity, RELEASES_DIR, RESTORE_MARKER, RESTORE_OVERRIDES } = require('../src/releases');
const { generate, readSpec } = require('../src/generate');
const {
  addProvider, getSpeechProvider, getVideoProvider, isProviderName, listProviders,
  removeProvider, doctorProvider, providersDir, providerKind, VIDEO_PROVIDER_PROTOCOL,
} = require('../src/providers');
const {
  backendHint, builtinNames, BUILTIN_BACKENDS, deliveryCapabilitiesFor,
} = require('../src/tts-backends');
const {
  composeWithRenderer, renderWithRenderer, shotsWithRenderer,
  getRenderer, listRenderers,
} = require('../src/renderers');
const {
  captureWalkthrough, captureStatus, exploreWalkthrough, safeUrl,
} = require('../src/walkthrough');
const { substrateGuard, welcomeWizard, firstRunQuiet, firstRunDone, isInteractive } = require('../src/first-run');
const { demo, DEMO_DIR_NAME } = require('../src/demo');
const {
  packProject, inspectArchive, openArchive, remix: remixProject, trustNotice,
} = require('../src/project-archive');
const machine = require('../src/machine');

/* Machine protocol conveniences: no-ops unless this invocation passed --json. */
const mData = fields => machine.data(fields);
const mSetData = payload => machine.setData(payload);
const mArtifact = (path, role) => machine.artifact(path, role);
const mDiag = (severity, code, message, subject) => machine.diag(severity, code, message, subject);

/* Provider command arrays are execution internals and may contain legacy
 * inline credentials. Machine payloads expose only public provider facts. */
function publicProviderData(provider) {
  if (!provider) return provider;
  const { command: _command, ...publicFields } = provider;
  return { ...publicFields, kind: providerKind(provider) };
}

function publicProviderHello(hello) {
  return {
    protocol: hello.protocol,
    provider: hello.provider,
    providerVersion: hello.providerVersion,
  };
}

function registerProviderSecrets(manifest) {
  for (const name of manifest.requiredEnvironment || []) machine.secret(process.env[name]);
  const secretName = /(?:api[-_]?key|authorization|credential|password|secret|token)/i;
  const registerFragments = value => {
    const text = String(value);
    machine.secret(text);
    const assignment = text.match(/^[^=]+=(.*)$/s);
    if (assignment) machine.secret(assignment[1]);
    // Header carriers may be echoed as only their value by a worker. Treat all
    // header values as credentials; cookies and proprietary auth schemes are
    // not reliably identifiable by name.
    const header = text.match(/(?:^|=)[^:=\s]+:\s*(.+)$/s);
    if (header) machine.secret(header[1]);
    const bearer = text.match(/\bBearer\s+(.+)$/i);
    if (bearer) machine.secret(bearer[1]);
  };
  const command = manifest.command || [];
  for (let i = 0; i < command.length; i++) {
    const part = String(command[i]);
    const assignment = part.match(/^([^=]+)=(.*)$/s);
    // Legacy commands may use a named secret option (`--api-key=x`) or a
    // generic carrier (`--header=Authorization: Bearer x`). Register both the
    // complete credential-bearing argument and its useful value fragments so
    // child prose cannot expose either representation.
    if (secretName.test(part) || /^--?header(?:=|$)/i.test(part)) registerFragments(part);
    if (!assignment && /^(?:--?)?(?:api[-_]?key|authorization|credential|password|secret|token|header)$/i.test(part)
        && i + 1 < command.length) {
      registerFragments(command[i + 1]);
    }
  }
}

function registerConfigProviderSecrets(config, overrideBackend = null) {
  const backends = new Set(Object.values(config.voices || {}).map(voice => voice && voice.backend).filter(Boolean));
  if (overrideBackend) backends.add(overrideBackend);
  for (const backend of backends) {
    const provider = getSpeechProvider(backend);
    if (provider) registerProviderSecrets(provider);
  }
}

/* Usage error (NAR-015-071 exit 2): the invocation is rejected before or
 * during dispatch. Human wording is unchanged; only the exit code is refined. */
function usageError(...lines) {
  for (const line of lines) console.error(line);
  mDiag('error', 'usage.invalid', lines.join('\n'));
  process.exit(machine.EXIT.usage);
}

/* Preserve the historical top-level `error:` wording for argument validators
 * that used to throw through main().catch, while classifying them as usage. */
function thrownUsageError(error) {
  console.error('error:', error.message);
  mDiag('error', 'usage.invalid', error.message);
  process.exit(machine.EXIT.usage);
}

class InvocationError extends Error {
  constructor(message) {
    super(message);
    this.code = 'NAROVA_USAGE';
  }
}

function invocationError(message) {
  throw new InvocationError(message);
}

/* The operation name recorded in the machine envelope: the command plus its
 * subcommand(s) when the command table defines them. */
function operationName(cmd, positionals, flags = {}) {
  if (flags.version) return 'version';
  if (!cmd || cmd === 'help' || cmd === '-h' || flags.help || flags.h) return 'help';
  const two = {
    assets: ['import', 'download', 'providers', 'search', 'acquire', 'list', 'untrack', 'verify', 'credits'],
    walkthrough: ['explore', 'capture', 'status'],
    release: ['save', 'list', 'restore', 'remove'],
    branch: ['save', 'compare', 'list', 'set', 'show'],
    history: ['list', 'annotate', 'compare'],
    providers: ['add', 'list', 'remove', 'doctor'],
    renderers: ['list', 'doctor'],
    voices: ['list', 'get'],
    karaoke: ['generate'],
    review: [],
  };
  const defaults = {
    walkthrough: 'status', release: 'list', branch: 'list', history: 'list',
    providers: 'list', renderers: 'list', voices: 'list',
  };
  if (cmd === 'voice' && positionals[1] === 'sample'
      && ['add', 'list', 'remove'].includes(positionals[2])) {
    return `voice sample ${positionals[2]}`;
  }
  if (two[cmd] && two[cmd].includes(positionals[1])) return `${cmd} ${positionals[1]}`;
  if (defaults[cmd] && positionals[1] == null) return `${cmd} ${defaults[cmd]}`;
  return cmd;
}

const PUBLIC_COMMANDS = new Set([
  'help', 'init', 'demo', 'pack', 'open', 'remix', 'ingest', 'assets', 'compile', 'check', 'critique', 'judge',
  'walkthrough', 'plan', 'provenance', 'diff', 'history', 'release', 'branch',
  'render', 'synth', 'compose', 'captions', 'review', 'shots', 'build', 'preview',
  'renderers', 'voices', 'providers', 'voice', 'doctor', 'karaoke', 'retime',
  'generate',
]);

function preDispatchOperation(argv) {
  if (argv.includes('--version') || argv.some(a => a.startsWith('--version='))) return 'version';
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '-h') continue;
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    if (token.includes('=')) continue;
    const key = token.slice(2);
    if ((VALUE_FLAGS.has(key) || BOOL_OR_VALUE.has(key))
        && argv[i + 1] != null && !argv[i + 1].startsWith('--')) i++;
  }
  const cmd = positionals[0];
  if (!cmd) return argv.includes('-h') ? 'help' : null;
  return operationName(cmd, positionals);
}

const BOOL_FLAGS = new Set(['reuse', 'force', 'detach', 'stop', 'help', 'h', 'version', 'variants', 'safe-area-guides', 'overwrite', 'inspect', 'strict', 'release', 'apply', 'plan', 'repair', 'motion', 'beats', 'proof', 'verify-motion', 'json', 'coverage', 'contact-sheet', 'takes', 'companion', 'creative-identity', 'audio-levels']);
const BOOL_OR_VALUE = new Set(['deliverables', 'critique', 'silences', 'companion']);
const VALUE_FLAGS = new Set(['at', 'attribution', 'backend', 'config', 'creator', 'dir', 'duration', 'engine', 'excerpt', 'format', 'fps', 'item-id', 'judge-assertion', 'kind', 'license', 'license-url', 'limit', 'max-words', 'model', 'new-project', 'origin', 'out', 'output', 'pack', 'parent', 'platform', 'port', 'profile', 'project', 'provider', 'quality', 'rationale', 'regenerate', 'renderer', 'repair-branch', 'scene', 'size', 'source-page', 'status', 'tempo', 'transcript', 'variant', 'video', 'voice-a', 'voice-b', 'audio', 'interval']);

function validateInvocationFlags(flags, cmd) {
  if (flags.repair && cmd !== 'judge') invocationError('--repair is reserved for a future judge phase and is not available');
  if (flags['judge-assertion'] != null && cmd !== 'branch' && !(cmd === 'judge' && flags.repair)) {
    invocationError('--judge-assertion is only valid with focused branch save or judge --repair');
  }
  if (flags['repair-branch'] != null && !(cmd === 'judge' && flags.repair)) {
    invocationError('--repair-branch is only valid with narova judge --repair');
  }
  if (flags.video != null && cmd !== 'judge' && !(cmd === 'branch' && flags['judge-assertion'])) {
    invocationError('--video is only valid with narova judge or focused narova branch save');
  }
  if (flags['audio-levels'] != null && cmd !== 'review') {
    invocationError('--audio-levels is only valid with narova review');
  }
  if ((flags.audio != null || flags.interval != null) && !(cmd === 'review' && flags['audio-levels'])) {
    invocationError('--audio and --interval are only valid with narova review --audio-levels');
  }
  const positiveNumber = (name, max = Infinity) => {
    if (flags[name] == null) return;
    const value = Number(flags[name]);
    if (!Number.isFinite(value) || value <= 0 || value > max) {
      invocationError(`--${name} must be a positive number${Number.isFinite(max) ? ` no greater than ${max}` : ''}`);
    }
  };
  positiveNumber('tempo');
  positiveNumber('fps', 120);
  positiveNumber('duration');
  if (cmd === 'generate') {
    const provider = String(flags.provider || 'sora');
    if (!isProviderName(provider)) invocationError('--provider must be a lowercase-hyphen provider name for generate');
  }
  if (flags.size != null) {
    const size = String(flags.size);
    if (cmd === 'generate') {
      if (!/^\d+x\d+$/i.test(size)) invocationError('--size must be WIDTHxHEIGHT for generate (for example 1280x720)');
    } else if (!['16:9', '1:1', '9:16'].includes(size)) {
      invocationError('--size must be one of 16:9|1:1|9:16');
    }
  }
  if (flags['max-words'] != null
      && (!Number.isInteger(Number(flags['max-words'])) || Number(flags['max-words']) <= 0)) {
    invocationError('--max-words must be a positive integer');
  }
  const enumerated = {
    platform: ['tiktok', 'reels', 'shorts', 'linkedin', 'x', 'youtube'],
    renderer: ['hyperframes', 'no-browser'],
    quality: ['draft', 'standard', 'high'],
    pack: ['core', 'essential'],
    kind: ['image', 'video', 'audio', 'model'],
  };
  for (const [name, choices] of Object.entries(enumerated)) {
    if (flags[name] != null && !choices.includes(String(flags[name]))) {
      invocationError(`--${name} must be one of ${choices.join('|')}`);
    }
  }
}

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const key = a.slice(2, eq);
        if (!BOOL_FLAGS.has(key) && !BOOL_OR_VALUE.has(key) && !VALUE_FLAGS.has(key)) {
          throw new Error(`unknown option --${key}`);
        }
        flags[key] = BOOL_FLAGS.has(key) && !BOOL_OR_VALUE.has(key) ? true : a.slice(eq + 1); continue;
      }
      const key = a.slice(2);
      if (BOOL_OR_VALUE.has(key)) {
        const nxt = argv[i + 1];
        if (nxt != null && !nxt.startsWith('--')) {
          flags[key] = nxt; i++;
        } else {
          flags[key] = true;
        }
        continue;
      }
      if (BOOL_FLAGS.has(key)) { flags[key] = true; continue; }
      if (!VALUE_FLAGS.has(key)) { throw new Error(`unknown option --${key}`); }
      // Every remaining flag expects a value; a bare `--tempo` must error, not
      // silently resolve to `true` (Number(true)===1, "true" -> hyperframes).
      const nxt = argv[i + 1];
      if (nxt != null && !nxt.startsWith('--')) { flags[key] = nxt; i++; }
      else { throw new Error(`--${key} needs a value`); }
    } else positionals.push(a);
  }
  return { positionals, flags };
}

function overridesFrom(flags) {
  const o = {};
  if (flags.backend) o.backend = flags.backend;
  if (flags.size) o.size = flags.size;
  if (flags.platform) o.platform = flags.platform;
  if (flags.variant) o.variant = flags.variant;
  if (flags.renderer) o.renderer = flags.renderer;
  if (flags.tempo != null) o.tempo = flags.tempo;
  if (flags['voice-a']) o.voiceA = flags['voice-a'];
  if (flags['voice-b']) o.voiceB = flags['voice-b'];
  return o;
}

function assetRegistrationFromFlags(flags, defaults = {}) {
  const origin = {
    ...((flags.origin || defaults.mode) ? { mode: flags.origin || defaults.mode } : {}),
    ...(flags.provider ? { provider: flags.provider } : {}),
    ...(flags['item-id'] ? { itemId: flags['item-id'] } : {}),
    ...(flags['source-page'] ? { sourcePage: flags['source-page'] } : {}),
    ...(defaults.sourceUrl ? { sourceUrl: defaults.sourceUrl } : {}),
  };
  const rights = {
    ...(flags.license ? { license: flags.license } : {}),
    ...(flags['license-url'] ? { licenseUrl: flags['license-url'] } : {}),
    ...(flags.creator ? { creator: flags.creator } : {}),
    ...(flags.attribution ? { attribution: flags.attribution } : {}),
  };
  return {
    ...(Object.keys(origin).length ? { origin } : {}),
    ...(Object.keys(rights).length ? { rights } : {}),
  };
}

/* Import-time license advisory (NAR-016-059): an unrecognized --license
 * string warns — naming the value and the recognized vocabulary — but is
 * stored unchanged; the open registry storage contract is untouched. */
function adviseUnrecognizedLicense(flags) {
  if (flags.license && !recognizedLicense(flags.license)) {
    console.error(`warning: license "${terminalSafe(flags.license)}" is not a recognized form — recognized forms include "Public Domain", "CC0", and Creative Commons identifiers (CC-BY, CC-BY-SA, CC-BY-NC, CC-BY-ND, with an optional version or URL)`);
  }
}

async function loadResolved(flags, { readOnly = false, ignoreRestore = false } = {}) {
  const projectDir = flags.project || '.';
  const { raw, dir, file, sourceBytes } = await loadProjectConfig(projectDir, flags.config);
  if (flags.variant != null) {
    const declared = Array.isArray(raw.variants)
      ? raw.variants.map(item => item && item.id).filter(Boolean)
      : [];
    if (!declared.includes(flags.variant)) {
      invocationError(`unknown variant ${JSON.stringify(flags.variant)} — declared variants: ${declared.join(', ') || '(none declared)'}`);
    }
  }
  const out = path.resolve(flags.out || path.join(dir, 'out'));
  const mayReadOutputEvidence = evidenceFile => {
    if (!readOnly) return true;
    try {
      const root = fs.realpathSync(dir);
      const file = fs.realpathSync(evidenceFile);
      const relative = path.relative(root, file);
      if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)
          || path.isAbsolute(relative) || !fs.statSync(file).isFile()) return false;
      return true;
    } catch {
      // Advisory commands never consume restore/build evidence that resolves
      // outside the project. The collector will grade external output unknown.
      return false;
    }
  };
  let restoredOverrides = {};
  const restoredOverridesFile = path.join(out, RESTORE_OVERRIDES);
  if (!ignoreRestore && fs.existsSync(restoredOverridesFile) && mayReadOutputEvidence(restoredOverridesFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(restoredOverridesFile, 'utf8'));
      const allowed = new Set(['backend', 'size', 'platform', 'variant', 'renderer', 'tempo', 'voiceA', 'voiceB']);
      restoredOverrides = Object.fromEntries(Object.entries(parsed).filter(([key]) => allowed.has(key)));
    } catch { /* malformed restored overrides are ignored; schema still validates CLI input */ }
  }
  const effectiveOverrides = { ...restoredOverrides, ...overridesFrom(flags) };
  const cliOverrides = overridesFrom(flags);
  const config = resolveConfig(raw, effectiveOverrides, dir);
  registerConfigProviderSecrets(config, effectiveOverrides.backend);
  const manifestFile = path.join(out, 'manifest.json');
  const markerFile = path.join(out, RESTORE_MARKER);
  if (fs.existsSync(markerFile) && fs.existsSync(manifestFile)
      && mayReadOutputEvidence(markerFile) && mayReadOutputEvidence(manifestFile)) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
      const restored = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const legacySafeLayout = marker.legacySafeLayout === true || restored.safeLayout == null;
      if (marker.manifestSha256 === hashFile(manifestFile) && legacySafeLayout) {
        if (config._safeLayoutAuthored && config.safeLayout === false) {
          config._retireLegacySafeLayout = true;
          if (!readOnly) fs.rmSync(markerFile, { force: true });
        } else {
          config._legacySafeLayout = true;
          if (!config._safeLayoutAuthored) config.safeLayout = true;
        }
      }
    } catch { /* malformed or stale restore metadata cannot change layout */ }
  }
  return {
    config, projectDir: dir, effectiveOverrides, restoredOverrides, cliOverrides,
    raw, configFile: file, configSourceBytes: sourceBytes,
  };
}

const outDirOf = (flags, projectDir) =>
  path.resolve(flags.out || path.join(projectDir || '.', 'out'));

function verifyMotionIfRequested(built, flags) {
  if (!flags['verify-motion'] && !flags.release) return;
  const report = auditMotion(built.mp4);
  console.log(formatMotionAudit(report));
  mData({ motionAudit: { ok: report.ok } });
  if (!report.ok) {
    mDiag('error', 'audit.motion', 'rendered video contains frozen or black segments beyond tolerance', built.mp4);
    process.exitCode = machine.EXIT.subjectNonPass;
  }
}

/* Studio serves out/hf-<slug> from disk and does not hot-reload; compose deletes and
 * recreates that directory, so a detached preview left running would keep
 * showing the OLD build (or an empty 00:00 canvas). Instead of just warning,
 * restart it on the new build — the review URL the user has open starts
 * serving fresh frames. */
function findHfDir(out) {
  if (!fs.existsSync(out)) return path.join(out, 'hf');
  try {
    const entries = fs.readdirSync(out, { withFileTypes: true });
    const match = entries.find(e => e.isDirectory() && e.name.startsWith('hf-'));
    if (match) return path.join(out, match.name);
  } catch (_) { /* out doesn't exist yet — fall through to legacy */ }
  return path.join(out, 'hf');
}

function findNoBrowserDir(out) {
  if (!fs.existsSync(out)) return path.join(out, 'no-browser');
  try {
    const entries = fs.readdirSync(out, { withFileTypes: true });
    const match = entries.find(e => e.isDirectory() && e.name.startsWith('no-browser-'));
    if (match) return path.join(out, match.name);
  } catch (_) { /* out does not exist yet */ }
  return path.join(out, 'no-browser');
}

async function refreshPreviewIfLive(out) {
  const hfDir = findHfDir(out);
  const pidFile = path.join(out, 'preview.pid');
  const pid = livePreviewPid(pidFile);
  if (!pid) return;
  const port = previewPort(pidFile) || 3002;
  const portIntent = previewPortIntent(pidFile);
  try {
    await stopHfPreview(pidFile);
    const p = await startHfPreview(hfDir, {
      ...(portIntent === 'explicit' ? { port } : { startPort: port }),
      logFile: path.join(out, 'preview.log'), pidFile,
    });
    console.log(`Studio restarted on the new build -> ${p.url}  (pid ${p.pid}; stop: narova preview --stop)`);
  } catch (e) {
    console.error(`note: could not restart the detached preview (${e.message}) — restart it yourself: narova preview --detach`);
  }
}

const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function projectSlug(config) {
  return String(config.title || 'narova').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'narova';
}

function proofContactSheets(reviewDir) {
  const found = [];
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/^contact-sheet\.jpe?g$/i.test(entry.name)) found.push(full);
    }
  }
  visit(reviewDir);
  return found.sort();
}

/* Print when each scene starts — the QA timeline for snapshots and review. */
function printSceneTable(config, out) {
  const timings = JSON.parse(fs.readFileSync(path.join(out, 'timings.json'), 'utf8'));
  const data = composeData(config, timings);
  console.log('scene starts:');
  for (const sc of data.scenes) {
    console.log(`  ${fmtTime(sc.start)}  ${sc.id}  (${sc.dur.toFixed(1)}s)`);
  }
  console.log(`  ${fmtTime(data.total)}  end`);
}

function fileSlug(value) {
  return String(value || 'narova-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'narova-project';
}

const displayPath = value => JSON.stringify(String(value));
const terminalSafe = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, character => {
  const escaped = JSON.stringify(character);
  return escaped.slice(1, -1);
});

const HELP = `narova — a scene script becomes a narrated, captioned video
(HyperFrames for full browser rendering; no-browser for local browserless rendering)

Usage: narova <command> [options]

Commands:
  init <dir>            scaffold a project (config + one example scene)
  pack                  write a deterministic, digest-manifested .narova project archive
                           --output <file> (default: <title-or-directory>.narova)
  open <archive>        verify and materialize an untrusted .narova archive
                           --dir <target>; --inspect validates without writing
  remix <source>        copy a local project/archive or github:<owner>/<repo>[#ref]
                           into a fresh project with recorded parent lineage
  ingest <url>          fetch a source page: download images into assets/,
                           screenshot it (if Chrome), append sources.md,
                           seed claims.md — the mechanical pass of url-to-source
  assets import <file>  register an existing project-local creative asset
  assets download <url> download atomically with --output <project-relative path>
  assets providers      list built-in stock catalogues and credential readiness
  assets search <query> search --provider <name> --kind image|video|audio|model
  assets acquire <id>   resolve/download a provider result with --output <path>
  assets list           list files tracked in assets.lock.json
  assets untrack <file> remove a provenance record without deleting the file
  assets verify         verify tracked file hashes, sizes, and media kinds
  assets credits        print deduplicated attribution lines
                           --format text|youtube|web|json (default: text)
  provenance            read-only provenance report: claims grounding, media
                           origins + rights buckets, AI generation, reproducibility
                           (advisory; missing evidence reads "not recorded"; --json
                           for the machine-readable form)
  compile               compile reel.config -> out/manifest.json
                           (versioned intermediate representation; also written
                           automatically by synth, compose, and build)
  check                validate config fast — no TTS, no browser
                            --strict: verify every claim in claims.md ledger
                            --creative-identity: also emit out/creative-identity.json
                              (advisory identity fingerprint + rationale verification;
                              never fails the build). Projects with creative.md
                              always maintain the local fingerprint-only sibling
                              ledger and advisory output at every check level
                            --release: strict + fail on remote deps, missing
                              claims, unsupported HTML, black frames, stale
                              walkthrough captures, or an unapproved non-trivial
                              creative brief (exit 3, subject non-pass)
  critique [profiles]  opt-in craft review; comma-separate creative, cinematic,
                           social-short, explainer, presentation, accessibility
  judge                inspect the encoded artifact as an evidence mirror
                           --video <file> selects a self-contained local video (default: out/video.mp4)
                           --json returns narova.judgement/1 in narova.result/1
                           --plan adds plural unranked intervention options
                           --repair --judge-assertion <id> --repair-branch <name>
                           creates only an unapproved caption-sidecar candidate
                           no score, validity gate, hidden taste lens, or creative repair
  plan                 compare current config against the last manifest;
                           classify what changed and which stages will rebuild
  release save <name>  save out/manifest.json as a named release
  release list         list all saved releases
  release restore <n>  restore a saved release to out/manifest.json
  release remove <n>   delete a saved release
  branch save <name>   snapshot the current small proof as a candidate branch
                           --rationale "why this direction may serve the brief"
                           --judge-assertion <id> preserves the receipt-bound
                             encoded proof and its focused observation
  branch compare <a> <b> [c]  compare 2–3 intact proofs for one assertion
                           read-only; no score, ranking, recommendation, or selection
  branch set <name>    approve/reject/archive a proof branch with --status
  branch list|show     inspect saved proof directions and their rationale
  synth                Python TTS -> out/audio/*, out/timings.json
  compose              timings + audio -> selected renderer project + captions
  captions             (re)write out/captions.srt + out/captions.vtt from out/timings.json
  walkthrough explore <id>  open source and print agent-readable interactive page state
  walkthrough capture [id]  record narration-timed product actions with agent-browser
  walkthrough status [id]   report missing/stale/fresh captured walkthrough assets
  shots                snapshot QA frames with the selected renderer
  review --coverage    advisory per-reel clip usage summary (no gates)
  review --contact-sheet  one labeled still per scene from the encoded video
  review --excerpt <terms>  one short audio clip per term from synthesized audio
  review --silences [s]  advisory silence-gap report (threshold seconds, default 1.0)
  review --takes        advisory narration take index (timing, sentence file, take identity)
  review --audio-levels [--audio <file>] [--interval start,end]
                          advisory loudness/peak/clipping facts from existing audio
  --companion [size]    also write a compressed companion of the video for quick review
                          e.g. --companion 60MB; no size uses quick-review defaults;
                          never enforced, never gates, primary stays full quality
  build                synth + compose + selected renderer -> out/video.mp4
  preview              HyperFrames Studio, or a no-browser draft preview MP4
  renderers list       list bundled local renderer providers and capabilities
  renderers doctor <name>  verify a renderer's local requirements
  voices list|get      list / download TTS voices (delegates to narova_tts)
  providers add <manifest>    register an external speech or video provider
  providers list              list explicitly registered providers by kind
  providers remove <name>     unregister an external provider
  providers doctor <name>     verify environment + worker handshake
  voice sample add <file> <name>   save a clone sample for chatterbox
  voice sample list                list saved clone samples
  voice sample remove <name>       remove a saved clone sample
  karaoke generate <audio>         transcribe audio + transcript -> word-timed karaoke JSON + SRT
                                     --transcript <file>  map clean text onto Whisper timings
                                     --max-words N        words per karaoke cue (default 8)
                                     --engine faster-whisper|whisper-cpp|auto (default auto)
  retime <config> <karaoke.json>  print scene duration suggestions aligned to word timings
                                      --apply   rewrite the config file in-place
  generate <prompt>       generate a video clip via a registered provider
                              --provider <name>        registered video provider (default: sora)
                              --output <path>           output file (default: assets/gen-<provider>-<slug>.mp4)
                              --model <id>              provider model
                              --size <WxH>              generation size/ratio
                              --duration <s>            provider-supported seconds
                              --regenerate <mp4>        re-run a previous clip from its .gen.json spec
                                                        (keeps provider/model/prompt; override any of them)
                              A .gen.json spec sidecar is written next to every clip so the
                              generative intent (prompt/model/params) survives as editable source.
  demo                 first video in one command: readiness + a built-in demo
                       project through the full pipeline -> narova-demo/out/video.mp4
  doctor               check ffmpeg, ffprobe, python venv, agent-browser, npx hyperframes

Commands find the project from the current folder OR any parent folder, so
they work from inside out/ and renderer project folders too. A detached
HyperFrames Studio preview is restarted when its composition is replaced.

Options:
  --backend <name>          TTS backend (${backendHint()} or a registered provider)
  --renderer hyperframes|no-browser   local renderer (default: hyperframes)
  --reuse                  skip synth, reuse out/audio + out/timings.json
                           (ignored automatically if the spoken text changed)
  --force                  synth even when reusable audio exists
  --tempo N                narration tempo (atempo)
  --size 16:9|1:1|9:16     frame aspect
  --platform tiktok|reels|shorts|linkedin|x|youtube   frame preset + target duration band
                           (--size wins over the platform preset)
  --variant <id>           apply a declared hook variant as scene 1 (check/synth/
                           compose/build; build renders out/video-<id>.mp4)
   --variants               build the base video.mp4 AND one out/video-<id>.mp4
                            per declared variant (shared sentences are cache-free)
   --plan                   build: print what this revision will rebuild (scope)
                            before doing the work — advisory, never changes behavior
  --deliverables           build: render per-platform deliverables (one mp4 per
                            export profile + thumbnails, ffmpeg post-processed)
  --deliverables ids      build: comma-separated export preset ids or "true"
                            for all profiles (e.g. --deliverables youtube-1080p,reels-1080p)
  --fps N                  render fps (default 30)
  --quality draft|standard|high   renderer quality
  --safe-area-guides       build: overlay TikTok safe-area zones on the
                            TikTok deliverable (requires --deliverables)
  --at t1,t2,...           shots: explicit frame times (default: mid-scene)
  --motion                 shots: capture start/middle/end of every scene
  --beats                  shots: capture arrival/resolved frames for every
                           narration sentence and both sides of named markers
  --proof                  shots: fail when most sampled pilot frames are
                           near-black or no visual evidence was rendered
  --verify-motion          build: fail on >=2s frozen or >=0.5s black segments
  --port N                 Studio port (default 3002)
  --detach                 keep Studio running and return its URL + pid
  --scene <id>             preview one isolated scene (safe for WebGL-heavy films)
  --stop                   stop a detached Studio preview
  --out <dir>              output dir (default <project>/out)
  --project <dir>          project dir (default .)
  --config <file>          explicit config path
  --video <file>           judge/focused branch save: selected encoded artifact
                           (default: <project>/out/video.mp4)
  --judge-assertion <id>   focused branch save or delegated caption repair
  --repair-branch <name>   judge --repair destination proof branch
  --dir <dir>              open/remix target directory
  --inspect                open: verify and summarize without extraction
  --overwrite              open/remix: replace an occupied target atomically
  --voice-a <s> --voice-b <s>   override the first two voices (add more in config)
  Asset metadata flags (assets import/download):
  --origin <mode> --provider <name> --item-id <id> --source-page <url>
  --license <id> --license-url <url> --creator <name> --attribution <text>
  Stock catalogue flags (assets search/acquire):
  --pack core|essential (default: core)
  --provider <name> --kind image|video|audio|model --limit <1..20> --json
`;

/* Action-scoped help (NAR-009-036): for grouped command families with
 * distinct per-action usage, `narova <group> <action> --help` prints that
 * action's usage and the options it accepts. A group without an action (or
 * an action without usage text) falls back to the global HELP. */
const ASSET_METADATA_FLAGS = `  --origin <mode> --provider <name> --item-id <id> --source-page <url>
  --license <id> --license-url <url> --creator <name> --attribution <text>`;
const ACTION_HELP = {
  assets: {
    import: `usage: narova assets import <file> [metadata options]\n${ASSET_METADATA_FLAGS}`,
    download: `usage: narova assets download <url> --output <project-relative path> [metadata options]\n${ASSET_METADATA_FLAGS}`,
    providers: 'usage: narova assets providers [--pack core|essential]',
    search: 'usage: narova assets search <query> --provider <name> --kind image|video|audio|model [--limit N] [--pack core|essential] [--json]',
    acquire: `usage: narova assets acquire <id> --provider <name> --kind image|video|audio|model --output <project-relative path> [--pack core|essential]
  acquire derives stock provenance from the provider — --origin, --item-id, and --source-page are not accepted
  --license <id> --license-url <url> --creator <name> --attribution <text>  (rights overrides)`,
    list: 'usage: narova assets list',
    untrack: 'usage: narova assets untrack <project-relative file>',
    verify: 'usage: narova assets verify',
    credits: 'usage: narova assets credits [--format text|youtube|web|json]',
  },
  walkthrough: {
    explore: 'usage: narova walkthrough explore <id>',
    capture: 'usage: narova walkthrough capture [id]',
    status: 'usage: narova walkthrough status [id]',
  },
  branch: {
    save: 'usage: narova branch save <name> --rationale "why this small proof may serve the brief" [--judge-assertion <id>] [--video <file>] [--status candidate|exploring] [--parent <name>]',
    compare: 'usage: narova branch compare <name> <name> [name]',
    list: 'usage: narova branch list',
    set: 'usage: narova branch set <name> [--status approved|rejected|archived|candidate] [--rationale "..."]',
    show: 'usage: narova branch show <name>',
  },
};

async function main() {
  const argv = process.argv.slice(2);
  // Pre-scan for the machine-output request so even a parse failure can emit
  // the minimal usage-error envelope (NAR-015-071).
  const jsonRequested = argv.some(a => a === '--json' || a.startsWith('--json='));
  let positionals;
  let flags;
  try {
    ({ positionals, flags } = parseArgs(argv));
  } catch (error) {
    console.error(error.message);
    if (jsonRequested) machine.emitUsageEnvelope(preDispatchOperation(argv), error.message);
    process.exit(machine.EXIT.usage);
  }
  const cmd = positionals[0];
  if (flags.json) machine.begin(operationName(cmd, positionals, flags));
  const helpRequested = !cmd || cmd === 'help' || cmd === '-h' || flags.help || flags.h;
  if (!flags.version && !helpRequested) validateInvocationFlags(flags, cmd);
  substrateGuard();

  if (flags.version) {
    const version = require('../package.json').version;
    console.log(version);
    mData({ version });
    return;
  }
  if (!cmd || cmd === 'help' || cmd === '-h') {
    if (!machine.isActive() && !flags.help && !flags.h && !firstRunDone()
        && (isInteractive() || process.env.NAROVA_FIRST_RUN === '1')) {
      // First contact with the product (NAR-021-001/002/006): the welcome
      // wizard interactively, or the quiet checklist + commands when a
      // non-interactive caller opts in (NAROVA_FIRST_RUN=1).
      if (isInteractive()) { await welcomeWizard({ cwd: process.cwd() }); return; }
      firstRunQuiet({});
      console.log('');
    }
    console.log(HELP);
    return;
  }
  if ((flags.help || flags.h) && cmd !== 'demo') {
    const actionHelp = ACTION_HELP[cmd] && ACTION_HELP[cmd][positionals[1]];
    console.log(actionHelp || HELP);
    return;
  }

  switch (cmd) {
    case 'init': {
      const dir = positionals[1];
      if (!dir) usageError('usage: narova init <dir>');
      const result = initProject(dir);
      mSetData({
        dir: result.target, created: result.created, skipped: result.skipped,
        projectCreated: result.targetCreated, assetDirectoryCreated: result.assetsCreated,
      });
      if (result.targetCreated) mArtifact(result.target, 'project');
      if (result.assetsCreated) mArtifact(result.assets, 'asset-directory');
      for (const file of result.created) mArtifact(file, 'authoring-source');
      return;
    }

    case 'demo': {
      // The activation event (NAR-021-004): one command to a finished MP4
      // through the ordinary pipeline. No keys, no config, no questions.
      if (flags.help || flags.h) { console.log('usage: narova demo   # one command to a finished MP4: narova-demo/out/video.mp4'); return; }
      const demoProjectDir = path.join(process.cwd(), DEMO_DIR_NAME);
      const demoConfig = path.join(demoProjectDir, 'reel.config.mjs');
      const demoConfigExisted = fs.existsSync(demoConfig);
      try {
        const result = await demo({ cwd: process.cwd(), renderer: flags.renderer });
        mData({
          seconds: result.seconds,
          elapsedMs: result.elapsed,
          networkBytes: result.networkBytes,
          projectDir: result.projectDir,
          created: result.created,
        });
        const demoOut = path.join(result.projectDir, 'out');
        if (result.created) {
          mArtifact(result.projectDir, 'project');
          mArtifact(path.join(result.projectDir, 'reel.config.mjs'), 'authoring-source');
        }
        mArtifact(result.mp4, 'video');
        mArtifact(path.join(demoOut, 'captions.srt'), 'captions');
        mArtifact(path.join(demoOut, 'captions.vtt'), 'captions');
        mArtifact(path.join(demoOut, 'manifest.json'), 'manifest');
        mArtifact(path.join(demoOut, 'timings.json'), 'timings');
        mArtifact(path.join(demoOut, 'audio'), 'audio');
        mArtifact(path.join(demoOut, 'revisions.jsonl'), 'revision-ledger');
        mArtifact(findHfDir(demoOut), 'renderer-project');
        mArtifact(findNoBrowserDir(demoOut), 'renderer-project');
      } catch (err) {
        if (!demoConfigExisted && fs.existsSync(demoConfig)) {
          mData({ projectDir: demoProjectDir, created: true });
          mArtifact(demoProjectDir, 'project');
          mArtifact(demoConfig, 'authoring-source');
        }
        if (err.code === 'NAROVA_DEMO_BLOCKED') {
          mDiag('error', 'health.demo', err.message);
          process.exitCode = machine.EXIT.subjectNonPass;
          return;
        }
        if (err.code === 'NAROVA_DEMO_OPERATION_FAILED') {
          mDiag('error', 'operation.failed', err.message);
          process.exitCode = machine.EXIT.failure;
          return;
        }
        throw err;
      }
      return;
    }

    case 'pack': {
      for (const name of ['backend', 'out', 'platform', 'renderer', 'size', 'tempo', 'variant', 'voice-a', 'voice-b']) {
        if (flags[name] != null) invocationError(`--${name} is not portable authoring state and cannot be applied by pack`);
      }
      const resolved = await loadResolved(flags, { readOnly: true, ignoreRestore: true });
      const diagnostics = [];
      if (!check(resolved.config, { diagnostics })) {
        const error = new Error('project does not pass ordinary validation; archive was not written');
        error.code = 'NAROVA_SUBJECT_NON_PASS';
        error.diagnostics = diagnostics;
        throw error;
      }
      const assetLock = path.join(resolved.projectDir, 'assets.lock.json');
      if (fs.existsSync(assetLock)) {
        const assetReport = verifyAssets(resolved.projectDir);
        if (!assetReport.ok) {
          const error = new Error(`tracked project assets do not verify: ${assetReport.results.filter(item => !item.ok).map(item => `${item.file}: ${item.issues.join('; ')}`).join(', ')}`);
          error.code = 'NAROVA_SUBJECT_NON_PASS';
          error.diagnostics = assetReport.results
            .filter(item => !item.ok)
            .map(item => ({ severity: 'error', code: 'audit.assets.verify', message: item.issues.join('; '), subject: item.file }));
          throw error;
        }
      }
      const destination = flags.output
        ? path.resolve(flags.output)
        : path.resolve(`${fileSlug(resolved.configFile.endsWith('.json') ? resolved.config.title : path.basename(resolved.projectDir))}.narova`);
      const result = packProject({
        projectDir: resolved.projectDir,
        config: resolved.config,
        raw: resolved.raw,
        configFile: resolved.configFile,
        output: destination,
        productVersion: require('../package.json').version,
      });
      console.log(`packed ${result.members} members (${result.bytes} bytes) -> ${displayPath(result.path)}`);
      mSetData(result);
      mArtifact(result.path, 'project-archive');
      return;
    }

    case 'open': {
      const archive = positionals[1];
      if (!archive) usageError('usage: narova open <archive.narova> [--dir <target> | --inspect]');
      if (flags.inspect) {
        const result = inspectArchive(archive);
        console.log(`archive: ${displayPath(result.path)}`);
        console.log(`title: ${result.source && result.source.title ? result.source.title : 'not recorded'}`);
        console.log(`format: ${result.format}; packed by narova ${result.packer && result.packer.version ? result.packer.version : 'not recorded'}`);
        console.log(`members: ${result.members.length}`);
        for (const member of result.members) console.log(`  ${member.role.padEnd(18)} ${String(member.bytes).padStart(10)}  ${member.path}`);
        mSetData(result);
        return;
      }
      const target = path.resolve(flags.dir || path.basename(archive).replace(/\.narova$/i, '') || 'narova-project');
      const result = openArchive(archive, target, { overwrite: !!flags.overwrite });
      console.log(`opened ${result.manifest.members.length} members -> ${displayPath(result.target)}`);
      console.log(trustNotice(result.target));
      console.log(`next: narova check --project ${JSON.stringify(result.target)}`);
      console.log(`then: narova build --project ${JSON.stringify(result.target)}`);
      mSetData({
        target: result.target, archive: result.archive, archiveSha256: result.sha256,
        members: result.manifest.members.length, source: result.manifest.source,
        trust: 'building executes the project authored source with ambient authority',
      });
      mArtifact(result.target, 'project');
      return;
    }

    case 'remix': {
      const source = positionals[1];
      if (!source) usageError('usage: narova remix <archive|project-dir|github:owner/repo[#ref]> [--dir <target>]');
      const sourceBase = source.startsWith('github:')
        ? source.slice('github:'.length).split(/[\/#]/).pop()
        : path.basename(source).replace(/\.narova$/i, '');
      const target = path.resolve(flags.dir || `${fileSlug(sourceBase)}-remix`);
      const result = await remixProject(source, target, { overwrite: !!flags.overwrite });
      console.log(`remixed ${result.members} members -> ${displayPath(result.target)}`);
      console.log(`parent: ${result.origin.kind} ${result.origin.identity || result.origin.locator}`);
      console.log(trustNotice(result.target));
      console.log(`next: narova check --project ${JSON.stringify(result.target)}`);
      mSetData({ ...result, trust: 'building executes the project authored source with ambient authority' });
      mArtifact(result.target, 'project');
      mArtifact(path.join(result.target, '.narova-remix.json'), 'remix-lineage');
      return;
    }

    case 'ingest': {
      const url = positionals[1];
      if (!url) usageError('usage: narova ingest <url> [--project <dir>]');
      const { dir: projectDir } = await loadProjectConfig(flags.project || '.', flags.config);
      const result = await ingest(url, { projectDir });
      if (result) {
        mData({
          url: result.finalUrl || url,
          slug: result.slug,
          images: result.images,
          screenshot: result.screenshot && result.screenshot.ok ? result.screenshot.path : null,
          claimsCreated: result.claimsCreated,
        });
        for (const file of result.files || []) mArtifact(path.join(projectDir, file), 'asset');
        if ((result.files || []).length) mArtifact(path.join(projectDir, 'assets.lock.json'), 'registry');
        mArtifact(path.join(projectDir, 'sources.md'), 'source');
        if (result.claimsCreated) mArtifact(path.join(projectDir, 'claims.md'), 'source');
      }
      return;
    }

    case 'assets': {
      const action = positionals[1];
      if (!['import', 'download', 'providers', 'search', 'acquire', 'list', 'untrack', 'verify', 'credits'].includes(action)) {
        usageError(
          'usage: narova assets import <file> [metadata options]',
          '       narova assets download <url> --output <project-relative path> [metadata options]',
          '       narova assets providers',
          '       narova assets search <query> --provider <name> --kind <kind> [--limit N] [--json]',
          '       narova assets acquire <id> --provider <name> --kind <kind> --output <path>',
          '       narova assets list|untrack <file>|verify|credits',
        );
      }
      let projectDir;
      let rawConfig;
      try {
        if (action === 'providers') {
          let providers;
          try { providers = listStockProviders(process.env, { pack: flags.pack }); }
          catch (error) { invocationError(error.message); }
          for (const provider of providers) {
            const readiness = provider.ready ? 'ready' : `optional: needs ${provider.envKey}`;
            console.log(`${provider.id}\t${provider.kinds.join(',')}\t${readiness}`);
          }
          mSetData({
            pack: flags.pack || 'core',
            providers: providers.map(p => ({ id: p.id, kinds: p.kinds, ready: p.ready, envKey: p.ready ? undefined : p.envKey })),
          });
          return;
        }
        if (action === 'search') {
          const query = positionals.slice(2).join(' ');
          if (!query || !flags.provider) {
            invocationError('usage: narova assets search <query> --provider <name> --kind image|video|audio|model [--limit N] [--json]');
          }
          let results;
          try {
            results = await searchStock(flags.provider, query, {
              kind: flags.kind, limit: flags.limit, pack: flags.pack,
            });
          } catch (error) {
            if (/^(?:unknown stock provider|--limit |stock search query |\S+ does not support kind )/.test(error.message)) {
              invocationError(error.message);
            }
            throw error;
          }
          // Under --json the standard envelope supersedes the legacy bare-JSON
          // result list (NAR-015-012); the legacy print remains for humans.
          if (machine.isActive()) {
            mSetData({ provider: flags.provider, kind: flags.kind || null, query, results });
          } else if (flags.json) {
            console.log(JSON.stringify(results, null, 2));
          } else if (!results.length) {
            console.log('no stock assets found');
          } else {
            for (const result of results) {
              const license = result.rights?.license || result.rights?.status || 'unknown';
              const dimensions = result.download?.width && result.download?.height
                ? ` ${result.download.width}x${result.download.height}` : '';
              console.log(`${result.provider}\t${result.id}\t${result.kind}${dimensions}\t${license}\t${result.title}`);
              console.log(`  ${result.sourcePage}`);
            }
          }
          return;
        }
        ({ dir: projectDir, raw: rawConfig } = await loadProjectConfig(flags.project || '.', flags.config));
        if (action === 'list') {
          const lock = readAssetLock(projectDir);
          if (!lock.assets.length) console.log('no tracked creative assets');
          for (const asset of lock.assets) {
            console.log(`${asset.file}\t${asset.kind}\t${asset.origin?.mode || 'unknown'}\t${asset.rights?.status || 'unknown'}`);
          }
          mSetData({ assets: lock.assets });
          return;
        }
        if (action === 'verify') {
          const report = verifyAssets(projectDir);
          if (!report.count) console.log('ok: no tracked creative assets');
          for (const result of report.results) {
            console.log(`${result.ok ? 'ok' : 'fail'}: ${result.file}${result.ok ? '' : ` — ${result.issues.join('; ')}`}`);
            if (!result.ok) mDiag('error', 'audit.assets.verify', result.issues.join('; '), result.file);
          }
          mSetData({ ok: report.ok, count: report.count, results: report.results });
          if (!report.ok) process.exitCode = machine.EXIT.subjectNonPass;
          return;
        }
        if (action === 'credits') {
          if (flags.format && flags.format !== 'text') {
            const entries = creditEntries(projectDir);
            let formatted;
            try { formatted = formatCredits(entries, flags.format); }
            catch (error) { invocationError(error.message); }
            if (formatted) console.log(formatted);
            mSetData({ format: flags.format, entries });
            return;
          }
          const lines = creditLines(projectDir);
          if (!lines.length) console.log('no tracked attribution text');
          else for (const line of lines) console.log(`- ${line}`);
          mSetData({ format: 'text', lines });
          return;
        }
        if (action === 'untrack') {
          const file = positionals[2];
          if (!file) invocationError('usage: narova assets untrack <project-relative file>');
          const removed = unregisterAsset(projectDir, file);
          console.log(`untracked: ${removed} (file kept)`);
          mData({ file: removed });
          mArtifact(path.join(projectDir, 'assets.lock.json'), 'registry');
          return;
        }
        if (action === 'import') {
          const file = positionals[2];
          if (!file) invocationError('usage: narova assets import <project-relative file> [metadata options]');
          const resolved = resolveProjectFile(projectDir, file);
          const record = withAssetMutation(projectDir, () => {
            const previous = readAssetLock(projectDir).assets.find(asset => asset.file === resolved.relative);
            let metadata;
            try {
              metadata = assetRegistrationFromFlags(flags);
              normalizeRegistrationMetadata(metadata);
            } catch (error) {
              invocationError(error.message);
            }
            if (previous && metadata.origin) {
              metadata.origin = { ...previous.origin, ...metadata.origin };
              // A URL digest describes the exact raw URL supplied with that
              // value. Never carry it across to a replacement URL.
              if (Object.hasOwn(flags, 'source-page')) delete metadata.origin.sourcePageHash;
            }
            if (previous && metadata.rights) metadata.rights = { ...previous.rights, ...metadata.rights, status: 'declared' };
            return registerAsset(projectDir, {
              file: resolved.relative,
              ...metadata,
            }, { lockHeld: true });
          });
          console.log(`tracked: ${record.file} (${record.kind}, ${record.bytes} bytes)`);
          console.log(`lock:    ${path.join(projectDir, 'assets.lock.json')}`);
          adviseUnrecognizedLicense(flags);
          mData({ file: record.file, kind: record.kind, bytes: record.bytes });
          mArtifact(path.join(projectDir, 'assets.lock.json'), 'registry');
          return;
        }
        const requestedId = positionals.slice(2).join(' ');
        if (!requestedId || !flags.output) {
          invocationError(action === 'acquire'
            ? 'usage: narova assets acquire <id> --provider <name> --kind <kind> --output <project-relative path>'
            : 'usage: narova assets download <url> --output <project-relative path> [metadata options]');
        }
        if (action === 'acquire' && !flags.provider) {
          invocationError('assets acquire requires --provider');
        }
        if (action === 'acquire') {
          const forbidden = ['origin', 'item-id', 'source-page'].filter(flag => Object.hasOwn(flags, flag));
          if (forbidden.length) {
            invocationError(`assets acquire derives stock provenance; do not pass ${forbidden.map(flag => `--${flag}`).join(', ')}`);
          }
        }
        // Validate the existing registry and destination before mutating bytes.
        readAssetLock(projectDir);
        const destination = resolveProjectFile(projectDir, flags.output, { mustExist: false });
        const assetRootRef = rawConfig && rawConfig.assets != null ? rawConfig.assets : 'assets';
        if (typeof assetRootRef !== 'string' || !assetRootRef.trim() || path.isAbsolute(assetRootRef)) {
          throw new Error('config.assets must be a project-relative directory before downloading assets');
        }
        const assetRoot = path.resolve(projectDir, assetRootRef);
        const assetRootRelative = path.relative(projectDir, assetRoot);
        if (!assetRootRelative || assetRootRelative === '..' || assetRootRelative.startsWith(`..${path.sep}`)) {
          throw new Error('config.assets must be a directory inside the project, not the project itself');
        }
        if (!fs.existsSync(assetRoot) || !fs.statSync(assetRoot).isDirectory()) {
          throw new Error(`config.assets directory not found: ${assetRoot}`);
        }
        const withinAssetRoot = path.relative(assetRoot, destination.absolute);
        if (!withinAssetRoot || withinAssetRoot === '..' || withinAssetRoot.startsWith(`..${path.sep}`) || path.isAbsolute(withinAssetRoot)) {
          throw new Error(`--output must be inside the configured asset directory (${assetRootRef})`);
        }
        if (fs.existsSync(destination.absolute) && !fs.lstatSync(destination.absolute).isFile()) {
          throw new Error(`asset destination is not a file: ${destination.relative}`);
        }
        // Reject malformed user overrides before any catalogue lookup.
        try { normalizeRegistrationMetadata(assetRegistrationFromFlags(flags)); }
        catch (error) { invocationError(error.message); }
        let stock = null;
        let url = requestedId;
        if (action === 'acquire') {
          try {
            stock = await resolveStock(flags.provider, requestedId, { kind: flags.kind, pack: flags.pack });
          } catch (error) {
            if (/^(?:unknown stock provider|stock asset id |\S+ does not support kind )/.test(error.message)) {
              invocationError(error.message);
            }
            throw error;
          }
          url = stock.download.url;
          const outputKind = inferKind(destination.relative);
          if (outputKind !== stock.kind) {
            throw new Error(`--output extension identifies ${outputKind}, but ${stock.provider} item is ${stock.kind}`);
          }
        }
        const registrationFor = sourceUrl => {
          const authored = assetRegistrationFromFlags(flags, {
            mode: stock ? 'stock' : 'download', sourceUrl,
          });
          if (!stock) return authored;
          const rightsOverride = authored.rights || null;
          const rightsDeclared = stock.rights?.status === 'declared'
            || Boolean(flags.license || flags['license-url']);
          return {
            origin: {
              mode: 'stock', provider: stock.provider, itemId: stock.id,
              sourcePage: stock.sourcePage, sourceUrl,
            },
            rights: {
              ...(stock.rights || { status: 'unknown' }),
              ...(rightsOverride || {}),
              status: rightsDeclared ? 'declared' : 'unknown',
            },
          };
        };
        // Validate normalized catalogue metadata before downloading media. The
        // downloaded bytes and lock update then commit as one recoverable unit.
        normalizeRegistrationMetadata(registrationFor(url));
        const extension = path.extname(destination.absolute);
        const stem = path.basename(destination.absolute, extension);
        const token = `${process.pid}-${Date.now()}`;
        const staged = path.join(path.dirname(destination.absolute), `.${stem}.download-${token}${extension}`);
        const backup = path.join(path.dirname(destination.absolute), `.${stem}.previous-${token}${extension}`);
        let published = false;
        let backedUp = false;
        let record;
        try {
          const downloaded = await downloadAsset(url, staged);
          const responseKind = String(downloaded.contentType || '').split('/')[0].toLowerCase();
          const expectedKind = stock ? stock.kind : inferKind(destination.relative);
          if (['image', 'video', 'audio'].includes(responseKind) && responseKind !== expectedKind) {
            const sourceName = stock ? stock.provider : 'download URL';
            throw new Error(`${sourceName} returned ${responseKind} content for a ${expectedKind} asset`);
          }
          record = withAssetMutation(projectDir, () => {
            try {
              const latest = readAssetLock(projectDir).assets.find(asset => asset.file === destination.relative);
              resolveProjectFile(projectDir, destination.relative, { mustExist: false });
              if (fs.existsSync(destination.absolute) && !fs.lstatSync(destination.absolute).isFile()) {
                throw new Error(`asset destination is not a regular file: ${destination.relative}`);
              }
              const metadata = normalizeRegistrationMetadata(registrationFor(downloaded.finalUrl || url));
              if (latest && !stock) {
                metadata.origin = { ...latest.origin, ...metadata.origin };
                if (!flags.origin) metadata.origin.mode = latest.origin.mode;
                if (metadata.rights) metadata.rights = { ...latest.rights, ...metadata.rights, status: 'declared' };
              }
              if (fs.existsSync(destination.absolute)) {
                fs.renameSync(destination.absolute, backup);
                backedUp = true;
              }
              fs.renameSync(staged, destination.absolute);
              published = true;
              return registerAsset(projectDir, {
                file: destination.relative,
                contentType: downloaded.contentType,
                ...metadata,
                acquiredAt: new Date().toISOString(),
              }, { lockHeld: true });
            } catch (error) {
              if (published) fs.rmSync(destination.absolute, { force: true });
              if (backedUp && fs.existsSync(backup)) fs.renameSync(backup, destination.absolute);
              published = false;
              backedUp = false;
              throw error;
            }
          });
          if (backedUp) {
            try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* committed asset wins */ }
          }
        } catch (error) {
          let rollbackError = null;
          try {
            fs.rmSync(staged, { force: true });
            if (published) fs.rmSync(destination.absolute, { force: true });
            if (backedUp && fs.existsSync(backup)) fs.renameSync(backup, destination.absolute);
          } catch (failure) { rollbackError = failure; }
          if (rollbackError) error.message += `; asset rollback failed: ${rollbackError.message}`;
          throw error;
        }
        console.log(`${stock ? 'acquired' : 'downloaded'}: ${record.file} (${record.kind}, ${record.bytes} bytes)`);
        console.log(`lock:       ${path.join(projectDir, 'assets.lock.json')}`);
        adviseUnrecognizedLicense(flags);
        mData({ file: record.file, kind: record.kind, bytes: record.bytes, ...(stock ? { provider: stock.provider, itemId: stock.id } : { url }) });
        mArtifact(path.join(projectDir, record.file), 'asset');
        mArtifact(path.join(projectDir, 'assets.lock.json'), 'registry');
      } catch (error) {
        console.error(`assets ${action} failed: ${error.message}`);
        // Usage-shaped rejections (missing query/provider/output arguments)
        // surface through this catch as Errors; classify them as usage errors.
        const usage = error instanceof InvocationError || error.message.startsWith('usage:');
        mDiag('error', usage ? 'usage.invalid' : 'operation.failed', error.message);
        process.exit(usage ? machine.EXIT.usage : machine.EXIT.failure);
      }
      return;
    }

    case 'compile': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const compiled = compileTimeline(config, { out });
      console.log(`manifest -> ${path.join(out, 'manifest.json')}`);
      mData({ manifest: path.join(out, 'manifest.json'), scenes: config.scenes.length });
      mArtifact(path.join(out, 'manifest.json'), 'manifest');
      mArtifact(compiled.files.narration, 'stage-input');
      mArtifact(compiled.files.resolvedConfig, 'stage-input');
      if (compiled.files.restoreMarker) mArtifact(compiled.files.restoreMarker, 'compatibility-state');
      return;
    }

    case 'check': {
      let config;
      let projectDir;
      try { ({ config, projectDir } = await loadResolved(flags)); }
      catch (e) {
        if (e.code === 'NAROVA_USAGE') throw e;
        console.error(e.message); process.exit(1);
      }
      const diagnostics = [];
      const ok = check(config, {
        strict: flags.strict,
        release: flags.release,
        outDir: outDirOf(flags, projectDir),
        critiqueProfile: flags.critique || null,
        emitCreativeArtifact: !!flags['creative-identity'],
        diagnostics,
      });
      for (const d of diagnostics) mDiag(d.severity, d.code, d.message);
      mData({
        level: flags.release ? 'release' : flags.strict ? 'strict' : 'default',
        warnings: diagnostics.filter(d => d.severity === 'warning').length,
        errors: diagnostics.filter(d => d.severity === 'error').length,
      });
      if (flags['creative-identity']) {
        const identityArtifact = path.join(outDirOf(flags, projectDir), 'creative-identity.json');
        if (fs.existsSync(identityArtifact)) mArtifact(identityArtifact, 'report');
      }
      // Run critique when requested via --critique flag or as a standalone command.
      if (flags.critique) {
        console.log('');
        const advice = critique(config, {
          profile: flags.critique === true ? 'all' : flags.critique,
          projectDir,
          outDir: outDirOf(flags, projectDir),
        });
        mData({ critique: advice });
      }
      if (!ok) process.exitCode = machine.EXIT.subjectNonPass;
      return;
    }

    case 'critique': {
      let config;
      let projectDir;
      try { ({ config, projectDir } = await loadResolved(flags)); }
      catch (e) {
        if (e.code === 'NAROVA_USAGE') throw e;
        console.error(e.message); process.exit(1);
      }
      const profile = positionals[1] || flags.profile || 'all';
      const advice = critique(config, { profile, projectDir, outDir: outDirOf(flags, projectDir) });
      mData({ profile, advice });
      return;
    }

    case 'judge': {
      if (positionals[1] != null) {
        invocationError('usage: narova judge [--video <file>] [--plan] [--json] [--repair --judge-assertion <id> --repair-branch <name>]');
      }
      if (flags.plan && flags.repair) invocationError('--plan and --repair cannot be combined');
      if (flags.repair && (!String(flags['judge-assertion'] || '').trim()
          || !String(flags['repair-branch'] || '').trim())) {
        invocationError('narova judge --repair requires --judge-assertion <id> and --repair-branch <name>');
      }
      const {
        config, projectDir, configFile, configSourceBytes, raw, effectiveOverrides,
      } = await loadResolved(flags, { readOnly: true });
      const out = outDirOf(flags, projectDir);
      const defaultVideo = config.variant ? `video-${config.variant}.mp4` : 'video.mp4';
      const report = judge(config, {
        projectDir,
        outDir: out,
        configFile,
        video: flags.video ? path.resolve(projectDir, flags.video) : path.join(out, defaultVideo),
      });
      if (flags.repair) {
        const assertionId = String(flags['judge-assertion']).trim();
        const targetName = String(flags['repair-branch']).trim();
        const proof = verifyProofReceipt(config, out);
        if (!proof.ok) throw new Error(`${proof.reason} — rerun narova shots --motion --proof before repair`);
        const proofReceiptSha256 = hashFile(path.join(out, '.proof-receipt.json'));
        const expectedRevision = branchRevision(targetName);
        const stagedName = `branch-stage-${process.pid}-${Date.now()}`;
        let staged = null;
        let published;
        try {
          staged = await saveRelease(path.join(out, 'manifest.json'), stagedName, {
            projectDir,
            resolvedOverrides: effectiveOverrides,
            configSource: { file: configFile, bytes: configSourceBytes, raw },
          });
          const metadataDir = branchDir(staged.name);
          fs.mkdirSync(metadataDir, { recursive: true });
          const identity = projectIdentity(projectDir);
          const bundle = writeProofBundle(out, proof, metadataDir, staged.dir);
          const prepared = prepareCaptionRepair({
            config, baselineJudgement: report, assertionId, verifiedProof: proof,
            proofBundle: bundle, metadataDir, snapshotDir: staged.dir,
            projectDir, outDir: out, configFile,
          });
          const currentProof = verifyProofReceipt(config, out);
          if (!currentProof.ok || hashFile(path.join(out, '.proof-receipt.json')) !== proofReceiptSha256) {
            throw new Error('proof evidence changed during caption repair');
          }
          const rationale = `Unapproved ${prepared.repairCandidate.policy} candidate for assertion "${assertionId}".`;
          const stagedBranch = saveBranch(staged.name, {
            rationale,
            status: 'candidate',
            ...bundle,
            snapshotManifestSha256: hashFile(path.join(staged.dir, 'manifest.json')),
            projectIdentity: identity,
            videoCi: prepared.videoCi,
            videoCiIdentity: prepared.videoCiIdentity,
            repairCandidate: prepared.repairCandidate,
            repairCandidateIdentity: prepared.repairCandidateIdentity,
          });
          if (!verifyProofBundle(metadataDir, staged.dir, stagedBranch, identity)) {
            throw new Error('staged repair proof bundle failed integrity verification');
          }
          if (!verifyBranchExperiment(metadataDir, stagedBranch.videoCi, stagedBranch.videoCiIdentity)) {
            throw new Error('staged repair Video CI evidence failed integrity verification');
          }
          if (!verifyCaptionRepair(metadataDir, stagedBranch.repairCandidate,
            stagedBranch.repairCandidateIdentity, stagedBranch, staged.dir)) {
            throw new Error('staged caption repair candidate failed integrity verification');
          }
          const expectedStagedRevision = branchRevision(staged.name);
          published = publishStagedBranch(staged.name, targetName, {
            expectedRevision, expectedStagedRevision,
          });
        } catch (error) {
          if (staged) {
            try { removeRelease(staged.name); } catch { /* published or already cleaned */ }
          }
          throw error;
        }
        const branch = readBranch(published.name);
        console.log(formatJudgement(report));
        console.log('');
        console.log(formatCaptionRepair(branch.repairCandidate, published.name));
        mSetData({
          judgement: report,
          repairCandidate: branch.repairCandidate,
          repairCandidateIdentity: branch.repairCandidateIdentity,
          branch: {
            name: published.name, status: branch.status, rationale: branch.rationale,
            proofIdentity: branch.proofIdentity, snapshotIdentity: branch.snapshotIdentity,
          },
        });
        mArtifact(published.dir, 'archive');
        mArtifact(published.metadataDir, 'proof-metadata');
        return;
      }
      console.log(formatJudgement(report));
      if (flags.plan) {
        const planned = interventionPlan(report);
        console.log(formatInterventionPlan(planned));
        mSetData({ judgement: report, interventionPlan: planned });
      } else {
        mSetData({ judgement: report });
      }
      return;
    }

    case 'walkthrough': {
      const action = positionals[1] || 'status';
      if (!['explore', 'capture', 'status'].includes(action)) {
        usageError('usage: narova walkthrough explore|capture|status [id]');
      }
      const { config, projectDir } = await loadResolved(flags);
      const declared = Object.keys(config.walkthroughs || {});
      const requested = positionals[2];
      if (action === 'explore' && !requested && declared.length > 1) {
        usageError(`walkthrough explore needs an id — declared: ${declared.join(', ')}`);
      }
      const ids = requested && requested !== 'all'
        ? [requested]
        : (action === 'explore' ? declared.slice(0, 1) : declared);
      if (ids.length === 0) {
        console.error('no walkthroughs declared in reel.config');
        process.exit(1);
      }
      for (const id of ids) {
        if (!config.walkthroughs[id]) {
          console.error(`unknown walkthrough "${id}" — declared: ${declared.join(', ') || '(none)'}`);
          process.exit(1);
        }
      }
      const out = outDirOf(flags, projectDir);
      const timingsPath = path.join(out, 'timings.json');
      const timings = fs.existsSync(timingsPath)
        ? JSON.parse(fs.readFileSync(timingsPath, 'utf8'))
        : null;
      if (action === 'explore') {
        const result = exploreWalkthrough(config, ids[0]);
        console.log(result.snapshot || '(no interactive elements found)');
        console.log(`\nsession stays open: agent-browser --session ${result.session} snapshot -i`);
        mData({ id: ids[0], session: result.session, snapshot: result.snapshot || null });
        return;
      }
      if (action === 'status') {
        const statuses = [];
        for (const id of ids) {
          const status = captureStatus(config, id, timings, { outDir: out });
          console.log(`${status.ok ? '✓' : '○'} ${id}: ${status.ok ? 'fresh' : status.reason}${status.ok && status.manifest ? ` (${status.manifest.media.width}x${status.manifest.media.height}, ${status.manifest.media.duration.toFixed(1)}s)` : ''}`);
          statuses.push({
            id, fresh: status.ok, reason: status.ok ? null : status.reason,
            media: status.ok && status.manifest ? status.manifest.media : null,
          });
        }
        // Inspection: stale/missing state is reported in the payload; the
        // operation itself succeeds (NAR-015-013 retained behavior).
        mSetData({ walkthroughs: statuses });
        return;
      }
      if (!timings) {
        console.error(`walkthrough capture needs ${timingsPath} — run \`narova synth\` first`);
        process.exit(1);
      }
      const captures = [];
      for (const id of ids) {
        const flow = config.walkthroughs[id];
        console.log(`walkthrough "${id}" -> ${safeUrl(flow.url)}`);
        if (flow.mutates) {
          console.log('  note: this walkthrough declares mutating actions; use a disposable demo account and seeded data');
        }
        const result = captureWalkthrough(config, id, timings, { outDir: out });
        console.log(`captured -> ${result.recording} (${result.manifest.media.width}x${result.manifest.media.height}, ${result.manifest.media.duration.toFixed(1)}s, ${result.manifest.steps.length} actions)`);
        captures.push({ id, media: result.manifest.media, steps: result.manifest.steps.length });
        mArtifact(result.recording, 'recording');
        mArtifact(path.join(result.dir, 'capture.json'), 'capture-manifest');
      }
      mSetData({ captures });
      mArtifact(path.join(projectDir, 'assets.lock.json'), 'registry');
      return;
    }

    case 'plan': {
      const { config, dir } = await loadCurrent(flags.project || '.');
      const out = outDirOf(flags, dir);
      const prev = lastManifest(out);
      if (!prev) {
        console.log('no previous manifest found in', out);
        console.log('run `narova compile` or `narova build` first to generate one');
        process.exit(1);
      }
      const result = plan(prev, config, { toolVersion: require('../package.json').version });
      console.log(formatPlan(result));
      mSetData(result);
      return;
    }

    case 'provenance': {
      // CHANGE-2026-027 / NAR-009-028: read-only provenance report composed
      // from existing project evidence (claims ledger, registry, manifest,
      // declarations). Advisory; never mutates, synthesizes, renders, probes
      // tools, or touches the network; missing evidence reads "not recorded"
      // and never fails the command.
      let config;
      let projectDir;
      let raw;
      let configFile;
      let restoredOverrides;
      let cliOverrides;
      try {
        ({ config, projectDir, raw, configFile, restoredOverrides, cliOverrides }
          = await loadResolved(flags, { readOnly: true }));
      }
      catch (e) {
        if (e.code === 'NAROVA_USAGE') throw e;
        console.error(e.message); process.exit(1);
      }
      const report = collectProvenance(config, {
        outDir: outDirOf(flags, projectDir),
        configFile,
        raw,
        restoredOverrides,
        cliOverrides,
      });
      // Under --json the envelope supersedes the bare report print
      // (NAR-015-012); the report moves into the envelope's data payload.
      if (machine.isActive()) mSetData(report);
      else if (flags.json) console.log(JSON.stringify(report, null, 2));
      else console.log(formatProvenance(report));
      return;
    }

    case 'diff': {
      // CHANGE-2026-026 / NAR-009-027: per-scene revision-impact report
      // against the latest recorded revision (or, pre-ledger, the last build
      // manifest, named as that baseline). Advisory; produces no media.
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const { compile } = require('../src/manifest');
      const { renderContextHash } = require('../src/scene-cache');
      const { narrationContextDigest } = require('../src/audio-fingerprint');
      const fresh = compile(config, { toolVersion: require('../package.json').version });
      const currentNc = narrationContextDigest(config);
      const records = revisions.readLedger(out);
      if (records.length === 0) {
        // Migration path: a project built before the ledger existed still
        // has its last enriched manifest. Comparing against it names that
        // baseline explicitly (NAR-009-027 MAY).
        const prevManifestPath = path.join(out, 'manifest.json');
        if (fs.existsSync(prevManifestPath)) {
          try {
            const prev = JSON.parse(fs.readFileSync(prevManifestPath, 'utf8'));
            let prevNc = null;
            try { prevNc = fs.readFileSync(path.join(out, '.narration-context'), 'utf8').trim() || null; } catch {}
            const baselineRecord = {
              ordinal: null,
              renderContextIdentity: renderContextHash(prev, {
                fps: flags.fps || (prev.format && prev.format.fps) || 30,
                quality: flags.quality,
              }),
              sceneIdentities: (prev.scenes || []).map(s => ({
                id: s.id, digest: s.hash || null, narration: revisions.narrationDigest(s),
                silentDur: s.dur || null, duration: s.duration || null, sentences: null,
              })),
              stageDurations: null,
            };
            const report = revisions.buildRevisionReport({
              currentScenes: revisions.sceneProjection(fresh),
              currentContextIdentity: renderContextHash(fresh, { fps: flags.fps, quality: flags.quality }),
              baselineRecord,
              audioIdentityChanged: prevNc != null && prevNc !== currentNc,
            });
            console.log(revisions.formatRevisionImpact(report, { baselineName: 'last build manifest (no recorded revision)' }));
            mSetData({ baseline: 'last build manifest (no recorded revision)', ...report });
            return;
          } catch { /* fall through to the no-revision statement */ }
        }
        console.log('no revisions recorded yet — build once, then narova diff predicts the impact of your edits');
        mSetData({ baseline: null, rows: [] });
        return;
      }
      const baseline = records[records.length - 1];
      const report = revisions.buildRevisionReport({
        currentScenes: revisions.sceneProjection(fresh, revisions.sentenceCountsFromTakes(out)),
        currentContextIdentity: renderContextHash(fresh, { fps: flags.fps, quality: flags.quality }),
        baselineRecord: baseline,
        // Shared narration context (voices/tempo/gaps) — NOT the full audio
        // fingerprint, which flips on any single turn edit. A turn-text edit
        // is scene-scoped (per-scene classes + sentence cache); a shared
        // input change is what re-synthesizes every scene. Records from
        // before this field existed carry only the full fingerprint: compare
        // per-scene narration digests in that case and skip the project line.
        audioIdentityChanged: baseline.narrationContext != null && baseline.narrationContext !== currentNc,
      });
      console.log(revisions.formatRevisionImpact(report));
      mSetData(report);
      const changed = report.rows.some(r => r.cls !== 'unchanged') || report.contextChanged || report.audioIdentityChanged;
      if (!changed) console.log('\nno changes since the last recorded revision — the next build records no new revision');
      return;
    }

    case 'history': {
      // CHANGE-2026-026 / NAR-009-026: list / annotate / compare over the
      // append-only revision ledger. Read-only except annotate (label only).
      const sub = positionals[1];
      const projectDir = flags.project || '.';
      const out = outDirOf(flags, projectDir);
      const records = revisions.readLedger(out);
      if (!sub || sub === 'list') {
        if (records.length === 0) {
          console.log('no revisions recorded yet — every state-changing build appends one to out/revisions.jsonl');
          mSetData({ revisions: [] });
          return;
        }
        const listed = [];
        for (const rec of records) {
          const parent = rec.parent != null ? records.find(r => r.ordinal === rec.parent) : null;
          const when = rec.recordedAt ? rec.recordedAt.slice(0, 16).replace('T', ' ') : '';
          const label = rec.label ? `  ${rec.label}` : '';
          const summary = revisions.changeSummaryForRecord(rec, parent);
          const mr = rec.measuredReuse || {};
          const reuseBits = [];
          if (mr.audio && mr.audio.scenesIdentical != null) {
            reuseBits.push(`${mr.audio.scenesIdentical}/${mr.audio.scenesEvidenced} audio`);
          }
          if (mr.spans && mr.spans.reusedCount != null) reuseBits.push(`${mr.spans.reusedCount}/${mr.spans.totalCount} spans`);
          const reuse = reuseBits.length ? `  [measured: ${reuseBits.join(', ')}]` : '';
          console.log(`  v${rec.ordinal}  ${when}  ${summary}${reuse}${label}`);
          listed.push({ ordinal: rec.ordinal, recordedAt: rec.recordedAt || null, label: rec.label || null, summary });
        }
        console.log(`\ncompare: narova history compare <a>..<b>   annotate: narova history annotate <v> "label"`);
        mSetData({ revisions: listed });
        return;
      }
      if (sub === 'annotate') {
        const ordinal = parseInt(positionals[2], 10);
        const label = positionals.slice(3).join(' ').trim();
        if (!Number.isInteger(ordinal) || !label) {
          usageError('usage: narova history annotate <version> "label"');
        }
        const r = revisions.annotateLedger(out, ordinal, label);
        if (!r.ok) {
          console.error(r.error);
          process.exit(1);
        }
        console.log(`annotated v${ordinal} — "${label}" (label only; identities and evidence unchanged)`);
        mData({ ordinal, label });
        mArtifact(path.join(out, 'revisions.jsonl'), 'ledger');
        return;
      }
      if (sub === 'compare') {
        const spec = String(positionals[2] || '');
        const m = spec.match(/^(\d+)\.\.(\d+)$/);
        let a, b;
        if (m) { a = parseInt(m[1], 10); b = parseInt(m[2], 10); }
        else {
          a = parseInt(positionals[2], 10);
          b = parseInt(positionals[3], 10);
        }
        if (!Number.isInteger(a) || !Number.isInteger(b)) {
          usageError('usage: narova history compare <a>..<b>  (or <a> <b>)');
        }
        const recA = records.find(r => r.ordinal === a);
        const recB = records.find(r => r.ordinal === b);
        if (!recA) { console.error(`no revision v${a} recorded`); process.exit(1); }
        if (!recB) { console.error(`no revision v${b} recorded`); process.exit(1); }
        if (a === b) { usageError('pick two different revisions'); }
        const report = revisions.buildRevisionReport({
          baselineRecord: recA,
          afterRecord: recB,
          audioIdentityChanged: recA.narrationContext != null && recB.narrationContext != null
            && recA.narrationContext !== recB.narrationContext,
        });
        console.log(revisions.formatRevisionImpact(report));
        mSetData({ from: a, to: b, ...report });
        return;
      }
      usageError(`unknown history subcommand "${sub}" — use list, annotate, or compare`);
    }

    case 'release': {
      const sub = positionals[1];
      const projectDir = flags.project || '.';
      const out = outDirOf(flags, projectDir);
      const mp = path.join(out, 'manifest.json');
      // restore and list don't require an existing manifest
      // save and restore need a project context, but list/remove work globally
      const needsManifest = sub === 'save';
      if (needsManifest && !fs.existsSync(mp)) {
        console.error(`no manifest found in ${out} — run narova compile or build first`);
        process.exit(1);
      }
      if (!sub || sub === 'list') {
        const entries = listReleases();
        if (entries.length === 0) {
          console.log('no releases saved yet — narova release save <name>');
        } else {
          for (const e of entries) {
            const kb = (e.size / 1024).toFixed(1);
            const dur = e.duration ? `  ${e.duration.toFixed(1)}s` : '';
            console.log(`  ${e.name.padEnd(24)} ${kb.padStart(6)}KB${dur}  ${new Date(e.created).toISOString().slice(0,16).replace('T',' ')}  ${e.title || ''}`);
          }
          console.log(`\n${entries.length} release(s) in ${require('../src/releases').RELEASES_DIR}`);
        }
        mSetData({ releases: entries });
        return;
      }
      if (sub === 'save') {
        const name = positionals[2];
        if (!name) usageError('usage: narova release save <name>');
        const projectDir = path.resolve(flags.project || '.');
        const r = await saveRelease(mp, name, { projectDir });
        console.log(`release "${r.name}" saved -> ${r.dir}  (${r.files.length} files: ${r.files.join(', ')})`);
        mData({ name: r.name, files: r.files });
        mArtifact(r.dir, 'archive');
        return;
      }
      if (sub === 'restore') {
        const name = positionals[2];
        if (!name) usageError('usage: narova release restore <name>');
        const restoreProjectDir = path.resolve(flags['new-project'] || flags.project || '.');
        const result = restoreRelease(name, out, {
          projectDir: path.resolve(flags.project || '.'),
          overwrite: flags.overwrite,
          newProject: flags['new-project'],
        });
        console.log(`release "${name}" restored -> ${result.manifest}`);
        if (result.restored.length) console.log(`  restored: ${result.restored.join(', ')}`);
        if (result.conflicts.length) console.log(`  skipped (existing): ${result.conflicts.join(', ')}`);
        mData({ name, restored: result.restored, conflicts: result.conflicts });
        mArtifact(result.manifest, 'manifest');
        const outputEntries = new Set(['.audio-fingerprint', '.timings-fingerprint', 'timings.json', RESTORE_OVERRIDES]);
        for (const restored of result.restored) {
          const restoredPath = outputEntries.has(restored)
            ? path.join(path.dirname(result.manifest), restored)
            : path.join(restoreProjectDir, restored);
          mArtifact(restoredPath, restored === 'assets.lock.json' ? 'registry' : 'restored-source');
        }
        return;
      }
      if (sub === 'remove') {
        const name = positionals[2];
        if (!name) usageError('usage: narova release remove <name>');
        removeRelease(name);
        console.log(`release "${name}" removed`);
        mData({ name });
        return;
      }
      usageError('usage: narova release save|list|restore|remove [name]');
    }

    case 'branch': {
      const sub = positionals[1] || 'list';
      if (sub !== 'save' && (flags['judge-assertion'] != null || flags.video != null)) {
        usageError('--judge-assertion and --video are only valid with narova branch save');
      }
      if (sub === 'save') {
        const name = positionals[2];
        const rationale = String(flags.rationale || '').trim();
        const focusAssertion = String(flags['judge-assertion'] || '').trim();
        if (!name || !rationale) {
          usageError('usage: narova branch save <name> --rationale "why this small proof may serve the brief" [--judge-assertion <id>] [--video <file>] [--status candidate|exploring] [--parent <name>]');
        }
        if (flags.video && !focusAssertion) usageError('--video on branch save requires --judge-assertion <id>');
        let status;
        try { status = validBranchStatus(flags.status || 'candidate'); }
        catch (error) { thrownUsageError(error); }
        const {
          config, projectDir, configFile, configSourceBytes, raw, effectiveOverrides,
        } = await loadResolved(flags);
        const out = outDirOf(flags, projectDir);
        const mp = path.join(out, 'manifest.json');
        if (!fs.existsSync(mp)) {
          console.error(`no manifest found in ${out} — run narova compile or compose for the small proof first`);
          process.exit(1);
        }
        const proof = verifyProofReceipt(config, out);
        if (!proof.ok) {
          console.error(`${proof.reason} — rerun narova shots --motion --proof before saving this branch`);
          mDiag('error', 'gate.proof.receipt', proof.reason);
          process.exit(machine.EXIT.subjectNonPass);
        }
        // Build the complete snapshot and external proof bundle under a unique
        // stage name. Only a complete pair can replace an existing branch.
        const stagedName = `branch-stage-${process.pid}-${Date.now()}`;
        const expectedRevision = branchRevision(name);
        let staged = null;
        let published;
        try {
          staged = await saveRelease(mp, stagedName, {
            projectDir,
            resolvedOverrides: effectiveOverrides,
            ...(focusAssertion ? { configSource: { file: configFile, bytes: configSourceBytes, raw } } : {}),
          });
          let experimentReport = null;
          if (focusAssertion) {
            const stagedConfig = path.join(staged.dir, path.basename(configFile));
            if (!configSourceBytes || !fs.readFileSync(stagedConfig).equals(configSourceBytes)) {
              throw new Error('focused Video CI proof config changed before its snapshot was captured');
            }
            const defaultVideo = config.variant ? `video-${config.variant}.mp4` : 'video.mp4';
            experimentReport = judge(config, {
              projectDir,
              outDir: out,
              configFile,
              video: flags.video ? path.resolve(projectDir, flags.video) : path.join(out, defaultVideo),
            });
          }
          const currentProof = verifyProofReceipt(config, out);
          if (!currentProof.ok) throw new Error(currentProof.reason);
          const metadataDir = branchDir(staged.name);
          fs.mkdirSync(metadataDir, { recursive: true });
          const identity = projectIdentity(projectDir);
          const bundle = writeProofBundle(out, currentProof, metadataDir, staged.dir);
          const videoCi = experimentReport
            ? captureBranchExperiment(experimentReport, focusAssertion, metadataDir, projectDir)
            : null;
          const videoCiIdentity = videoCi ? branchExperimentIdentity(videoCi) : null;
          const stagedBranch = saveBranch(staged.name, {
            rationale,
            status,
            parent: flags.parent || undefined,
            ...bundle,
            snapshotManifestSha256: hashFile(path.join(staged.dir, 'manifest.json')),
            projectIdentity: identity,
            ...(videoCi ? { videoCi, videoCiIdentity } : {}),
          });
          if (!verifyProofBundle(metadataDir, staged.dir, stagedBranch, identity)) {
            throw new Error('staged proof bundle failed integrity verification');
          }
          if (videoCi && !verifyBranchExperiment(metadataDir, stagedBranch.videoCi, stagedBranch.videoCiIdentity)) {
            throw new Error('staged Video CI experiment failed integrity verification');
          }
          const expectedStagedRevision = branchRevision(staged.name);
          published = publishStagedBranch(staged.name, name, { expectedRevision, expectedStagedRevision });
        } catch (error) {
          if (staged) {
            try { removeRelease(staged.name); } catch { /* already published or cleaned */ }
          }
          throw error;
        }
        const branch = readBranch(published.name);
        console.log(`proof branch "${published.name}" saved: status=${branch.status} evidence=${branch.evidence.length} proof=${branch.proofIdentity} rationale="${branch.rationale}"`);
        if (branch.videoCi) {
          console.log(`focused Video CI proof preserved: assertion=${branch.videoCi.focusAssertion} artifact=${branch.videoCi.artifact.sha256}`);
          console.log('compare 2–3 focused proofs; Narova will not rank or select among them');
        } else {
          console.log('keep this branch small; compare 2–3 proofs, then let the creator choose');
        }
        mData({
          name: published.name,
          status: branch.status,
          rationale: branch.rationale,
          parent: branch.parent || null,
          proofIdentity: branch.proofIdentity,
          snapshotIdentity: branch.snapshotIdentity,
          evidence: branch.evidence,
          videoCi: branch.videoCi || null,
          videoCiIdentity: branch.videoCiIdentity || null,
        });
        mArtifact(published.dir, 'archive');
        mArtifact(published.metadataDir, 'proof-metadata');
        return;
      }
      if (sub === 'compare') {
        const requestedNames = positionals.slice(2);
        if (requestedNames.length < 2 || requestedNames.length > 3) {
          usageError('usage: narova branch compare <name> <name> [name]');
        }
        if (!fs.existsSync(RELEASES_DIR)) throw new Error('no proof branch store exists');
        const names = requestedNames.map(name => path.basename(releasePath(name)));
        const nameKeys = names.map(name => name.toLowerCase().replace(/[. ]+$/g, ''));
        if (new Set(nameKeys).size !== names.length) {
          usageError('branch comparison needs two or three unique branch names');
        }
        const projectDir = resolveProjectDir(flags.config ? path.dirname(path.resolve(flags.config)) : (flags.project || '.'));
        const identity = projectIdentity(projectDir);
        const entries = names.map(name => {
          const revision = branchRevision(name);
          const branch = readBranch(name);
          if (!branch) throw new Error(`branch "${name}" not found`);
          validBranchStatus(branch.status);
          if (typeof branch.rationale !== 'string' || !branch.rationale.trim()) {
            throw new Error(`branch "${name}" has no creator rationale`);
          }
          if (!verifyProofBundle(branchDir(name), releasePath(name), branch, identity)) {
            throw new Error(`branch "${name}" has invalid, stale, or other-project proof evidence`);
          }
          const metadataDir = branchDir(name);
          if (!verifyBranchExperiment(metadataDir, branch.videoCi, branch.videoCiIdentity)) {
            throw new Error(`branch "${name}" has no intact focused Video CI experiment`);
          }
          if (branch.repairCandidate && !verifyCaptionRepair(
            metadataDir, branch.repairCandidate, branch.repairCandidateIdentity, branch,
            releasePath(name),
          )) {
            throw new Error(`branch "${name}" has no intact caption repair evidence`);
          }
          return { name, branch, metadataDir, revision };
        });
        const focusAssertion = entries[0].branch.videoCi.focusAssertion;
        const mismatch = entries.find(entry => entry.branch.videoCi.focusAssertion !== focusAssertion);
        if (mismatch) {
          throw new Error(`branch "${mismatch.name}" focuses on a different assertion`);
        }
        const comparison = branchComparison(entries);
        const changed = entries.find(entry => branchRevision(entry.name) !== entry.revision);
        if (changed) throw new Error(`branch "${changed.name}" changed during comparison`);
        console.log(formatBranchComparison(comparison));
        mSetData({ comparison });
        return;
      }
      if (sub === 'list') {
        const entries = listBranches();
        if (!entries.length) {
          console.log('no branches saved yet — compose a small proof, then narova branch save <name> --rationale "..."');
        } else {
          for (const e of entries) {
            const status = e.branch ? `[${e.branch.status}]` : '[—]';
            const parent = e.branch && e.branch.parent ? ` ← ${e.branch.parent}` : '';
            console.log(`  ${status} ${e.name.padEnd(24)} ${parent} ${e.title || ''}`);
            if (e.branch && e.branch.rationale) console.log(`       "${e.branch.rationale}"`);
            if (e.branch && e.branch.proofIdentity) console.log(`       proof identity: ${e.branch.proofIdentity}`);
          }
          console.log(`\n${entries.length} branch(es) in ${require('../src/releases').RELEASES_DIR}`);
        }
        mSetData({
          branches: entries.map(e => ({
            name: e.name, title: e.title || null,
            status: e.branch ? e.branch.status : null,
            parent: e.branch && e.branch.parent ? e.branch.parent : null,
            rationale: e.branch && e.branch.rationale ? e.branch.rationale : null,
            proofIdentity: e.branch && e.branch.proofIdentity ? e.branch.proofIdentity : null,
          })),
        });
        return;
      }
      if (sub === 'set') {
        const name = positionals[2];
        if (!name) usageError('usage: narova branch set <name> [--status approved|rejected|archived|candidate] [--rationale "..."]');
        const status = flags.status;
        const rationale = flags.rationale;
        if (status) {
          try { validBranchStatus(status); }
          catch (error) { thrownUsageError(error); }
        }
        let branch = readBranch(name);
        let metadataWritten = false;
        if (!branch) {
          // Auto-create branch metadata for an existing release.
          branch = saveBranch(name, { rationale: rationale || '', status: status || 'exploring' });
          metadataWritten = true;
        } else {
          if (status) { setBranchStatus(name, status); branch.status = status; metadataWritten = true; }
          if (rationale) {
            branch = setBranchRationale(name, rationale);
            metadataWritten = true;
          }
        }
        console.log(`branch "${name}": status=${branch.status}${branch.rationale ? ' rationale="' + branch.rationale + '"' : ''}`);
        mData({ name, status: branch.status, rationale: branch.rationale || null });
        if (metadataWritten) mArtifact(path.join(branchDir(name), 'branch.json'), 'branch-metadata');
        return;
      }
      if (sub === 'show') {
        const name = positionals[2];
        if (!name) usageError('usage: narova branch show <name>');
        const branch = readBranch(name);
        if (!branch) { console.error(`branch "${name}" not found`); process.exit(1); }
        // Under --json the envelope supersedes the raw stored-object print
        // (NAR-015-012); the branch object moves into the data payload.
        if (machine.isActive()) mSetData(branch);
        else console.log(JSON.stringify(branch, null, 2));
        return;
      }
      usageError('usage: narova branch save|compare|list|set|show [name]');
    }

    case 'render':
      console.error('narova render was removed in 0.3.0 — use "narova compose" (generate the HyperFrames project) or "narova build" (full mp4)');
      mDiag('error', 'usage.invalid', 'narova render was removed in 0.3.0');
      process.exit(machine.EXIT.usage);
      break;

    case 'synth': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const reuse = flags.force ? false : resolveReuse(config, out, flags.reuse);
      const inputs = writeStageInputs(config, out);
      mArtifact(inputs.manifest, 'manifest');
      mArtifact(inputs.narration, 'stage-input');
      mArtifact(inputs.resolvedConfig, 'stage-input');
      if (inputs.restoreMarker) mArtifact(inputs.restoreMarker, 'restore-metadata');
      synth(out, { backend: flags.backend, reuse, projectDir, config });
      enrichTimeline(out);   // merge measured timings into manifest.json
      console.log(`synth complete -> ${out}/audio (incl. full.wav), ${out}/timings.json`);
      mData({ out, reused: !!reuse });
      if (!reuse) {
        mArtifact(path.join(out, 'audio'), 'audio');
        mArtifact(path.join(out, 'timings.json'), 'timings');
      }
      return;
    }

    case 'compose': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const renderer = getRenderer(config.renderer);
      const r = composeWithRenderer(config, out);
      mArtifact(r.dir, 'renderer-project');
      console.log(`composed ${r.scenes} scenes (${r.total}s) with ${renderer.name} -> ${r.dir}`);
      const caps = writeCaptions(config, out);
      console.log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);
      printSceneTable(config, out);
      console.log(`  qa: narova shots --beats   ·   preview: narova preview --detach   ·   release: narova build --reuse --release`);
      if (renderer.name === 'hyperframes') await refreshPreviewIfLive(out);
      mData({ scenes: r.scenes, total: r.total, renderer: renderer.name, cues: caps.cues });
      mArtifact(caps.srt, 'captions');
      mArtifact(caps.vtt || path.join(out, 'captions.vtt'), 'captions');
      if (caps.omissionPath) mArtifact(caps.omissionPath, 'caption-omission');
      return;
    }

    case 'captions': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      if (!fs.existsSync(path.join(out, 'timings.json'))) {
        console.error('captions needs out/timings.json — run `narova synth` first');
        process.exit(1);
      }
      const caps = writeCaptions(config, out);
      console.log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);
      mData({ cues: caps.cues });
      mArtifact(caps.srt, 'captions');
      mArtifact(caps.vtt || path.join(out, 'captions.vtt'), 'captions');
      if (caps.omissionPath) mArtifact(caps.omissionPath, 'caption-omission');
      return;
    }

    case 'review': {
      const modes = [flags.coverage, flags['contact-sheet'], flags.excerpt, flags.silences, flags.takes, flags['audio-levels']].filter(Boolean).length;
      if (modes === 0) {
        usageError('review needs one of --coverage | --contact-sheet | --excerpt <terms> | --silences [s] | --takes | --audio-levels');
      }
      if (modes > 1) {
        usageError('review modes are mutually exclusive');
      }
      if (flags['audio-levels']) {
        if (flags.audio === '') {
          usageError('--audio needs a non-empty file path');
        }
        if (flags.audio != null && typeof flags.audio !== 'string') {
          usageError('--audio needs a file path');
        }
        if (flags.interval != null && typeof flags.interval !== 'string') {
          usageError('--interval needs start,end seconds');
        }
        if (flags.interval != null) {
          const parts = String(flags.interval).split(',').map(s => s.trim());
          if (parts.length !== 2) {
            usageError('--interval needs start,end seconds');
          }
          const start = parts[0] === '' ? NaN : Number(parts[0]);
          const end = parts[1] === '' ? NaN : Number(parts[1]);
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
            usageError('--interval needs 0 ≤ start < end');
          }
        }
        const { projectDir } = await loadResolved(flags, { readOnly: true });
        const report = await audioLevelFacts(outDirOf(flags, projectDir), { audio: flags.audio, interval: flags.interval });
        console.log(formatAudioLevels(report));
        console.log('advisory evidence — values describe the rendered audio, not a target or verdict');
        const machineFacts = report.facts && Object.fromEntries(
          Object.entries(report.facts).map(([key, value]) => [
            key,
            value === -Infinity ? '-inf'
              : value === Infinity ? '+inf'
                : value,
          ]),
        );
        mSetData({ mode: 'audio-levels', ...report, ...(machineFacts ? { facts: machineFacts } : {}) });
        return;
      }
      if (flags.silences) {
        const threshold = flags.silences === true ? 1.0 : Number(flags.silences);
        if (!Number.isFinite(threshold) || threshold <= 0) {
          usageError('--silences needs a positive threshold in seconds, e.g. --silences 0.8');
        }
        const { config, projectDir } = await loadResolved(flags);
        const report = silenceGaps(outDirOf(flags, projectDir), { threshold });
        console.log(formatSilences(report));
        console.log('advisory evidence — a long silence may be intentional; nothing here gates or fails a build');
        mSetData({ mode: 'silences', threshold, ...report });
        return;
      }
      if (flags.takes) {
        const { config, projectDir } = await loadResolved(flags);
        const out = outDirOf(flags, projectDir);
        const timingsPath = path.join(out, 'timings.json');
        if (!fs.existsSync(timingsPath)) {
          console.error('review --takes needs out/timings.json — run `narova synth` first');
          process.exit(1);
        }
        const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
        const index = takeIndex(config, out, timings);
        console.log(formatTakes(index));
        console.log('advisory evidence — audition weak takes, then re-roll surgically with vo take: N or vary: true');
        mSetData({ mode: 'takes', ...index });
        return;
      }
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      if (flags.coverage) {
        const report = clipCoverage(config);
        console.log(formatCoverage(report));
        mSetData({ mode: 'coverage', ...report });
        return;
      }
      const timingsPath = path.join(out, 'timings.json');
      if (!fs.existsSync(timingsPath)) {
        console.error('review needs out/timings.json — run `narova synth` first');
        process.exit(1);
      }
      const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
      if (flags['contact-sheet']) {
        const sheet = contactSheet(config, out, timings);
        if (sheet.reason) console.log(`note: ${sheet.reason}`);
        if (sheet.sheet) console.log(`contact sheet -> ${sheet.sheet} (${sheet.tiles.length} scenes)`);
        if (sheet.missing.length) console.log(`no still for: ${sheet.missing.join(', ')}`);
        console.log('advisory evidence — look at it; nothing here gates or fails a build');
        mSetData({ mode: 'contact-sheet', reason: sheet.reason || null, tiles: sheet.tiles, missing: sheet.missing });
        if (sheet.sheet) mArtifact(sheet.sheet, 'contact-sheet');
        return;
      }
      const terms = String(flags.excerpt).split(',').map(s => s.trim()).filter(Boolean);
      if (terms.length === 0) {
        usageError('review --excerpt needs comma-separated terms, e.g. --excerpt "Marjaiyyah,Ijtihad"');
      }
      const excerpts = termExcerpts(config, out, timings, terms);
      if (excerpts.reason) { console.error(excerpts.reason); process.exit(1); }
      for (const e of excerpts.excerpts) console.log(`excerpt -> ${e.file}  (${e.term})`);
      if (excerpts.notFound.length) console.log(`not found in timing evidence: ${excerpts.notFound.join(', ')}`);
      console.log('advisory evidence — listen before handing off; nothing here gates or fails a build');
      mSetData({ mode: 'excerpt', excerpts: excerpts.excerpts, notFound: excerpts.notFound });
      for (const e of excerpts.excerpts) mArtifact(e.file, 'excerpt');
      return;
    }

    case 'shots': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const timingsPath = path.join(out, 'timings.json');
      if (!fs.existsSync(timingsPath)) {
        console.error('shots needs out/timings.json — run `narova synth` first');
        process.exit(1);
      }
      if (flags.proof) {
        // Invalidate any older successful proof before rendering. Recompile the
        // current source into the manifest that a later branch snapshot saves.
        clearProofReceipt(out);
        writeStageInputs(config, out);
        enrichTimeline(out);
      }
      const data = composeData(config, JSON.parse(fs.readFileSync(timingsPath, 'utf8')));
      // One QA frame per scene, mid-scene by default; --at t1,t2 overrides.
      const reviewModes = [flags.at, flags.motion, flags.beats].filter(Boolean).length;
      if (reviewModes > 1) {
        usageError('--at, --motion, and --beats are mutually exclusive');
      }
      const times = flags.at
        ? String(flags.at).split(',').map(Number)
        : flags.beats
          ? beatReviewTimes(data)
        : flags.motion
          ? motionReviewTimes(data)
        : data.scenes.map(sc => Math.round((sc.start + sc.dur / 2) * 10) / 10);
      if (times.some(t => !Number.isFinite(t))) {
        usageError('--at needs comma-separated seconds, e.g. --at 0.8,6.2,14');
      }
      const rendered = shotsWithRenderer(config, out, times);
      console.log(`frames -> ${rendered.dir}  (${times.length} @ ${times.join(', ')})`);
      mData({ times, frames: times.length, proof: !!flags.proof });
      mArtifact(rendered.dir, 'frames');
      if (flags.proof) {
        const report = auditProofFrames(rendered.dir);
        console.log(formatProofAudit(report));
        if (!report.ok) {
          mDiag('error', 'audit.proof.frames', 'sampled pilot frames were near-black or no visual evidence was rendered');
          process.exitCode = machine.EXIT.subjectNonPass;
        } else {
          try {
            const receipt = writeProofReceipt(config, out, proofContactSheets(rendered.dir), report.frames.map(frame => frame.file));
            console.log('proof receipt: pass — evidence is bound to the current config, manifest, timings, and frames');
            mData({ proofReceipt: receipt });
            mArtifact(path.join(out, '.proof-receipt.json'), 'receipt');
          } catch (error) {
            console.error(`proof receipt: FAIL — ${error.message}`);
            mDiag('error', 'gate.proof.receipt', error.message);
            process.exitCode = 1;
          }
        }
      }
      console.log('look at every frame — lint misses glyph bleed and chrome collisions; your eyes are the check');
      return;
    }

    case 'build': {
      if (flags.variant && flags.variants) {
        usageError('--variant and --variants are mutually exclusive — pick one');
      }
      const buildArtifacts = (built, out) => {
        if (!built) return;
        if (built.mp4) mArtifact(built.mp4, 'video');
        if (built.renderer === 'hyperframes') mArtifact(findHfDir(out), 'renderer-project');
        if (built.renderer === 'no-browser') mArtifact(findNoBrowserDir(out), 'renderer-project');
        if (built.revisions) mArtifact(path.join(out, 'revisions.jsonl'), 'revision-ledger');
        if (built.companion && built.companion.mp4) mArtifact(built.companion.mp4, 'video-companion');
        for (const item of built.deliverables || []) {
          if (item.mp4) mArtifact(item.mp4, 'deliverable');
          if (item.thumbnail) mArtifact(item.thumbnail, 'thumbnail');
        }
      };
      const buildOpts = {
        backend: flags.backend, reuse: flags.reuse,
        release: flags.release,
        renderer: flags.renderer,
        fps: flags.fps, quality: flags.quality,
        deliverables: flags.deliverables
          ? (flags.deliverables === true ? true : String(flags.deliverables).split(',').map(s => s.trim()).filter(Boolean))
          : undefined,
        safeAreaGuides: flags['safe-area-guides'],
        companion: flags.companion,
        artifact: mArtifact,
      };
      if (flags.variants) {
        const builtResults = [];
        // One resolved config per pass: base first, then each declared variant.
        // The sentence-level TTS cache makes shared sentences free, so each
        // extra pass only pays for the variant's scene-1 lines.
        const { raw, dir } = await loadProjectConfig(flags.project || '.', flags.config);
        const out = outDirOf(flags, dir);
        // resolveConfig no longer mutates the raw config (scenes are copied),
        // but keep the fresh-copy discipline cheap and explicit per pass.
        const fresh = () => JSON.parse(JSON.stringify(raw));
        const base = resolveConfig(fresh(), overridesFrom(flags), dir);
        const variantConfigs = base.variants.map(v => ({
          id: v.id,
          config: resolveConfig(fresh(), { ...overridesFrom(flags), variant: v.id }, dir),
        }));
        registerConfigProviderSecrets(base, flags.backend);
        for (const variant of variantConfigs) registerConfigProviderSecrets(variant.config, flags.backend);
        // Preflight every deliverable before rendering any of them. A broken
        // variant must not leave a misleading partial "release" on disk.
        if (flags.release) {
          for (const candidate of [base, ...variantConfigs.map(v => v.config)]) {
            const gateDiagnostics = [];
            if (!check(candidate, { release: true, outDir: out, diagnostics: gateDiagnostics })) {
              for (const d of gateDiagnostics) mDiag(d.severity, d.code, d.message);
              process.exitCode = machine.EXIT.subjectNonPass;
              return;
            }
          }
        }
        if (base.variants.length === 0) {
          console.log('no variants declared in config — building the base video only');
          const builtBase = build(base, { ...buildOpts, out, projectDir: dir });
          builtResults.push({ variant: null, ...builtBase });
          buildArtifacts(builtBase, out);
          verifyMotionIfRequested(builtBase, flags);
        } else {
          const builtFirst = build(base, { ...buildOpts, out, projectDir: dir });
          builtResults.push({ variant: null, ...builtFirst });
          buildArtifacts(builtFirst, out);
          verifyMotionIfRequested(builtFirst, flags);
          for (const variant of variantConfigs) {
            console.log(`\nvariant "${variant.id}": only its scene-1 sentences re-synthesize — the sentence cache covers the rest`);
            const builtVariant = build(variant.config, { ...buildOpts, out, projectDir: dir, name: `video-${variant.id}.mp4` });
            builtResults.push({ variant: variant.id, ...builtVariant });
            buildArtifacts(builtVariant, out);
            verifyMotionIfRequested(builtVariant, flags);
          }
        }
        mSetData({ builds: builtResults });
        if (base.renderer === 'hyperframes') await refreshPreviewIfLive(out);
        return;
      }
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      if (flags.release) {
        const candidates = [];
        if (flags.variant) {
          const { raw, dir } = await loadProjectConfig(flags.project || '.', flags.config);
          const baseOverrides = overridesFrom(flags);
          delete baseOverrides.variant;
          candidates.push(resolveConfig(JSON.parse(JSON.stringify(raw)), baseOverrides, dir));
        }
        candidates.push(config);
        for (const candidate of candidates) {
          const gateDiagnostics = [];
          if (!check(candidate, { release: true, outDir: out, diagnostics: gateDiagnostics })) {
            for (const d of gateDiagnostics) mDiag(d.severity, d.code, d.message);
            process.exitCode = machine.EXIT.subjectNonPass;
            return;
          }
        }
      }
      // --plan: print what this revision will rebuild before doing the work.
      // Advisory only (never changes build behavior). Makes the change scope
      // legible at build time so authors/agents can see which scenes are
      // affected without a separate `narova plan` step — directly serving
      // "fear of disturbing approved work".
      if (flags.plan) {
        const prev = lastManifest(out);
        if (prev) {
          const result = plan(prev, config, { toolVersion: require('../package.json').version });
          console.log(formatPlan(result));
          // Scene-cache preview: the same per-scene reuse decision the real
          // build will make (driven by scene-cache.plan, not just the stage
          // scope above). Read the enriched manifest on disk so timings are
          // available; if it can't be read, skip silently.
          try {
            const { read } = require('../src/manifest');
            const { plan: cachePlan, formatCacheStatus } = require('../src/scene-cache');
            const manifest = read(prev);
            const renderer = getRenderer(config.renderer);
            const cp = cachePlan({
              outDir: out, manifest,
              renderer, fps: flags.fps, quality: flags.quality,
            });
            console.log(formatCacheStatus(cp));
          } catch { /* cache preview is best-effort */ }
        } else {
          console.log('plan: no previous manifest — this is a first build');
        }
      }
      const built = build(config, {
        ...buildOpts, out, projectDir,
        name: config.variant ? `video-${config.variant}.mp4` : undefined,
      });
      buildArtifacts(built, out);
      mSetData({
        mp4: built.mp4,
        seconds: built.seconds,
        renderer: built.renderer,
        deliverables: built.deliverables || [],
        companion: built.companion || null,
        revision: built.revisions || null,
      });
      verifyMotionIfRequested(built, flags);
      if (config.renderer === 'hyperframes') await refreshPreviewIfLive(out);
      return;
    }

    case 'preview': {
      const project = path.resolve(flags.project || '.');
      const previewOut = outDirOf(flags, project);
      const pidFile = path.join(previewOut, 'preview.pid');
      if (flags.stop) {
        const stopped = await stopHfPreview(pidFile);
        console.log(stopped ? `preview stopped (${pidFile})` : 'no detached preview is running');
        mData({ stopped });
        return;
      }
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const renderer = getRenderer(config.renderer);
      if (renderer.name === 'no-browser') {
        if (flags.detach) invocationError('no-browser preview writes a draft MP4 and does not support --detach');
        const rendered = renderWithRenderer(config, out, {
          name: 'preview-no-browser.mp4', fps: flags.fps || 15, quality: flags.quality || 'draft',
        });
        console.log(`no-browser preview -> ${rendered.mp4}`);
        mData({ renderer: 'no-browser', detached: false });
        mArtifact(rendered.dir, 'renderer-project');
        mArtifact(rendered.mp4, 'video');
        return;
      }
      const webglScenes = config.scenes.filter(s => s.three || s._threeModuleContents).length;
      if (webglScenes > 12 && !flags.scene) {
        throw new Error(`${webglScenes} WebGL scenes exceed the safe full-preview context budget; use \`narova preview --scene <id>\`, \`narova shots --beats\`, or \`narova shots --motion\``);
      }
      if (flags.scene && flags.detach) {
        invocationError('isolated --scene preview currently runs in the foreground; omit --detach');
      }
      // Reject an explicit bad port before compose replaces a renderer project.
      const explicitPort = flags.port == null ? null : Number(flags.port);
      if (explicitPort != null
          && (!Number.isInteger(explicitPort) || explicitPort < 1 || explicitPort > 65535)) {
        invocationError('--port must be an integer from 1 to 65535');
      }
      const r = flags.scene
        ? renderer.composeScene(config, out, String(flags.scene))
        : composeWithRenderer(config, out);
      if (flags.detach) {
        // A live Studio keeps serving the directory compose just replaced, so
        // re-running preview --detach means "show me the new build": stop the
        // stale server and start fresh on its port (compose already ran above).
        const stale = livePreviewPid(pidFile);
        const rememberedPort = previewPort(pidFile);
        const rememberedIntent = previewPortIntent(pidFile);
        if (stale) {
          console.log(`restarting Studio (was pid ${stale}) — detached previews do not hot-reload`);
          await stopHfPreview(pidFile);
        }
        const p = await startHfPreview(r.dir, {
          ...(explicitPort == null
            ? (rememberedIntent === 'explicit' && rememberedPort != null
              ? { port: rememberedPort }
              : { startPort: rememberedPort ?? 3002 })
            : { port: explicitPort }),
          logFile: path.join(out, 'preview.log'), pidFile,
          projectName: projectSlug(config),
        });
        console.log(`Studio running -> ${p.url}`);
        console.log(`  pid ${p.pid} · log ${p.logFile} · stop: narova preview --stop --project ${projectDir}`);
        mSetData({ renderer: 'hyperframes', detached: true, url: p.url, pid: p.pid, port: p.port });
        mArtifact(r.dir, 'renderer-project');
        mArtifact(pidFile, 'preview-state');
        mArtifact(p.portFile, 'preview-state');
        mArtifact(p.intentFile, 'preview-state');
        mArtifact(p.stateFile, 'preview-state');
        mArtifact(p.logFile, 'preview-log');
      } else {
        const port = explicitPort || 3002;
        if (!Number.isInteger(port) || port < 1 || port > 65535) invocationError('--port must be an integer from 1 to 65535');
        console.log(`composed -> ${r.dir}`);
        console.log(`Studio -> ${previewUrl(r.dir, port, projectSlug(config))} (Ctrl-C to stop)`);
        mSetData({ renderer: 'hyperframes', detached: false, url: previewUrl(r.dir, port, projectSlug(config)), port });
        mArtifact(r.dir, 'renderer-project');
        runHf(['preview', '--port', String(port)], r.dir);
      }
      return;
    }

    case 'renderers': {
      const sub = positionals[1] || 'list';
      if (sub === 'list') {
        const renderers = listRenderers();
        for (const renderer of renderers) {
          const mode = renderer.browserless ? 'browserless' : 'browser';
          console.log(`${renderer.name}\t${renderer.providerVersion}\tlocal · ${mode}`);
        }
        mSetData({ renderers });
        return;
      }
      if (sub === 'doctor') {
        const name = positionals[2];
        if (!name) usageError('usage: narova renderers doctor <hyperframes|no-browser>');
        let renderer;
        try { renderer = getRenderer(name); }
        catch (error) { thrownUsageError(error); }
        const report = renderer.doctor();
        for (const check of report.checks) {
          const mark = check.ok === null ? '·' : (check.ok ? '✓' : '✗');
          console.log(`${mark} ${check.name}: ${check.detail}`);
        }
        mSetData({ renderer: name, ...report });
        if (!report.ok) {
          mDiag('error', 'health.renderer', `renderer ${name} did not pass its local requirement checks`);
          process.exitCode = machine.EXIT.subjectNonPass;
        }
        return;
      }
      usageError('usage: narova renderers list|doctor [name]');
      return;
    }

    case 'voices': {
      const sub = positionals[1] || 'list';
      if (!['list', 'get'].includes(sub)) usageError('usage: narova voices list|get [voice]');
      if (sub === 'get' && !positionals[2]) usageError('usage: voices get <name> --backend piper');
      if (machine.isActive() && flags.backend) {
        const external = getSpeechProvider(String(flags.backend));
        if (external) registerProviderSecrets(external);
      }
      const py = findPython(flags.project || '.');
      const args = ['-m', 'narova_tts', 'voices', sub, ...positionals.slice(2)];
      if (flags.backend) args.push('--backend', flags.backend);
      const r = spawnSync(py, args, {
        ...(machine.isActive()
          ? { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
          : { stdio: 'inherit' }),
        env: { ...process.env, PYTHONPATH: path.join(__dirname, '..', 'py') },
      });
      if (r.error) { console.error(`voices failed to launch (${py}): ${r.error.message}`); process.exit(1); }
      if (machine.isActive()) {
        const stdout = machine.redact(String(r.stdout || ''));
        const stderr = machine.redact(String(r.stderr || ''));
        if (stdout) process.stderr.write(stdout);
        if (stderr) process.stderr.write(stderr);
        mSetData({ subcommand: sub, backend: flags.backend || null, output: stdout.trim() });
        if (r.status === machine.EXIT.usage) {
          mDiag('error', 'usage.invalid', stderr.trim() || stdout.trim() || 'invalid voices invocation');
        }
      }
      process.exitCode = r.status === machine.EXIT.usage
        ? machine.EXIT.usage
        : (r.status === machine.EXIT.success ? machine.EXIT.success : machine.EXIT.failure);
      return;
    }

    case 'providers': {
      const sub = positionals[1] || 'list';
      if (sub === 'list') {
        const entries = listProviders();
        // NAR-018-068 — surface declared delivery-control capabilities. Built-in
        // backends declare too, so one command shows the whole speech surface.
        const builtins = [...builtinNames()].sort();
        if (entries.length === 0) {
          console.log(`no external providers registered (${providersDir()})`);
        } else {
          for (const provider of entries) {
            const version = provider.providerVersion ? ` ${provider.providerVersion}` : '';
            const kind = providerKind(provider);
            const capability = kind === 'speech'
              ? (provider.capabilities.voiceListing ? 'voices' : 'no-voice-list')
              : 'video generation';
            console.log(`${provider.name.padEnd(20)} ${provider.displayName}${version}  ${provider.protocol}  ${capability}`);
            if (kind === 'speech' && provider.deliveryCapabilities) {
              const declared = Object.entries(provider.deliveryCapabilities)
                .map(([family, status]) => `${family}:${status}`).join('  ');
              console.log(`${' '.repeat(20)} delivery: ${declared}`);
            } else if (kind === 'speech') {
              console.log(`${' '.repeat(20)} delivery: (undeclared — every family reads as unknown)`);
            }
          }
        }
        console.log(`\nbuilt-in backends: ${builtins.join(', ')}`);
        for (const name of builtins) {
          const caps = deliveryCapabilitiesFor(name);
          const declared = caps ? Object.entries(caps).map(([family, status]) => `${family}:${status}`).join('  ') : '(unknown)';
          console.log(`${name.padEnd(20)} ${BUILTIN_BACKENDS[name].displayName}  delivery: ${declared}`);
        }
        console.log('\ndelivery statuses are disclosures, not restrictions — they tell you what each backend honors before you burn a render');
        mSetData({ providers: entries.map(publicProviderData), builtins: builtins.map(name => ({
          name,
          displayName: BUILTIN_BACKENDS[name].displayName,
          deliveryCapabilities: deliveryCapabilitiesFor(name),
        })) });
        return;
      }
      if (sub === 'add') {
        const manifest = positionals[2];
        if (!manifest) usageError('usage: narova providers add <provider-manifest.json>');
        const added = addProvider(manifest, { beforeHandshake: registerProviderSecrets });
        console.log(`provider "${added.name}" registered -> ${path.join(providersDir(), `${added.name}.json`)}`);
        if (added.missingEnvironment.length) {
          console.log(`  set before use: ${added.missingEnvironment.join(', ')}`);
        }
        mSetData({ provider: publicProviderData(added) });
        mArtifact(path.join(providersDir(), `${added.name}.json`), 'provider-registry');
        return;
      }
      if (sub === 'remove') {
        const name = positionals[2];
        if (!name) usageError('usage: narova providers remove <name>');
        if (!isProviderName(name)) invocationError('provider name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens');
        removeProvider(name);
        console.log(`provider "${name}" unregistered`);
        mSetData({ name, removed: true });
        return;
      }
      if (sub === 'doctor') {
        const name = positionals[2];
        if (!name) usageError('usage: narova providers doctor <name>');
        if (!isProviderName(name)) invocationError('provider name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens');
        const result = doctorProvider(name, { beforeHandshake: registerProviderSecrets });
        console.log(`worker ok: ${name} ${result.hello.providerVersion} speaks ${result.hello.protocol}`);
        if (result.missingEnvironment.length) {
          console.error(`missing required environment: ${result.missingEnvironment.join(', ')}`);
          mDiag('error', 'health.provider', `provider ${name} is missing required environment`, name);
          process.exitCode = machine.EXIT.subjectNonPass;
        }
        mSetData({
          name,
          hello: publicProviderHello(result.hello),
          missingEnvironment: result.missingEnvironment,
        });
        return;
      }
      usageError('usage: narova providers add|list|remove|doctor [manifest-or-name]');
      return;
    }

    case 'voice': {
      const sub = positionals[1];
      if (!sub || sub === 'help') {
        console.log('narova voice sample — manage clone recordings for the chatterbox backend\n');
        console.log('  voice sample add <file> <name>     save <file> as a named clone sample');
        console.log('  voice sample list                  list saved clone samples');
        console.log('  voice sample remove <name>         remove a saved clone sample\n');
        console.log('After adding a sample, use chatterbox by name in reel.config:');
        console.log('  voices: { a: { backend: "chatterbox", speaker: "my-voice" } }\n');
        console.log(`Samples live in ~/.narova/samples/`);
        return;
      }
      if (sub !== 'sample') usageError('unknown voice subcommand — use "voice sample"');
      const action = positionals[2];
      try {
        switch (action) {
          case 'add': {
            const file = positionals[3];
            const name = positionals[4];
            if (!file) usageError('usage: narova voice sample add <file> <name>');
            const dest = addSample(file, name || path.basename(file, path.extname(file)));
            console.log(`sample "${path.basename(dest, path.extname(dest))}" saved -> ${dest}`);
            console.log('\nUse it in reel.config:');
            console.log(`  voices: { a: { backend: "chatterbox", speaker: "${path.basename(dest, path.extname(dest))}" } }`);
            mSetData({ name: path.basename(dest, path.extname(dest)), path: dest });
            mArtifact(dest, 'voice-sample');
            return;
          }
          case 'list': {
            const samples = listSamples();
            if (samples.length === 0) {
              console.log('No voice samples saved yet.\n');
              console.log('Add one: narova voice sample add <path-to-audio> my-voice');
              console.log('(chatterbox needs 10–20s of clean speech — .wav, .mp3, .flac, or .m4a)');
            } else {
              console.log(`Voice samples (${samples.length}):\n`);
              for (const s of samples) {
                console.log(`  ${s.name.padEnd(20)} ${(s.size / 1024).toFixed(0).padStart(5)} KB  ${s.ext}`);
              }
              console.log(`\nUse by name: speaker: "${samples[0].name}"`);
            }
            mSetData({ samples });
            return;
          }
          case 'remove': {
            const name = positionals[3];
            if (!name) usageError('usage: narova voice sample remove <name>');
            const removed = removeSample(name);
            console.log(`removed sample "${path.basename(removed, path.extname(removed))}"`);
            mSetData({ name: path.basename(removed, path.extname(removed)), removed: true });
            return;
          }
          default:
            usageError('unknown action — use add, list, or remove');
        }
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
      }
    }

    case 'doctor': {
      const rows = [];
      const ok = doctor(flags.project || '.', { collect: rows });
      mSetData({ ok, checks: rows });
      if (!ok) {
        mDiag('error', 'health.doctor', 'one or more required tools are missing or unusable');
        process.exitCode = machine.EXIT.subjectNonPass;
      }
      return;
    }

    case 'karaoke': {
      const sub = positionals[1];
      if (sub !== 'generate') {
        usageError('usage: narova karaoke generate <audio-file> [--transcript <file>]');
      }
      const audioFile = positionals[2];
      if (!audioFile) {
        usageError('usage: narova karaoke generate <audio-file> [--transcript <file>]');
      }
      const audioPath = path.resolve(audioFile);
      if (!fs.existsSync(audioPath)) {
        console.error(`audio file not found: ${audioPath}`);
        process.exit(1);
      }
      try {
        const result = generateKaraoke(audioPath, {
          projectDir: flags.project || '.',
          transcript: flags.transcript,
          engine: flags.engine,
          outDir: flags.out || path.dirname(audioPath),
          maxWords: flags['max-words'] ? Number(flags['max-words']) : undefined,
        });
        mSetData({ cues: result.cues });
        mArtifact(result.karaokePath, 'captions');
        mArtifact(result.srtPath, 'captions');
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
      }
      return;
    }

    case 'retime': {
      const configFile = positionals[1];
      const karaokeFile = positionals[2];
      if (!configFile || !karaokeFile) {
        usageError('usage: narova retime <reel.config.mjs> <captions-karaoke.json> [--apply]');
      }
      try {
        const result = retime(configFile, karaokeFile, {
          log: console.log,
          apply: flags.apply,
        });
        mSetData({ applied: !!flags.apply, scenes: result });
        if (flags.apply) mArtifact(path.resolve(configFile), 'authoring-source');
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
      }
      return;
    }

    case 'generate': {
      // Minimal early help: only when there is no prompt AND no --regenerate.
      if (!positionals[1] && !flags.regenerate) {
        const lines = [
          'usage: narova generate <prompt> --provider <registered-name> [--output <path>]',
          '       narova generate --regenerate <existing-clip.mp4> [new prompt] [overrides]',
          '',
          'Registered video providers:',
        ];
        const videos = listProviders(VIDEO_PROVIDER_PROTOCOL);
        if (videos.length) {
          for (const provider of videos) lines.push(`  ${provider.name.padEnd(12)} ${provider.displayName}`);
        } else lines.push('  (none — install narova-openai for Sora, narova-runway for Runway, or narova-google for Veo, then register its video manifest)');
        usageError(...lines);
      }
      try {
        const { dir: projectDir } = await loadProjectConfig(flags.project || '.', flags.config);
        readAssetLock(projectDir);
        const assetsDir = path.join(projectDir, 'assets');
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

        // --regenerate <mp4>: re-run a previous generation from its .gen.json
        // spec sidecar, overriding any of prompt/provider/model/size/duration.
        // Lets an author say "regenerate this shot, same composition, rainy"
        // without losing the original generative intent.
        let baseSpec = null;
        if (flags.regenerate) {
          const regenPath = path.resolve(projectDir, flags.regenerate);
          if (!fs.existsSync(regenPath)) {
            console.error(`--regenerate: asset not found: ${regenPath}`);
            process.exit(1);
          }
          baseSpec = readSpec(regenPath);
          if (!baseSpec) {
            console.error(`--regenerate: no .gen.json spec sidecar found for ${regenPath} (only assets created by \`narova generate\` carry one)`);
            process.exit(1);
          }
          console.log(`regenerating from spec: ${path.basename(regenPath).replace(/\.(mp4|webm|mov)$/i, '')}.gen.json`);
        }

        const provider = String(flags.provider || (baseSpec && baseSpec.provider) || 'sora');
        if (!isProviderName(provider)) {
          usageError('video provider name must start with a lowercase letter and contain only lowercase letters, digits, and hyphens');
        }
        const info = getVideoProvider(provider);
        if (!info) {
          console.error(`video provider "${provider}" is not registered`);
          console.error('install its companion, then run `narova providers add <video-provider-manifest.json>`');
          process.exit(1);
        }
        registerProviderSecrets(info);
        const prompt = positionals[1] || (baseSpec && baseSpec.prompt);
        if (!prompt) {
          usageError(
            'usage: narova generate <prompt> --provider <registered-name> [--output <path>]',
            '       narova generate --regenerate <existing-clip.mp4> [--provider ..] [new prompt]',
          );
        }

        const params = {};
        if (flags.model) params.model = flags.model;
        if (flags.size) params.size = flags.size;
        if (flags.duration) params.duration = Number(flags.duration);
        if (baseSpec && baseSpec.params) {
          // Inherit unspecified params from the source spec so a regeneration
          // reproduces the original composition by default.
          for (const [k, v] of Object.entries(baseSpec.params)) {
            if (params[k] == null) params[k] = v;
          }
        }

        const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const output = flags.output
          ? path.resolve(projectDir, flags.output)
          : (baseSpec
            ? path.resolve(path.dirname(flags.regenerate
                ? path.resolve(projectDir, flags.regenerate) : projectDir), baseSpec.artifact)
            : path.join(assetsDir, `gen-${provider}-${slug}.mp4`));
        await generate(provider, prompt, output, assetsDir, { params, projectDir, providerManifest: info });
        console.log(`Add to reel.config.mjs:  clip: "assets/${path.basename(output)}"`);
        if (readSpec(output)) {
          console.log(`Generative spec:        assets/${path.basename(output).replace(/\.(mp4|webm|mov)$/i, '')}.gen.json (edit/regenerate from here)`);
        }
        const specPath = output.replace(/\.(mp4|webm|mov)$/i, '.gen.json');
        const generatedSpec = readSpec(output);
        mSetData({
          provider,
          providerProtocol: generatedSpec && generatedSpec.providerProtocol,
          providerVersion: generatedSpec && generatedSpec.providerVersion,
          output,
          spec: fs.existsSync(specPath) ? specPath : null,
        });
        mArtifact(output, 'generated-media');
        if (fs.existsSync(specPath)) mArtifact(specPath, 'generation-recipe');
        mArtifact(path.join(projectDir, 'assets.lock.json'), 'registry');
      } catch (e) {
        console.error(`generate failed: ${e.message}`);
        process.exit(1);
      }
      return;
    }

    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      mDiag('error', 'usage.invalid', `unknown command: ${cmd}`);
      process.exit(machine.EXIT.usage);
  }
}

main().catch(err => {
  if (err.code === 'NAROVA_USAGE') {
    thrownUsageError(err);
    return;
  }
  console.error('error:', terminalSafe(err.message));
  if (err.code === 'NAROVA_SUBJECT_NON_PASS') {
    for (const diagnostic of err.diagnostics || []) {
      mDiag(diagnostic.severity, diagnostic.code, diagnostic.message, diagnostic.subject);
    }
    process.exit(machine.EXIT.subjectNonPass);
  }
  process.exit(machine.EXIT.failure);
});
