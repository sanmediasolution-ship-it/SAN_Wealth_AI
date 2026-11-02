// Supabase access from the server only. The service-role key never reaches the browser.
const enc = encodeURIComponent;
const url = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const configured = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_ANON_KEY);

async function rest(path, opts) {
  const o = opts || {};
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(url() + '/rest/v1/' + path, {
    method: o.method || 'GET',
    headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=representation' }, o.headers || {}),
    body: o.body ? JSON.stringify(o.body) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  if (!r.ok) { const e = new Error('db_' + r.status); e.status = r.status; e.detail = data; throw e; }
  return data;
}

const rpc = (fn, args) => rest('rpc/' + fn, { method: 'POST', body: args });

// Supabase Auth, called with the public (anon) key.
async function auth(path, payload, query) {
  const r = await fetch(url() + '/auth/v1/' + path + (query ? '?' + query : ''), {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return { ok: r.ok, status: r.status, data: data || {} };
}

// Who is calling? Identity always comes from the verified token, never from the request body.
async function userFrom(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return null;
  try {
    const r = await fetch(url() + '/auth/v1/user', { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id, email: u.email || '' } : null;
  } catch (_) { return null; }
}

module.exports = { enc, configured, rest, rpc, auth, userFrom };
