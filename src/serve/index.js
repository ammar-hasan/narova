'use strict';
/* Range-capable static server (LEARNINGS #17: plain http.server returns 200 not 206
 * so seeking breaks). Serves out/ plus a small landing index (video + download +
 * player link). */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.mp4': 'video/mp4', '.m4a': 'audio/mp4',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};
const mime = p => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

function landingPage(root, title) {
  const has = f => fs.existsSync(path.join(root, f));
  const mp4 = ['video.mp4', 'reel.mp4'].find(has);
  const player = has('player.html') ? 'player.html' : null;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#070b13;color:#eaf1fb;font-family:system-ui,-apple-system,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
.wrap{max-width:1000px;width:92%;padding:32px}h1{font-weight:800;letter-spacing:-.02em}
video{width:100%;border-radius:12px;border:1px solid #223350;background:#000}
.row{display:flex;gap:14px;margin-top:16px;flex-wrap:wrap}
a.btn{font-family:ui-monospace,Menlo,monospace;font-size:14px;color:#2ee6d6;text-decoration:none;border:1px solid #178f86;border-radius:9px;padding:10px 16px}
a.btn:hover{background:#0c1526}.muted{color:#8595b4;font-size:13px}</style></head>
<body><div class=wrap><h1>${esc(title)}</h1>
${mp4 ? `<video controls preload=metadata src="${mp4}"></video>` : '<p class=muted>No video.mp4 yet — run <code>narova build</code>.</p>'}
<div class=row>
${mp4 ? `<a class=btn href="${mp4}" download>⬇ download mp4</a>` : ''}
${player ? `<a class=btn href="player.html">▶ interactive player</a>` : ''}
</div></div></body></html>`;
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function serveFile(req, res, filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { res.writeHead(404); return res.end('not found'); }
  const size = stat.size;
  const ctype = mime(filePath);
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': ctype,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res).on('error', () => res.end());
  } else {
    res.writeHead(200, { 'Content-Type': ctype, 'Accept-Ranges': 'bytes', 'Content-Length': size });
    fs.createReadStream(filePath).pipe(res).on('error', () => res.end());
  }
}

/* Start the server. Returns the http.Server. */
function serve(root, opts = {}) {
  const port = opts.port || 8080;
  const host = opts.host || '0.0.0.0';
  const title = opts.title || 'narova';
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/' || urlPath === '/index.html') {
      const body = landingPage(root, title);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }
    // Resolve safely under root (no path traversal).
    const resolved = path.normalize(path.join(root, urlPath));
    if (!resolved.startsWith(path.resolve(root))) { res.writeHead(403); return res.end('forbidden'); }
    serveFile(req, res, resolved);
  });
  server.listen(port, host, () => {
    const shown = host === '0.0.0.0' ? 'localhost' : host;
    (opts.log || console.log)(`serving ${root} on http://${shown}:${port}`);
  });
  return server;
}

module.exports = { serve, landingPage };
