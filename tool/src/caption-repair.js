'use strict';

/* The first Video CI repair policy is intentionally small. It can only rebuild
 * caption sidecars from already measured timings, and it can only publish an
 * unapproved proof-branch candidate after a focused re-judgement aligns. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { writeCaptions, buildSrt, buildVtt } = require('./captions');
const { composeData } = require('./compose/data');
const { judge, compareProbe } = require('./judge');
const {
  captureBranchExperiment, branchExperimentIdentity, normalizeObservation,
} = require('./branch-experiment');
const { writeVideoCiBinding } = require('./video-ci-binding');
const { hashFile } = require('./manifest');
const { verifyProofBundle } = require('./proof-receipt');

const SCHEMA = 'narova.repair-candidate/1';
const POLICY = 'caption-sidecar-rebuild/v1';
const SHA256 = /^[a-f0-9]{64}$/;
const ELIGIBLE_CLASSES = new Set(['mechanical', 'accessibility']);
const PROTECTED_KEYS = [
  'encodedArtifact', 'resolvedConfig', 'effectiveConfig', 'manifest', 'timings',
  'proof', 'snapshotSource', 'nonCaptionEvidence', 'sceneState',
];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function repairCandidateIdentity(record) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(record))).digest('hex');
}

function valueIdentity(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function byteIdentity(value) {
  const bytes = Buffer.from(value, 'utf8');
  return {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function focused(report, assertionId) {
  const assertion = (report.assertions || []).find(item => item && item.id === assertionId);
  if (!assertion) throw new Error(`assertion "${assertionId}" was not found in the resolved project`);
  const observations = (report.observations || []).filter(item => (
    item && item.assertion && item.assertion.id === assertionId
      && item.assessmentTarget !== 'free-form-correspondence'
  ));
  if (observations.length !== 1) {
    throw new Error(`assertion "${assertionId}" does not have one focused judgement observation`);
  }
  return { assertion, observation: observations[0] };
}

function readBoundSource(binding, key) {
  const source = binding && binding.context && binding.context[key];
  if (!source || source.available !== true || !SHA256.test(String(source.sha256 || ''))
      || !Number.isInteger(source.bytes) || source.bytes < 0 || source.content == null) {
    throw new Error(`caption repair needs available receipt-bound ${key} evidence`);
  }
  return source;
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function validateJsonSnapshot(source, file, label) {
  const bytes = fs.readFileSync(file);
  const current = {
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
  if (source.bytes !== current.bytes || source.sha256 !== current.sha256) {
    throw new Error(`${label} does not match the canonical evidence receipt`);
  }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error(`${label} is not valid JSON`); }
  if (!sameValue(source.content, parsed)) {
    throw new Error(`${label} snapshot content does not match its receipt identity`);
  }
}

function validateCaptionSnapshots(binding) {
  const captions = binding && binding.context && binding.context.captions;
  if (!Array.isArray(captions)) throw new Error('caption repair evidence receipt has invalid caption context');
  for (const source of captions) {
    if (!source || source.available !== true || typeof source.content !== 'string') {
      throw new Error('caption repair cannot use unavailable receipt-bound caption evidence');
    }
    if (!['srt', 'vtt'].includes(source.format) || !SHA256.test(String(source.sha256 || ''))
        || !Number.isInteger(source.bytes) || source.bytes < 0) {
      throw new Error('caption repair evidence receipt has invalid caption context');
    }
    const actual = byteIdentity(source.content);
    if (source.bytes !== actual.bytes || source.sha256 !== actual.sha256) {
      throw new Error('caption repair caption snapshot content does not match its receipt identity');
    }
  }
  return captions;
}

function loadBinding(report) {
  const source = report.sources && report.sources.evidenceBinding;
  if (!source || source.used !== true || !source.path || !SHA256.test(String(source.sha256 || ''))) {
    throw new Error('caption repair needs a matching canonical video evidence receipt');
  }
  if (hashFile(source.path) !== source.sha256) {
    throw new Error('caption repair evidence receipt changed after baseline judgement');
  }
  const document = JSON.parse(fs.readFileSync(source.path, 'utf8'));
  return { source, document };
}

function assertEligibility(config, report, assertionId, verifiedProof, binding) {
  const { assertion, observation } = focused(report, assertionId);
  if (!ELIGIBLE_CLASSES.has(assertion.class)) {
    throw new Error('caption repair accepts only mechanical or accessibility assertions');
  }
  if (config.captionsEnabled === false) {
    throw new Error('caption repair is unavailable because captions are disabled');
  }
  const probes = assertion.observe || [];
  if (!probes.some(probe => probe.metric === 'caption.word_count')) {
    throw new Error('caption repair needs a caption.word_count probe');
  }
  if (observation.outcome !== 'UNCERTAIN') {
    throw new Error('caption repair needs a focused UNCERTAIN observation');
  }
  for (const probe of probes) {
    const row = (observation.evidence || []).find(item => item.metric === probe.metric);
    if (!row) throw new Error(`caption repair cannot establish probe evidence for ${probe.metric}`);
    if (probe.metric === 'caption.word_count') {
      if (row.availability !== 'unavailable' || row.value != null) {
        throw new Error('caption repair needs caption uncertainty caused by unavailable or invalid captions');
      }
    } else if (row.availability !== 'available' || compareProbe(row.value, probe) !== true) {
      throw new Error('caption repair uncertainty is not caused only by caption availability');
    }
  }
  if (!verifiedProof || !verifiedProof.ok || !verifiedProof.receipt) {
    throw new Error('caption repair needs a current valid proof receipt');
  }
  validateCaptionSnapshots(binding);
  return { assertion, observation };
}

function exactCopy(source, destination, expectedSha256, label) {
  if (hashFile(source) !== expectedSha256) throw new Error(`${label} does not match the canonical evidence receipt`);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  if (hashFile(destination) !== expectedSha256) throw new Error(`${label} changed while being staged`);
}

function protectedIdentity(before, after) {
  return { before, after, match: before === after };
}

function prepareCaptionRepair({
  config, baselineJudgement, assertionId, verifiedProof, proofBundle,
  metadataDir, snapshotDir, projectDir, outDir, configFile,
}) {
  const { source: bindingSource, document: binding } = loadBinding(baselineJudgement);
  const { observation: beforeObservation } = assertEligibility(
    config, baselineJudgement, assertionId, verifiedProof, binding,
  );
  const boundManifest = readBoundSource(binding, 'manifest');
  const boundTimings = readBoundSource(binding, 'timings');
  validateJsonSnapshot(boundManifest, path.join(outDir, 'manifest.json'), 'manifest');
  validateJsonSnapshot(boundTimings, path.join(outDir, 'timings.json'), 'timings');
  if (verifiedProof.receipt.timingsSha256 !== boundTimings.sha256) {
    throw new Error('caption repair timing evidence does not match the current proof');
  }
  if (verifiedProof.receipt.manifestSha256 !== boundManifest.sha256) {
    throw new Error('caption repair manifest evidence does not match the current proof');
  }

  const work = fs.mkdtempSync(path.join(metadataDir, '.caption-repair-staging-'));
  const candidateOut = path.join(work, 'out');
  fs.mkdirSync(candidateOut);
  const artifactName = `artifact${path.extname(baselineJudgement.artifact.path).toLowerCase() || '.media'}`;
  const candidateVideo = path.join(candidateOut, artifactName);
  try {
    exactCopy(baselineJudgement.artifact.path, candidateVideo,
      baselineJudgement.artifact.sha256, 'encoded artifact');
    exactCopy(path.join(outDir, 'manifest.json'), path.join(candidateOut, 'manifest.json'),
      boundManifest.sha256, 'manifest');
    exactCopy(path.join(outDir, 'timings.json'), path.join(candidateOut, 'timings.json'),
      boundTimings.sha256, 'timings');

    const captions = writeCaptions(config, candidateOut);
    if (captions.omitted || captions.cues < 1) {
      throw new Error('caption repair measured timings did not derive any caption cues');
    }
    const bindingPath = writeVideoCiBinding(candidateVideo, {
      outDir: candidateOut, projectDir: work,
      sceneState: binding.context.sceneState || [],
    });
    const candidateBinding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    const candidateJudgement = judge(config, {
      projectDir, outDir: candidateOut, configFile, video: candidateVideo,
    });
    const { observation: afterObservation } = focused(candidateJudgement, assertionId);
    if (afterObservation.outcome !== 'ALIGNED') {
      throw new Error(`caption repair candidate did not align assertion "${assertionId}"`);
    }

    const contextFiles = [
      { file: captions.srt, name: 'captions.srt', role: 'captions' },
      { file: captions.vtt, name: 'captions.vtt', role: 'captions' },
      { file: bindingPath, name: `${artifactName}.narova-ci.json`, role: 'video-ci-evidence' },
    ];
    const videoCi = captureBranchExperiment(
      candidateJudgement, assertionId, metadataDir, projectDir, { contextFiles },
    );
    const videoCiIdentity = branchExperimentIdentity(videoCi);
    const storedContext = Object.fromEntries(videoCi.contextArtifacts.map(item => [path.basename(item.path), item]));
    const afterCaptions = ['captions.srt', 'captions.vtt'].map(name => storedContext[name]);
    const beforeCaptions = (binding.context.captions || []).map(item => ({
      format: item.format || null,
      bytes: item.bytes,
      sha256: item.sha256,
      available: item.available,
      reason: item.reason || null,
    }));

    const proofReceipt = verifiedProof.receipt;
    const evidenceIdentity = valueIdentity(proofBundle.evidenceHashes);
    const protectedIdentities = {
      encodedArtifact: protectedIdentity(baselineJudgement.artifact.sha256, candidateJudgement.artifact.sha256),
      resolvedConfig: protectedIdentity(proofReceipt.configResolvedSha256, proofReceipt.configResolvedSha256),
      effectiveConfig: protectedIdentity(proofReceipt.configSha256, proofReceipt.configSha256),
      manifest: protectedIdentity(boundManifest.sha256, candidateBinding.context.manifest.sha256),
      timings: protectedIdentity(boundTimings.sha256, candidateBinding.context.timings.sha256),
      proof: protectedIdentity(proofBundle.proofIdentity, proofBundle.proofIdentity),
      snapshotSource: protectedIdentity(proofBundle.snapshotIdentity, proofBundle.snapshotIdentity),
      nonCaptionEvidence: protectedIdentity(evidenceIdentity, evidenceIdentity),
      sceneState: protectedIdentity(
        valueIdentity(binding.context.sceneState || []),
        valueIdentity(candidateBinding.context.sceneState || []),
      ),
    };
    if (PROTECTED_KEYS.some(key => !protectedIdentities[key].match
        || protectedIdentities[key].before == null || protectedIdentities[key].after == null)) {
      throw new Error('caption repair changed a protected production identity');
    }
    if (hashFile(path.join(snapshotDir, 'manifest.json')) !== boundManifest.sha256
        || hashFile(path.join(snapshotDir, 'timings.json')) !== boundTimings.sha256) {
      throw new Error('caption repair snapshot changed during staging');
    }

    const repairCandidate = {
      schema: SCHEMA,
      policy: POLICY,
      purpose: 'unapproved branch-isolated caption repair candidate',
      creatorAuthority: 'creator',
      approval: null,
      selection: null,
      focusAssertion: assertionId,
      artifact: {
        baseline: { bytes: baselineJudgement.artifact.bytes, sha256: baselineJudgement.artifact.sha256 },
        candidate: { bytes: candidateJudgement.artifact.bytes, sha256: candidateJudgement.artifact.sha256 },
        identical: baselineJudgement.artifact.sha256 === candidateJudgement.artifact.sha256
          && baselineJudgement.artifact.bytes === candidateJudgement.artifact.bytes,
      },
      observations: {
        before: normalizeObservation(beforeObservation, projectDir, path.resolve(baselineJudgement.artifact.path)),
        after: videoCi.observation,
      },
      captions: { before: beforeCaptions, after: afterCaptions },
      protectedIdentities,
      allProtectedIdentitiesMatch: true,
    };
    return {
      videoCi, videoCiIdentity, repairCandidate,
      repairCandidateIdentity: repairCandidateIdentity(repairCandidate),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    if (hashFile(bindingSource.path) !== bindingSource.sha256) {
      throw new Error('caption repair evidence receipt changed during staging');
    }
  }
}

function inside(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) return null;
  const file = path.resolve(root, relative);
  const rel = path.relative(root, file);
  return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) ? file : null;
}

function verifyCaptionRepair(metadataDir, record, expectedIdentity, branch, snapshotDir) {
  try {
    if (!record || record.schema !== SCHEMA || record.policy !== POLICY
        || repairCandidateIdentity(record) !== expectedIdentity) return false;
    if (record.creatorAuthority !== 'creator' || record.approval !== null || record.selection !== null) return false;
    if (!branch || !branch.videoCi || record.focusAssertion !== branch.videoCi.focusAssertion) return false;
    if (!snapshotDir || !verifyProofBundle(metadataDir, snapshotDir, branch)) return false;
    if (!record.artifact || record.artifact.identical !== true
        || record.artifact.baseline.sha256 !== record.artifact.candidate.sha256
        || record.artifact.candidate.sha256 !== branch.videoCi.artifact.sha256) return false;
    if (!record.observations || record.observations.before.outcome !== 'UNCERTAIN'
        || record.observations.after.outcome !== 'ALIGNED'
        || JSON.stringify(record.observations.after) !== JSON.stringify(branch.videoCi.observation)) return false;
    if (!record.captions || !Array.isArray(record.captions.after)
        || record.captions.after.length !== 2) return false;
    const formats = new Set();
    for (const item of record.captions.after) {
      if (!item || item.role !== 'captions' || !SHA256.test(String(item.sha256 || ''))
          || !Number.isInteger(item.bytes) || item.bytes < 1) return false;
      const file = inside(metadataDir, item.path);
      if (!file || path.dirname(file) !== path.join(metadataDir, 'video-ci')) return false;
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || hashFile(file) !== item.sha256) return false;
      formats.add(path.extname(file).toLowerCase());
    }
    if (!formats.has('.srt') || !formats.has('.vtt')) return false;

    const receiptFile = inside(metadataDir, branch.proofReceipt);
    if (!receiptFile || hashFile(receiptFile) !== branch.proofReceiptSha256) return false;
    const proofReceipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    const context = branch.videoCi.contextArtifacts || [];
    if (context.length !== 3) return false;
    const bindingArtifact = context.find(item => item.role === 'video-ci-evidence');
    const captionArtifacts = context.filter(item => item.role === 'captions');
    if (!bindingArtifact || captionArtifacts.length !== 2) return false;
    const bindingFile = inside(metadataDir, bindingArtifact.path);
    if (!bindingFile || hashFile(bindingFile) !== bindingArtifact.sha256) return false;
    if (!branch.videoCi.evidenceBinding
        || branch.videoCi.evidenceBinding.sha256 !== bindingArtifact.sha256) return false;
    const binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
    if (!binding.artifact || binding.artifact.sha256 !== branch.videoCi.artifact.sha256
        || binding.artifact.bytes !== branch.videoCi.artifact.bytes) return false;
    const boundManifest = readBoundSource(binding, 'manifest');
    const boundTimings = readBoundSource(binding, 'timings');
    const proofManifest = inside(metadataDir, proofReceipt.manifestPath);
    const proofTimings = inside(metadataDir, proofReceipt.timingsPath);
    const proofConfig = inside(metadataDir, proofReceipt.configPath);
    if (!proofManifest || !proofTimings || !proofConfig) return false;
    validateJsonSnapshot(boundManifest, proofManifest, 'stored manifest');
    validateJsonSnapshot(boundTimings, proofTimings, 'stored timings');
    const boundCaptions = validateCaptionSnapshots(binding);
    const expectedCaptionHashes = captionArtifacts.map(item => item.sha256).sort();
    const boundCaptionHashes = boundCaptions.map(item => item.sha256).sort();
    if (JSON.stringify(expectedCaptionHashes) !== JSON.stringify(boundCaptionHashes)) return false;
    const derived = composeData(
      JSON.parse(fs.readFileSync(proofConfig, 'utf8')),
      JSON.parse(fs.readFileSync(proofTimings, 'utf8')),
    );
    const expectedCaptionText = { srt: buildSrt(derived), vtt: buildVtt(derived) };
    for (const item of captionArtifacts) {
      const format = path.extname(item.path).slice(1).toLowerCase();
      const file = inside(metadataDir, item.path);
      if (!expectedCaptionText[format]
          || fs.readFileSync(file, 'utf8') !== expectedCaptionText[format]) return false;
    }

    if (record.allProtectedIdentitiesMatch !== true) return false;
    if (JSON.stringify(Object.keys(record.protectedIdentities || {}).sort())
        !== JSON.stringify(PROTECTED_KEYS.slice().sort())) return false;
    for (const value of Object.values(record.protectedIdentities)) {
      if (!value || value.match !== true || value.before == null || value.before !== value.after) return false;
    }
    const expectedProtected = {
      encodedArtifact: branch.videoCi.artifact.sha256,
      resolvedConfig: proofReceipt.configResolvedSha256,
      effectiveConfig: proofReceipt.configSha256,
      manifest: proofReceipt.manifestSha256,
      timings: proofReceipt.timingsSha256,
      proof: branch.proofIdentity,
      snapshotSource: branch.snapshotIdentity,
      nonCaptionEvidence: valueIdentity(branch.evidenceHashes),
    };
    for (const [key, expected] of Object.entries(expectedProtected)) {
      if (!SHA256.test(String(expected || ''))
          || record.protectedIdentities[key].before !== expected) return false;
    }
    return true;
  } catch { return false; }
}

function formatCaptionRepair(candidate, branchName) {
  return [
    `REPAIR CANDIDATE — ${branchName}`,
    `Policy: ${candidate.policy}`,
    `Assertion: ${candidate.focusAssertion}`,
    `Before: ${candidate.observations.before.outcome} — ${candidate.observations.before.observed}`,
    `After: ${candidate.observations.after.outcome} — ${candidate.observations.after.observed}`,
    `Changed: ${candidate.captions.after.map(item => path.basename(item.path)).join(', ')}`,
    `Protected identities: ${candidate.allProtectedIdentitiesMatch ? 'unchanged' : 'changed'}`,
    'Current production: unchanged.',
    'Status: unapproved candidate. The creator may compare, approve, reject, archive, or discard it.',
  ].join('\n');
}

module.exports = {
  SCHEMA, POLICY, repairCandidateIdentity, prepareCaptionRepair,
  verifyCaptionRepair, formatCaptionRepair,
};
