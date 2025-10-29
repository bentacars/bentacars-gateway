// /api/chat.js
// Node 22+ (your package.json already set to "node": "22.x")

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ai_reply: 'Method not allowed.' });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY;

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ai_reply: 'Missing OPENAI_API_KEY on the server.' });
    }
    if (!MANYCHAT_API_KEY) {
      // We can still respond, just won’t persist fields.
      console.warn('⚠️ MANYCHAT_API_KEY is missing — fields will not be updated.');
    }

    const {
      message,        // user's last text
      user,           // ManyChat Contact Id (subscriber_id)
      name,           // First Name
      ai_model,       // current state from ManyChat (optional)
      ai_budget,
      ai_payment_mode,
      ai_timeline,
      ai_location
    } = req.body || {};

    if (!message || !user) {
      return res.status(400).json({ ai_reply: 'Missing message or user id.' });
    }

    // ---------- Helpers ----------
    const mcSetField = async (fieldName, value) => {
      if (!MANYCHAT_API_KEY) return;
      if (value === undefined || value === null || value === '') return;

      try {
        await fetch('https://api.manychat.com/fb/subscriber/setCustomField', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            subscriber_id: String(user),
            field_name: fieldName,
            field_value: value
          })
        });
      } catch (e) {
        console.warn('ManyChat setCustomField error', fieldName, e?.message);
      }
    };

    // Normalize number from text, e.g., "600k", "₱600,000", "600 000"
    const toNumber = (val) => {
      if (val === undefined || val === null) return undefined;
      if (typeof val === 'number') return val;
      let s = String(val).toLowerCase().replace(/[₱, ]/g, '').trim();
      if (s.endsWith('k')) s = String(parseFloat(s) * 1000);
      const n = Number(s);
      return Number.isFinite(n) ? Math.round(n) : undefined;
    };

    // Build a compact snapshot of known state
    const known = {
      model: ai_model || '',
      budget: ai_budget ?? '',
      payment_mode: ai_payment_mode || '',
      timeline: ai_timeline || '',
      location: ai_location || ''
    };

    // 1) Ask the model to EXTRACT *structured* fields from the latest user message.
    const extractSystem = `
You extract car-buying info from Filipino/Taglish messages.
Return ONLY a single JSON object with any of these keys when confidently present:
- "model": string (e.g., "Vios", "any sedan")
- "budget_amount": number in PHP (e.g., 600000). Infer if user says "600k".
- "payment_mode": "cash" or "financing"
- "downpayment_amount": number in PHP (optional)
- "monthly_amount": number in PHP (optional)
- "timeline": short string (e.g., "this month", "1-2 months", "ASAP")
- "location": short string (e.g., "Cebu City", "QC")

No commentary, no markdown. JSON only. If nothing found, return "{}".
    `.trim();

    const extractResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        messages: [
          { role: 'system', content: extractSystem },
          { role: 'user', content: message }
        ]
      })
    });

    const extractData = await extractResp.json();
    let extracted = {};
    try {
      extracted = JSON.parse(
        extractData?.choices?.[0]?.message?.content?.trim() || '{}'
      );
    } catch {
      extracted = {};
    }

    // Coerce/clean extracted values
    const upd = {
      model: (extracted.model || '').toString().slice(0, 120),
      budget: toNumber(extracted.budget_amount),
      payment_mode: (extracted.payment_mode || '').toLowerCase() === 'financing'
        ? 'financing'
        : (extracted.payment_mode || '').toLowerCase() === 'cash'
          ? 'cash'
          : '',
      timeline: (extracted.timeline || '').toString().slice(0, 120),
      location: (extracted.location || '').toString().slice(0, 120)
    };

    // Only update fields that are new/changed
    const updateOps = [];
    if (upd.model && upd.model !== known.model) {
      updateOps.push(mcSetField('ai_model', upd.model));
      known.model = upd.model;
    }
    if (Number.isFinite(upd.budget) && upd.budget !== known.budget) {
      updateOps.push(mcSetField('ai_budget', upd.budget));
      known.budget = upd.budget;
    }
    if (upd.payment_mode && upd.payment_mode !== known.payment_mode) {
      updateOps.push(mcSetField('ai_payment_mode', upd.payment_mode));
      known.payment_mode = upd.payment_mode;
    }
    if (upd.timeline && upd.timeline !== known.timeline) {
      updateOps.push(mcSetField('ai_timeline', upd.timeline));
      known.timeline = upd.timeline;
    }
    if (upd.location && upd.location !== known.location) {
      updateOps.push(mcSetField('ai_location', upd.location));
      known.location = upd.location;
    }
    await Promise.allSettled(updateOps);

    // 2) Generate the next human, Taglish reply (ONE question at a time).
    //    Tone auto-adjusts to user message vibe.
    const nextSystem = `
You are BentaCars' car expert consultant. Respond in friendly, natural Taglish.
Rules:
- Sound human, casual, and helpful. No corporate/robot vibe.
- Auto-adjust tone to the user's mood (polite if formal, lively if casual).
- NEVER say "segment". Use plain words like "klase" o "type ng sasakyan".
- Ask ONLY ONE specific, short follow-up question at a time.
- Always keep it brief (1–2 short sentences max).
- If enough info seems complete (model/type, budget, payment mode, timeline), confirm and say you'll check best options next.
- Do NOT mention "target monthly".
- If user asked something specific and info is insufficient, ask the *next best* question.

Known info now (use to avoid asking again):
- Model/Type: ${known.model || '(wala pa)'}
- Budget: ${known.budget || '(wala pa)'}
- Payment mode: ${known.payment_mode || '(wala pa)'}
- Timeline: ${known.timeline || '(wala pa)'}
- Location: ${known.location || '(wala pa)'}
    `.trim();

    // Decide the next best question
    const needs = [];
    if (!known.model) needs.push('model/type');
    if (!known.budget) needs.push('budget');
    if (!known.payment_mode) needs.push('payment mode (cash or financing)');
    if (!known.timeline) needs.push('timeline');

    let userMsg = `${name ? name + ': ' : ''}${message}`.trim();

    const nextResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: nextSystem },
          {
            role: 'user',
            content:
              needs.length === 0
                ? `${userMsg}\n\nIf info looks complete, confirm briefly and say you'll check best 2 options next.`
                : `${userMsg}\n\nWe still need: ${needs.join(', ')}. Ask only the next best one.`
          }
        ]
      })
    });

    const nextData = await nextResp.json();
    const aiText =
      nextData?.choices?.[0]?.message?.content?.trim() ||
      'Sige! Ano pong budget range natin para makahanap ako ng magandang match?';

    return res.status(200).json({ ai_reply: aiText });
  } catch (err) {
    console.error('API error', err);
    return res.status(500).json({
      ai_reply: 'Sorry! Nagka-issue saglit. Paki-type ulit po ang message 😊'
    });
  }
}
