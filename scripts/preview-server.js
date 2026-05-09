#!/usr/bin/env node
/**
 * Servidor local zero-dep para preview de decks Goberna.
 * Sirve archivos de output/ y ejemplos/ en http://localhost:3000.
 *
 * Hot-reload: cualquier cambio en output/ dispara un evento SSE → el
 * <script> inyectado al final del HTML hace location.reload().
 *
 * History: antes de devolver el HTML, NO toca el archivo. La copia de
 * seguridad la hace el flow del agente (output/.history/) — acá solo
 * se sirve.
 *
 * Uso: npm start  (o: node scripts/preview-server.js)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'output');
const HISTORY_DIR = path.join(OUTPUT_DIR, '.history');

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

// ── SSE clients ──────────────────────────────────────────────────
const sseClients = new Set();

function broadcastReload(file) {
  const payload = JSON.stringify({ type: 'reload', file, ts: Date.now() });
  for (const res of sseClients) {
    try { res.write(`data: ${payload}\n\n`); } catch { /* noop */ }
  }
}

// Watch output/ recursivamente — fs.watch nos avisa de cualquier cambio.
// Ignoramos .history/ para no causar loops.
let watchDebounce = null;
let lastChange = '';
function startWatcher() {
  if (!fs.existsSync(OUTPUT_DIR)) return;
  fs.watch(OUTPUT_DIR, { recursive: true }, (event, filename) => {
    if (!filename) return;
    if (filename.startsWith('.history')) return;
    if (!filename.endsWith('.html')) return;
    lastChange = filename;
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => broadcastReload(lastChange), 120);
  });
}

// ── Hot-reload script (inyectado al final del <body>) ───────────
const HOT_RELOAD_SNIPPET = `
<script>
(function(){
  if (window.__GOBERNA_HOT__) return;
  window.__GOBERNA_HOT__ = true;
  try {
    var es = new EventSource('/__hot');
    es.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (msg.type === 'reload') {
          // Pequeño delay para que el filesystem termine de escribir
          setTimeout(function(){ location.reload(); }, 80);
        }
      } catch(_) {}
    };
    es.onerror = function() { /* el browser reintenta solo */ };
  } catch(_) {}
})();
</script>
`;

function listHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.html'))
    .sort();
}

function listHistory() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs.readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith('.html'))
    .sort()
    .reverse(); // más reciente primero
}

function indexPage() {
  const outFiles = listHtml(OUTPUT_DIR);
  const exFiles = listHtml(path.join(ROOT, 'ejemplos'));
  const histFiles = listHistory();
  const link = (folder, f) =>
    `<li><a href="/${folder}/${encodeURIComponent(f)}">${f}</a></li>`;
  const histLink = (f) =>
    `<li><a href="/output/.history/${encodeURIComponent(f)}">${f}</a></li>`;

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
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; background:#fbbf24; color:#0a1f4a; font-weight:700; vertical-align: middle; margin-left:8px; }
</style>
</head><body>
<h1>Goberna · Preview Server <span class="pill">hot-reload activo</span></h1>
<p style="color:rgba(255,255,255,.7)">Decks generados localmente. Cambios en <code>output/</code> recargan el browser automáticamente.</p>

<h2>output/</h2>
<ul>${outFiles.length ? outFiles.map(f => link('output', f)).join('') : '<li class="empty">Todavía no hay decks generados.</li>'}</ul>

<h2>history/ (últimas 30)</h2>
<ul>${histFiles.length ? histFiles.slice(0, 30).map(f => histLink(f)).join('') : '<li class="empty">Sin history. Se generan automáticamente al editar.</li>'}</ul>

<h2>ejemplos/</h2>
<ul>${exFiles.length ? exFiles.map(f => link('ejemplos', f)).join('') : '<li class="empty">Sin ejemplos.</li>'}</ul>
</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // SSE endpoint para hot-reload
  if (url === '/__hot') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

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

    // Inyectamos el snippet de hot-reload al final del body de los HTML
    if (ext === '.html') {
      fs.readFile(filePath, 'utf8', (err2, html) => {
        if (err2) { res.writeHead(500).end('Read error'); return; }
        const injected = html.includes('</body>')
          ? html.replace('</body>', `${HOT_RELOAD_SNIPPET}</body>`)
          : html + HOT_RELOAD_SNIPPET;
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(injected);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  ▸ Goberna preview\n  ▸ http://localhost:${PORT}\n  ▸ hot-reload activo (output/ → SSE → location.reload())\n`);
  startWatcher();
});
