// GET /api/config -> public plan and pack list, and whether accounts are switched on.
const { base } = require('./_lib.js');
const db = require('./_db.js');

module.exports = async (req, res) => {
  if (!base(req, res, { method: 'GET', name: 'config', max: 60 })) return;
  if (!db.configured()) return res.status(200).json({ backend: false });
  try {
    const plans = await db.rest('plans?active=eq.true&select=id,name,price_inr,ai,voice,sort&order=sort.asc');
    const packs = await db.rest('wallet_packs?active=eq.true&select=id,price_inr,credit_micro,sort&order=sort.asc');
    return res.status(200).json({
      backend: true,
      plans,
      packs,
      pay: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      ai: !!process.env.OPENAI_API_KEY,
      lowUsd: Number(process.env.LOW_BALANCE_USD) > 0 ? Number(process.env.LOW_BALANCE_USD) : 1
    });
  } catch (_) {
    return res.status(502).json({ error: 'db_error' });
  }
};
