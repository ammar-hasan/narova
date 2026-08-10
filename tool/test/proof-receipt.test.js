'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeProofReceipt, verifyProofReceipt, clearProofReceipt, _internals } = require('../src/proof-receipt');
const { buildHashes } = require('../src/manifest');

test('proof receipt binds config, manifest, timings, contact sheet, and audited frames', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-receipt-'));
  const config = { title: 'Proof', projectDir: out, scenes: [] };
  const manifest = path.join(out, 'manifest.json');
  const timings = path.join(out, 'timings.json');
  const evidence = path.join(out, 'contact-sheet.jpg');
  const frame = path.join(out, 'frame.jpg');
  try {
    fs.writeFileSync(manifest, JSON.stringify({ hashes: buildHashes(config, config.projectDir) }));
    fs.writeFileSync(timings, '{}');
    fs.writeFileSync(path.join(out, 'config.resolved.json'), JSON.stringify(config));
    fs.writeFileSync(evidence, 'sheet');
    fs.writeFileSync(frame, 'frame');
    const receipt = writeProofReceipt(config, out, [evidence], [frame]);
    assert.match(receipt.projectIdentity, /^[a-f0-9]{64}$/);
    assert.equal(verifyProofReceipt(config, out).ok, true);
    assert.match(verifyProofReceipt({ ...config, projectDir: path.join(out, 'other-project') }, out).reason,
      /belongs to another project/);
    assert.match(verifyProofReceipt({ ...config, title: 'edited' }, out).reason, /config changed/);
    fs.writeFileSync(frame, 'changed');
    assert.match(verifyProofReceipt(config, out).reason, /frames changed/);
    clearProofReceipt(out);
    assert.match(verifyProofReceipt(config, out).reason, /no successful proof receipt/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('proof receipt rejects changed and newly added source assets', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-assets-'));
  const out = path.join(project, 'out');
  const assetsDir = path.join(project, 'assets');
  fs.mkdirSync(out);
  fs.mkdirSync(assetsDir);
  const asset = path.join(assetsDir, 'field.bin');
  const config = { title: 'Proof assets', projectDir: project, assetsDir, scenes: [] };
  const evidence = path.join(out, 'contact-sheet.jpg');
  const frame = path.join(out, 'frame.jpg');
  try {
    fs.writeFileSync(asset, 'reviewed bytes');
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ hashes: buildHashes(config, project) }));
    fs.writeFileSync(path.join(out, 'timings.json'), '{}');
    fs.writeFileSync(path.join(out, 'config.resolved.json'), JSON.stringify(config));
    fs.writeFileSync(evidence, 'sheet');
    fs.writeFileSync(frame, 'frame');
    writeProofReceipt(config, out, [evidence], [frame]);
    fs.writeFileSync(asset, 'changed bytes');
    assert.match(verifyProofReceipt(config, out).reason, /source assets changed/);
    fs.writeFileSync(asset, 'reviewed bytes');
    assert.equal(verifyProofReceipt(config, out).ok, true);
    fs.writeFileSync(path.join(assetsDir, 'added.bin'), 'unreviewed bytes');
    assert.match(verifyProofReceipt(config, out).reason, /source assets changed/);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('semantic proof and snapshot identities ignore only volatile manifest creation time', () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-stable-a-'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-stable-b-'));
  try {
    const base = { narova: '0.28.0', project: { title: 'Same proof' }, scenes: [{ id: 'one' }] };
    fs.writeFileSync(path.join(first, 'manifest.json'), JSON.stringify({ ...base, project: { ...base.project, created: '2026-01-01T00:00:00Z' } }));
    fs.writeFileSync(path.join(second, 'manifest.json'), JSON.stringify({ ...base, project: { ...base.project, created: '2026-08-08T00:00:00Z' } }));
    fs.writeFileSync(path.join(first, 'reel.config.json'), '{"title":"Same proof"}');
    fs.writeFileSync(path.join(second, 'reel.config.json'), '{"title":"Same proof"}');
    assert.equal(_internals.stableManifestHash(path.join(first, 'manifest.json')),
      _internals.stableManifestHash(path.join(second, 'manifest.json')));
    assert.equal(_internals.snapshotContentIdentity(first), _internals.snapshotContentIdentity(second));
    const receipt = {
      version: 2, projectIdentity: 'a'.repeat(64), configSha256: 'b'.repeat(64),
      configResolvedSha256: 'c'.repeat(64), timingsSha256: 'd'.repeat(64),
      evidence: [{ sha256: 'e'.repeat(64) }], frames: [{ sha256: 'f'.repeat(64) }],
    };
    assert.equal(_internals.proofContentIdentity(receipt, path.join(first, 'manifest.json')),
      _internals.proofContentIdentity(receipt, path.join(second, 'manifest.json')));
  } finally {
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
