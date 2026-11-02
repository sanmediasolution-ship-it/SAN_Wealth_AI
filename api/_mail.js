// Emails through Resend. If RESEND_API_KEY is not set, nothing is sent and the app keeps working.
async function send(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM || 'SAN WEALTH AI <onboarding@resend.dev>', to: [to], subject, html })
  });
  return r.ok;
}

const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function lowBalance(to, name, micro) {
  const usd = (Math.max(0, micro) / 1e6).toFixed(2);
  return send(to, 'Your AI wallet is running low',
    '<p>Hi ' + esc(name || 'there') + ',</p>' +
    '<p>Your SAN WEALTH AI wallet balance is now <b>$' + usd + '</b>. When it reaches zero, AI chat and voice notes will stop until you recharge.</p>' +
    '<p>Open the app, go to <b>Ask AI</b> and tap <b>Recharge</b>. Your own records and the rest of the app are not affected.</p>' +
    '<p>SAN WEALTH AI</p>');
}

module.exports = { send, lowBalance };
