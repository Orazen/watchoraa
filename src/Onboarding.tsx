import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Info, Minus, Plus, Vibrate, Volume2 } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardFooter, CardHeader } from './components/ui';

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <Card className="w-full max-w-xl">
        <CardHeader className="gap-2 p-6 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{step.eyebrow}</p>
            <Badge tone="outline">
              Step {stepIndex + 1} of {STEPS.length}
            </Badge>
          </div>
          <h2 id="onboarding-title" className="font-display text-2xl font-semibold leading-tight tracking-tight text-foreground">
            {step.title}
          </h2>
          <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-6 p-6 pt-2">
          <p role="status" aria-live="polite" className="text-base leading-relaxed text-foreground">
            {step.body}
          </p>

          {step.key === 'voice' ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-base font-medium text-foreground">Reading speed</span>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Slower"
                    onClick={() => setSpeechRate((v) => Math.max(0.7, Number((v - 0.1).toFixed(2))))}
                  >
                    <Minus aria-hidden="true" />
                    Slower
                  </Button>
                  <strong className="text-lg font-semibold tabular-nums text-foreground">{speechRate.toFixed(2)}x</strong>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="Faster"
                    onClick={() => setSpeechRate((v) => Math.min(1.5, Number((v + 0.1).toFixed(2))))}
                  >
                    <Plus aria-hidden="true" />
                    Faster
                  </Button>
                </div>
              </div>
              <Button variant="secondary" onClick={onTestVoice}>
                <Volume2 aria-hidden="true" />
                Test voice
              </Button>
            </div>
          ) : null}

          {step.key === 'feedback' ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-medium text-foreground">Vibration</span>
                <Button
                  variant={hapticsEnabled ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={hapticsEnabled}
                  onClick={() => setHapticsEnabled((v) => !v)}
                >
                  {hapticsEnabled ? 'On' : 'Off'}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-medium text-foreground">Alert tones</span>
                <Button
                  variant={toneEnabled ? 'secondary' : 'outline'}
                  size="sm"
                  aria-pressed={toneEnabled}
                  onClick={() => setToneEnabled((v) => !v)}
                >
                  {toneEnabled ? 'On' : 'Off'}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-base font-medium text-foreground">Strength</span>
                <div className="flex items-center gap-2">
                  {(['low', 'medium', 'high'] as const).map((level) => (
                    <Button
                      key={level}
                      variant={intensity === level ? 'primary' : 'outline'}
                      size="sm"
                      aria-pressed={intensity === level}
                      onClick={() => setIntensity(level)}
                    >
                      {level}
                    </Button>
                  ))}
                </div>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  // Replay the hazard-warning pattern via the same mechanism Settings uses.
                  if ('vibrate' in navigator && hapticsEnabled) navigator.vibrate([0, 90, 220, 90]);
                  speak('This is the warning pattern. A chair is near you on the left.');
                }}
              >
                <Vibrate aria-hidden="true" />
                Test warning pattern
              </Button>
            </div>
          ) : null}

          {step.key === 'camera' ? (
            <p className="flex items-start gap-2.5 rounded-lg border-2 border-foreground/20 bg-muted p-4 text-base leading-relaxed text-muted-foreground">
              <Info aria-hidden="true" className="mt-1 h-4 w-4 shrink-0" />
              <span>
                Tip: you can also start the camera later from the Assist tab. Watchora never saves
                camera frames — they are processed in memory and discarded.
              </span>
            </p>
          ) : null}
        </CardContent>

        <CardFooter className="flex-wrap justify-between gap-3 p-6 pt-0">
          {stepIndex > 0 ? (
            <Button variant="ghost" onClick={back}>
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          ) : null}
          <Button size="xl" className="min-w-40 flex-1" onClick={next}>
            <ArrowRight aria-hidden="true" />
            {stepIndex === STEPS.length - 1 ? 'Start using watchora' : 'Continue'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
