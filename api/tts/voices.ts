export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const voices = [
    { shortName: 'en-US-JennyNeural', locale: 'en-US', language: 'English (US)', native: 'English (US)', gender: 'Female' },
    { shortName: 'en-US-GuyNeural', locale: 'en-US', language: 'English (US)', native: 'English (US)', gender: 'Male' },
    { shortName: 'en-US-AriaNeural', locale: 'en-US', language: 'English (US)', native: 'English (US)', gender: 'Female' },
    { shortName: 'en-GB-LibbyNeural', locale: 'en-GB', language: 'English (UK)', native: 'English (UK)', gender: 'Female' },
    { shortName: 'en-GB-RyanNeural', locale: 'en-GB', language: 'English (UK)', native: 'English (UK)', gender: 'Male' },
    { shortName: 'en-IN-NeerjaNeural', locale: 'en-IN', language: 'English (India)', native: 'English (India)', gender: 'Female' },
    { shortName: 'en-IN-PrabhatNeural', locale: 'en-IN', language: 'English (India)', native: 'English (India)', gender: 'Male' },
    { shortName: 'hi-IN-SwaraNeural', locale: 'hi-IN', language: 'Hindi', native: 'हिन्दी', gender: 'Female' },
    { shortName: 'hi-IN-MadhurNeural', locale: 'hi-IN', language: 'Hindi', native: 'हिन्दी', gender: 'Male' },
    { shortName: 'ta-IN-PallaviNeural', locale: 'ta-IN', language: 'Tamil', native: 'தமிழ்', gender: 'Female' },
    { shortName: 'ta-IN-ValluvarNeural', locale: 'ta-IN', language: 'Tamil', native: 'தமிழ்', gender: 'Male' },
    { shortName: 'te-IN-ShrutiNeural', locale: 'te-IN', language: 'Telugu', native: 'తెలుగు', gender: 'Female' },
    { shortName: 'te-IN-MohanNeural', locale: 'te-IN', language: 'Telugu', native: 'తెలుగు', gender: 'Male' },
    { shortName: 'kn-IN-SapnaNeural', locale: 'kn-IN', language: 'Kannada', native: 'ಕನ್ನಡ', gender: 'Female' },
    { shortName: 'kn-IN-GaganNeural', locale: 'kn-IN', language: 'Kannada', native: 'ಕನ್ನಡ', gender: 'Male' },
    { shortName: 'ml-IN-SobhanaNeural', locale: 'ml-IN', language: 'Malayalam', native: 'മലയാളം', gender: 'Female' },
    { shortName: 'ml-IN-MidhunNeural', locale: 'ml-IN', language: 'Malayalam', native: 'മലയാളം', gender: 'Male' },
    { shortName: 'bn-IN-TanishaaNeural', locale: 'bn-IN', language: 'Bengali', native: 'বাংলা', gender: 'Female' },
    { shortName: 'bn-IN-BashkarNeural', locale: 'bn-IN', language: 'Bengali', native: 'বাংলা', gender: 'Male' },
    { shortName: 'gu-IN-DhwaniNeural', locale: 'gu-IN', language: 'Gujarati', native: 'ગુજરાતી', gender: 'Female' },
    { shortName: 'mr-IN-AarohiNeural', locale: 'mr-IN', language: 'Marathi', native: 'मराठी', gender: 'Female' },
    { shortName: 'ur-IN-GulNeural', locale: 'ur-IN', language: 'Urdu', native: 'اردو', gender: 'Female' },
    { shortName: 'es-ES-ElviraNeural', locale: 'es-ES', language: 'Spanish (Spain)', native: 'Español', gender: 'Female' },
    { shortName: 'fr-FR-DeniseNeural', locale: 'fr-FR', language: 'French', native: 'Français', gender: 'Female' },
    { shortName: 'de-DE-KatjaNeural', locale: 'de-DE', language: 'German', native: 'Deutsch', gender: 'Female' },
  ];

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).json({ voices, count: voices.length });
}
