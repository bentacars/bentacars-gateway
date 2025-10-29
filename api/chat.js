// /api/chat.js (Node/Next.js API Route)
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, user, name } = req.body || {};
    if (!message || !user) {
      return res.status(400).json({ error: 'Missing message or user' });
    }

    // Simple in-memory state for demo (stateless hosting resets this).
    // For production, store per-user state in a DB (e.g., Supabase/Firestore).
    // We'll infer missing fields every turn and ask the next best question.
    const system = `
You are BentaCars' sales assistant. Goal: qualify first, then recommend up to 2 best-matching units.
Ask ONE concise question at a time in friendly Filipino/Taglish.
Required qualifying info before suggesting cars:
- desired vehicle type/segment (e.g., sedan, SUV, MPV) or specific model
- budget range (PHP)
- payment mode (cash or financing; if financing, ask ballpark DP or monthly)
- timeline (when to buy)
- location (optional but helpful)

Rules:
- If info is incomplete, DO NOT suggest cars yet. Ask the next best question.
- Be brief and helpful. Example style: "Sige! Ano pong budget range natin?".
- When info seems complete, respond with a short confirmation + say you'll check best options.
Return only plain text that I can show the customer. No JSON, no code fences.
`;

    // Build a compact chat for OpenAI
    const userMsg = `${name ? name + ': ' : ''}${message}`.trim();

    // Call OpenAI Chat Completions (compatible endpoint)
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.3
      })
    });

    const data = await completion.json();
    const aiText =
      data?.choices?.[0]?.message?.content?.trim() ||
      'Sige po, ano pong budget range natin para makahanap ako ng best na unit?';

    // For now we only send back ai_reply.
    // (Later, once you qualify fully, you can have your backend attach unit suggestions too.)
    return res.status(200).json({
      ai_reply: aiText
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ai_reply: 'Pasensya na po, nagka-issue saglit. Paki-type ulit po ang mensahe.'
    });
  }
}
