export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const voices = [
    // Sarvam AI Indian Neural Voices (bulbul:v2 & bulbul:v3)
    { shortName: 'sarvam-anushka', locale: 'hi-IN', language: 'Hindi (Sarvam AI)', native: 'अनुष्का (हिन्दी)', gender: 'Female' },
    { shortName: 'sarvam-abhilash', locale: 'hi-IN', language: 'Hindi (Sarvam AI)', native: 'अभिलाष (हिन्दी)', gender: 'Male' },
    { shortName: 'sarvam-aditya', locale: 'hi-IN', language: 'Hindi (Sarvam AI)', native: 'आदित्य (हिन्दी)', gender: 'Male' },
    { shortName: 'sarvam-priya', locale: 'hi-IN', language: 'Hindi (Sarvam AI)', native: 'प्रिया (हिन्दी)', gender: 'Female' },
    { shortName: 'sarvam-manisha', locale: 'hi-IN', language: 'Hindi (Sarvam AI)', native: 'मनीषा (हिन्दी)', gender: 'Female' },
    { shortName: 'sarvam-vidya', locale: 'ta-IN', language: 'Tamil (Sarvam AI)', native: 'வித்யா (தமிழ்)', gender: 'Female' },
    { shortName: 'sarvam-rahul', locale: 'te-IN', language: 'Telugu (Sarvam AI)', native: 'రాహుల్ (తెలుగు)', gender: 'Male' },

    // Microsoft Edge Indian Neural Voices
    { shortName: 'hi-IN-SwaraNeural', locale: 'hi-IN', language: 'Hindi', native: 'स्वरा (हिन्दी)', gender: 'Female' },
    { shortName: 'hi-IN-MadhurNeural', locale: 'hi-IN', language: 'Hindi', native: 'मधुर (हिन्दी)', gender: 'Male' },
    { shortName: 'ta-IN-PallaviNeural', locale: 'ta-IN', language: 'Tamil', native: 'பல்லவி (தமிழ்)', gender: 'Female' },
    { shortName: 'ta-IN-ValluvarNeural', locale: 'ta-IN', language: 'Tamil', native: 'வள்ளுவர் (தமிழ்)', gender: 'Male' },
    { shortName: 'te-IN-ShrutiNeural', locale: 'te-IN', language: 'Telugu', native: 'శ్రుతి (తెలుగు)', gender: 'Female' },
    { shortName: 'te-IN-MohanNeural', locale: 'te-IN', language: 'Telugu', native: 'మోహన్ (తెలుగు)', gender: 'Male' },
    { shortName: 'kn-IN-SapnaNeural', locale: 'kn-IN', language: 'Kannada', native: 'ಸಪ್ನಾ (ಕನ್ನಡ)', gender: 'Female' },
    { shortName: 'kn-IN-GaganNeural', locale: 'kn-IN', language: 'Kannada', native: 'ಗಗನ್ (ಕನ್ನಡ)', gender: 'Male' },
    { shortName: 'ml-IN-SobhanaNeural', locale: 'ml-IN', language: 'Malayalam', native: 'ശോഭന (മലയാളം)', gender: 'Female' },
    { shortName: 'ml-IN-MidhunNeural', locale: 'ml-IN', language: 'Malayalam', native: 'മിഥുൻ (മലയാളം)', gender: 'Male' },
    { shortName: 'bn-IN-TanishaaNeural', locale: 'bn-IN', language: 'Bengali', native: 'তানিশা (বাংলা)', gender: 'Female' },
    { shortName: 'bn-IN-BashkarNeural', locale: 'bn-IN', language: 'Bengali', native: 'ভাস্কর (বাংলা)', gender: 'Male' },
    { shortName: 'gu-IN-DhwaniNeural', locale: 'gu-IN', language: 'Gujarati', native: 'ધ્વનિ (ગુજરાતી)', gender: 'Female' },
    { shortName: 'mr-IN-AarohiNeural', locale: 'mr-IN', language: 'Marathi', native: 'आरोही (मराठी)', gender: 'Female' },
    { shortName: 'ur-IN-GulNeural', locale: 'ur-IN', language: 'Urdu', native: 'گل (اردو)', gender: 'Female' },
    { shortName: 'en-IN-NeerjaNeural', locale: 'en-IN', language: 'English (India)', native: 'Neerja', gender: 'Female' },
    { shortName: 'en-IN-PrabhatNeural', locale: 'en-IN', language: 'English (India)', native: 'Prabhat', gender: 'Male' },

    // English & Global Neural Voices
    { shortName: 'en-US-JennyNeural', locale: 'en-US', language: 'English (US)', native: 'Jenny (US)', gender: 'Female' },
    { shortName: 'en-US-GuyNeural', locale: 'en-US', language: 'English (US)', native: 'Guy (US)', gender: 'Male' },
    { shortName: 'en-US-AriaNeural', locale: 'en-US', language: 'English (US)', native: 'Aria (US)', gender: 'Female' },
    { shortName: 'en-GB-LibbyNeural', locale: 'en-GB', language: 'English (UK)', native: 'Libby (UK)', gender: 'Female' },
    { shortName: 'en-GB-RyanNeural', locale: 'en-GB', language: 'English (UK)', native: 'Ryan (UK)', gender: 'Male' },
    { shortName: 'es-ES-ElviraNeural', locale: 'es-ES', language: 'Spanish (Spain)', native: 'Elvira (Español)', gender: 'Female' },
    { shortName: 'fr-FR-DeniseNeural', locale: 'fr-FR', language: 'French', native: 'Denise (Français)', gender: 'Female' },
    { shortName: 'de-DE-KatjaNeural', locale: 'de-DE', language: 'German', native: 'Katja (Deutsch)', gender: 'Female' },
  ];

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.status(200).json({ voices, count: voices.length });
}
