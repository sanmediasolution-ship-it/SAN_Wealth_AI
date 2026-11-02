// POST /api/checkout  { kind: 'plan' | 'pack', id }  ->  a Razorpay order for the signed-in user.
const { base, body } = require('./_lib.js');
const db = require('./_db.js');
const pay = require('./_pay.js');

module.exports = async (req, res) => {
  if (!base(req, res, { name: 'checkout', max: 15 })) return;
  if (!db.configured()) return res.status(503).json({ error: 'not_configured' });
  if (!pay.ready()) return res.status(503).json({ error: 'pay_not_configured' });
  const user = await db.userFrom(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const b = body(req);
  const kind = b.kind === 'pack' ? 'pack' : b.kind === 'plan' ? 'plan' : '';
  const id = String(b.id || '').slice(0, 40);
  if (!kind || !id) return res.status(400).json({ error: 'bad_request' });

  try {
    const table = kind === 'plan' ? 'plans' : 'wallet_packs';
    const rows = await db.rest(table + '?id=eq.' + db.enc(id) + '&active=eq.true&select=id,price_inr');
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    const price = rows[0].price_inr;

    const state = await db.rpc('account_state', { p_user: user.id });
    if (kind === 'pack' && !(state && state.active)) return res.status(402).json({ error: 'subscription_inactive' });

    const order = await pay.createOrder(price, { user_id: user.id, kind, item_id: id });
    await db.rest('orders', { method: 'POST', body: { provider_order_id: order.id, user_id: user.id, kind, item_id: id, amount_inr: price } });

    const p = (state && state.profile) || {};
    return res.status(200).json({
      order_id: order.id, amount: order.amount, currency: order.currency || 'INR',
      key: process.env.RAZORPAY_KEY_ID, name: p.full_name || '', email: user.email, contact: p.phone || ''
    });
  } catch (_) {
    return res.status(502).json({ error: 'checkout_failed' });
  }
};
