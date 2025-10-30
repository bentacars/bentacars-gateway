// /api/chat.ts (or chat.js)
// Full P1 Qualifier – ManyChat safe, deterministic.
// v: P1-qualifier-2025-10-30-03

export default async function handler(req, res) {
  const VERSION = 'P1-qualifier-2025-10-30-03';
  if (req.method !== 'POST') {
    return res.status(200).json({ ai_reply: 'Method not allowed', version: VERSION });
  }

  const isDebug = String(req.query.debug || '').toLowerCase() === '1';

  // --------- Helpers ----------
  const S = (v: any) => (v == null ? '' : String(v));
  const isPlaceholder = (s: string) =>
    !!s &&
    (
      /^\s*\{\{[^}]+\}\}\s*$/.test(s) ||           // {{cuf_xxx}}
      /^\s*(null|undefined|-+)\s*$/i.test(s)
    );
  const clean = (v: any) => {
    const s = S(v).trim();
    if (!s || isPlaceholder(s)) return '';
    return s;
  };
  const norm = (v: any) => clean(v).toLowerCase().replace(/\s+/g, ' ').trim();

  // Currency/amount normalizer (returns number in PHP if found, else 0)
  const parseAmount = (txt: string): number => {
    const s = txt
      .replace(/[₱,]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    // common “200k”, “150k”, “1.2m”
    const km = s.match(/(\d+(?:\.\d+)?)\s*k\b/);
    if (km) return Math.round(parseFloat(km[1]) * 1000);
    const mm = s.match(/(\d+(?:\.\d+)?)\s*m\b/);
    if (mm) return Math.round(parseFloat(mm[1]) * 1_000_000);
    const plain = s.match(/\b\d{2,9}\b/);
    if (plain) return parseInt(plain[0], 10);
    return 0;
  };

  // Body/model inference
  const MODEL_TO_BODY: Record<string, string> = {
    // Toyota
    vios: 'sedan', wigo: 'hatchback', raize: 'crossover', yaris: 'hatchback',
    innova: 'mpv', avanza: 'mpv', veloz: 'mpv', fortuner: 'suv', hilux: 'pickup',
    rush: 'suv', altis: 'sedan',
    // Honda
    city: 'sedan', civic: 'sedan', brv: '7-seater suv', hrv: 'crossover', crv: 'suv', brio: 'hatchback',
    // Nissan
    almera: 'sedan', terra: 'suv', navara: 'pickup', livina: 'mpv',
    // Mitsubishi
    xpander: 'mpv', mirage: 'hatchback', montero: 'suv', strada: 'pickup',
    // Ford
    territory: 'suv', everest: 'suv', ranger: 'pickup',
    // Suzuki
    ertiga: 'mpv', swift: 'hatchback', dzire: 'sedan', jimny: 'suv',
    // Hyundai / Kia / Isuzu (common)
    stargazer: 'mpv', staria: 'van', accent: 'sedan',
    soluto: 'sedan', sportage: 'suv', sorento: 'suv', carnival: 'van',
    mux: 'suv', dmax: 'pickup'
  };

  const looksLikeBody = (msg: string) => {
    const m = msg.toLowerCase();
    if (/sedan|hatch|hatchback|crossover|mpv|suv|van|pickup|fb/.test(m)) return true;
    if (/\b5\s*seater|\bfive[- ]?seater\b/.test(m)) return true;
    if (/\b7\s*seater|\bseven[- ]?seater|7[- ]?seater\+?/.test(m)) return true;
    return false;
  };

  // Payment parsing
  const parsePaymentMode = (txt: string): 'cash' | 'financing' | '' => {
    const t = norm(txt);
    if (!t) return '';
    if (/\bcash\b|spot cash|full cash|lumpsum/.test(t)) return 'cash';
    if (/\bfinanc|installment|loan|all[-\s]?in|bank|po\s?financing/.test(t)) return 'financing';
    return '';
  };

  // Transmission parsing (optional only)
  const parseTransmission = (txt: string): 'automatic' | 'manual' | '' => {
    const t = norm(txt);
    if (!t) return '';
    if (/\bauto|at|automatic/.test(t)) return 'automatic';
    if (/\bmanual|mt/.test(t)) return 'manual';
    return '';
  };

  // Debug footer toggle
  const addDebug = (base: string, obj: any) =>
    isDebug ? `${base}\n[v:${VERSION} ${Object.entries(obj).map(([k,v])=>`${k}=${v||'-'}`).join(', ')}]` : base;

  // --------- Input from ManyChat ----------
  const b = req.body || {};
  const message     = clean(b.message);
  const user        = clean(b.user);
  const name        = clean(b.name);

  // Custom fields (may arrive as {{cuf_xxx}})
  let ai_model      = clean(b.ai_model);
  let ai_budget     = clean(b.ai_budget);
  let ai_payment    = clean(b.ai_payment_mode);
  let ai_timeline   = clean(b.ai_timeline);
  let ai_location   = clean(b.ai_location);

  const msgNorm = norm(message);

  // 1) Reset / change intent
  if (/\b(reset|baguhin|change\s*(unit|model)?)\b/i.test(message)) {
    const resetLine = `Got it! Let’s start fresh 👍 Anong model o 5-seater/7-seater ang hanap mo? (Pwede rin pickup o pang-negosyo)`;
    return res.status(200).json({
      ai_reply: addDebug(resetLine, { step: 'reset', user })
    });
  }

  // 2) Try to infer missing bits from the **latest message**
  // 2a) Model/body
  if (!ai_model) {
    // If message names a model (e.g., "Vios"), store it as ai_model
    for (const key of Object.keys(MODEL_TO_BODY)) {
      if (msgNorm.includes(key)) { ai_model = key; break; }
    }
    // If not model but body words (sedan/5 seater etc.), keep as body only
  }
  // 2b) Payment mode
  if (!ai_payment) {
    const p = parsePaymentMode(message);
    if (p) ai_payment = p;
  }
  // 2c) Budget/DP quick catch from message
  if (!ai_budget) {
    if (/all[-\s]?in|dp|down\s*payment|downpayment/.test(msgNorm) || parsePaymentMode(msgNorm)==='financing') {
      const amt = parseAmount(message);
      if (amt > 0) ai_budget = `${amt}`;
    } else if (parsePaymentMode(msgNorm)==='cash' || /cash|budget|presyo|price/.test(msgNorm)) {
      const amt = parseAmount(message);
      if (amt > 0) ai_budget = `${amt}`;
    }
  }
  // 2d) Transmission (optional; not part of completion)
  const transmission = parseTransmission(message); // for follow-up warmth; not used in completion gate

  // 3) Build known state
  const normalizedModel = norm(ai_model);
  let inferredBody = '';
  for (const key of Object.keys(MODEL_TO_BODY)) {
    if (normalizedModel.includes(key)) { inferredBody = MODEL_TO_BODY[key]; break; }
  }

  let msgBody = '';
  if (looksLikeBody(message)) {
    if (/\b5\s*seater|\bfive[- ]?seater\b/.test(msgNorm)) msgBody = '5-seater (sedan/hatch/crossover)';
    else if (/\b7\s*seater|\bseven[- ]?seater|7[- ]?seater\+?/.test(msgNorm)) msgBody = '7-seater+ (MPV/SUV/van)';
    else if (/sedan|hatch|hatchback|crossover|mpv|suv|van|pickup|fb/.test(msgNorm)) msgBody = message.trim();
  }

  const known = {
    model_or_body: clean(ai_model) || inferredBody || msgBody,
    payment_mode:  norm(ai_payment),        // 'cash' | 'financing' | ''
    budget_or_dp:  clean(ai_budget),
    location:      clean(ai_location),
    timeline:      clean(ai_timeline),
  };

  // 4) Decide the next best question (AAL – one question only)
  const askBody = `Anong hanap mo—5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)? Pwede rin pickup o pang-negosyo (FB).`;
  const askPay  = `Sige! Cash o financing ang plan mo?`;
  const askCash = `Copy. Mga magkano ang **cash budget** mo?`;
  const askDP   = `Copy. Magkano ang **on-hand na downpayment** mo ngayon? (range ok)`;
  const askLoc  = `Saan area ka para makahanap tayong malapit sa’yo?`;
  const askTime = `Kung may ma-suggest ako na swak **today**, makakapag-view ka ba **this week**?`;

  let reply = '';

  if (!known.model_or_body) {
    reply = `Noted. ${askBody}`;
  } else if (!known.payment_mode) {
    // small warmth if we caught transmission
    reply = transmission
      ? `Noted—${transmission} ka. ${askPay}`
      : askPay;
  } else if (!known.budget_or_dp) {
    reply = known.payment_mode === 'cash' ? askCash : askDP;
  } else if (!known.location) {
    reply = askLoc;
  } else if (!known.timeline) {
    reply = askTime;
  } else {
    reply = `Thanks ${name || 'po'}! ✅ Kumpleto na tayo. Iche-check ko ngayon ang **best 2 options** na bagay sa’yo.`;
  }

  const debugObj = {
    user,
    model_or_body: known.model_or_body,
    pay: known.payment_mode,
    budget: known.budget_or_dp,
    loc: known.location,
    time: known.timeline,
    trans: transmission || '',
    complete: (!(!known.model_or_body || !known.payment_mode || !known.budget_or_dp || !known.location || !known.timeline)).toString()
  };

  return res.status(200).json({
    ai_reply: addDebug(reply, debugObj)
  });
}
