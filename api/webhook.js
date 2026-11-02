// POST /api/webhook  (Razorpay -> server). Verifies the signature on the raw body, then applies the payment.
const db = require('./_db.js');
const pay = require('./_pay.js');

function raw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!db.configured() || !process.env.RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ error: 'not_configured' });

  let buf;
  try { buf = await raw(req); } catch (_) { return res.status(400).json({ error: 'bad_request' }); }
  const sig = req.headers['x-razorpay-signature'];
  if (!pay.same(pay.hmac(process.env.RAZORPAY_WEBHOOK_SECRET, buf), sig)) return res.status(400).json({ error: 'bad_signature' });

  let evt;
  try { evt = JSON.parse(buf.toString('utf8')); } catch (_) { return res.status(400).json({ error: 'bad_request' }); }

  const p = evt && evt.payload && evt.payload.payment && evt.payload.payment.entity;
  if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && p && p.status === 'captured' && p.order_id) {
    try {
      const r = await db.rpc('apply_payment', { p_provider: 'razorpay', p_payment_id: p.id, p_order_id: p.order_id, p_amount_inr: Math.round(p.amount / 100) });
      return res.status(200).json({ status: r.status });
    } catch (_) {
      return res.status(500).json({ error: 'apply_failed' }); // Razorpay will retry
    }
  }
  return res.status(200).json({ status: 'ignored' });
}

handler.config = { api: { bodyParser: false } };
module.exports = handler;
