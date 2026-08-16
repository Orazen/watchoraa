// Guided permission onboarding (v0.4). Replaces the old informational-only
// Onboarding: a real, one-at-a-time permission sequence with spoken guidance,
// large accessible buttons, skip fallbacks, and a final readiness summary.
// No permission is requested before the user activates "Start Watchora".

import { useEffect, useRef, useState } from 'react';
import { describePermissionState, type PermissionService } from './permissionService';
import type { PermissionKey } from './permissionTypes';
import { useLiveAnnouncer } from '../accessibility/LiveAnnouncer';
import { useFocusTrap } from '../accessibility/FocusManager';

export type OnboardingResult = {
  speechRate: number;
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

const WELCOME_SPEECH =
  'Welcome to Watchora. I can help describe your surroundings, read text, guide journeys, and contact trusted people in an emergency. Activate Start Watchora to check the permissions needed for your selected features.';

export function PermissionOnboarding({
  service,
  onComplete,
  speak,
  testVoice,
}: {
  service: PermissionService;
  onComplete: (result: OnboardingResult) => void;
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
  testVoice: () => void;
}) {
  const [step, setStep] = useState<Step>('welcome');
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

  // Speak the current step once as it appears.
  const spokenRef = useRef<string>('');
  useEffect(() => {
    if (spokenRef.current === step) return;
    spokenRef.current = step;
    const timer = setTimeout(() => {
      if (step === 'welcome') speak(WELCOME_SPEECH, 6, 'onboarding-welcome');
      else if (step === 'audio') speak('First, let us test Watchora’s voice. You should hear this message clearly.', 6, 'onboarding-audio');
      else if (step === 'microphone')
        speak('Microphone access allows you to control Watchora using your voice. Your microphone is used only while voice control is active.', 6, 'onboarding-mic');
      else if (step === 'camera')
        speak('Camera access allows Watchora to describe scenes, read text, and detect nearby obstacles. Camera frames stay on your device unless you request AI analysis.', 6, 'onboarding-camera');
      else if (step === 'location')
        speak('Location access is needed for saved places, outdoor navigation, Safe Journey, and emergency location sharing.', 6, 'onboarding-location');
      else if (step === 'notifications')
        speak('Notifications allow Watchora to provide journey reminders and emergency updates when the application is not visible.', 6, 'onboarding-notif');
      else if (step === 'motion')
        speak('Motion access can help detect unusual phone movement and improve journey awareness. It does not prove that a theft or emergency occurred.', 6, 'onboarding-motion');
      else if (step === 'battery')
        speak('Battery level helps Watchora estimate remaining power during journeys and emergencies. It is shared only with trusted contacts while a journey or emergency is active.', 6, 'onboarding-battery');
      else if (step === 'summary') {
        const mic = service.get('microphone').state;
        const cam = service.get('camera').state;
        const loc = service.get('location').state;
        const notif = service.get('notifications').state;
        const bat = service.get('battery').state;
        speak(
          `Watchora is ready. Camera is ${describePermissionState(cam)}. Microphone is ${describePermissionState(mic)}. Location is ${describePermissionState(loc)}. Notifications are ${describePermissionState(notif)}. Battery is ${describePermissionState(bat)}. You can enable them later from Permission Centre.`,
          6,
          'onboarding-summary',
        );
      }
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function requestAndAdvance(key: PermissionKey, next: Step) {
    setRequesting(key);
    const state = await service.request(key);
    setRequesting(null);
    announce(`${service.get(key).label}: ${describePermissionState(state)}`, state === 'allowed' ? 'polite' : 'assertive');
    if (key === 'microphone' && state === 'allowed') setMicTested(true);
    setStep(next);
  }

  function finish() {
    onComplete({ speechRate, hapticsEnabled, toneEnabled, intensity, onboardingComplete: true });
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
              {WELCOME_SPEECH}
            </p>
            <button className="primary-btn start-watchora-btn" style={{ minHeight: 56 }} onClick={() => setStep('audio')}>
              ▶ Start Watchora
            </button>
          </div>
        )}

        {step === 'audio' && (
          <div className="form-stack">
            <p className="tiny-print" role="status" aria-live="polite">
              First, let us test Watchora’s voice. You should hear this message clearly.
            </p>
            <div className="control-inline">
              <button className="secondary-btn" onClick={testVoice}>
                <span aria-hidden="true">🔊</span> Repeat voice
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
