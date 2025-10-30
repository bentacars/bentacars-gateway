// /api/chat.js  — Next.js (Vercel) API Route
// Receives POST from ManyChat and returns { ai_reply: "..." } only.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ai_reply: 'Method not allowed' });
  }

  try {
    // ---------- 1) Pull + sanitize fields from ManyChat ----------
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
      if (typeof v === 'object') return JSON.stringify(v);
      const s = String(v).trim();
      const lower = s.toLowerCase();
      // Treat "not set", "n/a", "none", etc. as empty
      if (!s || ['not set', 'n/a', 'none', 'null', 'undefined', '-'].includes(lower)) return '';
      return s;
    };

    const msg = clean(message);
    const state = {
      model: clean(ai_model),
      budget: clean(ai_budget),
      payment: clean(ai_payment_mode),
      timeline: clean(ai_timeline),
      location: clean(ai_location),
    };

    // Hard reset words (skip any remembered state)
    const wantsReset = /\b(reset|restart|start\s*again|bagong simula|change unit|palit unit)\b/i.test(msg);

    // ---------- 2) Light model → body-type inference ----------
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
      territory: 'suv',
    };

    const inferBodyFromModel = (m) => {
      const normalized = (m || '').toLowerCase().replace(/\s+/g, '');
      for (const key of Object.keys(modelToBody)) {
        if (normalized.includes(key)) return modelToBody[key];
      }
      return '';
    };

    const inferredBody = inferBodyFromModel(state.model);

    // ---------- 3) Determine what’s known / missing ----------
    // We consider "model/body" satisfied if either explicit model or an inferred body exists.
    const known = {
      model_or_body: state.model || inferredBody,
      payment_mode: state.payment,            // "cash" or "financing" (or synonyms)
      budget_or_dp: state.budget,             // cash budget OR downpayment on-hand
      location: state.location,
      timeline: state.timeline
    };

    const isFilled = (s) => !!(s && String(s).trim());

    // Only complete when **all 5** are meaningfully filled
    const allComplete = isFilled(known.model_or_body)
      && isFilled(known.payment_mode)
      && isFilled(known.budget_or_dp)
      && isFilled(known.location)
      && isFilled(known.timeline);

    // ---------- 4) Build system instructions ----------
    const system = `
Ikaw ay sales assistant ng BentaCars. Goals:
1) Mag-qualify muna bago mag-offer ng units.
2) Gumamit ng natural na Taglish; i-adjust ang tono sa kausap (casual ↔︎ formal).
3) Huwag gumamit ng salitang "segment".
4) Isang maikling tanong lang bawat sagot. Huwag maglista ng sasakyan hangga't kulang ang info.

Guides:
• Kung may nabanggit na model (hal. "Vios"), puwede mong i-infer ang body-type (sedan, hatchback, crossover, MPV/SUV, pickup, van, pang-negosyo).
• Kung wala pang malinaw na kailangan: tanungin kung 5-seater (sedan/hatch/crossover) ba, 7-seater+ (MPV/SUV/van), pickup, o pang-negosyo.
• Sunod: transmission (automatic/manual/anything) kung may sense.
• Payment mode: "Cash o financing?"
• Budget details:
   – CASH: "Mga magkano cash budget mo?"
   – FINANCING: "Magkano ang on-hand mong downpayment?" (huwag magtanong ng target monthly)
• Location: "Saan area ka para makahanap tayong malapit sa'yo?"
• Timeline (urgent framing): "Kung may ma-suggest ako na swak today, makakapag-view ka ba this week?"

Kapag hindi pa kumpleto ang (model/body, payment mode, budget/DP, location, timeline):
• Huwag munang mag-offer; magtanong ng susunod na pinaka-importanteng bagay.
• Maging maiksi, magaan, at friendly.

Kapag kumpleto na ang lahat ng iyon:
• Huwag pa rin maglista ng units dito—sabihin lang na iche-check mo ang best 2 options at susunod na message ang details.

Output: plain text lang. Walang JSON o code block.
`.trim();

    // ---------- 5) Quick short-circuits ----------
    if (wantsReset) {
      return res.status(200).json({
        ai_reply:
          'Got it! Let’s start fresh 👍\nAnong model o 5-seater/7-seater ang hanap mo? (Pwede ring pickup o pang-negosyo)'
      });
    }

    if (allComplete) {
      return res.status(200).json({
        ai_reply: `Thanks ${name || ''}! Mukhang kumpleto na ang info mo. Iche-check ko na ang best **2 options** para sa'yo!`
      });
    }

    // Build a very compact context for the model
    const contextSummary = `
Known so far:
- Model/Body: ${known.model_or_body || '(none)'}
- Payment mode: ${known.payment_mode || '(none)'}
- Budget/DP: ${known.budget_or_dp || '(none)'}
- Location: ${known.location || '(none)'}
- Timeline: ${known.timeline || '(none)'}
`.trim();

    const userPrompt = `
Customer: ${name || 'Customer'} (${user})
Latest message: "${msg}"
${contextSummary}

Gawin mong natural, maiksi, at isang tanong lang na next-best question batay sa kulang.
`.trim();

    // ---------- 6) Call OpenAI (chat completions) ----------
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await completion.json();

    const aiText =
      data?.choices?.[0]?.message?.content?.trim()
      || 'Sige! Para masakto ko, 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)?';

    return res.status(200).json({ ai_reply: aiText });
  } catch (err) {
    console.error('[chat.js] error:', err);
    return res.status(500).json({
      ai_reply: 'Oops, nagka-issue saglit. Paki-type ulit po, aayusin ko kaagad.'
    });
  }
}
