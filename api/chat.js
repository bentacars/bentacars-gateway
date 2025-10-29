// /api/chat.js
// ESM module (your package.json has "type":"module")

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ai_reply: 'Method not allowed.' });
  }

  try {
    const { message, user, name, // standard payload
            // OPTIONAL: if later you include prior fields in the request body,
            // we’ll use them for better continuity:
            ai_model, ai_budget, ai_payment_mode, ai_timeline, ai_location
          } = req.body || {};

    if (!message || !user) {
      return res.status(400).json({ ai_reply: 'Missing message or user.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ai_reply: 'Server missing OpenAI API key.' });
    }

    // Light context we already know (if you later pass them from ManyChat request body)
    const known = {
      model: ai_model || null,
      budget: typeof ai_budget === 'number' ? ai_budget : ai_budget || null,
      payment_mode: ai_payment_mode || null,
      timeline: ai_timeline || null,
      location: ai_location || null,
    };

    // ---- SYSTEM STYLE (human Taglish, no "segment"/"target monthly") ----
    const style = `
You are BentaCars' trusted car consultant. Speak like a real Filipino sales pro:
- Natural Taglish, casual and friendly, short sentences.
- Be warm and helpful; sound human (not robotic).
- Auto-adjust tone based on the user's mood (positive if excited, calm + reassuring if frustrated).
- Never use the words "segment" or "target monthly".
- Ask ONE concise qualifying question at a time.
- If info is incomplete, do NOT suggest cars yet. Keep qualifying.
- Required info before suggesting cars:
  • specific model (or general preference)
  • budget range (PHP)
  • payment mode (cash or financing; if financing, ask DP or budget range, not "target monthly")
  • timeline (when to buy)
  • location (optional but helpful)
- If everything seems complete, confirm briefly and say you'll check the best options next (no listings yet).
`;

    // We’ll ask the model to *return JSON only* so we can map fields easily.
    const userMsg = `${name ? name + ': ' : ''}${message}`.trim();

    const extractionInstruction = `
Return strictly a JSON object with these keys:
- "ai_reply": string  // Your natural Taglish message for the user (one question at a time, as needed)
- "ai_model": string|null
- "ai_budget": number|null   // a single representative number if user gave a number/range (best guess)
- "ai_payment_mode": "cash"|"financing"|null
- "ai_timeline": string|null
- "ai_location": string|null

Rules:
- If you can infer any field from this turn, include it; otherwise set it to null.
- Keep "ai_reply" short, human, and helpful. Do not list cars yet if info is incomplete.
- Never say the words "segment" or "target monthly".
`;

    const payload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: style },
        { role: 'user', content: `Known info right now: ${JSON.stringify(known)}` },
        { role: 'user', content: `User says: "${userMsg}"` },
        { role: 'user', content: extractionInstruction }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    };

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await completion.json();

    // Safe default reply if anything goes odd
    let result = {
      ai_reply: 'Sige! Para mahanapan kita ng best na unit, ano bang budget range natin at cash or financing?',
      ai_model: null,
      ai_budget: null,
      ai_payment_mode: null,
      ai_timeline: null,
      ai_location: null
    };

    // Parse the model's JSON
    try {
      const parsed = JSON.parse(
        data?.choices?.[0]?.message?.content ?? '{}'
      );

      // Merge with defaults
      result = {
        ai_reply: (parsed.ai_reply || result.ai_reply).toString().trim(),
        ai_model: parsed.ai_model ?? null,
        ai_budget: (parsed.ai_budget === null || parsed.ai_budget === undefined || parsed.ai_budget === '') 
                    ? null 
                    : Number(parsed.ai_budget),
        ai_payment_mode: parsed.ai_payment_mode ?? null,
        ai_timeline: parsed.ai_timeline ?? null,
        ai_location: parsed.ai_location ?? null
      };
    } catch (_) {
      // ignore parse error; use defaults
    }

    // IMPORTANT: We only *return* fields here.
    // ManyChat will save them via your Response Mapping.
    // (Map: $.ai_model, $.ai_budget, $.ai_payment_mode, $.ai_timeline, $.ai_location, $.ai_reply)

    return res.status(200).json(result);

  } catch (err) {
    console.error('chat.js error:', err);
    return res.status(500).json({
      ai_reply: 'Pasensya na, nagka-issue saglit. Paki-type ulit po yung message, tutulungan kita agad.'
    });
  }
}
