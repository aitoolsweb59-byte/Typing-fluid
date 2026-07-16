const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function sanitizeForTyping(text) {
  if (!text) return '';
  return text
    .replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { message, provider } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const systemPrompt = `You are a helpful educational assistant. Respond with a detailed, well-written paragraph of 6-10 sentences about the topic. Use only standard ASCII keyboard characters. Do NOT use markdown, bullet points, em-dashes, curly quotes, or any special unicode symbols. Use plain hyphens, straight quotes, and periods only. Keep it engaging and suitable for typing practice.`;

    // Build available providers from env vars
    const allProviders = [];
    if (process.env.GROQ_API_KEY_1) allProviders.push({ name: 'groq1', type: 'groq', key: process.env.GROQ_API_KEY_1 });
    if (process.env.GROQ_API_KEY_2) allProviders.push({ name: 'groq2', type: 'groq', key: process.env.GROQ_API_KEY_2 });
    if (process.env.GEMINI_API_KEY_1) allProviders.push({ name: 'gemini1', type: 'gemini', key: process.env.GEMINI_API_KEY_1 });

    if (allProviders.length === 0) {
      console.error('ERROR: No API keys configured');
      return res.status(500).json({ error: 'No API keys configured. Add GROQ_API_KEY_1, GROQ_API_KEY_2, or GEMINI_API_KEY_1 in Vercel Environment Variables.' });
    }

    // Determine order: preferred first, then others as fallback
    let order = [];
    const preferred = provider || 'auto';
    if (preferred !== 'auto') {
      const p = allProviders.find(x => x.name === preferred);
      if (p) order.push(p);
    }
    allProviders.forEach(p => {
      if (!order.find(x => x.name === p.name)) order.push(p);
    });

    let lastError = null;

    for (const p of order) {
      try {
        let rawText = '';

        if (p.type === 'groq') {
          const response = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${p.key}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: GROQ_MODEL,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message }
              ],
              max_tokens: 1024,
              temperature: 0.7
            })
          });

          if (response.status === 429) {
            console.log(`Rate limit on ${p.name}, failing over...`);
            continue;
          }
          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Groq HTTP ${response.status}: ${errBody}`);
          }
          const data = await response.json();
          rawText = data.choices?.[0]?.message?.content || '';

        } else if (p.type === 'gemini') {
          const geminiUrl = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${p.key}`;
          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: systemPrompt + '\n\nTopic: ' + message }]
              }]
            })
          });

          if (response.status === 429) {
            console.log(`Rate limit on ${p.name}, failing over...`);
            continue;
          }
          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Gemini HTTP ${response.status}: ${errBody}`);
          }
          const data = await response.json();
          rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }

        const cleanText = sanitizeForTyping(rawText);
        if (!cleanText) throw new Error('Empty response from AI');
        return res.status(200).json({ text: cleanText, provider: p.name });

      } catch (err) {
        lastError = err;
        console.error(`${p.name} request failed:`, err.message);
        continue;
      }
    }

    return res.status(503).json({
      error: 'All API keys failed or are rate limited. Please try again later.',
      detail: lastError?.message
    });

  } catch (err) {
    console.error('Unhandled function error:', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
}
