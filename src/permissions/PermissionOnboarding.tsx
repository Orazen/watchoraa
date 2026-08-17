// Guided permission onboarding (v0.4). Replaces the old informational-only
// Onboarding: a real, one-at-a-time permission sequence with spoken guidance,
// large accessible buttons, skip fallbacks, and a final readiness summary.
// No permission is requested before the user activates "Start Watchora".

import { useEffect, useRef, useState } from 'react';
import { describePermissionState, type PermissionService } from './permissionService';
import type { PermissionKey, PermissionState } from './permissionTypes';
import { useLiveAnnouncer } from '../accessibility/LiveAnnouncer';
import { useFocusTrap } from '../accessibility/FocusManager';

export type OnboardingResult = {
  speechRate: number;
  selectedVoice?: string;
  hapticsEnabled: boolean;
  toneEnabled: boolean;
  intensity: 'low' | 'medium' | 'high';
  onboardingComplete: boolean;
};

type Step =
  | 'welcome'
  | 'audio'
  | 'microphone'
  | 'camera'
  | 'location'
  | 'notifications'
  | 'motion'
  | 'battery'
  | 'summary';

import { getStepSpeech, getVoiceTestPhrase } from '../voice/voicePhrases';

export function PermissionOnboarding({
  service,
  onComplete,
  speak,
  testVoice,
  voice = 'en-US-JennyNeural',
  onVoiceChange,
}: {
  service: PermissionService;
  onComplete: (result: OnboardingResult) => void;
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
  testVoice?: () => void;
  voice?: string;
  onVoiceChange?: (newVoice: string) => void;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const [currentVoice, setCurrentVoice] = useState(voice);
  const [speechRate, setSpeechRate] = useState(1.05);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [toneEnabled, setToneEnabled] = useState(true);
  const [intensity, setIntensity] = useState<'low' | 'medium' | 'high'>('medium');
  const [requesting, setRequesting] = useState<PermissionKey | null>(null);
  const [micTested, setMicTested] = useState(false);
  const [micText, setMicText] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { announce } = useLiveAnnouncer();

  useFocusTrap(containerRef, true);

  // Speak the current step once as it appears in the selected language.
  const spokenRef = useRef<string>('');
  useEffect(() => {
    const key = `${step}-${currentVoice}`;
    if (spokenRef.current === key) return;
    spokenRef.current = key;
    const timer = setTimeout(() => {
      const speech = getStepSpeech(step, currentVoice);
      if (speech) {
        speak(speech, 6, `onboarding-${step}`);
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, currentVoice]);

  async function requestAndAdvance(key: PermissionKey, next: Step) {
    setRequesting(key);
    try {
      const state = await Promise.race([
        service.request(key),
        new Promise<PermissionState>((res) => setTimeout(() => res('temporarily-unavailable'), 6000)),
      ]);
      announce(`${service.get(key).label}: ${describePermissionState(state)}`, state === 'allowed' ? 'polite' : 'assertive');
      if (key === 'microphone' && state === 'allowed') setMicTested(true);
    } catch {
      // ignore
    } finally {
      setRequesting(null);
      setStep(next);
    }
  }

  function finish() {
    onComplete({ speechRate, selectedVoice: currentVoice, hapticsEnabled, toneEnabled, intensity, onboardingComplete: true });
  }

  return (
    <div className="onboarding-backdrop" ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="permission-onboarding-title">
      <section className="panel onboarding-card onboarding-card-wide">
        <div className="section-head">
          <div>
            <p className="topbar-kicker">watchora · ready check</p>
            <h2 id="permission-onboarding-title">{stepLabel(step)}</h2>
          </div>
        </div>

        {step === 'welcome' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              {getStepSpeech('welcome', currentVoice)}
            </p>
            <button className="primary-btn start-watchora-btn" style={{ minHeight: 56 }} onClick={() => setStep('audio')}>
              ▶ Start Watchora
            </button>
          </div>
        )}

        {step === 'audio' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Select your preferred voice and speed, then press Test Voice to listen.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
              <label htmlFor="onboarding-voice-select" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted, #aaa)' }}>
                Preferred Voice:
              </label>
              <select
                id="onboarding-voice-select"
                value={currentVoice}
                onChange={(e) => {
                  const newV = e.target.value;
                  setCurrentVoice(newV);
                  onVoiceChange?.(newV);
                  speak(getVoiceTestPhrase(newV), 4, 'voice-change-test');
                }}
                aria-label="Select voice"
                style={{
                  width: '100%',
                  padding: '0.65rem 0.8rem',
                  borderRadius: '8px',
                  background: 'var(--card-bg, #222)',
                  color: 'var(--text-color, #fff)',
                  border: '1px solid var(--border-color, #444)',
                  fontSize: '0.95rem',
                }}
              >
                <optgroup label="English">
                  <option value="en-US-JennyNeural">👩 English (US) — Jenny (Warm & Natural)</option>
                  <option value="en-US-GuyNeural">👨 English (US) — Guy (Calm & Clear)</option>
                  <option value="en-US-AriaNeural">👩 English (US) — Aria (Expressive)</option>
                  <option value="en-GB-LibbyNeural">👩 English (UK) — Libby</option>
                  <option value="en-GB-RyanNeural">👨 English (UK) — Ryan</option>
                  <option value="en-IN-NeerjaNeural">👩 English (India) — Neerja</option>
                  <option value="en-IN-PrabhatNeural">👨 English (India) — Prabhat</option>
                  <option value="en-AU-NatashaNeural">👩 English (Australia) — Natasha</option>
                </optgroup>
                <optgroup label="Indian Languages">
                  <option value="hi-IN-SwaraNeural">👩 Hindi — Swara (हिन्दी)</option>
                  <option value="hi-IN-MadhurNeural">👨 Hindi — Madhur (हिन्दी)</option>
                  <option value="ta-IN-PallaviNeural">👩 Tamil — Pallavi (தமிழ்)</option>
                  <option value="ta-IN-ValluvarNeural">👨 Tamil — Valluvar (தமிழ்)</option>
                  <option value="te-IN-ShrutiNeural">👩 Telugu — Shruti (తెలుగు)</option>
                  <option value="te-IN-MohanNeural">👨 Telugu — Mohan (తెలుగు)</option>
                  <option value="kn-IN-SapnaNeural">👩 Kannada — Sapna (ಕನ್ನಡ)</option>
                  <option value="ml-IN-SobhanaNeural">👩 Malayalam — Sobhana (മലയാളം)</option>
                  <option value="bn-IN-TanishaaNeural">👩 Bengali — Tanishaa (বাংলা)</option>
                  <option value="gu-IN-DhwaniNeural">👩 Gujarati — Dhwani (ગુજરાતી)</option>
                  <option value="mr-IN-AarohiNeural">👩 Marathi — Aarohi (मराठी)</option>
                  <option value="ur-IN-GulNeural">👩 Urdu — Gul (اردو)</option>
                </optgroup>
                <optgroup label="Other Languages">
                  <option value="es-ES-ElviraNeural">👩 Spanish — Elvira (Español)</option>
                  <option value="fr-FR-DeniseNeural">👩 French — Denise (Français)</option>
                  <option value="de-DE-KatjaNeural">👩 German — Katja (Deutsch)</option>
                </optgroup>
              </select>
            </div>
            <div className="control-inline">
              <button className="secondary-btn" onClick={() => speak(getVoiceTestPhrase(currentVoice), 4, 'test-voice-btn')}>
                <span aria-hidden="true">🔊</span> Test voice
              </button>
              <button className="ghost-btn" onClick={() => setSpeechRate((v) => Math.max(0.7, Number((v - 0.1).toFixed(2))))}>
                − Slower
              </button>
              <strong>{speechRate.toFixed(2)}x</strong>
              <button className="ghost-btn" onClick={() => setSpeechRate((v) => Math.min(1.5, Number((v + 0.1).toFixed(2))))}>
                + Faster
              </button>
            </div>
            <button className="primary-btn" onClick={() => setStep('microphone')}>
              Continue
            </button>
          </div>
        )}

        {step === 'microphone' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Microphone access allows you to control Watchora using your voice. Your microphone is used only while voice control is active.
            </p>
            <button className="primary-btn" disabled={requesting === 'microphone'} onClick={() => requestAndAdvance('microphone', 'camera')}>
              {requesting === 'microphone' ? 'Requesting…' : '🎤 Enable microphone'}
            </button>
            {micTested && (
              <div className="voice-test">
                <p className="muted-note">Say: Watchora, describe my surroundings.</p>
                <input
                  type="text"
                  value={micText}
                  onChange={(e) => setMicText(e.target.value)}
                  placeholder="Type what you said (or use voice control later)"
                  aria-label="Voice test transcript"
                />
              </div>
            )}
            <button className="ghost-btn" onClick={() => setStep('camera')}>
              Skip for now
            </button>
            <details>
              <summary>Learn more</summary>
              <p className="muted-note">
                Your microphone is used only while voice control is active. Watchora does not listen in the background.
              </p>
            </details>
          </div>
        )}

        {step === 'camera' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Camera access allows Watchora to describe scenes, read text, and detect nearby obstacles. Camera frames stay on your device unless you request AI analysis.
            </p>
            <button className="primary-btn" disabled={requesting === 'camera'} onClick={() => requestAndAdvance('camera', 'location')}>
              {requesting === 'camera' ? 'Requesting…' : '📷 Enable camera'}
            </button>
            <button className="ghost-btn" onClick={() => setStep('location')}>
              Skip for now
            </button>
            <details>
              <summary>Learn more</summary>
              <p className="muted-note">
                Frames are processed in memory and discarded. Nothing is uploaded unless you explicitly request AI analysis.
              </p>
            </details>
          </div>
        )}

        {step === 'location' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Location access is needed for saved places, outdoor navigation, Safe Journey, and emergency location sharing.
            </p>
            <button className="primary-btn" disabled={requesting === 'location'} onClick={() => requestAndAdvance('location', 'notifications')}>
              {requesting === 'location' ? 'Requesting…' : <><span aria-hidden="true">📍</span> Enable location</>}
            </button>
            <button className="ghost-btn" onClick={() => setStep('notifications')}>
              Skip for now
            </button>
            <details>
              <summary>Learn more</summary>
              <p className="muted-note">
                Precise location is shared only with contacts you choose and only while a journey or emergency is active.
              </p>
            </details>
          </div>
        )}

        {step === 'notifications' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Notifications allow Watchora to provide journey reminders and emergency updates when the application is not visible.
            </p>
            <button className="primary-btn" disabled={requesting === 'notifications'} onClick={() => requestAndAdvance('notifications', 'motion')}>
              {requesting === 'notifications' ? 'Requesting…' : '🔔 Enable notifications'}
            </button>
            <button className="ghost-btn" onClick={() => setStep('motion')}>
              Skip for now
            </button>
          </div>
        )}

        {step === 'motion' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Motion access can help detect unusual phone movement and improve journey awareness. It does not prove that a theft or emergency occurred.
            </p>
            <button className="primary-btn" disabled={requesting === 'motion'} onClick={() => requestAndAdvance('motion', 'battery')}>
              {requesting === 'motion' ? 'Requesting…' : <><span aria-hidden="true">📳</span> Enable motion sensors</>}
            </button>
            <button className="ghost-btn" onClick={() => setStep('battery')}>
              Skip for now
            </button>
            <details>
              <summary>Learn more</summary>
              <p className="muted-note">
                Motion data is processed on your device and never uploaded. It helps the navigation coach adapt its speaking pace to whether you are walking or standing still.
              </p>
            </details>
          </div>
        )}

        {step === 'battery' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Battery level helps Watchora estimate how long your device will last during a journey or emergency. It is shared only with trusted contacts while a journey or emergency is active.
            </p>
            <button className="primary-btn" disabled={requesting === 'battery'} onClick={() => requestAndAdvance('battery', 'summary')}>
              {requesting === 'battery' ? 'Requesting…' : '🔋 Enable battery sharing'}
            </button>
            <button className="ghost-btn" onClick={() => setStep('summary')}>
              Skip for now
            </button>
            <details>
              <summary>Learn more</summary>
              <p className="muted-note">
                Your battery percentage is shared only during active Safe Journeys and emergency sessions. It is never stored or shared outside those moments.
              </p>
            </details>
          </div>
        )}

        {step === 'summary' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              Watchora is ready. Choose where to start.
            </p>
            <div className="control-inline wrap">
              <button className="primary-btn" style={{ minHeight: 56 }} onClick={finish}>
                ▶ Start Assist
              </button>
              <button className="secondary-btn" style={{ minHeight: 56 }} onClick={finish}>
                <span aria-hidden="true">🛡️</span> Start Safe Journey
              </button>
              <button className="secondary-btn" style={{ minHeight: 56 }} onClick={finish}>
                <span aria-hidden="true">📖</span> Read text
              </button>
              <button className="ghost-btn" onClick={finish}>
                Open dashboard
              </button>
            </div>
            <p className="muted-note">
              You can change everything later in Settings and Permission Centre.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function stepLabel(step: Step): string {
  switch (step) {
    case 'welcome':
      return 'Welcome';
    case 'audio':
      return 'Voice test';
    case 'microphone':
      return 'Microphone';
    case 'camera':
      return 'Camera';
    case 'location':
      return 'Location';
    case 'notifications':
      return 'Notifications';
    case 'motion':
      return 'Motion sensors';
    case 'battery':
      return 'Battery sharing';
    case 'summary':
      return 'You are ready';
  }
}
