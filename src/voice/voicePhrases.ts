export function getLangFromVoice(voiceName: string): string {
  const m = /^([a-z]{2})-[A-Z]{2}/.exec(voiceName);
  return m ? m[1] : 'en';
}

export function getVoiceTestPhrase(voiceName: string): string {
  const lang = getLangFromVoice(voiceName);
  switch (lang) {
    case 'hi':
      return 'यह वॉचोरा की आवाज़ का परीक्षण है। आप इसे स्पष्ट रूप से सुन सकते हैं।';
    case 'ta':
      return 'இது வாச்சோராவின் குரல் சோதனை. நீங்கள் இதை தெளிவாகக் கேட்கலாம்.';
    case 'te':
      return 'ఇది వాచోరా స్వర పరీక్ష. మీరు దీన్ని స్పష్టంగా వినవచ్చు.';
    case 'kn':
      return 'ಇದು ವಾಚೋರಾ ಧ್ವನಿ ಪರೀಕ್ಷೆ. ನೀವು ಇದನ್ನು ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಬಹುದು.';
    case 'ml':
      return 'ഇത് വാച്ചോറ ശബ്ദ പരിശോധനയാണ്. നിങ്ങൾക്ക് ഇത് വ്യക്തമായി കേൾക്കാം.';
    case 'bn':
      return 'এটি ওয়াচোরা ভয়েস পরীক্ষা। আপনি এটি স্পষ্টভাবে শুনতে পাচ্ছেন।';
    case 'gu':
      return 'આ વોચોરા અવાજ પરીક્ષણ છે. તમે તેને સ્પષ્ટ રીતે સાંભળી શકો છો.';
    case 'mr':
      return 'ही वॉचोरा आवाज चाचणी आहे. आपण हे स्पष्टपणे ऐकू शकता.';
    case 'ur':
      return 'یہ واچورا کی آواز کا ٹیسٹ ہے۔ آپ اسے واضح طور پر سن سکتے ہیں۔';
    case 'es':
      return 'Esta es una prueba de la voz de Watchora. Deberías escuchar este mensaje con claridad.';
    case 'fr':
      return 'Ceci est un test de la voix de Watchora. Vous devriez entendre ce message clairement.';
    case 'de':
      return 'Dies ist ein Test der Stimme von Watchora. Sie sollten diese Nachricht deutlich hören.';
    default:
      return 'This is a test of the Watchora voice. You should hear this message clearly.';
  }
}

export function getStepSpeech(step: string, voiceName: string): string {
  const lang = getLangFromVoice(voiceName);
  if (lang === 'hi') {
    switch (step) {
      case 'welcome':
        return 'वॉचोरा में आपका स्वागत है। मैं आपके आस-पास के वातावरण का वर्णन करने, टेक्स्ट पढ़ने, यात्राओं में मार्गदर्शन करने और आपातकालीन स्थिति में मदद करने में सहायता कर सकता हूँ।';
      case 'audio':
        return 'वॉचोरा की आवाज़ का परीक्षण करें। नीचे अपनी पसंदीदा आवाज़ और गति चुनें।';
      case 'microphone':
        return 'माइक्रोफ़ोन एक्सेस आपको आवाज़ से वॉचोरा को नियंत्रित करने की अनुमति देता है।';
      case 'camera':
        return 'कैमरा एक्सेस वॉचोरा को दृश्यों का वर्णन करने, टेक्स्ट पढ़ने और बाधाओं का पता लगाने की अनुमति देता है।';
      case 'location':
        return 'सुरक्षित यात्रा, नेविगेशन और आपातकालीन सहायता के लिए स्थान की अनुमति आवश्यक है।';
      case 'notifications':
        return 'सूचनाएं आपको यात्रा और आपातकालीन अपडेट देने की अनुमति देती हैं।';
      case 'motion':
        return 'मोशन सेंसर यात्रा के दौरान असामान्य गतिविधि की पहचान करने में मदद करते हैं।';
      case 'battery':
        return 'बैटरी स्तर यात्रा और आपातकालीन स्थिति में शेष पावर का अनुमान लगाने में मदद करता है।';
      case 'summary':
        return 'वॉचोरा तैयार है। सेटअप पूरा हो गया है।';
      default:
        return '';
    }
  }
  if (lang === 'ta') {
    switch (step) {
      case 'welcome':
        return 'வாச்சோராவிற்கு வரவேற்கிறோம். உங்களைச் சுற்றியுள்ளவற்றை விவரிக்கவும், உரையைப் படிக்கவும் நான் உதவுவேன்.';
      case 'audio':
        return 'வாச்சோராவின் குரலைத் தேர்ந்தெடுத்து வேகத்தை சரிசெய்யவும்.';
      case 'microphone':
        return 'குரல் கட்டுப்பாட்டுக்கு மைக்ரோஃபோன் அணுகல் தேவை.';
      case 'camera':
        return 'காட்சிகள் மற்றும் தடைகளை விவரிக்க கேமரா அணுகல் தேவை.';
      case 'location':
        return 'இருப்பிட அணுகல் பாதுகாப்பு மற்றும் வழிகாட்டலுக்கு தேவை.';
      case 'notifications':
        return 'அறிவிப்புகள் உங்களுக்கு பயண மற்றும் அவசர புதுப்பிப்புகளை வழங்குகின்றன.';
      case 'summary':
        return 'வாச்சோரா தயாராக உள்ளது.';
      default:
        return '';
    }
  }
  if (lang === 'te') {
    switch (step) {
      case 'welcome':
        return 'వాచోరాకు స్వాగతం. మీ పరిసరాలను వివరించడానికి, చదవడానికి మరియు మార్గదర్శకత్వం చేయడానికి నేను సహాయం చేస్తాను.';
      case 'audio':
        return 'వాచోరా స్వరాన్ని ఎంచుకోండి మరియు పరీక్షించండి.';
      case 'microphone':
        return 'వాయిస్ నియంత్రణ కోసం మైక్రోఫోన్ అనుమతి అవసరం.';
      case 'camera':
        return 'దృశ్యాలు మరియు అడ్డంకులను గుర్తించడానికి కెమెరా అనుమతి అవసరం.';
      case 'location':
        return 'భద్రత మరియు నావిగేషన్ కోసం లొకేషన్ అనుమతి అవసరం.';
      case 'notifications':
        return 'నోటిఫికేషన్‌లు ప్రయాణ మరియు అత్యవసర అప్‌డేట్‌లను అందిస్తాయి.';
      case 'summary':
        return 'వాచోరా సిద్ధంగా ఉంది.';
      default:
        return '';
    }
  }
  if (lang === 'es') {
    switch (step) {
      case 'welcome':
        return 'Bienvenido a Watchora. Puedo ayudarte a describir tu entorno, leer texto y guiarte en tus viajes.';
      case 'audio':
        return 'Primero, probemos la voz de Watchora. Puedes seleccionar tu voz y velocidad a continuación.';
      case 'microphone':
        return 'El acceso al micrófono te permite controlar Watchora con tu voz.';
      case 'camera':
        return 'El acceso a la cámara permite a Watchora describir escenas y detectar obstáculos.';
      case 'location':
        return 'El acceso a la ubicación es necesario para viajes seguros y navegación.';
      case 'notifications':
        return 'Las notificaciones permiten a Watchora brindarte recordatorios de viaje.';
      case 'summary':
        return 'Watchora está listo. La configuración se ha completado.';
      default:
        return '';
    }
  }

  // Default English
  switch (step) {
    case 'welcome':
      return 'Welcome to Watchora. I can help describe your surroundings, read text, guide journeys, and contact trusted people in an emergency. Activate Start Watchora to check the permissions needed for your selected features.';
    case 'audio':
      return 'First, let us test Watchora’s voice. You can select your voice and speed below.';
    case 'microphone':
      return 'Microphone access allows you to control Watchora using your voice. Your microphone is used only while voice control is active.';
    case 'camera':
      return 'Camera access allows Watchora to describe scenes, read text, and detect nearby obstacles. Camera frames stay on your device unless you request AI analysis.';
    case 'location':
      return 'Location access is needed for saved places, outdoor navigation, Safe Journey, and emergency location sharing.';
    case 'notifications':
      return 'Notifications allow Watchora to provide journey reminders and emergency updates when the application is not visible.';
    case 'motion':
      return 'Motion access can help detect unusual phone movement and improve journey awareness. It does not prove that a theft or emergency occurred.';
    case 'battery':
      return 'Battery level helps Watchora estimate remaining power during journeys and emergencies. It is shared only with trusted contacts while a journey or emergency is active.';
    case 'summary':
      return 'Watchora is ready. You can enable them later from Permission Centre.';
    default:
      return '';
  }
}
