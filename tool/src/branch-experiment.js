'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashFile } = require('./manifest');

const RECORD_SCHEMA = 'narova.branch-video-ci/1';
const COMPARISON_SCHEMA = 'narova.branch-comparison/1';
const SHA256 = /^[a-f0-9]{64}$/;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function branchExperimentIdentity(record) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(record))).digest('hex');
}

function within(root, relative) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) return null;
  const file = path.resolve(root, relative);
  const rel = path.relative(root, file);
  return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) ? file : null;
}

function projectPath(value, projectDir, artifactPath) {
  if (typeof value !== 'string') return value;
  if (path.resolve(value) === artifactPath) return 'artifact';
  if (!path.isAbsolute(value)) return value;
  const relative = path.relative(projectDir, value);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    ? relative.split(path.sep).join('/') : 'external-source';
}

function normalizeObservation(observation, projectDir, artifactPath) {
  const related = observation.relatedProductionState || {};
  const normalizeRelated = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if ((key === 'source' || key === 'asset') && item && typeof item === 'object') {
        return [key, { ...item, value: projectPath(item.value, projectDir, artifactPath) }];
      }
      return [key, item];
    }));
  };
  return {
    id: observation.id,
    family: observation.family,
    timeRange: observation.timeRange,
    assertion: observation.assertion ? {
      id: observation.assertion.id,
      class: observation.assertion.class,
      expect: observation.assertion.expect,
    } : null,
    intent: observation.intent,
    observed: observation.observed,
    evidence: (observation.evidence || []).map(item => ({
      ...item,
      source: projectPath(item.source, projectDir, artifactPath),
    })),
    interpretation: observation.interpretation,
    confidence: observation.confidence,
    confidenceBasis: observation.confidenceBasis,
    classification: observation.classification,
    outcome: observation.outcome,
    relatedProductionState: normalizeRelated(related),
    suggestedQuestions: Array.isArray(observation.suggestedQuestions)
      ? observation.suggestedQuestions.slice() : [],
  };
}

function captureBranchExperiment(report, assertionId, metadataDir, projectDir) {
  const focusAssertion = String(assertionId || '').trim();
  if (!focusAssertion) throw new Error('focused Video CI proof needs an assertion id');
  if (!report || report.schema !== 'narova.judgement/1') {
    throw new Error('focused Video CI proof needs a complete judgement');
  }
  const binding = report.sources && report.sources.evidenceBinding;
  if (!binding || binding.used !== true || !SHA256.test(String(binding.sha256 || ''))) {
    throw new Error('focused Video CI proof needs a matching canonical video evidence receipt');
  }
  const assertion = (report.assertions || []).find(item => item && item.id === focusAssertion);
  if (!assertion) throw new Error(`assertion "${focusAssertion}" was not found in the resolved project`);
  const observations = (report.observations || []).filter(item => (
    item && item.assertion && item.assertion.id === focusAssertion
  ));
  if (observations.length !== 1) {
    throw new Error(`assertion "${focusAssertion}" does not have one focused judgement observation`);
  }

  const artifactPath = path.resolve(report.artifact.path);
  const sourceStat = fs.lstatSync(artifactPath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error('focused Video CI artifact must be a regular file, not a symbolic link');
  }
  if (hashFile(artifactPath) !== report.artifact.sha256 || sourceStat.size !== report.artifact.bytes) {
    throw new Error('focused Video CI artifact changed after judgement');
  }
  if (binding.path && hashFile(binding.path) !== binding.sha256) {
    throw new Error('focused Video CI evidence receipt changed after judgement');
  }

  const experimentDir = path.join(metadataDir, 'video-ci');
  if (fs.existsSync(experimentDir)) throw new Error('focused Video CI staging directory already exists');
  fs.mkdirSync(experimentDir);
  const ext = path.extname(artifactPath).toLowerCase();
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.media';
  const relativeArtifact = path.posix.join('video-ci', `artifact${safeExt}`);
  const copied = path.join(metadataDir, ...relativeArtifact.split('/'));
  try {
    fs.copyFileSync(artifactPath, copied, fs.constants.COPYFILE_EXCL);
    if (hashFile(copied) !== report.artifact.sha256 || fs.statSync(copied).size !== report.artifact.bytes) {
      throw new Error('focused Video CI artifact changed while being preserved');
    }
    return {
      schema: RECORD_SCHEMA,
      focusAssertion,
      artifact: {
        path: relativeArtifact,
        bytes: report.artifact.bytes,
        sha256: report.artifact.sha256,
        duration: report.artifact.duration,
        streams: report.artifact.streams,
      },
      evidenceBinding: { sha256: binding.sha256 },
      observation: normalizeObservation(observations[0], path.resolve(projectDir), artifactPath),
    };
  } catch (error) {
    fs.rmSync(experimentDir, { recursive: true, force: true });
    throw error;
  }
}

function inventory(root) {
  const files = [];
  const visit = (dir, relative = '') => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file, rel);
      else if (entry.isFile()) files.push(rel);
      else throw new Error(`unsupported experiment artifact type: ${rel}`);
    }
  };
  visit(root);
  return files.sort();
}

function verifyBranchExperiment(metadataDir, record, expectedIdentity) {
  try {
    if (!record || record.schema !== RECORD_SCHEMA) return false;
    if (!SHA256.test(String(expectedIdentity || '')) || branchExperimentIdentity(record) !== expectedIdentity) return false;
    if (typeof record.focusAssertion !== 'string' || !record.focusAssertion.trim()) return false;
    if (!record.artifact || !SHA256.test(String(record.artifact.sha256 || ''))) return false;
    if (!Number.isInteger(record.artifact.bytes) || record.artifact.bytes < 0) return false;
    if (!Number.isFinite(record.artifact.duration) || record.artifact.duration < 0) return false;
    if (!record.evidenceBinding || !SHA256.test(String(record.evidenceBinding.sha256 || ''))) return false;
    const file = within(metadataDir, record.artifact.path);
    if (!file) return false;
    const metadataStat = fs.lstatSync(metadataDir);
    if (!metadataStat.isDirectory() || metadataStat.isSymbolicLink()) return false;
    const experimentDir = path.join(metadataDir, 'video-ci');
    const experimentStat = fs.lstatSync(experimentDir);
    if (!experimentStat.isDirectory() || experimentStat.isSymbolicLink()) return false;
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const realMetadata = fs.realpathSync(metadataDir);
    const realExperiment = fs.realpathSync(experimentDir);
    const realFile = fs.realpathSync(file);
    if (realExperiment !== path.join(realMetadata, 'video-ci')) return false;
    const realRelative = path.relative(realMetadata, realFile);
    if (!realRelative || realRelative === '..' || realRelative.startsWith(`..${path.sep}`)) return false;
    if (path.dirname(realFile) !== realExperiment) return false;
    if (record.artifact.path !== path.posix.join('video-ci', path.basename(file))) return false;
    if (stat.size !== record.artifact.bytes || hashFile(file) !== record.artifact.sha256) return false;
    if (path.dirname(file) !== experimentDir) return false;
    if (JSON.stringify(inventory(experimentDir)) !== JSON.stringify([path.basename(file)])) return false;
    const observation = record.observation;
    if (!observation || !observation.assertion || observation.assertion.id !== record.focusAssertion) return false;
    if (!['MEASURED', 'INFERRED', 'INTERPRETIVE'].includes(observation.classification)) return false;
    if (!['ALIGNED', 'DIVERGED', 'OBSERVED', 'UNCERTAIN'].includes(observation.outcome)) return false;
    if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) return false;
    if (!Array.isArray(observation.evidence)) return false;
    return true;
  } catch {
    return false;
  }
}

function branchComparison(entries) {
  const focusAssertion = entries[0].branch.videoCi.focusAssertion;
  return {
    schema: COMPARISON_SCHEMA,
    purpose: 'evidence comparison; creator retains creative authority',
    creatorAuthority: 'creator',
    score: null,
    ranking: null,
    selection: null,
    mutation: 'none',
    focusAssertion,
    branches: entries.map(({ name, branch, metadataDir }) => ({
      name,
      status: branch.status,
      rationale: branch.rationale,
      proofIdentity: branch.proofIdentity,
      snapshotIdentity: branch.snapshotIdentity,
      videoCiIdentity: branch.videoCiIdentity,
      artifact: {
        ...branch.videoCi.artifact,
        storedPath: path.join(metadataDir, ...branch.videoCi.artifact.path.split('/')),
      },
      observation: branch.videoCi.observation,
    })),
  };
}

function clock(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

function formatBranchComparison(comparison) {
  const lines = [
    `BRANCH COMPARISON — assertion ${comparison.focusAssertion}`,
    'Creative authority: creator. No score, ranking, recommendation, selection, or mutation.',
  ];
  comparison.branches.forEach((branch, index) => {
    const observation = branch.observation;
    lines.push('', `PROOF ${String.fromCharCode(65 + index)} — ${branch.name} [${branch.status}]`);
    lines.push(`Hypothesis: ${branch.rationale || '(not recorded)'}`);
    lines.push(`Artifact: ${branch.artifact.sha256} · ${branch.artifact.bytes} bytes · ${branch.artifact.duration}s`);
    lines.push(`Stored artifact: ${branch.artifact.storedPath}`);
    lines.push(`Observation ${clock(observation.timeRange.start)}–${clock(observation.timeRange.end)}: ${observation.observed}`);
    lines.push('Evidence:');
    for (const item of observation.evidence) {
      lines.push(`- ${item.metric}: ${item.value == null ? 'unavailable' : JSON.stringify(item.value)}${item.unit ? ` ${item.unit}` : ''} (${item.basis})`);
    }
    lines.push(`Interpretation: ${observation.interpretation}`);
    lines.push(`Confidence: ${observation.confidence}`);
    lines.push(`Classification: ${observation.classification}`);
    lines.push(`Outcome: ${observation.outcome}`);
    lines.push(`Related production state: ${JSON.stringify(observation.relatedProductionState)}`);
  });
  lines.push('', 'Narova has not chosen among these proofs. The creator may keep, reject, combine, or evolve them.');
  return lines.join('\n');
}

module.exports = {
  RECORD_SCHEMA,
  COMPARISON_SCHEMA,
  branchExperimentIdentity,
  captureBranchExperiment,
  verifyBranchExperiment,
  branchComparison,
  formatBranchComparison,
};
