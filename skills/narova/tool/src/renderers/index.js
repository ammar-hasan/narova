'use strict';

const RENDERER_PROTOCOL = 'narova-renderer-provider/v1';
const providers = new Map();

function register(provider) {
  if (!provider || provider.protocol !== RENDERER_PROTOCOL || typeof provider.name !== 'string') {
    throw new Error(`renderer provider must implement ${RENDERER_PROTOCOL}`);
  }
  providers.set(provider.name, provider);
  return provider;
}

register(require('./hyperframes'));
register(require('./no-browser'));

function rendererName(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.provider === 'string') return value.provider;
  return 'hyperframes';
}

function getRenderer(value) {
  const name = rendererName(value);
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`unknown renderer ${JSON.stringify(name)} (${[...providers.keys()].join('|')})`);
  }
  return provider;
}

function listRenderers() {
  return [...providers.values()].map(provider => ({
    name: provider.name,
    displayName: provider.displayName,
    providerVersion: provider.providerVersion,
    protocol: provider.protocol,
    local: provider.local,
    browserless: provider.browserless,
    capabilities: { ...provider.capabilities },
  }));
}

function composeWithRenderer(config, outDir, opts = {}) {
  return getRenderer(opts.renderer || config.renderer).compose(config, outDir, opts);
}

function renderWithRenderer(config, outDir, opts = {}) {
  return getRenderer(opts.renderer || config.renderer).render(config, outDir, opts);
}

function shotsWithRenderer(config, outDir, times, opts = {}) {
  return getRenderer(opts.renderer || config.renderer).shots(config, outDir, times, opts);
}

module.exports = {
  RENDERER_PROTOCOL, getRenderer, listRenderers, rendererName,
  composeWithRenderer, renderWithRenderer, shotsWithRenderer,
};
