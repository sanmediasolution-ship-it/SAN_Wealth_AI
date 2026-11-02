// Shared request checks. Files starting with "_" are not exposed as URLs.
const hits = new Map();
// Extra sites allowed to call this API (comma list in ALLOWED_ORIGINS), e.g. the Hostinger copy of the app.
const EXTRA = ['https://slategray-cheetah-199304.hostingersite.com']
  .concat(String(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean));

function limited(key, max) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < 60000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 3000) hits.clear();
  return recent.length > max; // best-effort limit per address per minute
}

// Method, same-site origin and rate limit. Returns true when the request may continue.
function base(req, res, opts) {
  const o = opts || {};
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  let allowed = false;
  if (origin) {
    try { allowed = new URL(origin).host === req.headers.host || EXTRA.includes(new URL(origin).origin); } catch (_) {}
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
  }
  if (req.method === 'OPTIONS') { res.status(allowed ? 204 : 403).end(); return false; }
  if (req.method !== (o.method || 'POST')) { res.status(405).json({ error: 'method_not_allowed' }); return false; }
  if (origin && !allowed) { res.status(403).json({ error: 'forbidden_origin' }); return false; }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip + ':' + (o.name || 'x'), o.max || 40)) { res.status(429).json({ error: 'rate_limited' }); return false; }
  return true;
}

function body(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function mapOpenAIError(status) {
  if (status === 401 || status === 403) return 'ai_auth';
  if (status === 429) return 'ai_busy';
  return 'ai_error';
}

module.exports = { base, body, mapOpenAIError };
