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

    // Light model → body-type inference so the question doesn’t feel awkward
    const modelToBody = {
      // Toyota
      vios: 'sedan',
      wigo: 'hatchback',
      raize: 'crossover',
      innova: 'mpv',
      avanza: 'mpv',
      veloz: 'mpv',
      fortuner: 'suv',
      hilux: 'pickup',
      // Honda
      city: 'sedan',
      civic: 'sedan',
      brv: '7-seater suv',
      // Nissan
      almera: 'sedan',
      // Mitsubishi
      xpander: 'mpv',
      mirage: 'hatchback',
      // Ford
      territory: 'suv',
    };

    const normalizedModel = String(ai_model || '').toLowerCase().replace(/\s+/g, '');
    let inferredBody = '';
    for (const key of Object.keys(modelToBody)) {
      if (normalizedModel.includes(key)) {
        inferredBody = modelToBody[key];
        break;
      }
    }

    // Figure out what’s already known / missing
    const known = {
      model_or_body: (ai_model && ai_model.trim()) || inferredBody, // treat inferred body as progress
      payment_mode: ai_payment_mode, // 'cash' or 'financing' ideally
      budget_or_dp: ai_budget,       // cash budget OR downpayment on-hand
      timeline: ai_timeline,
      location: ai_location
    };

    // Choose the next best missing item, in our agreed order.
    const missingOrder = [];
    if (!known.model_or_body) missingOrder.push('model_or_body');
    if (!known.payment_mode)  missingOrder.push('payment_mode');
    if (!known.budget_or_dp)  missingOrder.push('budget_or_dp');
    if (!known.location)      missingOrder.push('location');
    if (!known.timeline)      missingOrder.push('timeline');

    // Build a compact context string to guide the model
    const contextSummary = `
Known so far:
- Model/Body: ${known.model_or_body || '(none)'}
- Payment mode: ${known.payment_mode || '(none)'}
- Budget/DP: ${known.budget_or_dp || '(none)'}
- Location: ${known.location || '(none)'}
- Timeline: ${known.timeline || '(none)'}
Missing (in order): ${missingOrder.length ? missingOrder.join(', ') : 'none'}.
`.trim();

    // Human-friendly, Taglish, non-robotic system guide
    const system = `
Ikaw ay sales assistant ng BentaCars. Goals:
1) Mag-qualify muna bago mag-offer.
2) Taglish, natural, at sumasabay sa tono ng kausap (if casual → casual; if formal → medyo formal).
3) Huwag gumamit ng salitang "segment". 
4) Isang maikling tanong lang bawat reply, very conversational.

FLOW NG TANONG (isa-isa):
A. Unahin alamin ang kailangan ng customer:
   - Kung may binanggit na model (hal. "Vios"), puwedeng i-infer ang body (sedan, hatchback, crossover, MPV/SUV, pickup, van, pang-negosyo FB).
   - Kung wala, i-clarify: “5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)? Or pickup/pang-negosyo?”
   - Optional kasunod: transmission (automatic/manual/anything).
B. Payment mode:
   - “Cash o financing?”
C. Budget details:
   - Kung CASH: “Mga magkano cash budget mo?”
   - Kung FINANCING: “Magkano ang on-hand na downpayment mo?” (huwag magtanong ng target monthly)
D. Location (maaga pa lang kung wala pa): “Saan area ka para makahanap tayong malapit sa’yo?”
E. Timeline (urgent framing):
   - “Kung may ma-suggest ako na swak today, makakapag-view ka ba this week?”

KAPAG KULANG PA ANG INFO:
- Huwag muna mag-offer.
- Magtanong ng susunod na pinaka-makabuluhang tanong (ayon sa order sa itaas).
- Maging maikli at friendly.

KAPAG KUMPLETO NA ANG MAHALAGANG INFO (model/body, payment mode, budget/DP, timeline, location):
- Huwag pa rin maglista ng units.
- Sabihin lang na iche-check mo ang best 2 options para sa kanya at kasunod na mensahe ay ang mga options.

Output: plain text lang na isasend sa customer. Walang JSON, walang code block.
`.trim();

    // Compose the user message with mood-aware hinting
    const userMsg = `
Customer: ${name || 'Customer'} (${user})
Latest message: "${message}"
${contextSummary}

Gawin mong very natural at maiksi. Tanong ka lang ng isa, maliban na lang kung simple confirmation.
`.trim();

    // Call OpenAI (chat completions). Model = gpt-4o-mini as agreed.
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

    // Fallback, just in case
    const aiText =
      data?.choices?.[0]?.message?.content?.trim() ||
      'Sige! Para masakto ko, anong klase ng sasakyan ang hanap mo—5-seater (sedan/hatch/crossover) ba o 7-seater+ (MPV/SUV/van)?';

    return res.status(200).json({ ai_reply: aiText });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ai_reply: 'Oops, nagka-issue saglit. Paki-type ulit po, ayusin ko kaagad.'
    });
  }
}
