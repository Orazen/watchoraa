import { Mic, CircleOff, Ear, Hand } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './components/ui';
import type { DemoExchange } from './landingDemo';
import {
  resolveLandingVoice,
  matchChoice,
  VOICE_HELP,
  VOICE_ORIENTATION,
  normalizeVoice,
  type LandingChoice,
  type LandingSectionTarget,
} from './landingVoice';

// Voice control for the landing page — tap-to-talk, never always-listening.
//
// Research-grounded interaction model: an explicit wake button (privacy and
// clarity beat a wake word for a page a visitor did not opt into), spoken
// acknowledgment of every action, and repair that offers NAMED choices the
// visitor can answer by voice or tap when an utterance is not understood.
// Output is the browser's real speech (speechSynthesis — the server's neural
// TTS is auth-gated and a visitor has no account); input is SpeechRecognition
// where the browser has it, with the typed demo as the honest fallback.

type LandingVoiceProps = {
  onSignIn: () => void;
  onSignUp: () => void;
  onNavigate: (target: LandingSectionTarget) => void;
  onDemoExchange: (exchange: DemoExchange) => void;
};

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Prefer a natural English voice; fall back to any voice, then to default. */
function pickEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  return (
    en.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ??
    en.find((v) => /google/i.test(v.name)) ??
    en[0] ??
    null
  );
}

const ONBOARDED_KEY = 'watchora_landing_voice_onboarded';

export function LandingVoiceControl({ onSignIn, onSignUp, onNavigate, onDemoExchange }: LandingVoiceProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState('Tap the orb to talk — try: what time is it.');
  const [handsFree, setHandsFree] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [choices, setChoices] = useState<LandingChoice[] | null>(null);
  const [micAvailable] = useState<boolean>(() => getRecognitionCtor() !== null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const phaseRef = useRef<Phase>('idle');
  const handsFreeRef = useRef(false);
  const choicesRef = useRef<LandingChoice[] | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  // The three handlers below are mutually recursive (speak's onend restarts
  // listening in hands-free; recognition results call handleUtterance which
  // calls speak). Refs break the cycle without freezing stale closures.
  const speakRef = useRef<(text: string) => void>(() => undefined);
  const handleUtteranceRef = useRef<(text: string) => void>(() => undefined);
  const startListeningRef = useRef<() => void>(() => undefined);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);
  useEffect(() => {
    choicesRef.current = choices;
  }, [choices]);

  // Voice list arrives asynchronously in most browsers; refresh once.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const refresh = () => {
      voiceRef.current = pickEnglishVoice();
    };
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, []);

  const cancelSpeech = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }, []);

  const silence = useCallback(() => {
    setChoices(null);
    cancelSpeech();
    setStatus('Silenced. Tap the orb to talk again.');
    setPhaseBoth(handsFreeRef.current ? 'listening' : 'idle');
  }, [cancelSpeech, setPhaseBoth]);

  const speak = useCallback(
    (text: string) => {
      setStatus(text);
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      cancelSpeech();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.lang = voiceRef.current?.lang ?? 'en-US';
      utterance.onstart = () => setPhaseBoth('speaking');
      utterance.onend = () => {
        if (handsFreeRef.current) {
          setPhaseBoth('listening');
          startListeningRef.current();
        } else {
          setPhaseBoth('idle');
        }
      };
      window.speechSynthesis.speak(utterance);
    },
    [cancelSpeech, setPhaseBoth],
  );
  speakRef.current = speak;

  const handleUtterance = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      setPhaseBoth('thinking');

      // Repair turn: the previous reply asked a choice question. The visitor
      // can answer by voice or by tapping the choice buttons.
      if (choicesRef.current) {
        const choice = matchChoice(text, choicesRef.current);
        setChoices(null);
        if (choice === 'demo') {
          onNavigate('wispr-demo');
          speak('Taking you to the live demo. You can type or tap an example.');
          return;
        }
        if (choice === 'features') {
          onNavigate('wispr-features');
          speak(
            'watchora reads the world out loud. The camera describes what is ahead, hazards are detected on your phone in about a second without any network, text and banknotes are read by voice, and an emergency alerts your trusted contacts with real delivery confirmation.',
          );
          return;
        }
        if (choice === 'account') {
          onNavigate('wispr-account');
          speak('Here is the account section. Accounts are free.');
          return;
        }
        if (/^(no|nope|not now|later)\b/.test(normalizeVoice(text))) {
          speak('Alright.');
          return;
        }
        // Not a choice answer — fall through and treat it as a fresh command.
      }

      const action = resolveLandingVoice(text);
      if (!action) {
        speak("I didn't hear anything I could act on.");
        return;
      }
      switch (action.kind) {
        case 'stop':
          silence();
          break;
        case 'help':
          speak(action.say);
          break;
        case 'demo':
          onDemoExchange(action.exchange);
          speak(action.exchange.reply.say);
          break;
        case 'goto':
          onNavigate(action.target);
          speak(action.say);
          break;
        case 'auth':
          if (action.mode === 'signup') onSignUp();
          else onSignIn();
          speak(action.say);
          break;
        case 'read':
          speak(action.say);
          break;
        case 'clarify':
          setChoices(action.choices);
          speak(action.say);
          break;
      }
    },
    [onDemoExchange, onNavigate, onSignIn, onSignUp, setPhaseBoth, silence, speak],
  );
  handleUtteranceRef.current = handleUtterance;

  const startListening = useCallback(() => {
    const ctor = getRecognitionCtor();
    if (!ctor) {
      setStatus('This browser has no speech input — the typed demo below works everywhere.');
      setPhaseBoth('idle');
      return;
    }
    cancelSpeech();
    try {
      const recognition = new ctor();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => setPhaseBoth('listening');
      recognition.onresult = (event) => {
        const said = event.results?.[0]?.[0]?.transcript;
        if (said) handleUtteranceRef.current(said);
      };
      recognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setStatus('Microphone permission is off. The typed demo below works everywhere.');
        } else if (event.error === 'no-speech') {
          setStatus("I didn't hear anything — tap the orb and try again.");
        } else {
          setStatus('Voice input failed just now — try again or type in the demo.');
        }
        setPhaseBoth('idle');
      };
      recognition.onend = () => {
        if (phaseRef.current === 'listening') setPhaseBoth('idle');
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setStatus('I could not start the microphone — try again or type in the demo.');
      setPhaseBoth('idle');
    }
  }, [cancelSpeech, setPhaseBoth]);
  startListeningRef.current = startListening;

  /** Orb press. First-ever press gets the spoken orientation (onboarding). */
  const onOrbPress = useCallback(() => {
    // Tapping while speaking = barge-in silence.
    if (phaseRef.current === 'speaking') {
      silence();
      if (handsFreeRef.current) startListeningRef.current();
      return;
    }
    if (phaseRef.current === 'listening') {
      recognitionRef.current?.stop();
      setPhaseBoth('idle');
      return;
    }
    let onboarded = false;
    try {
      onboarded = window.localStorage.getItem(ONBOARDED_KEY) === '1';
      window.localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      onboarded = false;
    }
    if (!onboarded) {
      setPhaseBoth('thinking');
      speak(VOICE_ORIENTATION);
      return;
    }
    startListening();
  }, [setPhaseBoth, silence, speak, startListening]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const orbLabel =
    phase === 'listening'
      ? 'Voice listening — tap to stop'
      : phase === 'speaking'
        ? 'Speaking — tap to silence'
        : 'Start voice control';

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2" data-voice-control>
      {/* Visible status + live region: every state change is announced to
          screen readers without stealing focus. */}
      <p
        role="status"
        aria-live="polite"
        className="m-0 max-w-[16rem] rounded-xl border-2 border-foreground/90 bg-card px-3 py-2 text-sm leading-snug shadow-md"
      >
        {phase === 'listening' ? 'Listening… ' : ''}
        {status}
      </p>

      {choices ? (
        <div className="flex gap-2" aria-label="Suggested answers">
          {choices.map((choice) => (
            <Button
              key={choice}
              variant="outline"
              size="md"
              onClick={() => handleUtterance(choice)}
              aria-label={`Answer: ${choice}`}
            >
              {choice}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {micAvailable ? (
          <Button
            variant={handsFree ? 'secondary' : 'outline'}
            size="md"
            onClick={() => {
              const next = !handsFree;
              setHandsFree(next);
              if (next) startListening();
              else recognitionRef.current?.abort();
            }}
            aria-pressed={handsFree}
            aria-label="Hands-free mode: keep listening after every reply"
          >
            <Ear size={16} aria-hidden="true" />
            Hands-free
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="md"
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
          aria-label="What can I say: list of voice commands"
        >
          <Hand size={16} aria-hidden="true" />
          What can I say
        </Button>
        <button
          type="button"
          className="voice-orb"
          data-phase={phase}
          onClick={onOrbPress}
          aria-label={orbLabel}
        >
          {phase === 'speaking' ? <CircleOff size={24} aria-hidden="true" /> : <Mic size={24} aria-hidden="true" />}
        </button>
      </div>

      {showHelp ? (
        <div
          className="max-w-[16rem] rounded-xl border-2 border-foreground/90 bg-card px-3 py-2 text-sm leading-snug shadow-md"
          role="note"
          aria-label="Voice command list"
        >
          <p className="m-0 font-semibold">Try saying:</p>
          <ul className="m-0 mt-1 list-none p-0">
            {['What can I say', 'What does watchora do', 'Try the demo', 'What time is it', 'How does it stay safe', 'How much does it cost', 'Sign up', 'Stop'].map((c) => (
              <li key={c}>“{c}”</li>
            ))}
          </ul>
          <p className="m-0 mt-1 text-muted-foreground">Say stop to silence me at any time.</p>
        </div>
      ) : null}
    </div>
  );
}
