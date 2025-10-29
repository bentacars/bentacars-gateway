// /api/chat.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ ai_reply: 'Config error: missing OpenAI key.' });
    }

    const { message, user, name } = req.body || {};
    if (!message || !user) {
      return res.status(400).json({ ai_reply: 'Missing message or user id.' });
    }

    const system = `
You are BentaCars' sales assistant. Goal: qualify first, then recommend up to 2 best-matching units.
Ask ONE concise question at a time in friendly Filipino/Taglish.
Required qualifying info before suggesting cars:
- segment or specific model
- budget range (PHP)
- payment mode (cash/financing; if financing, ask DP or monthly)
- timeline (when to buy)
- location (optional)

Rules:
- If info is incomplete, DO NOT suggest cars yet. Ask the next best question.
- Be brief and helpful.
- When info seems complete, confirm and say you'll check best options.
Return only plain text for the customer.
`;

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${name ? name + ': ' : ''}${message}`.trim() },
        ],
        temperature: 0.3,
      }),
    });

    const data = await completion.json();
    const aiText =
      data?.choices?.[0]?.message?.content?.trim() ||
      'Sige po, ano pong budget range natin para makahanap ako ng best na unit?';

    return res.status(200).json({ ai_reply: aiText });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ai_reply: 'Pasensya na po, nagka-issue saglit. Paki-type ulit po ang mensahe.',
    });
  }
}
