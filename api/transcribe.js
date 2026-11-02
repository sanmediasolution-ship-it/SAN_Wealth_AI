// POST /api/transcribe  { audio: base64, mime, lang }  ->  { text, language, balance_micro }
// Voice notes need the Super Premium plan, an active subscription and wallet balance.
const crypto = require('crypto');
const { base, body, mapOpenAIError } = require('./_lib.js');
const { gate, charge, sttCost } = require('./_ai.js');
const mail = require('./_mail.js');

const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

module.exports = async (req, res) => {
  if (!base(req, res, { name: 'stt', max: 20 })) return;
  const g = await gate(req, res, 'voice');
  if (!g) return;

  const b = body(req);
  const audio = String(b.audio || '');
  if (!audio) return res.status(400).json({ error: 'empty' });
  if (audio.length > 4200000) return res.status(413).json({ error: 'too_big' });

  const mime = String(b.mime || 'audio/webm').slice(0, 60);
  const mt = mime.split(';')[0].toLowerCase();
  const ext = mt.includes('mp4') ? 'm4a' : mt.includes('ogg') ? 'ogg' : mt.includes('wav') ? 'wav' : mt.includes('mpeg') ? 'mp3' : 'webm';
  const lang = String(b.lang || 'auto');

  try {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mt }), 'voice.' + ext);
    form.append('model', MODEL);
    form.append('response_format', 'verbose_json'); // includes detected language and duration
    if (/^[a-z]{2}$/.test(lang)) form.append('language', lang);

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }, body: form
    });
    if (!r.ok) return res.status(502).json({ error: mapOpenAIError(r.status) });

    const j = await r.json();
    let balance = null;
    try { balance = await charge(g.user, g.state, sttCost(Number(j.duration) || 10), 'use:' + crypto.randomUUID(), mail); } catch (_) {}
    return res.status(200).json({ text: String(j.text || '').slice(0, 1500), language: String(j.language || ''), balance_micro: balance });
  } catch (_) {
    return res.status(502).json({ error: 'ai_error' });
  }
};
