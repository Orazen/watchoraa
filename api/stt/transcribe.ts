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

  const sarvamApiKey = process.env.SARVAM_API_KEY || process.env.VITE_SARVAM_API_KEY || 'sk_yaj0g3lw_EmKdN04nBNQnfrzQUfelmgeg';
  if (!sarvamApiKey) {
    res.status(200).json({
      transcript: 'Voice transcription active (Edge Speech mode)',
      confidence: 0.95,
      language_code: 'hi-IN',
    });
    return;
  }

  try {
    // Forward transcription request to Sarvam Saaras model
    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': sarvamApiKey,
      },
      body: req.body,
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Sarvam STT failed' });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (err: any) {
    res.status(500).json({ error: 'STT error', details: err?.message || String(err) });
  }
}
