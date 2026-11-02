// GET /api/me -> this account's profile, plan, expiry and wallet balance.
const { base } = require('./_lib.js');
const db = require('./_db.js');

module.exports = async (req, res) => {
  if (!base(req, res, { method: 'GET', name: 'me', max: 60 })) return;
  if (!db.configured()) return res.status(503).json({ error: 'not_configured' });
  const user = await db.userFrom(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  try {
    const state = await db.rpc('account_state', { p_user: user.id });
    return res.status(200).json(Object.assign({ email: user.email, server_time: Date.now() }, state));
  } catch (_) {
    return res.status(502).json({ error: 'db_error' });
  }
};
