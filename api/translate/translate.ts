export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const { input, source_language_code = 'en-IN', target_language_code = 'hi-IN' } = body;

  const sarvamApiKey = process.env.SARVAM_API_KEY || process.env.VITE_SARVAM_API_KEY || 'sk_yaj0g3lw_EmKdN04nBNQnfrzQUfelmgeg';
  if (!sarvamApiKey) {
    res.status(200).json({
      translated_text: input || '',
      source_language_code,
      target_language_code,
    });
    return;
  }

  try {
    const response = await fetch('https://api.sarvam.ai/translate', {
      method: 'POST',
      headers: {
        'api-subscription-key': sarvamApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        source_language_code,
        target_language_code,
        speaker_gender: 'Female',
        mode: 'formal',
        model: 'mayura:v1',
      }),
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Sarvam translation failed' });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: 'Translation error', details: err?.message || String(err) });
  }
}
