// /api/chat.js
// Stateless API that guides a car-buying qualification in Taglish.
// It uses "variable check" from fields you pass in the request body
// so the bot asks ONLY what's still missing, one short question at a time.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ai_reply: 'Method not allowed' });
  }

  try {
    const {
      message,          // user's latest text (required)
      user,             // contact id (required)
      name,             // first name (optional)
      // "Memory" coming from ManyChat User Fields (all optional)
      ai_model,
      ai_budget,
      ai_payment_mode,  // "cash" or "financing" ideally
      ai_timeline,      // when to buy
      ai_location
    } = req.body || {};

    if (!message || !user) {
      return res.status(400).json({ ai_reply: 'Missing message or user' });
    }

    // ---- Mood detector (light heuristic) ----
    const mood = detectMood(message);

    // Build known state & missing items list (drives the next best question)
    const known = {
      model: sanitize(ai_model),
      budget: sanitize(ai_budget),
      payment_mode: sanitize(ai_payment_mode),
      timeline: sanitize(ai_timeline),
      location: sanitize(ai_location),
    };

    const missing = [];
    if (!known.model) missing.push('model / klase ng sasakyan (e.g., sedan, SUV) o specific model');
    if (!known.budget) missing.push('budget range (PHP)');
    if (!known.payment_mode) missing.push('payment mode (cash o financing)');
    if (!known.timeline) missing.push('timeline kung kailan bibili');
    // location is helpful but optional — ask only if everything else is ready
    const everythingElseReady =
      known.model && known.budget && known.payment_mode && known.timeline;
    if (!known.location && everythingElseReady) {
      missing.push('location (optional, para sa availability at fees)');
    }

    // Tone guide based on mood
    const toneGuide = {
      neutral: 'relaxed, friendly, conversational Taglish',
      positive: 'upbeat, friendly, conversational Taglish',
      confused: 'very clear and guiding Taglish, reassure kindly',
      frustrated: 'calm, patient, and apologetic Taglish — keep it short and helpful',
    }[mood];

    // System prompt
    const system = `
You are BentaCars' expert consultant. Be natural and human in Taglish (mix of Filipino + casual English).
Auto-adjust tone to the user mood: ${toneGuide}.
NEVER use the word "segment". Say "klase ng sasakyan" instead (e.g., sedan, SUV, MPV).
Ask ONLY ONE short question at a time. Keep replies concise (1–2 lines).

Qualifying order before suggesting units:
1) klase ng sasakyan or specific model
2) budget range (PHP)
3) payment mode (cash or financing). If "financing", you may ask DP or monthly range next.
4) timeline (kailan bibili)
5) location (optional, helpful)

Rules:
- If any of the above info is MISSING, DO NOT recommend cars yet — just ask the next best question.
- If most info seems complete, briefly confirm and say you’ll check best options next (no unit names yet).
- Avoid sounding robotic; talk like a helpful salesperson.
- Never mention "target monthly" proactively. Ask DP or monthly only IF payment mode = financing.
- If the user asks for availability or a model before qualification is complete, acknowledge and redirect with the next question.

KNOWN STATE (from CRM):
- Model/Klasse: ${known.model || '(wala pa)'}
- Budget: ${known.budget || '(wala pa)'}
- Payment Mode: ${known.payment_mode || '(wala pa)'}
- Timeline: ${known.timeline || '(wala pa)'}
- Location: ${known.location || '(wala pa)'}
MISSING INFO: ${missing.length ? missing.join(', ') : 'none'}
Return only plain text the customer will see (no JSON, no labels).
`;

    const userMsg = `${name ? name + ': ' : ''}${message}`.trim();

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userMsg },
        ],
      }),
    });

    const data = await completion.json();

    // Basic guardrails
    const raw = data?.choices?.[0]?.message?.content?.trim();
    const aiText =
      cleanText(raw) ||
      fallbackNextQuestion(known, missing, name);

    return res.status(200).json({ ai_reply: aiText });
  } catch (err) {
    console.error('chat error:', err);
    return res.status(500).json({
      ai_reply:
        'Sorry, nagka-issue saglit. Paki-type ulit po ang message at tutulungan ko kayo agad. 🙏',
    });
  }
}

/* ----------------- Helpers ----------------- */

function sanitize(v) {
  if (v == null) return '';
  const s = String(v).trim();
  // Treat "0" as empty for budget if it came as number-like zero accidentally
  if (!s) return '';
  return s;
}

function cleanText(s) {
  if (!s) return '';
  // Strip any stray code fences or JSON artifacts just in case
  return s.replace(/```[\s\S]*?```/g, '').trim();
}

function detectMood(text) {
  const t = (text || '').toLowerCase();

  // quick signals
  const frustratedWords = ['ang tagal', 'bagal', 'bwisit', 'badtrip', 'hassle', 'ano ba', 'di ko maintindihan', 'nakakainis'];
  const confusedWords = ['paano', 'hindi ko alam', 'di ko sure', 'ano ibig sabihin', 'paki explain'];
  const positiveWords = ['thank', 'thanks', 'ayos', 'great', 'sige', 'nice', 'ok na', 'salamat', 'galing'];

  if (frustratedWords.some(w => t.includes(w))) return 'frustrated';
  if (confusedWords.some(w => t.includes(w))) return 'confused';
  if (positiveWords.some(w => t.includes(w)) || /😊|🙂|👍|👌/.test(t)) return 'positive';
  return 'neutral';
}

function fallbackNextQuestion(known, missing, name) {
  const firstName = (name || '').trim() ? `${name.split(' ')[0]}` : '';
  const hi = firstName ? `${firstName},` : '';

  // Decide next best question if model failed
  if (!known.model) {
    return `Hi ${hi ? hi + ' ' : ''}👋 Anong **klase ng sasakyan** ang hanap mo (e.g., sedan, SUV) — o may specific model ka na in mind?`;
  }
  if (!known.budget) {
    return `Got it! Para ma-match ko nang tama, about **magkano pong budget range** natin (PHP)?`;
  }
  if (!known.payment_mode) {
    return `Noted. **Cash o financing** po plan ninyo? (Kung financing, pwede ninyo din ilagay ballpark DP or monthly.)`;
  }
  if (!known.timeline) {
    return `Sige! **Kailan ninyo balak bumili** — this month, within 1–3 months, or later?`;
  }
  if (!known.location) {
    return `Copy. Optional lang, pero saan po **location** ninyo? Makakatulong para sa availability at fees.`;
  }
  return `Thanks! I’ll check the best options for you now based on details na binigay ninyo. 👌`;
}
