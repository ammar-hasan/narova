'use strict';
/* Stable diagnostic codes (NAR-015-072). Every diagnostic emitted in a machine
 * result envelope carries a code from this registry; human and machine output
 * share this one code source at the check/gate/audit construction sites.
 *
 * Codes are dot-namespaced and never change meaning within one envelope major
 * version (narova.result/1). The registry is published in AGENT_PROTOCOL.md;
 * tool/test/machine-protocol.test.js keeps the document and this module in
 * sync and asserts that every emitted code is registered here. */
const REGISTRY = Object.freeze({
  // Envelope-level fallbacks (NAR-015-071 classes).
  'usage.invalid': 'Invocation rejected before or during dispatch: unknown command or option, missing option value, missing or malformed argument.',
  'operation.failed': 'The operation could not complete its own work (unreadable config, missing prerequisite, tool or network failure).',
  'subject.non-pass': 'The operation ran correctly and the subject did not pass; generic fallback when no more specific code applies.',

  // Advisory checks (never fail the operation on their own).
  'check.warning': 'Advisory check finding; warnings never fail the operation outside release gates.',
  'check.clip-truncation': 'Advisory: a scene-bound direct clip probes longer than the resolved scene duration; the clip will be cut mid-playback. Remedy: set scene minDur.',

  // Release gates (check --release / build --release).
  'gate.release.captions-missing': 'Release gate: narration audio is present but the published caption sidecar is absent or empty without a recorded derivation reason.',
  'gate.release.asset-provenance': 'Release gate: a tracked asset failed provenance verification.',
  'gate.release.creative-brief': 'Release gate: the creative brief is missing, unapproved, or its proof set does not satisfy the release rules.',
  'gate.release.black-frame': 'Release gate: a scene has no visible content and no b-roll, walkthrough, or 3D scene.',
  'gate.release.remote-dependency': 'Release gate: a scene body uses a remote-dependency element (script/iframe/link).',
  'gate.release.unsupported-html': 'Release gate: a scene body uses an HTML element the renderer cannot reproduce deterministically.',
  'gate.release.scene-camera-missing': 'Release gate: a 3D scene declares no camera.',
  'gate.release.remote-asset': 'Release gate: a remote asset reference must be downloaded into the project assets directory.',
  'gate.release.walkthrough-stale': 'Release gate: a declared walkthrough capture is missing or stale against the current timings.',
  'gate.release.asset-location': 'Release gate: a local asset reference must live under the project assets directory.',
  'gate.release.assets-dir-missing': 'Release gate: an asset is referenced but the project has no assets directory.',
  'gate.release.asset-path-escape': 'Release gate: an asset path escapes the project assets directory.',
  'gate.release.asset-missing': 'Release gate: a referenced asset file does not exist.',
  'gate.release.failure': 'Release gate failed; generic code for release findings without a more specific code.',

  // Verification audits and proof gates.
  'audit.assets.verify': 'assets verify: a tracked file failed hash, size, or media-kind verification.',
  'audit.proof.frames': 'shots --proof: sampled pilot frames were near-black or no visual evidence was rendered.',
  'audit.motion': 'build --verify-motion: the rendered video contains frozen or black segments beyond tolerance.',
  'gate.proof.receipt': 'proof receipt: the captured proof could not be written or no longer matches the current source.',

  // Health inspections.
  'health.doctor': 'doctor: a required tool is missing or unusable.',
  'health.renderer': 'renderers doctor: the renderer failed one of its local requirement checks.',
  'health.provider': 'providers doctor: the provider worker handshake failed or required environment is missing.',
  'health.demo': 'demo: this machine is not ready to run the demo (readiness non-pass).',
});

function isRegistered(code) {
  return Object.hasOwn(REGISTRY, code);
}

function assertRegistered(code) {
  if (!isRegistered(code)) {
    throw new Error(`unregistered diagnostic code: ${code} — add it to tool/src/diagnostic-codes.js and AGENT_PROTOCOL.md`);
  }
  return code;
}

module.exports = { REGISTRY, isRegistered, assertRegistered };
