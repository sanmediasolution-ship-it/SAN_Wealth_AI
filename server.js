// SAN WEALTH AI: static app + API on one Node server (no dependencies).
const http = require('http'), fs = require('fs'), path = require('path');
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const handlers = {};
for (const f of fs.readdirSync(path.join(__dirname, 'api'))) {
  if (f.startsWith('_') || !f.endsWith('.js')) continue;
  handlers[f.slice(0, -3)] = require('./api/' + f);
}
function readBody(req) { return new Promise((ok, no) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); req.on('error', no); }); }
function shim(res) {
  res.status = n => { res.statusCode = n; return res; };
  res.json = o => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  res.send = b => { res.end(typeof b === 'object' && !Buffer.isBuffer(b) ? JSON.stringify(b) : b); return res; };
  return res;
}
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') { res.end('ok'); return; }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/\/$/, ''), h = handlers[name];
      if (!h) { shim(res).status(404).json({ error: 'not_found' }); return; }
      req.query = Object.fromEntries(url.searchParams);
      const raw = h.config && h.config.api && h.config.api.bodyParser === false;
      if (!raw && req.method !== 'GET' && req.method !== 'OPTIONS') {
        const b = await readBody(req);
        try { req.body = b.length ? JSON.parse(b.toString('utf8')) : {}; } catch (_) { req.body = {}; }
      }
      await h(req, shim(res)); return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(PUB, p));
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('Not found'); return; }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', /sw\.js|index\.html|manifest/.test(file) ? 'no-cache' : 'public, max-age=300');
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end('error'); } else res.end(); }
}).listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('listening'));
