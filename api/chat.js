// /api/chat.js
// Fast, deterministic qualifier (instant replies).
// Uses OpenAI only as a fallback when still ambiguous.
// ManyChat: map $.ai_reply -> ai_reply

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ai_reply: 'Method not allowed' });
  }

  try {
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

    // --- Normalize incoming text
    const raw = String(message || '').trim();
    const msg = raw.toLowerCase();

    // --- Light model → body-type inference
    const modelToBody = {
      vios: 'sedan', wigo: 'hatchback', raize: 'crossover',
      innova: 'mpv', avanza: 'mpv', veloz: 'mpv', fortuner: 'suv', hilux: 'pickup',
      city: 'sedan', civic: 'sedan', brv: '7-seater suv',
      almera: 'sedan', xpander: 'mpv', mirage: 'hatchback',
      territory: 'suv'
    };
    const normModel = String(ai_model || '').toLowerCase().replace(/\s+/g, '');
    let inferredBody = '';
    for (const k of Object.keys(modelToBody)) {
      if (normModel.includes(k) || msg.includes(k)) {
        inferredBody = modelToBody[k];
        break;
      }
    }

    // --- Heuristics from the last user message
    const paymentFromMsg =
      /cash\b/.test(msg) ? 'cash' :
      /(finance|loan|installment|hulugan|monthly)/.test(msg) ? 'financing' :
      '';

    // extract money-like number (₱, k, etc.)
    const moneyMatch = msg.match(/(?:₱|\bphp\s*)?([\d,.]+)\s*(k|thou|thousand)?/i);
    let moneyValue = '';
    if (moneyMatch) {
      const base = parseFloat((moneyMatch[1] || '').replace(/,/g, ''));
      if (!isNaN(base)) {
        moneyValue = moneyMatch[2] ? String(Math.round(base * 1000)) : String(Math.round(base));
      }
    }

    // timeline inference
    let timelineFromMsg = '';
    if (/(today|tonight|ngayon)/.test(msg)) timelineFromMsg = 'today';
    else if (/(this week|within the week|week)/.test(msg)) timelineFromMsg = 'this week';
    else if (/(next week)/.test(msg)) timelineFromMsg = 'next week';
    else if (/(this month|within the month)/.test(msg)) timelineFromMsg = 'this month';
    else if (/(next month)/.test(msg)) timelineFromMsg = 'next month';

    // location – very light (we keep whatever user already provided)
    const locationFromMsg = ''; // optional: try to parse cities/barangays if you want later

    // --- Known fields after merging heuristics
    const known = {
      model_or_body:
        (ai_model && ai_model.trim()) ||
        inferredBody ||
        '',

      payment_mode: (ai_payment_mode || paymentFromMsg || '').toLowerCase(),

      budget_or_dp: (ai_budget || moneyValue || '').toString(),

      timeline: (ai_timeline || timelineFromMsg || '').toString(),

      location: (ai_location || locationFromMsg || '').toString()
    };

    // Greeting fast-path (instant, no OpenAI)
    if (/^(hi|hello|hey|yo|good\s*(am|pm|day)|hi po|hello po)\b/.test(msg)) {
      return res.status(200).json({
        ai_reply: `Hi ${name || ''}! 👋 Anong model ang tinitingnan mo? 
Kung wala pa, 5-seater (sedan/hatch/crossover) ba or 7-seater+ (MPV/SUV/van)? Pwede rin pickup o pang-negosyo.`
          .replace(/\s+/g, ' ')
      });
    }

    // Decide next missing info (our agreed order)
    const missingOrder = [];
    if (!known.model_or_body) missingOrder.push('model_or_body');
    if (!known.payment_mode)  missingOrder.push('payment_mode');
    if (!known.budget_or_dp)  missingOrder.push('budget_or_dp');
    if (!known.location)      missingOrder.push('location');
    if (!known.timeline)      missingOrder.push('timeline');

    // Ask ONE concise question depending on the next missing item
    if (missingOrder.length) {
      const next = missingOrder[0];

      let prompt = '';
      if (next === 'model_or_body') {
        prompt =
          `Got it! Anong model ang target mo? ` +
          `Kung undecided pa, 5-seater (sedan/hatch/crossover) ba or 7-seater+ (MPV/SUV/van)? ` +
          `Pwede rin pickup o pang-negosyo.`;
      } else if (next === 'payment_mode') {
        prompt = `Sige. Payment mo ba ay **cash** o **financing**?`;
      } else if (next === 'budget_or_dp') {
        prompt = known.payment_mode === 'cash'
          ? `Mga magkano ang cash budget mo?`
          : `Magkano ang on-hand na downpayment mo (approx ok)?`;
      } else if (next === 'location') {
        prompt = `Saan area ka located para makahanap tayo ng malapit sa’yo?`;
      } else if (next === 'timeline') {
        prompt = `Kung may ma-suggest akong swak today, makakapag-view ka ba **this week**?`;
      }

      return res.status(200).json({ ai_reply: prompt });
    }

    // If we reach here, kompleto na ang key qualifiers → acknowledge (no unit list yet)
    const doneMsg =
      `Thanks ${name || ''}! Parang kumpleto na tayo. ` +
      `Iche-check ko ngayon ang best **2 options** na bagay sa'yo.`;
    return res.status(200).json({ ai_reply: doneMsg });

    // --- Optional: If you still want to keep OpenAI as fallback when ambiguous,
    // move the return above into an `else` and keep the call below.
    // For now we short-circuit to keep replies instant.

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ai_reply: 'Oops, nagka-issue saglit. Paki-type ulit po, aayusin ko agad.'
    });
  }
}
