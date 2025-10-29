// /api/chat.js
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

    // --- Light model → body-type inference ---
    const modelToBody = {
      vios: 'sedan', wigo: 'hatchback', raize: 'crossover', innova: 'mpv',
      avanza: 'mpv', veloz: 'mpv', fortuner: 'suv', hilux: 'pickup',
      city: 'sedan', civic: 'sedan', brv: '7-seater suv',
      almera: 'sedan', xpander: 'mpv', mirage: 'hatchback',
      territory: 'suv'
    };
    const normalizedModel = String(ai_model || '').toLowerCase().replace(/\s+/g, '');
    let inferredBody = '';
    for (const key of Object.keys(modelToBody)) {
      if (normalizedModel.includes(key)) {
        inferredBody = modelToBody[key];
        break;
      }
    }

    // --- What we know / still missing ---
    const known = {
      model_or_body: (ai_model && ai_model.trim()) || inferredBody, // model text or inferred body
      payment_mode : (ai_payment_mode || '').toLowerCase(),        // 'cash' or 'financing'
      budget_or_dp : String(ai_budget || '').trim(),               // cash budget OR DP on-hand
      location     : String(ai_location || '').trim(),
      timeline     : String(ai_timeline || '').trim()
    };

    const missing = [];
    if (!known.model_or_body) missing.push('model_or_body');
    if (!known.payment_mode)  missing.push('payment_mode');
    if (!known.budget_or_dp)  missing.push('budget_or_dp');
    if (!known.location)      missing.push('location');
    if (!known.timeline)      missing.push('timeline');

    // --- Deterministic, one-question-at-a-time logic (no LLM for this) ---
    if (missing.length) {
      const first = missing[0];
      let reply = '';

      switch (first) {
        case 'model_or_body': {
          // If user typed something like “vios”, we already inferred. Otherwise ask this:
          reply = `Gotcha! Para masakto, 5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)? Pwede rin pickup o pang-negosyo.`;
          break;
        }

        case 'payment_mode': {
          // Small nudge if message hints “installment/cash”
          const m = message.toLowerCase();
          const hinted =
            m.includes('install') || m.includes('hulug') ? 'Mukhang financing ang gusto mo—tama ba?' :
            m.includes('cash') ? 'Mukhang cash ang gusto mo—tama ba?' : '';
          reply = hinted || `Cash o financing po ang plan natin?`;
          break;
        }

        case 'budget_or_dp': {
          if (known.payment_mode === 'cash') {
            reply = `Sige! Mga magkano cash budget mo? Ballpark ok lang.`;
          } else {
            reply = `Magkano ang on-hand na downpayment mo ngayon? Ballpark ok lang.`;
          }
          break;
        }

        case 'location': {
          reply = `Saan area ka para ma-match ko sa malapit sa’yo? (Hal. QC, Makati, Cebu, Davao)`;
          break;
        }

        case 'timeline': {
          reply = `Kung may ma-suggest akong swak today, makakapag-view ka ba this week?`;
          break;
        }
      }

      return res.status(200).json({ ai_reply: reply });
    }

    // --- All qualifiers present → (optional) call OpenAI just to keep tone natural ---
    const system = `
Ikaw ay sales assistant ng BentaCars. Taglish, natural, human. 
Huwag gumamit ng salitang "segment". Maikli at friendly.
Ang customer ay kumpleto na ang key details, kaya mag-confirm ka lang and say:
"Thanks <Name>! I-check ko ngayon ang **best 2 options** na bagay sa’yo."
Walang bullet list ng units dito; confirmation lang. Plain text output.
`.trim();

    const userMsg = `
Customer: ${name || 'Customer'} (${user})
Known:
- Model/Body: ${known.model_or_body}
- Payment mode: ${known.payment_mode}
- Budget/DP: ${known.budget_or_dp}
- Location: ${known.location}
- Timeline: ${known.timeline}
`.trim();

    let aiText = '';
    try {
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
            { role: 'user', content: userMsg }
          ]
        })
      });
      const data = await completion.json();
      aiText =
        data?.choices?.[0]?.message?.content?.trim() ||
        `Thanks ${name || ''}! I-check ko ngayon ang best 2 options na bagay sa’yo.`;
    } catch {
      aiText = `Thanks ${name || ''}! I-check ko ngayon ang best 2 options na bagay sa’yo.`;
    }

    return res.status(200).json({ ai_reply: aiText });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ai_reply: 'Oops, nagka-issue saglit. Paki-type ulit po, aayusin ko kaagad.'
    });
  }
}
