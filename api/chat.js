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

    // Quick normalization
    const msg = String(message || '').toLowerCase();
    const normalizedModel = String(ai_model || '').toLowerCase().replace(/\s+/g, '');

    // 🔍 Smart body-type inference for smoother conversation
    const modelToBody = {
      vios: 'sedan', wigo: 'hatchback', raize: 'crossover', innova: 'mpv', avanza: 'mpv', veloz: 'mpv',
      fortuner: 'suv', hilux: 'pickup', city: 'sedan', civic: 'sedan', brv: '7-seater suv',
      almera: 'sedan', xpander: 'mpv', mirage: 'hatchback', territory: 'suv'
    };

    let inferredBody = '';
    for (const key of Object.keys(modelToBody)) {
      if (normalizedModel.includes(key) || msg.includes(key)) {
        inferredBody = modelToBody[key];
        break;
      }
    }

    // ✅ Store what we already know
    const known = {
      model_or_body: ai_model?.trim() || inferredBody || '',
      payment_mode: ai_payment_mode?.trim() || '',
      budget_or_dp: ai_budget?.trim() || '',
      location: ai_location?.trim() || '',
      timeline: ai_timeline?.trim() || ''
    };

    // ✅ Smarter logic for what's missing
    const missingOrder = [];
    if (!known.model_or_body && !/(vios|mirage|sedan|suv|pickup|unit|car|7-seater|5-seater|van|xpander|innova|fortuner)/i.test(msg)) missingOrder.push('model_or_body');
    if (!known.payment_mode && !/(cash|financing|loan|installment|hulog)/i.test(msg)) missingOrder.push('payment_mode');
    if (!known.budget_or_dp && !/(\d{2,3}k|\d{4,6}|budget|down|dp|amount|bayad|pera)/i.test(msg)) missingOrder.push('budget_or_dp');
    if (!known.location && !/(manila|quezon|makati|cavite|laguna|bulacan|rizal|area|city|region|province|taga)/i.test(msg)) missingOrder.push('location');
    if (!known.timeline && !/(today|week|month|soon|agad|now|ready|this week|next week|month end|monthend)/i.test(msg)) missingOrder.push('timeline');

    // 🧠 Context summary for GPT
    const contextSummary = `
Known so far:
- Model/Body: ${known.model_or_body || '(none)'}
- Payment mode: ${known.payment_mode || '(none)'}
- Budget/DP: ${known.budget_or_dp || '(none)'}
- Location: ${known.location || '(none)'}
- Timeline: ${known.timeline || '(none)'}
Missing (in order): ${missingOrder.length ? missingOrder.join(', ') : 'none'}.
`.trim();

    // 🎯 Smarter system prompt
    const system = `
You are a Taglish BentaCars Sales Assistant. 
Goal: Mag-qualify muna bago mag-offer. Natural at friendly, parang totoong tao.
Rules:
1. Ask ONE question at a time.
2. Be adaptive—respond casually if the user is casual, slightly formal if they are formal.
3. No "segment" word, no robot tone.
4. Taglish conversational phrasing only.

Flow:
A. Vehicle info first – kung may model (e.g., Vios), infer body (sedan, hatchback, SUV, MPV, pickup, van).
   - Kung wala, ask: “5-seater (sedan/hatch/crossover) or 7-seater+ (MPV/SUV/van)? Pwede rin pickup or pang-negosyo?”
   - Then optionally: “Automatic or manual?”
B. Ask payment mode: “Cash or financing?”
C. Ask budget or DP: 
   - If cash: “Mga magkano cash budget mo?”
   - If financing: “Magkano ang on-hand na downpayment mo?”
D. Ask location: “Saan area ka para mahanap natin ang malapit?”
E. Ask timeline: “Kung may ma-suggest ako today, pwede ka ba mag-view this week?”

If not complete → ask next logical question.
If complete (all 5 known) → say: “Thanks ${name || ''}! Mukhang complete na info mo. Iche-check ko na ang best 2 options para sa'yo.”

Output plain text only. No JSON, no labels.
`.trim();

    // 💬 User message for context
    const userMsg = `
Customer: ${name || 'Customer'} (${user})
Latest message: "${message}"
${contextSummary}
`.trim();

    // 🧩 Call GPT-4o-mini for fast contextual reply
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg }
        ]
      })
    });

    const data = await completion.json();

    const aiText =
      data?.choices?.[0]?.message?.content?.trim() ||
      `Sige! Para masakto ko, anong klase ng sasakyan hanap mo — 5-seater (sedan/hatch/crossover) or 7-seater+ (MPV/SUV/van)?`;

    // ✨ Smart override: only say "complete" if truly complete
    if (missingOrder.length === 0) {
      return res.status(200).json({
        ai_reply: `Thanks ${name || ''}! Mukhang kumpleto na ang info mo. Iche-check ko na ang best **2 options** para sa'yo.`
      });
    }

    return res.status(200).json({ ai_reply: aiText });
  } catch (err) {
    console.error('Chat API Error:', err);
    return res.status(500).json({
      ai_reply: 'Oops, nagka-issue saglit. Paki-type ulit po, aayusin ko agad.'
    });
  }
}
