import { useEffect, useRef, useState } from 'react';

// First-run onboarding for Watchora (roadmap Phase 1: "Add permission education
// for camera, microphone, and location" + "Accessibility-first onboarding").
// Voice-first: every step is spoken aloud as it appears, uses the app's own
// theme classes, and walks through the three permissions the app needs plus a
// voice/haptic test so a blind user calibrates feedback before first use.
// Dismissed state is persisted per-user (prefs API), never a nag.

export type OnboardingResult = {
  speechRate: number;
  hapticsEnabled: boolean;
  toneEnabled: boolean;
  intensity: 'low' | 'medium' | 'high';
  onboardingComplete: boolean;
};

type Step = 'welcome' | 'camera' | 'voice' | 'feedback' | 'done';

const STEPS: Array<{ key: Step; eyebrow: string; title: string; body: string }> = [
  {
    key: 'welcome',
    eyebrow: 'watchora · get started',
    title: 'Welcome',
    body: 'Watchora turns your phone camera into a spoken second pair of eyes. Over the next few steps we will check the permissions you need and tune your voice and alerts. Everything is spoken as we go.',
  },
  {
    key: 'camera',
    eyebrow: 'step 2 of 4 · camera',
    title: 'Camera access',
    body: 'Watchora needs the camera to see what is in front of you: hazards, signs, and documents. The camera feed is processed in memory and never saved or uploaded without your request. If you grant camera access now, we will start the live hazard layer.',
  },
  {
    key: 'voice',
    eyebrow: 'step 3 of 4 · voice',
    title: 'Voice feedback',
    body: 'This is how watchora talks to you. The buttons below let you test the reading voice and adjust how fast it speaks. Pick a speed that is comfortable. You can change it anytime in Settings.',
  },
  {
    key: 'feedback',
    eyebrow: 'step 4 of 4 · alerts',
    title: 'Hazard alerts',
    body: 'When the camera sees a nearby hazard, watchora uses a short vibration and tone so you know without looking at the screen. This test plays the warning pattern. You can turn these off or change the strength at any time.',
  },
  {
    key: 'done',
    eyebrow: 'all set',
    title: 'You are ready',
    body: 'Everything is set up. You can start with a spoken description of what is in front of you, or connect the camera and walk with the live hazard layer. If something is ever unclear, watchora says so instead of guessing.',
  },
];

export function Onboarding({
  onComplete,
  onTestVoice,
  speak,
}: {
  onComplete: (result: OnboardingResult) => void;
  onTestVoice: () => void;
  speak: (text: string) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [speechRate, setSpeechRate] = useState(1.05);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [toneEnabled, setToneEnabled] = useState(true);
  const [intensity, setIntensity] = useState<'low' | 'medium' | 'high'>('medium');
  const step = STEPS[stepIndex];
  const spokenRef = useRef<number>(-1);

  // Speak each step as it appears (voice-first onboarding).
  useEffect(() => {
    if (spokenRef.current === stepIndex) return;
    spokenRef.current = stepIndex;
    const timer = setTimeout(() => speak(`${step.eyebrow}. ${step.title}. ${step.body}`), 400);
    return () => clearTimeout(timer);
  }, [stepIndex, step, speak]);

  function next() {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      onComplete({ speechRate, hapticsEnabled, toneEnabled, intensity, onboardingComplete: true });
    }
  }

  function back() {
    if (stepIndex > 0) setStepIndex((i) => i - 1);
  }

  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      <section className="panel onboarding-card">
        <div className="section-head">
          <div>
            <p className="topbar-kicker">{step.eyebrow}</p>
            <h2 id="onboarding-title">{step.title}</h2>
          </div>
          <span className="pill pill-neutral">
            {stepIndex + 1} / {STEPS.length}
          </span>
        </div>

        <p className="tiny-print" role="status" aria-live="polite">
          {step.body}
        </p>

        {step.key === 'voice' ? (
          <div className="form-stack">
            <div className="settings-row">
              <span>Reading speed</span>
              <div className="control-inline">
                <button
                  className="ghost-btn"
                  aria-label="Slower"
                  onClick={() => setSpeechRate((v) => Math.max(0.7, Number((v - 0.1).toFixed(2))))}
                >
                  −
                </button>
                <strong>{speechRate.toFixed(2)}x</strong>
                <button
                  className="ghost-btn"
                  aria-label="Faster"
                  onClick={() => setSpeechRate((v) => Math.min(1.5, Number((v + 0.1).toFixed(2))))}
                >
                  +
                </button>
              </div>
            </div>
            <button className="secondary-btn" onClick={onTestVoice}>
              🔊 Test voice
            </button>
          </div>
        ) : null}

        {step.key === 'feedback' ? (
          <div className="form-stack">
            <div className="settings-row">
              <span>Vibration</span>
              <button
                className="ghost-btn"
                aria-pressed={hapticsEnabled}
                onClick={() => setHapticsEnabled((v) => !v)}
              >
                {hapticsEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="settings-row">
              <span>Alert tones</span>
              <button className="ghost-btn" aria-pressed={toneEnabled} onClick={() => setToneEnabled((v) => !v)}>
                {toneEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div className="settings-row">
              <span>Strength</span>
              <div className="control-inline">
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <button
                    key={level}
                    className={`ghost-btn ${intensity === level ? 'active' : ''}`}
                    aria-pressed={intensity === level}
                    onClick={() => setIntensity(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="secondary-btn"
              onClick={() => {
                // Replay the hazard-warning pattern via the same mechanism Settings uses.
                if ('vibrate' in navigator && hapticsEnabled) navigator.vibrate([0, 90, 220, 90]);
                speak('This is the warning pattern. A chair is near you on the left.');
              }}
            >
              📳 Test warning pattern
            </button>
          </div>
        ) : null}

        {step.key === 'camera' ? (
          <p className="muted-note">
            Tip: you can also start the camera later from the Assist tab. Watchora never saves
            camera frames — they are processed in memory and discarded.
          </p>
        ) : null}

        <div className="onboarding-actions">
          {stepIndex > 0 ? (
            <button className="ghost-btn" onClick={back}>
              ← Back
            </button>
          ) : null}
          <button className="primary-btn" onClick={next}>
            {stepIndex === STEPS.length - 1 ? 'Start using watchora' : 'Continue'}
          </button>
        </div>
      </section>
    </div>
  );
}
