// Razorpay helpers (server side only).
const crypto = require('crypto');

const ready = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
const basic = () => 'Basic ' + Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64');

function hmac(secret, data) { return crypto.createHmac('sha256', secret).update(data).digest('hex'); }
function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function createOrder(amountInr, notes) {
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: basic(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountInr * 100, currency: 'INR', receipt: 'sw' + Date.now().toString(36), notes })
  });
  if (!r.ok) throw new Error('razorpay_' + r.status);
  return r.json();
}

async function getPayment(id) {
  const r = await fetch('https://api.razorpay.com/v1/payments/' + encodeURIComponent(id), { headers: { Authorization: basic() } });
  if (!r.ok) throw new Error('razorpay_' + r.status);
  return r.json();
}

module.exports = { ready, hmac, same, createOrder, getPayment };
