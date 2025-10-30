// /api/chat.js — Phase 1 deterministic qualifier (no LLM)
// Hard-stop against premature "complete". Includes version + debug snapshot.

const VERSION = 'P1-qualifier-2025-10-30-01';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ai_reply: 'Method not allowed', version: VERSION });
  }

  try {
    // -------- 1) Inputs --------
    const {
      message = '',
      user = '',
      name = '',
      ai_model = '',
      ai_budget = '',
      ai_payment_mode = '',
      ai_timeline = '',
      ai_location = ''
    } = (req.body || {});

    const clean = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).trim();
      const lower = s.toLowerCase();
      if (!s || ['not set', 'n/a', 'none', 'null', 'undefined', '-', '(none)'].includes(lower)) return '';
      return s;
    };

    const msgRaw = clean(message);
    const msg = msgRaw.toLowerCase();
    const firstName = clean(name) || 'there';

    // -------- 2) Inference helpers --------
    const modelToBody = {
      vios: 'sedan', wigo: 'hatchback', raize: 'crossover',
      innova: 'mpv', avanza: 'mpv', veloz: 'mpv',
      fortuner: 'suv', hilux: 'pickup',
      city: 'sedan', civic: 'sedan', brv: '7-seater suv',
      almera: 'sedan',
      xpander: 'mpv', mirage: 'hatchback',
      territory: 'suv'
    };

    const includesAny = (t, arr) => arr.some(k => t.includes(k));

    const inferBodyFromMsg = () => {
      if (includesAny(msg, ['sedan'])) return 'sedan';
      if (includesAny(msg, ['hatchback', 'hatch'])) return 'hatchback';
      if (includesAny(msg, ['crossover'])) return 'crossover';
      if (includesAny(msg, ['mpv'])) return 'mpv';
      if (includesAny(msg, ['suv'])) return 'suv';
      if (includesAny(msg, ['pickup', 'pick up'])) return 'pickup';
      if (includesAny(msg, ['van'])) return 'van';
      if (includesAny(msg, ['7-seater', '7 seater', 'seven seater'])) return '7-seater';
      if (includesAny(msg, ['5-seater', '5 seater', 'five seater'])) return '5-seater';
      for (const key of Object.keys(modelToBody)) if (msg.includes(key)) return modelToBody[key];
      return '';
    };

    const inferPaymentFromMsg = () => {
      if (/(^|\b)(cash|full payment)(\b|$)/.test(msg)) return 'cash';
      if (/(financing|loan|installment|hulugan|monthly|terms)/.test(msg)) return 'financing';
      return '';
    };

    const inferBudgetOrDPFromMsg = () => {
      const m = msg.match(/(\d[\d,\.]*)\s*(k|thou|thousand)?/i);
      if (!m) return '';
      let n = m[1].replace(/[,\.]/g, '');
      if (!n) return '';
      let val = parseInt(n, 10);
      if (isNaN(val)) return '';
      if (m[2]) val *= 1000;
      return String(val);
    };

    const inferTimelineFromMsg = () => {
      if (/(today|ngayon)\b/.test(msg)) return 'today';
      if (/(this week|within the week|week)/.test(msg)) return 'this week';
      if (/(next week)/.test(msg)) return 'next week';
      if (/(this month|within the month)/.test(msg)) return 'this month';
      if (/(next month)/.test(msg)) return 'next month';
      if (/(soon|agad|asap)/.test(msg)) return 'soon';
      return '';
    };

    const resetWanted = /\b(reset|restart|start\s*again|change unit|palit unit|bagong simula)\b/i.test(msg);

    // -------- 3) Merge "known" state --------
    const known = {
      model_or_body: clean(ai_model) || inferBodyFromMsg(),
      payment_mode : clean(ai_payment_mode) || inferPaymentFromMsg(),
      budget_or_dp : clean(ai_budget) || inferBudgetOrDPFromMsg(),
      location     : clean(ai_location),
      timeline     : clean(ai_timeline) || inferTimelineFromMsg()
    };

    const isFilled = (s) => !!(s && String(s).trim());

    // Strict completion: ALL must be present (no inference-only completion!)
    const allComplete =
      isFilled(clean(ai_model)) || isFilled(known.model_or_body) ? // model/body can be inferred OR typed
      ( isFilled(known.payment_mode) &&
        isFilled(known.budget_or_dp) &&
        isFilled(known.location) &&
        isFilled(known.timeline) &&
        isFilled(known.model_or_body) ) : false;

    // -------- 4) Compose next reply deterministically --------
    let ai_reply = '';

    if (resetWanted) {
      ai_reply = `Got it! Let’s start fresh 👍 Anong model o 5-seater/7-seater ang hanap mo? (Pwede rin pickup o pang-negosyo)`;
    } else if (/^(hi|hello|hey|yo|good\s*(am|pm|day)|hi po|hello po)\b/i.test(msg)) {
      ai_reply = `Hi ${firstName}! 👋 Para masakto ko, anong model ang target mo? Kung undecided pa: 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)? Pwede rin pickup o pang-negosyo.`;
    } else if (!isFilled(known.model_or_body)) {
      ai_reply = `Sige! Para masakto, 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)? Pwede rin pickup o pang-negosyo.`;
    } else if (!isFilled(known.payment_mode)) {
      const hinted = inferPaymentFromMsg();
      if (hinted === 'cash') ai_reply = `Mukhang cash ang gusto mo—tama ba?`;
      else if (hinted === 'financing') ai_reply = `Mukhang financing ang plan mo—tama ba?`;
      else ai_reply = `Payment plan natin—**cash** o **financing**?`;
    } else if (!isFilled(known.budget_or_dp)) {
      ai_reply = known.payment_mode === 'cash'
        ? `Mga magkano ang cash budget mo? Ballpark ok lang.`
        : `Magkano ang on-hand na **downpayment** mo ngayon? Ballpark ok lang.`;
    } else if (!isFilled(known.location)) {
      ai_reply = `Saan area ka located para ma-match ko sa pinakamalapit na unit? (Hal. QC, Makati, Cavite, Cebu)`;
    } else if (!isFilled(known.timeline)) {
      ai_reply = `Kung may ma-suggest akong swak **today**, makakapag-view ka ba **this week**?`;
    } else if (allComplete) {
      ai_reply = `Thanks ${firstName}! ✅ Kumpleto na tayo. Iche-check ko ngayon ang **best 2 options** na bagay sa’yo.`;
    } else {
      // safety fallback
      ai_reply = `Sige! Para masakto ko, 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)?`;
    }

    // -------- 5) Optional debug (append or as separate field) --------
    const debug = String(req.query.debug || '') === '1';
    const ai_state = {
      version: VERSION,
      received: { message, user, name, ai_model, ai_budget, ai_payment_mode, ai_timeline, ai_location },
      known,
      allComplete
    };

    if (debug) {
      // Append a short snapshot so you can see what the server thinks (remove later)
      const brief = `\n[v:${VERSION} | known:${Object.entries(known).map(([k,v])=>`${k}=${v||'-'}`).join(', ')} | complete=${allComplete}]`;
      return res.status(200).json({ ai_reply: ai_reply + brief, ai_state });
    }

    return res.status(200).json({ ai_reply, version: VERSION });

  } catch (err) {
    console.error('[api/chat] error:', err);
    return res.status(500).json({ ai_reply: 'Oops, nagka-issue saglit. Paki-type ulit po, aayusin ko kaagad.', version: VERSION });
  }
}
