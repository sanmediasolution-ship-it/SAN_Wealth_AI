// Access rules and billing for AI calls.
const db = require('./_db.js');

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const MARKUP = () => num(process.env.AI_MARKUP, 2);          // multiplier over raw OpenAI cost
const LOW_MICRO = () => Math.round(num(process.env.LOW_BALANCE_USD, 1) * 1e6);

// Cost in micro-US-dollars (1,000,000 = $1), rounded up.
function chatCost(usage) {
  const inM = num(process.env.AI_IN_USD_PER_M, 0.15), outM = num(process.env.AI_OUT_USD_PER_M, 0.60);
  const u = usage || {};
  const usd = ((u.prompt_tokens || 0) * inM + (u.completion_tokens || 0) * outM) / 1e6;
  return Math.max(1, Math.ceil(usd * 1e6 * MARKUP()));
}
function sttCost(seconds) {
  const perMin = num(process.env.AI_STT_USD_PER_MIN, 0.006);
  return Math.max(1, Math.ceil((Math.max(1, seconds) / 60) * perMin * 1e6 * MARKUP()));
}

// Returns { user, state } if this user may use the feature ('ai' or 'voice'); otherwise answers and returns null.
async function gate(req, res, feature) {
  if (!db.configured()) { res.status(503).json({ error: 'not_configured' }); return null; }
  if (!process.env.OPENAI_API_KEY) { res.status(503).json({ error: 'not_configured' }); return null; }
  const user = await db.userFrom(req);
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return null; }
  let state;
  try { state = await db.rpc('account_state', { p_user: user.id }); }
  catch (_) { res.status(502).json({ error: 'db_error' }); return null; }
  if (!state || !state.active) { res.status(402).json({ error: 'subscription_inactive' }); return null; }
  if (!state.plan || !state.plan[feature]) { res.status(403).json({ error: feature === 'voice' ? 'plan_no_voice' : 'plan_no_ai' }); return null; }
  if (!(state.balance_micro > 0)) { res.status(402).json({ error: 'no_balance', balance_micro: Math.max(0, state.balance_micro || 0) }); return null; }
  return { user, state };
}

// Deduct the real cost of a finished call. Sends the low-balance email once when it crosses the limit.
async function charge(user, state, micro, ref, mail) {
  const r = await db.rpc('wallet_apply', { p_user: user.id, p_delta: -micro, p_reason: 'ai', p_ref: ref, p_low: LOW_MICRO() });
  if (r && r.crossed_low && user.email) {
    try {
      const name = (state.profile && state.profile.full_name) || '';
      await mail.lowBalance(user.email, name, r.balance_micro);
    } catch (_) {}
  }
  return r && typeof r.balance_micro === 'number' ? r.balance_micro : null;
}

module.exports = { gate, charge, chatCost, sttCost, LOW_MICRO };
