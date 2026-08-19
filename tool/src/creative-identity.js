'use strict';
/* Creative-identity contract (NAR-002-027, NAR-007-031..034).
 *
 * Advisory-only identity surfaces for unattended creative convergence:
 *   - fingerprint(config)      — deterministic multi-dimensional identity
 *                                computed from the resolved project alone,
 *                                with no render, network, or provider
 *   - selfCheck(config, dir)   — isolation-safe: compare the authored
 *                                creative.md claims block against the
 *                                fingerprint; flag claim-mismatch and
 *                                under-authored identity. Works with zero
 *                                siblings (sandboxed/isolated runs).
 *   - siblingCheck(config, dir)— when a local fingerprint-only ledger
 *                                exists, flag near-duplicate identity vs the
 *                                author's recent siblings; silent without a
 *                                ledger.
 *   - writeArtifact(config, dir, outDir) — emit creative-identity.json.
 *
 * Nothing here may gate validity at any check level (principles 17/18/32).
 * The ledger stores fingerprints only — never narration, claims, or private
 * content. Tone families are observable thresholds, not aesthetic judgment. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SIBLING_PALETTE_THRESHOLD = 0.12;
const LEDGER_MAX_ENTRIES = 24;

/* The ledger lives under the user home. An explicit env override lets tests
 * and isolated sandboxes redirect it; it must never hold narration/claims. */
function ledgerPath() {
  const root = process.env.NAROVA_CREATIVE_IDENTITY_DIR
    || path.join(os.homedir(), '.narova', 'creative-identity');
  return path.join(root, 'ledger.json');
}

/* ---------- fingerprint (NAR-007-031) ---------- */

function hexToRgb(value) {
  const v = String(value || '').trim();
  const m = v.match(/^#?([0-9a-f]{6})$/i) || v.match(/^#?([0-9a-f]{3})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function colorStats(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return null;
  const { r, g, b } = rgb;
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const luma = (mx + mn) / 2;
  const d = mx - mn;
  const sat = d > 0.02 ? (luma > 0.5 ? d / (2 - 2 * luma) : d / (2 * luma)) : 0;
  let hue = 0;
  if (d > 0.02) {
    const rr = (mx - r / 255) / d;
    const gg = (mx - g / 255) / d;
    const bb = (mx - b / 255) / d;
    if (r >= g && r >= b) hue = bb - gg;
    else if (g >= r && g >= b) hue = 2 + rr - bb;
    else hue = 4 + gg - rr;
    hue = ((hue / 6) % 1 + 1) % 1;
  }
  return { luma, sat, hue, satWeighted: sat * hue };
}

/* 18-bin hue histogram over 0..1, weighted by saturation; near-gray folds
 * into the neutral (0) bin. Mirrors the probe's rendered-frame metric but
 * derives from authored color tokens only. */
function hueHistogram(colors) {
  const bins = 18;
  const hist = new Array(bins).fill(0);
  for (const c of colors) {
    const s = colorStats(c);
    if (!s) continue;
    const bin = Math.floor(s.hue * bins) % bins;
    hist[bin] += Math.max(0, s.sat - 0.06) * 4;
    if (s.sat <= 0.06) hist[0] += 0.15;
  }
  return normalize(hist);
}

function normalize(v) {
  const s = v.reduce((a, b) => a + b, 0) || 1;
  return v.map(x => Math.round((x / s) * 1000) / 1000);
}

function hueEnergy(hueHist, family) {
  const warm = new Set([0, 1, 2, 16, 17]);
  const cool = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14]);
  let e = 0;
  hueHist.forEach((v, i) => {
    if (family === 'warm' && warm.has(i)) e += v;
    else if (family === 'cool' && cool.has(i)) e += v;
  });
  return e;
}

/* Layout/motion vocabulary: scan scene bodies + visual trees for cue and
 * animation families. Deterministic, config-only. */
function motionVocabulary(config) {
  const vocab = new Set();
  const markers = Object.keys(config.markers || {});
  const kinds = ['data-cue', 'data-grow', 'data-draw', 'data-count',
    'data-delay', 'data-drift', 'reveal', 'threeModule', 'visual'];
  for (const s of config.scenes || []) {
    for (const k of kinds) {
      if (s.body && s.body.includes(k)) vocab.add(`body:${k}`);
      if (s[k] && typeof s[k] === 'string') vocab.add(`body:${k}`);
    }
    if (s.visual) vocab.add('body:visual');
    if (s.threeModule) vocab.add('body:threeModule');
  }
  // cues resolved to markers are a distinct vocabulary signal
  if (markers.length) vocab.add(`markers:${markers.length}`);
  return [...vocab].sort();
}

function fingerprint(config) {
  const theme = config.theme || {};
  const mode = config.mode || 'dark';
  const colorValues = Object.values(theme).filter(v => typeof v === 'string' && hexToRgb(v));
  const bg = theme.bg || (mode === 'light' ? '#f2f2f0' : '#080d16');
  const accent = theme.accent || (mode === 'light' ? '#1a6f66' : '#2ee6d6');
  const scenes = config.scenes || [];
  const turns = scenes.map(s => (s.vo || []).length);
  const durs = scenes.map(s => (s.dur || 0));
  const explicitDur = durs.some(d => d > 0);
  const durTotal = durs.reduce((a, b) => a + b, 0) || 1;
  const turnTotal = turns.reduce((a, b) => a + b, 0) || 1;
  const captions = config.captionsEnabled === false ? 0 : ((config.captions && config.captions.preset) || 'subtitle');
  const chromeOn = Object.values(config.chrome || {}).some(Boolean);
  const stats = {
    meanLuma: colorStats(bg) ? colorStats(bg).luma : null,
    meanSat: colorStats(accent) ? colorStats(accent).sat : null,
  };
  return {
    palette: {
      bg,
      accent,
      mode,
      hueHist: hueHistogram([bg, accent]),
      stats,
    },
    structure: {
      sceneCount: scenes.length,
      explicitDur,
      durationShare: durs.map(d => Math.round((d / durTotal) * 1000) / 1000),
      turnShare: turns.map(t => Math.round((t / turnTotal) * 1000) / 1000),
    },
    layout: {
      patterns: !!config.includePatterns,
      chrome: chromeOn,
      captions,
      renderer: config.renderer || 'hyperframes',
    },
    motion: motionVocabulary(config),
  };
}

function jsd(a, b) {
  const n = Math.max(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const ai = i < a.length ? a[i] : 0;
    const bi = i < b.length ? b[i] : 0;
    const m = (ai + bi) / 2;
    if (m > 0) s += ai > 0 ? ai * Math.log2(ai / m) : 0;
    if (m > 0) s += bi > 0 ? bi * Math.log2(bi / m) : 0;
  }
  return s / 2;
}

/* ---------- rationale claims (NAR-002-027 input) ---------- */

const CREATIVE_FILE_NAMES = ['creative.md', 'CREATIVE.md', 'creative-rationale.md'];

function findCreativeFile(dir) {
  if (!dir) return null;
  for (const name of CREATIVE_FILE_NAMES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* Parse `key: value` claims lines anywhere in the rationale. Recognized keys:
 * palette, provenance, structure, motion, layout. */
function parseClaims(creativeFile) {
  if (!creativeFile || !fs.existsSync(creativeFile)) return {};
  const src = fs.readFileSync(creativeFile, 'utf8');
  const claims = {};
  const re = /^\s*(palette|provenance|structure|motion|layout)\s*:\s*(.+)$/gim;
  let m;
  while ((m = re.exec(src)) !== null) {
    claims[m[1].toLowerCase()] = m[2].trim().replace(/\s+/g, ' ');
  }
  return claims;
}

/* Citation resolvability (NAR-002-027): a brief/source/brand citation must
 * point at an artifact that exists in the project or a brief clause. Returns
 * advisory lines; never errors. */
function citationAdvisories(config, dir) {
  const advisories = [];
  const creativeFile = findCreativeFile(dir);
  if (!creativeFile) return advisories;
  const src = fs.readFileSync(creativeFile, 'utf8');
  // cited file paths: markdown-ish links or bare paths to project files
  const fileRefRe = /[`"'(]?([A-Za-z0-9_./-]+\.(?:md|json|txt|css|mjs|js|png|jpg|jpeg|webp|svg|wav|mp3|mp4|webm|pdf|html?))[`"')]?/g;
  const cited = new Set();
  let m;
  while ((m = fileRefRe.exec(src)) !== null) {
    const ref = m[1];
    if (ref.startsWith('http')) continue;
    cited.add(ref);
  }
  for (const ref of cited) {
    // bare basenames resolve against the project dir; relative paths too
    const candidate = path.isAbsolute(ref) ? ref : path.join(dir, ref);
    const also = path.basename(ref) !== ref ? path.join(dir, path.basename(ref)) : null;
    const exists = fs.existsSync(candidate) || (also && fs.existsSync(also));
    if (!exists) advisories.push(`creative.md cites "${ref}" but no such file exists in the project — a citation must resolve to the brief, a brand token, or a project artifact`);
  }
  return advisories;
}

/* ---------- self-check (NAR-007-032) ---------- */

function selfCheck(config, fp, claims) {
  const warnings = [];
  const theme = config.theme || {};
  const hasAuthoredPalette = !!(theme.bg && theme.accent);
  if (!hasAuthoredPalette) {
    warnings.push('UNDER-AUTHORED: no explicit authored palette tokens detected (bg/accent default or unknown)');
  }
  if (!Object.keys(claims).length) {
    warnings.push('UNDER-AUTHORED: creative.md contains no parseable identity claims');
    return warnings;
  }
  const tone = String(claims.palette || '').toLowerCase();
  const luma = fp.palette.stats.meanLuma;
  const sat = fp.palette.stats.meanSat;
  if (tone) {
    if (/dark|night|navy|ink|deep|dim|shadow|black/i.test(tone) && luma != null && luma > 0.45) {
      warnings.push(`CLAIM-MISMATCH: creative.md claims "${tone}" (dark family) but the authored bg luma is ${luma.toFixed(2)} (light)`);
    }
    if (/light|bright|cream|paper|day|sunny|white|pale/i.test(tone) && luma != null && luma < 0.45) {
      warnings.push(`CLAIM-MISMATCH: creative.md claims "${tone}" (light family) but the authored bg luma is ${luma.toFixed(2)} (dark)`);
    }
    if (/muted|desatur|pastel|low.?chroma|grey|gray|subdued|quiet/i.test(tone) && sat != null && sat > 0.35) {
      warnings.push(`CLAIM-MISMATCH: creative.md claims "${tone}" (muted family) but the authored accent saturation is ${sat.toFixed(2)} (saturated)`);
    }
    if (/warm|amber|gold|candle|sunset|espresso|roast|orange|sepia|honey/i.test(tone)) {
      const warm = hueEnergy(fp.palette.hueHist, 'warm');
      if (warm < 0.35) {
        warnings.push(`CLAIM-MISMATCH: creative.md claims "${tone}" (warm family) but authored hue energy is mostly cool/neutral (warm energy ${warm.toFixed(2)})`);
      }
    }
    if (/cool|navy|blue|teal|steel|night.*cool|cold|cyan|slate/i.test(tone)) {
      const cool = hueEnergy(fp.palette.hueHist, 'cool');
      if (cool < 0.35) {
        warnings.push(`CLAIM-MISMATCH: creative.md claims "${tone}" (cool family) but authored hue energy is mostly warm/neutral (cool energy ${cool.toFixed(2)})`);
      }
    }
  }
  if (!/invented|brief|brand|source/i.test(String(claims.provenance || ''))) {
    warnings.push('UNDER-AUTHORED: creative.md palette claim lacks a provenance tag (brief/brand/source/invented)');
  }
  if (fp.structure.sceneCount <= 1) {
    warnings.push('UNDER-AUTHORED: single-scene project — no structural beat spine to diverge on');
  }
  return warnings;
}

/* ---------- sibling check (NAR-007-033) ---------- */

function projectKey(config, dir) {
  const base = config.title || path.basename(dir || '.');
  return crypto.createHash('sha256').update(`${base}\u0000${dir || ''}`).digest('hex');
}

function readLedger() {
  try {
    const raw = fs.readFileSync(ledgerPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(e => e && e.fp) : [];
  } catch { return []; }
}

function writeLedger(entries) {
  const root = process.env.NAROVA_CREATIVE_IDENTITY_DIR
    || path.join(os.homedir(), '.narova', 'creative-identity');
  fs.mkdirSync(root, { recursive: true });
  const slim = entries.slice(-LEDGER_MAX_ENTRIES).map(e => ({
    key: e.key,
    title: e.title,
    at: e.at,
    stateHash: e.stateHash,
    fp: {
      palette: { bg: e.fp.palette.bg, accent: e.fp.palette.accent, mode: e.fp.palette.mode, hueHist: e.fp.palette.hueHist, stats: e.fp.palette.stats },
      structure: { sceneCount: e.fp.structure.sceneCount, explicitDur: e.fp.structure.explicitDur, durationShare: e.fp.structure.durationShare, turnShare: e.fp.structure.turnShare },
      layout: e.fp.layout,
      motion: e.fp.motion,
    },
  }));
  fs.writeFileSync(ledgerPath(), JSON.stringify(slim, null, 2));
}

function siblingCheck(config, dir, fp) {
  const advisories = [];
  const ledger = readLedger();
  if (!ledger.length) return { advisories, ledger: null };
  const key = projectKey(config, dir);
  for (const entry of ledger.slice(-10)) {
    if (entry.key === key) continue; // self
    const paletteDist = jsd(fp.palette.hueHist, entry.fp.palette.hueHist);
    const structureDist = jsd(fp.structure.durationShare, entry.fp.structure.durationShare);
    if (paletteDist <= SIBLING_PALETTE_THRESHOLD) {
      advisories.push(
        `identity near sibling "${entry.title}" (${entry.at}): palette JSD ${paletteDist.toFixed(3)} — ` +
        `similarity is only a defect relative to this brief; a brand series or multi-part piece may legitimately match`);
    }
    if (structureDist === 0 && fp.structure.sceneCount > 1 && entry.fp.structure.sceneCount > 1) {
      advisories.push(
        `structural beat spine identical to sibling "${entry.title}" (${entry.at}): same scene-count/duration spine — ` +
        `consider a different beat structure unless the brief demands it`);
    }
  }
  return { advisories, ledger: ledger.length ? ledger : null };
}

function intersection(x, y) { return x.filter(v => y.includes(v)); }
function union(x, y) { return [...new Set([...x, ...y])]; }

/* ---------- artifact (NAR-007-034) ---------- */

function writeArtifact(config, dir, outDir, fp, claims, selfCheckLines, siblingAdvisories) {
  const projectDir = dir || config.projectDir || '.';
  const out = outDir || path.join(projectDir, 'out');
  const artifact = {
    title: config.title,
    fingerprint: fp,
    rationaleClaims: claims && Object.keys(claims).length ? claims : null,
    comparison: {
      selfCheck: selfCheckLines.length ? selfCheckLines : 'clear',
      sibling: siblingAdvisories.length ? siblingAdvisories : (readLedger().length ? 'clear' : 'no-ledger'),
    },
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(out, { recursive: true });
  const target = path.join(out, 'creative-identity.json');
  fs.writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`);
  return target;
}

/* ---------- combined entry point for check() ---------- */

function run(config, opts = {}) {
  const dir = config.projectDir || opts.projectDir || '.';
  const creativeFile = findCreativeFile(dir);
  const fp = fingerprint(config);
  const claims = parseClaims(creativeFile);
  const lines = [];
  let self = [];
  let citations = [];
  let sibling = { advisories: [], ledger: null };
  let artifactPath = null;

  // The identity surfaces are advisory and opt-in: a project participates
  // by carrying an authored creative.md. Absence is silent at default/strict/
  // release check (NAR-002-027); only the advisory critique profile MAY note
  // it for an ambitious brief. This keeps ordinary check clean and honest.
  if (creativeFile) {
    self = selfCheck(config, fp, claims);
    citations = citationAdvisories(config, dir);
    sibling = siblingCheck(config, dir, fp);
    lines.push(
      ...self.map(w => `creative-identity: ${w}`),
      ...citations.map(w => `creative-identity: ${w}`),
      ...sibling.advisories.map(w => `creative-identity: ${w}`),
    );
    // record to the ledger (fingerprints only) after checks are computed
    const entries = readLedger();
    const key = projectKey(config, dir);
    const prev = entries.find(e => e.key === key);
    const stateHash = crypto.createHash('sha256')
      .update(JSON.stringify({ fp, claims })).digest('hex');
    // dedupe: don't emit the same advisories twice for an unchanged project
    const dedupe = prev && prev.stateHash === stateHash;
    const emitted = dedupe ? [] : lines.slice();
    lines.length = 0;
    lines.push(...emitted);
    if (!dedupe) {
      entries.push({
        key,
        title: config.title,
        at: new Date().toISOString(),
        stateHash,
        fp,
      });
      writeLedger(entries);
    }
  }

  if (opts.emitArtifact && (creativeFile || fp.structure.sceneCount >= 1)) {
    artifactPath = writeArtifact(config, dir, opts.outDir, fp, claims, self, sibling.advisories);
  }
  return { fp, self, citations, sibling, lines, artifactPath, ledger: readLedger() };
}

module.exports = {
  fingerprint,
  parseClaims,
  selfCheck,
  siblingCheck,
  citationAdvisories,
  writeArtifact,
  run,
  SIBLING_PALETTE_THRESHOLD,
};
