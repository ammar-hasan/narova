'use strict';

/* Optional build-time Witness publication. This runs only after the primary
 * encoded artifact and canonical Video CI receipt have been committed. It
 * reuses the built-in artifact analyzer and never reconstructs renderer
 * provenance from mutable composition output. */
const path = require('node:path');
const { probeArtifact } = require('./judge');
const { loadVideoCiBinding, verifyVideoCiBinding } = require('./video-ci-binding');
const {
  publishWitnessBundle, verifyArtifactBytes, witnessArtifact,
} = require('./witness');

function publishBuildWitness(mp4, outDir) {
  const artifact = probeArtifact(mp4);
  const binding = loadVideoCiBinding(artifact, outDir);
  const bundle = witnessArtifact(artifact, { binding });
  const output = path.join(outDir, 'witness.json');
  publishWitnessBundle(bundle, output, {
    verifyInputs: () => {
      verifyArtifactBytes(artifact);
      if (bundle.coverage.profile === 'MIXED') verifyVideoCiBinding(binding);
    },
  });
  return { artifact, binding, bundle, output };
}

module.exports = { publishBuildWitness };
