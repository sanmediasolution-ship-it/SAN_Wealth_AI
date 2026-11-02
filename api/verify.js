// POST /api/verify  { order_id, payment_id, signature }  -> confirms a payment with Razorpay itself, then applies it.
// The webhook (api/webhook.js) does the same job as a backup. Applying twice is safe.
const { base, body } = require('./_lib.js');
const db = require('./_db.js');
const pay = require('./_pay.js');

module.exports = async (req, res) => {
  if (!base(req, res, { name: 'verify', max: 30 })) return;
  if (!db.configured()) return res.status(503).json({ error: 'not_configured' });
  if (!pay.ready()) return res.status(503).json({ error: 'pay_not_configured' });
  const user = await db.userFrom(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const b = body(req);
  const orderId = String(b.order_id || ''), paymentId = String(b.payment_id || ''), sig = String(b.signature || '');
  if (!orderId || !paymentId) return res.status(400).json({ error: 'bad_request' });
  if (!pay.same(pay.hmac(process.env.RAZORPAY_KEY_SECRET, orderId + '|' + paymentId), sig)) return res.status(400).json({ error: 'bad_signature' });

  try {
    const rows = await db.rest('orders?provider_order_id=eq.' + db.enc(orderId) + '&select=user_id,amount_inr');
    if (!rows.length || rows[0].user_id !== user.id) return res.status(404).json({ error: 'not_found' });

    const p = await pay.getPayment(paymentId); // never trust the browser: ask Razorpay
    if (p.order_id !== orderId) return res.status(400).json({ error: 'mismatch' });
    if (p.status !== 'captured') return res.status(202).json({ status: 'pending' }); // webhook finishes it once captured

    const r = await db.rpc('apply_payment', { p_provider: 'razorpay', p_payment_id: p.id, p_order_id: orderId, p_amount_inr: Math.round(p.amount / 100) });
    return res.status(200).json({ status: r.status });
  } catch (_) {
    return res.status(502).json({ error: 'verify_failed' });
  }
};
