// POST /api/ai  { text, lang, context }  ->  { data: { intent, entries, reply }, balance_micro }
// Needs a signed-in user with an active plan that includes AI and a wallet balance. The real cost is deducted.
const crypto = require('crypto');
const { base, body, mapOpenAIError } = require('./_lib.js');
const { gate, charge, chatCost } = require('./_ai.js');
const mail = require('./_mail.js');

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const LANGS = { ta: 'Tamil', en: 'English', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', ar: 'Arabic', es: 'Spanish', fr: 'French', id: 'Indonesian', zh: 'Chinese', ja: 'Japanese' };

module.exports = async (req, res) => {
  if (!base(req, res, { name: 'ai', max: 30 })) return;
  const g = await gate(req, res, 'ai');
  if (!g) return;

  const b = body(req);
  const text = String(b.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'empty' });
  const context = JSON.stringify(b.context || {}).slice(0, 5000);
  const lang = LANGS[String(b.lang || '')];

  const system = [
    'You are SAN WEALTH AI, a friendly personal finance assistant inside a money-tracking app.',
    'The user may type or speak in any language, including Tamil, Hindi, English or mixed languages. Reply in the same language and script the user used' + (lang ? ' (the user prefers ' + lang + ')' : '') + '.',
    'Reply with ONLY a JSON object: {"intent":"add"|"ask","entries":[{"type":"expense"|"income","amount":number,"category":string,"note":string,"date":"YYYY-MM-DD"}],"reply":string}.',
    'Use intent "add" when the user says they spent, paid, bought, received, earned or were credited an amount. Add one entry per amount. The amount must be stated by the user (numbers or number words in any language); never guess an amount. Use the summary JSON for today\'s date, the currency and the allowed categories; pick the closest category or "Other". Resolve words like today, yesterday into a date. Keep note under 40 characters, in the user\'s language. In reply, confirm briefly what was added.',
    'Use intent "ask" for questions or advice, with entries []. If the user wants to add something but gives no amount, use "ask" and politely ask for the amount.',
    'For questions, use only the numbers in the summary JSON. If the data is not there, say so. Give practical, brief advice in at most 120 words. You are not a licensed financial adviser; do not promise returns.'
  ].join('\n');

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: MODEL, temperature: 0.2, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: 'Summary JSON: ' + context + '\n\nUser message: ' + text }]
      })
    });
    if (!r.ok) return res.status(502).json({ error: mapOpenAIError(r.status) });

    const j = await r.json();
    const raw = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    let d;
    try { d = JSON.parse(raw); } catch (_) { d = { intent: 'ask', entries: [], reply: String(raw || '') }; }

    const entries = (Array.isArray(d.entries) ? d.entries : []).slice(0, 5).map(e => ({
      type: e && e.type === 'income' ? 'income' : 'expense',
      amount: Number(e && e.amount),
      category: String((e && e.category) || 'Other').slice(0, 30),
      note: String((e && e.note) || '').slice(0, 60),
      date: String((e && e.date) || '').slice(0, 10)
    })).filter(e => e.amount > 0 && e.amount < 1e9);

    let balance = null;
    try { balance = await charge(g.user, g.state, chatCost(j.usage), 'use:' + crypto.randomUUID(), mail); } catch (_) {}

    return res.status(200).json({
      data: { intent: d.intent === 'add' && entries.length ? 'add' : 'ask', entries, reply: String(d.reply || '').slice(0, 1500) },
      balance_micro: balance
    });
  } catch (_) {
    return res.status(502).json({ error: 'ai_error' });
  }
};
