const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama3-8b-8192';

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
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body || {};
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const GROQ_API_KEYS = [
      process.env.GROQ_API_KEY_1,
      process.env.GROQ_API_KEY_2
    ].filter(Boolean);

    if (GROQ_API_KEYS.length === 0) {
      console.error('ERROR: No GROQ_API_KEY_1 or GROQ_API_KEY_2 env vars found');
      return res.status(500).json({ error: 'Server configuration error: No API keys configured' });
    }

    const systemPrompt = `You are a helpful educational assistant. Respond with a single concise paragraph of 2-4 sentences about the topic. Use only standard ASCII keyboard characters. Do NOT use markdown, bullet points, em-dashes, curly quotes, or any special unicode symbols. Use plain hyphens, straight quotes, and periods only. Keep it engaging and suitable for typing practice.`;

    let lastError = null;

    for (const apiKey of GROQ_API_KEYS) {
      try {
        const response = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message }
            ],
            max_tokens: 256,
            temperature: 0.7
          })
        });

        if (response.status === 429) {
          console.log(`Rate limit on key ending ${apiKey.slice(-4)}, failing over...`);
          continue;
        }

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Groq HTTP ${response.status}: ${errBody}`);
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content || '';
        const cleanText = sanitizeForTyping(rawText);
        return res.status(200).json({ text: cleanText });

      } catch (err) {
        lastError = err;
        console.error('Groq request failed:', err.message);
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
