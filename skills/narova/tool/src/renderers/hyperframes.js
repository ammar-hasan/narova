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

  /* Scene-level render cache. HyperFrames renders the full timeline as a
   * single MP4 and exposes no frame-range option, so an isolated single-scene
   * re-render is not possible without recomposing a sub-project (which would
   * change the chrome counter / progress bar / transitions and break the
   * determinism contract). The cache therefore operates at whole-video
   * granularity: a build where nothing changed reuses the previous MP4 and
   * skips the render entirely; any change does a full render and stores the
   * result for next time. This is declared explicitly rather than silently
   * degrading — per-scene savings are a no-browser capability today. */
  cache: { mode: 'whole-video' },

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
