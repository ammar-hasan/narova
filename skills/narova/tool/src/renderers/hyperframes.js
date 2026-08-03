'use strict';

const path = require('path');
const { compose } = require('../compose');
const { runHf, HYPERFRAMES_VERSION } = require('../hf');
const { materializeVisualBodies } = require('./visual');
const { which } = require('../util');

const provider = {
  name: 'hyperframes',
  displayName: 'HyperFrames',
  providerVersion: HYPERFRAMES_VERSION,
  protocol: 'narova-renderer-provider/v1',
  local: true,
  browserless: false,
  capabilities: {
    html: true,
    portableVisuals: true,
    css: true,
    video: true,
    svg: true,
    captions: true,
    snapshots: true,
    studio: true,
  },

  doctor() {
    return {
      ok: !!which('npx'),
      checks: [
        { name: 'npx', ok: !!which('npx'), detail: which('npx') || 'not found' },
        { name: 'browser', ok: null, detail: 'downloaded/managed by HyperFrames when rendering' },
      ],
    };
  },

  compose(config, outDir) {
    return compose(materializeVisualBodies(config), outDir);
  },

  render(config, outDir, opts = {}) {
    const composed = this.compose(config, outDir);
    const name = opts.name || 'video.mp4';
    const args = ['render', '--output', path.join('..', name)];
    if (opts.videoFrameFormat) args.push('--video-frame-format', opts.videoFrameFormat);
    if (opts.fps) args.push('--fps', String(opts.fps));
    if (opts.quality) args.push('--quality', String(opts.quality));
    runHf(args, composed.dir);
    return { ...composed, mp4: path.join(outDir, name), project: composed.dir };
  },

  shots(config, outDir, times) {
    const composed = this.compose(config, outDir);
    runHf(['snapshot', '--at', times.join(','), '-o', 'snapshots/review'], composed.dir);
    return { dir: path.join(composed.dir, 'snapshots', 'review'), project: composed.dir };
  },
};

module.exports = provider;
