#!/usr/bin/env node
/**
 * Servidor local zero-dep para preview de decks Goberna.
 * Sirve archivos de output/ y ejemplos/ en http://localhost:3000.
 *
 * Uso: npm start  (o: node scripts/preview-server.js)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

function listHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .sort();
}

function indexPage() {
  const outFiles = listHtml(path.join(ROOT, 'output'));
  const exFiles = listHtml(path.join(ROOT, 'ejemplos'));
  const link = (folder, f) =>
    `<li><a href="/${folder}/${encodeURIComponent(f)}">${f}</a></li>`;

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Goberna Decks · Preview</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; background: #0a1f4a; color: white; padding: 40px; max-width: 800px; margin: auto; }
  h1 { color: #fbbf24; font-weight: 900; letter-spacing: -0.02em; }
  h2 { color: #fbbf24; margin-top: 32px; font-size: 14px; text-transform: uppercase; letter-spacing: .25em; }
  ul { list-style: none; padding: 0; }
  li { margin: 6px 0; }
  a { color: white; text-decoration: none; padding: 8px 12px; background: rgba(255,255,255,0.06); border-radius: 8px; display: block; transition: background .2s; }
  a:hover { background: rgba(251,191,36,0.15); }
  .empty { color: rgba(255,255,255,0.4); font-style: italic; }
</style>
</head><body>
<h1>Goberna · Preview Server</h1>
<p style="color:rgba(255,255,255,.7)">Decks generados localmente. Sirviendo desde <code>${ROOT}</code></p>

<h2>output/</h2>
<ul>${outFiles.length ? outFiles.map(f => link('output', f)).join('') : '<li class="empty">Todavía no hay decks generados.</li>'}</ul>

<h2>ejemplos/</h2>
<ul>${exFiles.length ? exFiles.map(f => link('ejemplos', f)).join('') : '<li class="empty">Sin ejemplos.</li>'}</ul>
</body></html>`;
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(indexPage());
  }

  // Solo permitir paths bajo output/ y ejemplos/
  const parts = url.replace(/^\/+/, '').split('/');
  if (!['output', 'ejemplos'].includes(parts[0])) {
    res.writeHead(404).end('Not found');
    return;
  }
  const filePath = path.join(ROOT, ...parts);
  // Sandbox: no permitir salir del ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ▸ Goberna preview\n  ▸ http://localhost:${PORT}\n`);
});
