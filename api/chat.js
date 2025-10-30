// /api/chat.js
// ✅ Stable version: P1-qualifier-2025-10-30-03 (Vercel JavaScript)
module.exports = async (req, res) => {
  const VERSION = 'P1-qualifier-2025-10-30-03';
  if (req.method !== 'POST') {
    return res.status(200).json({ ai_reply: 'Method not allowed', version: VERSION });
  }

  const isDebug = String(req.query.debug || '').toLowerCase() === '1';

  // --- Helpers ---
  const S = (v) => (v == null ? '' : String(v));
  const isPlaceholder = (s) =>
    !!s &&
    (/^\s*\{\{[^}]+\}\}\s*$/.test(s) || /^\s*(null|undefined|-+)\s*$/i.test(s));
  const clean = (v) => {
    const s = S(v).trim();
    if (!s || isPlaceholder(s)) return '';
    return s;
  };
  const norm = (v) => clean(v).toLowerCase().replace(/\s+/g, ' ').trim();

  const parseAmount = (txt) => {
    const s = txt.replace(/[₱,]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const km = s.match(/(\d+(?:\.\d+)?)\s*k\b/);
    if (km) return Math.round(parseFloat(km[1]) * 1000);
    const mm = s.match(/(\d+(?:\.\d+)?)\s*m\b/);
    if (mm) return Math.round(parseFloat(mm[1]) * 1_000_000);
    const plain = s.match(/\b\d{2,9}\b/);
    if (plain) return parseInt(plain[0], 10);
    return 0;
  };

  const MODEL_TO_BODY = {
    vios: 'sedan', wigo: 'hatchback', raize: 'crossover', innova: 'mpv',
    avanza: 'mpv', veloz: 'mpv', fortuner: 'suv', hilux: 'pickup',
    city: 'sedan', civic: 'sedan', brv: '7-seater suv', almera: 'sedan',
    xpander: 'mpv', mirage: 'hatchback', territory: 'suv', everest: 'suv',
    ranger: 'pickup', soluto: 'sedan', mux: 'suv', dmax: 'pickup'
  };

  const looksLikeBody = (msg) => {
    const m = msg.toLowerCase();
    return /sedan|hatch|crossover|mpv|suv|van|pickup|fb|5\s*seater|7\s*seater/.test(m);
  };

  const parsePaymentMode = (txt) => {
    const t = norm(txt);
    if (!t) return '';
    if (/\bcash\b|spot cash|full cash/.test(t)) return 'cash';
    if (/\bfinanc|installment|loan|all[-\s]?in|bank/.test(t)) return 'financing';
    return '';
  };

  const addDebug = (base, obj) =>
    isDebug ? `${base}\n[v:${VERSION} ${Object.entries(obj).map(([k,v])=>`${k}=${v||'-'}`).join(', ')}]` : base;

  // --- Input ---
  const b = req.body || {};
  const message = clean(b.message);
  const name = clean(b.name);
  let ai_model = clean(b.ai_model);
  let ai_budget = clean(b.ai_budget);
  let ai_payment = clean(b.ai_payment_mode);
  let ai_timeline = clean(b.ai_timeline);
  let ai_location = clean(b.ai_location);

  const msgNorm = norm(message);

  // Reset
  if (/\b(reset|change unit|baguhin)\b/i.test(message)) {
    return res.status(200).json({
      ai_reply: 'Got it! Let’s start fresh 👍 Anong model o 5-seater/7-seater ang hanap mo? (Pwede rin pickup o pang-negosyo)'
    });
  }

  // Inference
  if (!ai_model) {
    for (const key of Object.keys(MODEL_TO_BODY)) {
      if (msgNorm.includes(key)) ai_model = key;
    }
  }
  if (!ai_payment) ai_payment = parsePaymentMode(message);
  if (!ai_budget) {
    const amt = parseAmount(message);
    if (amt > 0) ai_budget = `${amt}`;
  }

  // Known state
  let inferredBody = '';
  for (const key of Object.keys(MODEL_TO_BODY)) {
    if (norm(ai_model).includes(key)) inferredBody = MODEL_TO_BODY[key];
  }

  let msgBody = '';
  if (looksLikeBody(message)) msgBody = message.trim();

  const known = {
    model_or_body: clean(ai_model) || inferredBody || msgBody,
    payment_mode: norm(ai_payment),
    budget_or_dp: clean(ai_budget),
    location: clean(ai_location),
    timeline: clean(ai_timeline)
  };

  const missing = [];
  if (!known.model_or_body) missing.push('model_or_body');
  if (!known.payment_mode) missing.push('payment_mode');
  if (!known.budget_or_dp) missing.push('budget_or_dp');
  if (!known.location) missing.push('location');
  if (!known.timeline) missing.push('timeline');

  const complete = missing.length === 0;

  const askBody = `Anong hanap mo—5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)?`;
  const askPay = `Sige! Cash o financing ang plan mo?`;
  const askCash = `Mga magkano ang cash budget mo?`;
  const askDP = `Magkano ang on-hand downpayment mo ngayon?`;
  const askLoc = `Saan area ka para makahanap tayong malapit sa’yo?`;
  const askTime = `Kung may ma-suggest ako na swak today, makakapag-view ka ba this week?`;

  let reply = '';
  if (!known.model_or_body) reply = askBody;
  else if (!known.payment_mode) reply = askPay;
  else if (!known.budget_or_dp) reply = known.payment_mode === 'cash' ? askCash : askDP;
  else if (!known.location) reply = askLoc;
  else if (!known.timeline) reply = askTime;
  else reply = `Thanks ${name || 'po'}! ✅ Kumpleto na tayo. Iche-check ko ngayon ang **best 2 options** na bagay sa’yo.`;

  return res.status(200).json({ ai_reply: addDebug(reply, { ...known, complete }) });
};
