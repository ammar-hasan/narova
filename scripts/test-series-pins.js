'use strict';
// Actual pinned CI/style/font/exchange proof. Requires ready rendering tools.
// NAROVA_PINS_FONT_DIR supplies three local Noto Sans Arabic WOFF2 fixtures.
// Browser readback uses NAROVA_CSS_BROWSER_MODULE/PATH; no providers/models.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const product = process.env.NAROVA_PINS_PRODUCT || path.resolve(__dirname, '..');
const series = require(path.join(product, 'tool/src/series'));
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-series-pins-'));
const source = path.join(evidence, 'source');
const checkout = path.join(evidence, 'checkout');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 2) + '\n'); };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { evidence, toolVersion: require(path.join(product, 'tool/package.json')).version, checks: [], videos: [], browser: [] };
const pass = name => { report.checks.push(name); console.log('PASS ' + name); };
let sequence = 0, browser, server;
function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NAROVA_FIRST_RUN: '0' }, ...options });
  write(path.join(evidence, `command-${++sequence}.log`), (result.stdout || '') + (result.stderr || ''));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
function cli(args, fail = false) {
  const result = spawnSync(process.execPath, [path.join(product, 'tool/bin/narova.js'), ...args, '--json'], { encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NAROVA_FIRST_RUN: '0' } });
  write(path.join(evidence, `command-${++sequence}.log`), (result.stdout || '') + (result.stderr || ''));
  if (fail) { assert.notEqual(result.status, 0, 'expected pre-production failure'); return JSON.parse(result.stdout); }
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}
const project = id => path.join(checkout, 'episodes', id);
const build = (id, extra = []) => cli(['series', 'build', checkout, '--episode', id, '--fps', '10', '--quality', 'draft', ...extra]);
function frame(directory, label, expected) {
  const video = path.join(directory, 'out/video.mp4');
  const metadata = JSON.parse(execute('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', video]));
  assert.ok(Math.abs(Number(metadata.format.duration) - 1) < 0.1);
  const pixels = spawnSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', video, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1024 * 1024 });
  assert.equal(pixels.status, 0, pixels.stderr?.toString()); assert.equal(pixels.stdout.length, 320 * 180 * 3);
  const counts = { red: 0, green: 0, blue: 0 };
  for (let i = 0; i < pixels.stdout.length; i += 3) {
    const r = pixels.stdout[i], g = pixels.stdout[i + 1], b = pixels.stdout[i + 2];
    if (r > 180 && g < 80 && b < 80) counts.red++;
    if (g > 180 && r < 80 && b < 80) counts.green++;
    if (b > 180 && r < 80 && g < 80) counts.blue++;
  }
  assert.ok(counts[expected] > 10000, `${label}: expected ${expected} shared fill`); assert.ok(counts.blue > 1000, `${label}: local border missing`);
  const copy = path.join(evidence, label + '.mp4'); fs.copyFileSync(video, copy);
  execute('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', video, '-frames:v', '1', '-y', path.join(evidence, label + '.png')]);
  const value = { label, path: copy, sha256: hash(copy), seconds: Number(metadata.format.duration), pixels: counts }; report.videos.push(value); return value;
}
async function readback(directory, label, color) {
  const generated = fs.readdirSync(path.join(directory, 'out')).map(n => path.join(directory, 'out', n)).find(p => fs.existsSync(path.join(p, 'index.html')));
  assert.ok(generated, 'missing composed browser document');
  const page = await browser.newPage();
  try {
    const url = `http://127.0.0.1:${server.address().port}/${path.relative(evidence, generated).split(path.sep).join('/')}/index.html`;
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => Boolean(window.__timelines?.main));
    await page.evaluate(() => { window.__timelines.main.seek(0.5); });
    const value = await page.evaluate(async () => {
      const families = ['PinRegular', 'PinArabic', 'PinBold'];
      const faces = [];
      for (let i = 0; i < families.length; i++) {
        const loaded = await document.fonts.load(`16px "${families[i]}"`, i === 1 ? 'مرحبا' : 'Shared');
        faces.push({ family: families[i], loaded: loaded.map(f => ({ family: f.family, status: f.status })), applied: getComputedStyle(document.querySelector('.font-' + i)).fontFamily });
      }
      const panel = getComputedStyle(document.querySelector('.panel'));
      const image = getComputedStyle(document.querySelector('.image')).backgroundImage;
      return { fill: panel.backgroundColor, border: panel.borderTopColor, faces, image };
    });
    assert.equal(value.fill, color); assert.equal(value.border, 'rgb(0, 0, 255)');
    for (const face of value.faces) { assert.equal(face.loaded.length, 1); assert.equal(face.loaded[0].status, 'loaded'); assert.match(face.applied, new RegExp(face.family)); }
    const imageURL = value.image.match(/url\("([^"]+)"\)/)?.[1]; assert.ok(imageURL); const bytes = await fetch(imageURL); assert.equal(bytes.status, 200);
    value.imageSha256 = crypto.createHash('sha256').update(Buffer.from(await bytes.arrayBuffer())).digest('hex'); assert.equal(value.imageSha256, report.sharedImageSha256);
    report.browser.push({ label, ...value });
  } finally { await page.close(); }
}
(async () => {
  try {
    console.log('Evidence: ' + path.join(evidence, 'results.json'));
    const fontDirectory = process.env.NAROVA_PINS_FONT_DIR || path.join(product, 'tool/node_modules/@fontsource/noto-sans-arabic/files');
    const fontNames = ['noto-sans-arabic-latin-400-normal.woff2', 'noto-sans-arabic-arabic-400-normal.woff2', 'noto-sans-arabic-latin-700-normal.woff2'];
    const fonts = fontNames.map((name, i) => { const file = path.join(fontDirectory, name); assert.ok(fs.existsSync(file), 'Set NAROVA_PINS_FONT_DIR to the existing local font fixtures'); const relative = `fonts/font-${i}.woff2`; write(path.join(source, relative), fs.readFileSync(file)); return relative; });
    write(path.join(source, 'media/shared.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#00ff00"/></svg>'); report.sharedImageSha256 = hash(path.join(source, 'media/shared.svg'));
    const css = color => fonts.map((f, i) => `@font-face{font-family:"${['PinRegular', 'PinArabic', 'PinBold'][i]}";src:url("../${f}")}`).join('\n') + `\n.panel{background:rgb(${color})}.image{background-image:url("../media/shared.svg")}`;
    write(path.join(source, 'styles/look.css'), css('255,0,0'));
    write(path.join(source, 'series.config.json'), { format: series.FORMAT, id: 'daily', title: 'Daily', defaults: { theme: { accent: '#ffffff' } }, resources: { look: { file: 'styles/look.css', dependencies: [...fonts, 'media/shared.svg'] } }, episodes: ['day1', 'day2', 'day3'].map(id => ({ id, title: id, project: 'episodes/' + id })) });
    const body = '<div class="font-0" style="font-family:PinRegular;color:white;font-size:16px">Shared regular</div><div class="panel" style="position:absolute;left:30px;top:35px;width:200px;height:100px;box-sizing:border-box"></div><div class="image" style="position:absolute;left:250px;top:35px;width:20px;height:20px"></div><span class="font-1" style="position:absolute;left:30px;top:140px;font-family:PinArabic;color:white">مرحبا</span><span class="font-2" style="position:absolute;left:150px;top:140px;font-family:PinBold;color:white">Shared bold</span>';
    for (const id of ['day1', 'day2', 'day3']) {
      const episode = path.join(source, 'episodes', id);
      write(path.join(episode, 'reel.config.json'), { title: 'Pin ' + id, size: { w: 320, h: 180 }, renderer: 'hyperframes', captions: false, chrome: false, theme: { css: 'theme.css' }, scenes: [{ id: 'one', dur: 1, vo: [], body }] });
      write(path.join(episode, 'theme.css'), `@import "${series.FILES}styles/look.css";\n.panel{border:8px solid rgb(0,0,255)}`);
      write(path.join(episode, 'creative-brief.md'), '# Creative brief\nStatus: ready\nAmbition: routine\n\nPinned style and shared-font proof.\n');
    }
    for (const id of ['day1', 'day2']) cli(['series', 'pin', source, '--episode', id, '--resources', 'look']);
    write(path.join(source, 'styles/look.css'), css('0,255,0')); cli(['series', 'pin', source, '--episode', 'day3', '--resources', 'look']);
    const objects = fs.readdirSync(path.join(source, series.STORE, 'files')); assert.equal(objects.length, 6); report.uniqueStoredPayloads = objects.length; report.fontHashes = fonts.map(f => hash(path.join(source, f))); assert.equal(new Set(report.fontHashes).size, 3); pass('three episode pins retain two stylesheet versions and three font versions once, with one shared image');
    write(path.join(source, '.gitignore'), '**/.narova-series/\n**/series-membership.json\n**/out/\n');
    execute('git', ['init', '-b', 'main'], { cwd: source }); execute('git', ['add', '.'], { cwd: source }); execute('git', ['-c', 'user.name=Narova pin proof', '-c', 'user.email=probe@example.invalid', 'commit', '-m', 'Pinned episode sources'], { cwd: source });
    report.sourceCommit = execute('git', ['rev-parse', 'HEAD'], { cwd: source }).trim(); execute('git', ['clone', '--depth', '1', 'file://' + source, checkout], { cwd: evidence }); assert.equal(execute('git', ['rev-parse', '--is-shallow-repository'], { cwd: checkout }).trim(), 'true');
    for (const id of ['day1', 'day2', 'day3']) assert.equal(fs.existsSync(path.join(project(id), series.HOME)), false);
    browser = await require(process.env.NAROVA_CSS_BROWSER_MODULE || 'puppeteer-core').launch({ executablePath: process.env.NAROVA_CSS_BROWSER_PATH, headless: true, args: ['--no-sandbox'] });
    server = http.createServer((req, res) => { const file = path.resolve(evidence, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); if (!file.startsWith(evidence + path.sep)) { res.writeHead(403); res.end(); return; } try { res.setHeader('Content-Type', ({ '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); } catch { res.writeHead(404); res.end(); } }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const videos = {};
    for (const id of ['day1', 'day2', 'day3']) { build(id); const green = id === 'day3'; videos[id] = frame(project(id), id, green ? 'green' : 'red'); await readback(project(id), id, green ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)'); }
    pass('fresh shallow Git checkout builds old/red and new/green episodes with local blue borders, three loaded fonts and source-relative image bytes');
    const corruptBinding = series.readBinding(project('day1')); const member = corruptBinding.files.find(f => f.path === fonts[0]); const object = path.join(checkout, series.STORE, 'files', member.sha256); const good = fs.readFileSync(object); write(object, Buffer.from('corrupt pinned font'));
    const failure = cli(['series', 'build', checkout, '--episode', 'day1', '--reuse'], true); assert.match(JSON.stringify(failure), /mismatch|stored byte count/); assert.equal(hash(path.join(project('day1'), 'out/video.mp4')), videos.day1.sha256); fs.writeFileSync(object, good); pass('corrupt selected store fails before production/reuse and preserves existing output despite valid local copies');
    write(path.join(checkout, 'styles/look.css'), css('0,255,0')); build('day1', ['--reuse']); const retained = frame(project('day1'), 'retained', 'red'); assert.equal(retained.sha256, videos.day1.sha256); pass('live shared edits cannot alter a pinned repeat or its exact video bytes');
    cli(['series', 'pin', checkout, '--episode', 'day1']); const mismatch = cli(['series', 'build', checkout, '--episode', 'day1', '--reuse'], true); assert.match(JSON.stringify(mismatch), /--update-shared/); build('day1', ['--update-shared', '--reuse']); frame(project('day1'), 'adopted', 'green'); await readback(project('day1'), 'adopted', 'rgb(0, 255, 0)'); assert.equal(hash(path.join(project('day2'), 'out/video.mp4')), videos.day2.sha256); assert.equal(fs.readdirSync(path.join(checkout, series.STORE, 'files')).length, 6); pass('explicit repin/update adopts one episode without changing sibling output or duplicating unchanged fonts');
    const packed = path.join(evidence, 'day1.narova'), opened = path.join(evidence, 'opened'), detached = path.join(evidence, 'detached'); cli(['pack', '--project', project('day1'), '--output', packed]); cli(['open', packed, '--dir', opened]); cli(['series', 'detach', detached, '--project', project('day2')]); fs.rmSync(checkout, { recursive: true }); fs.rmSync(source, { recursive: true });
    for (const [directory, label, green] of [[opened, 'opened', true], [detached, 'detached', false]]) { cli(['build', '--project', directory, '--fps', '10', '--quality', 'draft']); frame(directory, label, green ? 'green' : 'red'); await readback(directory, label, green ? 'rgb(0, 255, 0)' : 'rgb(255, 0, 0)'); }
    pass('archive/open and detached episode render and load all three fonts after both series trees/stores are deleted'); report.status = 'pass';
  } catch (error) { report.status = 'fail'; report.error = error.stack; process.exitCode = 1; console.error(error); }
  finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); write(path.join(evidence, 'results.json'), report); console.log('Evidence: ' + path.join(evidence, 'results.json')); }
})();
