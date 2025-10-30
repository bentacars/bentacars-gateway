// /api/chat.js — deterministic qualifier for ManyChat → Vercel
// Returns: { ai_reply: "..." } only. No unit listing here; just qualifying.
// Phase 1 goal: ask ONE short Taglish question at a time until 5 fields are present:
// model/body, payment_mode, budget_or_dp, location, timeline.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ai_reply: 'Method not allowed' });
  }

  try {
    // ---------- 1) Pull + sanitize ----------
    const {
      message = '',
      user = '',
      name = '',
      ai_model = '',
      ai_budget = '',
      ai_payment_mode = '',
      ai_timeline = '',
      ai_location = ''
    } = req.body || {};

    const clean = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).trim();
      const lower = s.toLowerCase();
      if (!s || ['not set', 'n/a', 'none', 'null', 'undefined', '-'].includes(lower)) return '';
      return s;
    };

    const msgRaw = clean(message);
    const msg = msgRaw.toLowerCase();
    const firstName = clean(name) || 'there';

    // ---------- 2) Lightweight inference from the latest message ----------
    const modelToBody = {
      // Toyota
      vios: 'sedan', wigo: 'hatchback', raize: 'crossover',
      innova: 'mpv', avanza: 'mpv', veloz: 'mpv',
      fortuner: 'suv', hilux: 'pickup',
      // Honda
      city: 'sedan', civic: 'sedan', brv: '7-seater suv',
      // Nissan
      almera: 'sedan',
      // Mitsubishi
      xpander: 'mpv', mirage: 'hatchback',
      // Ford
      territory: 'suv'
    };

    const containsAny = (text, arr) => arr.some(k => text.includes(k));

    const inferBodyFromMsg = () => {
      // direct body keywords
      if (containsAny(msg, ['sedan'])) return 'sedan';
      if (containsAny(msg, ['hatch', 'hatchback'])) return 'hatchback';
      if (containsAny(msg, ['crossover'])) return 'crossover';
      if (containsAny(msg, ['mpv'])) return 'mpv';
      if (containsAny(msg, ['suv'])) return 'suv';
      if (containsAny(msg, ['pickup', 'pick up'])) return 'pickup';
      if (containsAny(msg, ['van'])) return 'van';
      if (containsAny(msg, ['7-seater', '7 seater', 'seven seater'])) return '7-seater';
      if (containsAny(msg, ['5-seater', '5 seater', 'five seater'])) return '5-seater';
      // from model names
      for (const key of Object.keys(modelToBody)) {
        if (msg.includes(key)) return modelToBody[key];
      }
      return '';
    };

    const inferPaymentFromMsg = () => {
      if (/(cash|full payment)\b/.test(msg)) return 'cash';
      if (/(financing|loan|installment|hulugan|utuang|monthly|terms)/.test(msg)) return 'financing';
      return '';
    };

    const inferBudgetOrDPFromMsg = () => {
      // capture like "150k", "150 k", "200,000", "200k dp", "dp 120k"
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
      if (/(today|ngayon|right now)/.test(msg)) return 'today';
      if (/(this week|within the week|week)/.test(msg)) return 'this week';
      if (/(next week)/.test(msg)) return 'next week';
      if (/(this month|within the month)/.test(msg)) return 'this month';
      if (/(next month)/.test(msg)) return 'next month';
      if (/(soon|agad|asap)/.test(msg)) return 'soon';
      return '';
    };

    const resetWanted = /\b(reset|restart|start\s*again|change unit|palit unit|bagong simula)\b/i.test(msg);

    // ---------- 3) Merge known from ManyChat + latest message inference ----------
    const known = {
      model_or_body: clean(ai_model) || inferBodyFromMsg(),
      payment_mode : clean(ai_payment_mode) || inferPaymentFromMsg(),
      budget_or_dp : clean(ai_budget) || inferBudgetOrDPFromMsg(),
      location     : clean(ai_location), // keep manual for now (avoid false positives)
      timeline     : clean(ai_timeline) || inferTimelineFromMsg()
    };

    const isFilled = (s) => !!(s && String(s).trim());

    // strict "complete" check – ALL 5 must be present
    const allComplete =
      isFilled(known.model_or_body) &&
      isFilled(known.payment_mode)  &&
      isFilled(known.budget_or_dp)  &&
      isFilled(known.location)      &&
      isFilled(known.timeline);

    // ---------- 4) Greeting / Reset short-circuits ----------
    if (resetWanted) {
      return res.status(200).json({
        ai_reply: `Got it! Let’s start fresh 😄\nAnong model o 5-seater/7-seater ang hanap mo? (Pwede rin pickup o pang-negosyo)`
      });
    }

    if (/^(hi|hello|hey|yo|good\s*(am|pm|day)|hi po|hello po)\b/.test(msg)) {
      return res.status(200).json({
        ai_reply: `Hi ${firstName}! 👋 Para masakto ko, anong model ang target mo? 
Kung undecided pa, 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)? Pwede rin pickup o pang-negosyo.`
          .replace(/\s+/g, ' ')
      });
    }

    // ---------- 5) Deterministic next-best question (no LLM) ----------
    // We always ask in this order until filled: model/body → payment → budget/DP → location → timeline.
    if (!isFilled(known.model_or_body)) {
      return res.status(200).json({
        ai_reply:
          `Sige! Para masakto, 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)? Pwede rin pickup o pang-negosyo.`
      });
    }

    if (!isFilled(known.payment_mode)) {
      // small nudge if user hinted
      const hinted = inferPaymentFromMsg();
      if (hinted === 'cash') {
        return res.status(200).json({ ai_reply: `Mukhang cash ang gusto mo—tama ba?` });
      }
      if (hinted === 'financing') {
        return res.status(200).json({ ai_reply: `Mukhang financing ang plan mo—tama ba?` });
      }
      return res.status(200).json({ ai_reply: `Payment plan natin—**cash** o **financing**?` });
    }

    if (!isFilled(known.budget_or_dp)) {
      if (known.payment_mode === 'cash') {
        return res.status(200).json({ ai_reply: `Mga magkano ang cash budget mo? Ballpark ok lang.` });
      } else {
        return res.status(200).json({ ai_reply: `Magkano ang on-hand na **downpayment** mo ngayon? Ballpark ok lang.` });
      }
    }

    if (!isFilled(known.location)) {
      return res.status(200).json({
        ai_reply: `Saan area ka located para ma-match ko sa pinakamalapit na unit? (Hal. QC, Makati, Cavite, Cebu)`
      });
    }

    if (!isFilled(known.timeline)) {
      return res.status(200).json({
        ai_reply: `Kung may ma-suggest akong swak **today**, makakapag-view ka ba **this week**?`
      });
    }

    // ---------- 6) All qualifiers complete → confirm only (no units here) ----------
    if (allComplete) {
      return res.status(200).json({
        ai_reply: `Thanks ${firstName}! ✅ Kumpleto na tayo. Iche-check ko ngayon ang **best 2 options** na bagay sa’yo.`
      });
    }

    // Fallback (shouldn’t hit)
    return res.status(200).json({
      ai_reply: `Sige! Para masakto ko, 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)?`
    });

  } catch (err) {
    console.error('[api/chat] error:', err);
    return res.status(500).json({
      ai_reply: 'Oops, nagka-issue saglit. Paki-type ulit po, aayusin ko kaagad.'
    });
  }
}
