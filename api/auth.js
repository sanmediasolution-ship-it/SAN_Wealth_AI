// POST /api/auth  { action: signup | login | refresh | logout, ... }
const { base, body } = require('./_lib.js');
const db = require('./_db.js');

const PURPOSES = ['Personal money tracking', 'My business accounts', 'Both personal and business', 'Other'];
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const money = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null; };

function session(j) {
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: j.expires_in, uid: j.user && j.user.id };
}

module.exports = async (req, res) => {
  if (!base(req, res, { name: 'auth', max: 20 })) return;
  if (!db.configured()) return res.status(503).json({ error: 'not_configured' });
  const b = body(req);

  try {
    if (b.action === 'signup') {
      const email = clean(b.email, 254).toLowerCase();
      const password = String(b.password || '');
      const p = {
        full_name: clean(b.full_name, 80), phone: clean(b.phone, 20).replace(/[^\d+]/g, ''),
        city: clean(b.city, 80), business: clean(b.business, 100), purpose: clean(b.purpose, 40),
        monthly_income: money(b.monthly_income), monthly_expense: money(b.monthly_expense)
      };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'invalid_email' });
      if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'weak_password' });
      if (p.full_name.length < 2) return res.status(400).json({ error: 'invalid_name' });
      if (p.phone.replace(/\D/g, '').length < 7 || p.phone.replace(/\D/g, '').length > 15) return res.status(400).json({ error: 'invalid_phone' });
      if (p.city.length < 2 || p.business.length < 2) return res.status(400).json({ error: 'missing_fields' });
      if (!PURPOSES.includes(p.purpose)) return res.status(400).json({ error: 'missing_fields' });
      if (p.monthly_income === null || p.monthly_expense === null) return res.status(400).json({ error: 'invalid_amounts' });

      const r = await db.auth('signup', { email, password, data: { full_name: p.full_name } });
      if (!r.ok) {
        const msg = String(r.data.msg || r.data.message || r.data.error_description || '').toLowerCase();
        if (r.status === 429) return res.status(429).json({ error: 'rate_limited' });
        if (msg.includes('already')) return res.status(409).json({ error: 'email_exists' });
        if (msg.includes('password')) return res.status(400).json({ error: 'weak_password' });
        return res.status(400).json({ error: 'signup_failed' });
      }
      const u = r.data.user || r.data;
      if (!u || !u.id) return res.status(400).json({ error: 'signup_failed' });
      // Supabase hides "already registered" by returning a user with no identities.
      if (Array.isArray(u.identities) && u.identities.length === 0) return res.status(409).json({ error: 'email_exists' });
      try { await db.rest('profiles', { method: 'POST', body: Object.assign({ id: u.id }, p) }); }
      catch (e) { if (e.status !== 409) return res.status(502).json({ error: 'db_error' }); }
      if (r.data.access_token) return res.status(200).json({ session: session(r.data) });
      return res.status(200).json({ confirm: true });
    }

    if (b.action === 'login') {
      const r = await db.auth('token', { email: clean(b.email, 254).toLowerCase(), password: String(b.password || '') }, 'grant_type=password');
      if (!r.ok) {
        const msg = String(r.data.msg || r.data.error_description || r.data.message || '').toLowerCase();
        if (msg.includes('not confirmed')) return res.status(401).json({ error: 'email_not_confirmed' });
        if (r.status === 429) return res.status(429).json({ error: 'rate_limited' });
        return res.status(401).json({ error: 'invalid_login' });
      }
      return res.status(200).json({ session: session(r.data) });
    }

    if (b.action === 'refresh') {
      const r = await db.auth('token', { refresh_token: String(b.refresh_token || '') }, 'grant_type=refresh_token');
      if (!r.ok) return res.status(401).json({ error: 'session_expired' });
      return res.status(200).json({ session: session(r.data) });
    }

    if (b.action === 'logout') {
      const h = String(req.headers.authorization || '');
      if (h.startsWith('Bearer ')) {
        try { await fetch(String(process.env.SUPABASE_URL).replace(/\/+$/, '') + '/auth/v1/logout', { method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: h } }); } catch (_) {}
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'bad_request' });
  } catch (_) {
    return res.status(502).json({ error: 'server_error' });
  }
};
