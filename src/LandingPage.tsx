import {
  ArrowRight,
  Banknote,
  BookOpen,
  Check,
  ChevronDown,
  Mic,
  MessageCircleHeart,
  ScanEye,
  ShieldCheck,
  Siren,
  Volume2,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from './components/ui';
import { runDemoCommand, DEMO_SUGGESTIONS, DEMO_UNKNOWN_REPLY, type DemoExchange } from './landingDemo';
import { LandingVoiceControl } from './LandingVoiceControl';
import type { Dispatch, SetStateAction } from 'react';

export type DemoLine = {
  who: 'you' | 'watchora';
  text: string;
  note?: string;
  intent?: string;
  requiresConfirmation?: boolean;
};

// Watchora landing page — the logged-out front door.
//
// Designed for the audience the product serves: a visitor who may be blind,
// on a screen reader, on a keyboard, or all three. The page therefore DOES
// the thing instead of showing pictures of the thing — the demo section runs
// the app's real command router (src/landingDemo.ts) and answers with the
// app's real spoken strings, quoted where one exists and honestly described
// where quoting would be fabrication. Nothing speaks on its own: every sound
// on this page is behind a button the visitor pressed.

type LandingProps = {
  onSignIn: () => void;
  onSignUp: () => void;
};

/** Move focus as well as scroll position, so keyboard and screen-reader
 * context follows the jump (a bare scrollIntoView leaves the reading cursor
 * exactly where it was). Targets carry tabIndex={-1} and a styles.css ring. */
function goto(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth' });
  el.focus({ preventScroll: true });
}

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced motion and missing IntersectionObserver both mean: never hide
    // content behind an animation that may never run.
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('active');
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.classList.add('active');
            observer.unobserve(el);
          }
        });
      },
      { rootMargin: '0px 0px -40px 0px', threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="wispr-reveal" style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// Waveform visualizer — vertical bars of varying height in a pill. Color is
// inherited (bg-current) so it works on cream, ink, or inside a chat bubble.
function Waveform() {
  const heights = [10, 18, 26, 34, 22, 30, 14, 24, 16];
  return (
    <span className="inline-flex items-end gap-[3px] rounded-full px-1 py-1" aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-current" style={{ height: `${h}px` }} />
      ))}
    </span>
  );
}

// Hand-drawn lavender underline accent for key headline words.
function Squiggle() {
  return (
    <svg className="h-[18px] w-[240px]" width="240" height="18" viewBox="0 0 240 18" fill="none" aria-hidden="true">
      <path
        d="M4 12 C 30 4, 55 16, 82 10 S 132 4, 158 10 S 208 16, 236 8"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Speak one block of text on explicit user action only. Returns false when
 * this browser has no speechSynthesis (the buttons are hidden then, so this
 * is a backstop, not a silent failure). */
function speakAloud(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
  return true;
}

type Feature = {
  tag: string;
  problem: string;
  title: string;
  body: string;
  icon: typeof ScanEye;
  /** An example of the app's spoken output, labelled as an example. */
  example?: string;
};

// Every card leads with the problem a blind person actually hits, because
// that is the decision a visitor is making: does this app know my problem?
const FEATURES: Feature[] = [
  {
    tag: 'Four modes',
    problem: 'Other apps bury their answers in pictures and menus you cannot see.',
    title: 'Camera-to-voice AI',
    body: 'Point the camera, get a spoken answer — summary first, then detail, warnings, and how confident the model is. Never a wall of text.',
    icon: ScanEye,
    example: 'Stop. There is a chair ahead on your left.',
  },
  {
    tag: 'On-device',
    problem: 'Cloud vision takes seconds you do not have when the hazard is one step away.',
    title: 'Local hazard layer',
    body: 'Object detection runs on your phone the moment the camera is on — sub-second, offline, private. Frames never leave the device.',
    icon: ShieldCheck,
    example: 'A chair is near you on the left.',
  },
  {
    tag: 'Offline-first',
    problem: 'Print is everywhere — signs, labels, medicine boxes — and screen readers cannot touch it.',
    title: 'Read text, even offline',
    body: 'On-device OCR reads text in seconds with zero network. When confidence is low it falls back to the cloud read instead of guessing.',
    icon: BookOpen,
    example: 'The sign says: waiting room, first floor.',
  },
  {
    tag: 'Trust',
    problem: 'In an emergency you cannot navigate three menus, and an app that lies about sending help is dangerous.',
    title: 'SOS that never lies',
    body: 'Emergency requests are a deterministic log, separate from AI analysis. Trusted contacts get real SMS and email alerts, and the app tells you exactly what was delivered.',
    icon: Siren,
    example: 'Emergency requested. Say confirm to share your location with trusted contacts, or cancel.',
  },
  {
    tag: 'Daily living',
    problem: 'Paying, matching clothes, checking food — daily tasks that still need a sighted person.',
    title: 'Money, colors, expiry dates',
    body: 'Say "what money is this", "what color is this", or "read the expiry". It never guesses between two similar banknotes and always says when lighting makes it unsure.',
    icon: Banknote,
    example: 'This looks like a two hundred rupee note. The lighting makes me unsure.',
  },
  {
    tag: 'With you',
    problem: 'Most assistive tech is a tool. Some moments need something closer to company.',
    title: 'A companion, not a command line',
    body: 'Say "I feel lost" or ask a plain question and Watchora responds with practical help. Feelings are processed on your device, and never interrupt a safety alert.',
    icon: MessageCircleHeart,
  },
];

const MODES = ['Navigation', 'Reading', 'Environment', 'Assistant'];

const PRINCIPLES = [
  {
    title: 'Uncertainty is never hidden',
    body: 'The model never claims a path is definitely safe, never tells you to cross a road from camera analysis alone, and never states an exact distance unless it is directly measurable. Low confidence means the warning says so — out loud.',
  },
  {
    title: 'Fail silent, not fail loud',
    body: 'When detection confidence drops, nothing fires rather than guessing. A wrong vibration at a curb is worse than no vibration at all.',
  },
  {
    title: 'Your data stays yours',
    body: 'Camera frames are processed in memory and discarded after each request. Your API key never leaves the server. Rate limits and size caps are enforced.',
  },
];

const CHECKLIST = [
  'Free account — real row in Postgres, no seeded demo data',
  'Installable PWA — add it to your home screen',
  'Trusted contacts, saved places, SOS history, community reports',
];

const RECOGNITION_CTOR =
  typeof window !== 'undefined' &&
  ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function DemoSection({ lines, setLines }: { lines: DemoLine[]; setLines: Dispatch<SetStateAction<DemoLine[]>> }) {
  const [value, setValue] = useState('');
  const [micNote, setMicNote] = useState<string | null>(null);
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const inputRef = useRef<HTMLInputElement | null>(null);

  function runCommand(transcript: string) {
    const trimmed = transcript.trim();
    if (!trimmed) return;
    const exchange: DemoExchange | null = runDemoCommand(trimmed);
    const reply = exchange ? exchange.reply : DEMO_UNKNOWN_REPLY;
    setLines((prev) => [
      ...prev,
      { who: 'you', text: trimmed },
      {
        who: 'watchora',
        text: reply.say,
        note: reply.note || undefined,
        intent: exchange ? exchange.intent : undefined,
        requiresConfirmation: exchange ? exchange.requiresConfirmation : undefined,
      },
    ]);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    runCommand(value);
    setValue('');
  }

  function startMic() {
    setMicNote(null);
    const ctor =
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!ctor) {
      // Honest fallback: no dead button, no pretending to listen.
      setMicNote('Voice input is not available in this browser — type your command instead.');
      return;
    }
    const recognition = new ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const said = event.results?.[0]?.[0]?.transcript;
      if (said) runCommand(said);
    };
    recognition.onerror = () => setMicNote('I could not hear a command just now — try typing it.');
    recognition.onend = () => undefined;
    try {
      recognition.start();
      setMicNote('Listening — say one command.');
    } catch {
      setMicNote('I could not start the microphone — try typing your command.');
    }
  }

  return (
    <section
      className="bg-background text-foreground"
      id="wispr-demo"
      tabIndex={-1}
      aria-labelledby="wispr-demo-heading"
    >
      <div className="mx-auto max-w-4xl px-6 py-24">
        <Reveal>
          <Badge tone="outline" className="border-foreground/60 bg-card">
            <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
            Live — runs in your browser, no account
          </Badge>
          <h2 id="wispr-demo-heading" className="m-0 mt-4 font-display text-4xl font-medium tracking-tight md:text-5xl">
            Try the command brain right now
          </h2>
          <p className="m-0 mt-3 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            This is the same command router the app uses, running right here on the page. Type or
            speak a command and hear what watchora would say. Safety commands stop at the
            confirmation gate — on purpose, exactly like the app.
          </p>
        </Reveal>

        <Reveal delay={100}>
          <div className="mt-8 rounded-2xl border-2 border-foreground/90 bg-card p-5 shadow-md md:p-6">
            <div className="flex flex-wrap gap-2" aria-label="Example commands">
              {DEMO_SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion.transcript}
                  variant="outline"
                  size="md"
                  onClick={() => runCommand(suggestion.transcript)}
                  aria-label={`Try the command: ${suggestion.transcript}`}
                >
                  {suggestion.label}
                </Button>
              ))}
            </div>

            <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onSubmit}>
              <div className="flex-1">
                <Field label="Try a command" htmlFor="wispr-demo-input">
                  <Input
                    id="wispr-demo-input"
                    ref={inputRef}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder="e.g. what time is it"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="md">
                  Send
                </Button>
                {RECOGNITION_CTOR ? (
                  <Button type="button" variant="outline" size="md" onClick={startMic} aria-label="Speak a command">
                    <Mic size={18} aria-hidden="true" />
                    Speak
                  </Button>
                ) : null}
              </div>
            </form>
            {micNote ? (
              <p className="m-0 mt-3 text-sm font-medium text-muted-foreground" role="status">
                {micNote}
              </p>
            ) : null}

            <div
              className="mt-6 flex flex-col gap-3"
              role="log"
              aria-label="Demo conversation"
              aria-live="polite"
            >
              {lines.length === 0 ? (
                <p className="m-0 text-base text-muted-foreground">
                  The conversation will appear here. New replies are announced automatically to
                  screen readers.
                </p>
              ) : (
                lines.map((line, i) =>
                  line.who === 'you' ? (
                    <p key={i} className="m-0 ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-base font-medium text-primary-foreground">
                      {line.text}
                    </p>
                  ) : (
                    <div key={i} className="mr-auto max-w-[90%] rounded-2xl rounded-bl-sm bg-secondary px-4 py-3 text-secondary-foreground">
                      <p className="m-0 text-base">{line.text}</p>
                      {line.intent ? (
                        <p className="m-0 mt-1.5 text-sm">
                          Understood as: {line.intent.replace(/_/g, ' ')}
                          {line.requiresConfirmation ? ' — needs your confirmation' : ''}
                        </p>
                      ) : null}
                      {line.note ? <p className="m-0 mt-1.5 text-sm opacity-80">{line.note}</p> : null}
                      {canSpeak ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          className="mt-3"
                          onClick={() => speakAloud(line.text)}
                          aria-label="Hear this response aloud"
                        >
                          <Volume2 size={16} aria-hidden="true" />
                          Hear it
                        </Button>
                      ) : null}
                    </div>
                  ),
                )
              )}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function LandingPage({ onSignIn, onSignUp }: LandingProps) {
  const [demoLines, setDemoLines] = useState<DemoLine[]>([]);
  return (
    <main className="bg-background font-sans text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-lg focus:border-2 focus:border-foreground/90 focus:bg-primary focus:px-4 focus:text-base focus:font-semibold focus:text-primary-foreground"
        href="#wispr-demo"
        onClick={(e) => {
          // A bare hash-link scrolls but does not reliably move keyboard/
          // screen-reader focus in every browser; goto() moves both.
          e.preventDefault();
          goto('wispr-demo');
        }}
      >
        Skip to the live demo
      </a>

      {/* Floating nav pill */}
      <nav className="sticky top-4 z-40 mx-auto mt-6 w-fit max-w-[calc(100%-2rem)]" aria-label="Primary">
        <div className="flex items-center gap-1 rounded-full border-2 border-foreground/90 bg-card py-1.5 pe-1.5 ps-4 shadow-sm">
          <a className="flex items-center gap-2 pe-2 font-display text-lg font-semibold tracking-tight text-foreground no-underline" href="#wispr-top">
            <Waveform />
            <span>watchora</span>
          </a>
          <a
            className="inline-flex max-lg:hidden rounded-full px-3 py-2 text-sm font-semibold no-underline hover:bg-muted text-foreground"
            href="#wispr-demo"
            onClick={(e) => {
              e.preventDefault();
              goto('wispr-demo');
            }}
          >
            Try it
          </a>
          <a
            className="inline-flex max-lg:hidden rounded-full px-3 py-2 text-sm font-semibold no-underline hover:bg-muted text-foreground"
            href="#wispr-features"
            onClick={(e) => {
              e.preventDefault();
              goto('wispr-features');
            }}
          >
            What it does
          </a>
          <a
            className="inline-flex max-lg:hidden rounded-full px-3 py-2 text-sm font-semibold no-underline hover:bg-muted text-foreground"
            href="#wispr-safety"
            onClick={(e) => {
              e.preventDefault();
              goto('wispr-safety');
            }}
          >
            How it stays safe
          </a>
          <span className="mx-1 hidden h-6 w-px bg-foreground/20 md:block" aria-hidden="true" />
          {/* On the narrowest phones the pill's own max-width forces an
              overflow; Sign in stays reachable through the hero and the final
              CTA card, so the nav drops it below sm instead of overflowing. */}
          <Button variant="ghost" className="max-sm:hidden px-3 sm:px-4" onClick={onSignIn}>
            Sign in
          </Button>
          <Button variant="primary" className="px-3 sm:px-4" onClick={onSignUp}>
            Create account
          </Button>
        </div>
      </nav>

      {/* ── Cream chamber: hero ─────────────────────────────── */}
      <header
        id="wispr-top"
        className="relative flex min-h-[88vh] flex-col items-center justify-center overflow-hidden bg-background px-6 py-24 text-center text-foreground md:py-32 bg-[radial-gradient(55%_45%_at_50%_-5%,color-mix(in_srgb,var(--secondary)_45%,transparent),transparent),radial-gradient(40%_35%_at_85%_115%,color-mix(in_srgb,var(--primary)_14%,transparent),transparent)]"
      >
        {/* Oversized outlined display word — decorative editorial backdrop */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none whitespace-nowrap text-center font-display text-[20vw] leading-none tracking-tight text-transparent opacity-[0.07] [-webkit-text-stroke:2px_var(--foreground)] md:text-[13rem]"
        >
          VOICE FIRST
        </span>

        <div className="relative flex max-w-3xl flex-col items-center">
          <Reveal>
            <Badge tone="outline" className="border-foreground/60 bg-card">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              Camera-to-voice · Real accounts, not demos
            </Badge>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="m-0 mt-6 font-display text-5xl font-medium leading-[1.05] tracking-tight md:text-6xl">
              Point the camera.
              <br />
              <span className="text-muted-foreground">Hear what's there.</span>
              <span className="mt-2 block text-secondary">
                <Squiggle />
              </span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="m-0 mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
              Watchora turns a phone camera into a spoken second pair of eyes —
              navigation, reading, and environment description, with trusted contacts,
              SOS, and community hazard reports. Built voice-first, so it works with
              your screen reader, not around it.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="xl" onClick={() => goto('wispr-demo')}>
                <Mic size={18} aria-hidden="true" />
                <span>Try it right now — no account</span>
              </Button>
              <Button size="xl" variant="outline" onClick={onSignUp}>
                <span>Create your account</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Button>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <div className="mt-8 flex items-center gap-3 text-sm font-medium text-muted-foreground">
              <span className="text-primary">
                <Waveform />
              </span>
              <span>Spoken feedback · haptic alerts · offline-capable</span>
            </div>
          </Reveal>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-muted-foreground" aria-hidden="true">
          <ChevronDown size={18} aria-hidden="true" />
        </div>
      </header>

      {/* ── Cream chamber: the live demo ────────────────────── */}
      {/* The skip link lands here: for a blind visitor this section IS the
          product pitch. #wispr-demo has a visible focus ring in styles.css. */}
      <DemoSection lines={demoLines} setLines={setDemoLines} />

      {/* ── Ink chamber: features ───────────────────────────── */}
      <section
        className="bg-[radial-gradient(50%_40%_at_50%_0%,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent)] bg-foreground text-background"
        id="wispr-features"
        tabIndex={-1}
        aria-labelledby="wispr-features-heading"
      >
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Reveal>
                <h2 id="wispr-features-heading" className="m-0 font-display text-4xl font-medium tracking-tight md:text-5xl">
                  What watchora does
                </h2>
              </Reveal>
              <Reveal delay={80}>
                <p className="m-0 mt-3 max-w-xl text-lg leading-relaxed text-background/70">
                  Every card starts with the problem, because that is the decision you are
                  making. The examples are what the app actually says.
                </p>
              </Reveal>
            </div>
            <Reveal delay={140}>
              <div className="flex flex-wrap gap-2">
                {MODES.map((mode) => (
                  <span key={mode} className="rounded-full border-2 border-background/50 px-3 py-1 text-sm font-semibold">
                    {mode}
                  </span>
                ))}
              </div>
            </Reveal>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 2) * 90}>
                <Card className="h-full">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-bold uppercase tracking-[0.18em] text-primary">{feature.tag}</span>
                      <feature.icon
                        size={22}
                        aria-hidden="true"
                        className={feature.title === 'SOS that never lies' ? 'text-accent' : 'text-primary'}
                      />
                    </div>
                    <CardTitle className="font-display text-2xl">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="m-0 text-base font-medium leading-relaxed">{feature.problem}</p>
                    <p className="m-0 mt-3 leading-relaxed text-muted-foreground">{feature.body}</p>
                    {feature.example ? (
                      <div className="mt-4 border-t-2 border-dashed border-foreground/20 pt-4">
                        <p className="m-0 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          Example of spoken output
                        </p>
                        <p className="m-0 mt-1 text-base italic leading-relaxed">“{feature.example}”</p>
                        {canSpeakGlobally() ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="md"
                            className="mt-3"
                            onClick={() => speakAloud(feature.example as string)}
                            aria-label={`Hear the example: ${feature.example}`}
                          >
                            <Volume2 size={16} aria-hidden="true" />
                            Hear it
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cream chamber: comparison ───────────────────────── */}
      <section className="bg-background text-foreground" aria-labelledby="wispr-speed-heading">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <h2 id="wispr-speed-heading" className="m-0 font-display text-4xl font-medium tracking-tight md:text-5xl">
                  Why the local layer matters
                </h2>
                <p className="m-0 mt-3 max-w-xl text-lg leading-relaxed text-muted-foreground">
                  A blind pedestrian can't wait 15 seconds for an answer. Watchora doesn't make them.
                </p>
              </div>
              <Badge tone="success">On-device · Offline-capable</Badge>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <Reveal>
              <Card className="h-full bg-foreground text-background">
                <CardHeader>
                  <p className="m-0 text-sm font-bold uppercase tracking-[0.18em] text-background/60">Cloud round-trip</p>
                  <p className="m-0 font-display text-6xl font-medium leading-none">~15s</p>
                </CardHeader>
                <CardContent>
                  <p className="m-0 leading-relaxed text-background/70">
                    Worst case for a single photo sent to a cloud model on a slow connection —
                    the old way of doing this.
                  </p>
                </CardContent>
              </Card>
            </Reveal>
            <Reveal delay={100}>
              <Card className="h-full">
                <CardHeader>
                  <p className="m-0 text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">Local hazard layer</p>
                  <p className="m-0 font-display text-6xl font-medium leading-none text-primary">≈1s</p>
                </CardHeader>
                <CardContent>
                  <p className="m-0 leading-relaxed text-muted-foreground">
                    YOLO detection on your device, haptic alert immediately, no network required.
                  </p>
                </CardContent>
              </Card>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Ink chamber: safety ─────────────────────────────── */}
      <section
        className="bg-[radial-gradient(50%_40%_at_50%_0%,color-mix(in_srgb,var(--secondary)_10%,transparent),transparent)] bg-foreground text-background"
        id="wispr-safety"
        tabIndex={-1}
        aria-labelledby="wispr-safety-heading"
      >
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <h2 id="wispr-safety-heading" className="m-0 font-display text-4xl font-medium tracking-tight md:text-5xl">
                  How watchora stays safe
                </h2>
                <p className="m-0 mt-3 max-w-xl text-lg leading-relaxed text-background/70">
                  Built for people who can't afford confident guesses.
                </p>
              </div>
              <Badge tone="outline" className="border-secondary bg-secondary text-secondary-foreground">
                Safety by design
              </Badge>
            </div>
          </Reveal>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PRINCIPLES.map((principle, i) => (
              <Reveal key={principle.title} delay={i * 90}>
                <Card className="h-full border-background/40 bg-transparent text-background shadow-none">
                  <CardHeader>
                    <span className="font-display text-4xl font-medium text-secondary">{String(i + 1).padStart(2, '0')}</span>
                    <CardTitle className="font-display text-2xl">{principle.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="m-0 leading-relaxed text-background/70">{principle.body}</p>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cream chamber: final CTA ────────────────────────── */}
      <section id="wispr-account" className="bg-background text-foreground" aria-labelledby="wispr-cta-heading">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <Card className="grid gap-10 border-2 p-8 md:grid-cols-[1.2fr_1fr] md:p-12">
            <Reveal>
              <div>
                <h2 id="wispr-cta-heading" className="m-0 font-display text-4xl font-medium leading-tight tracking-tight md:text-5xl">
                  Ready to <span className="text-muted-foreground">hear it</span> yourself?
                </h2>
                <ul className="m-0 mt-6 list-none p-0">
                  {CHECKLIST.map((item) => (
                    <li key={item} className="flex items-center gap-3 py-1.5 text-base leading-relaxed">
                      <Check size={16} strokeWidth={3} aria-hidden="true" className="shrink-0 text-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal delay={120}>
              <div className="flex h-full flex-col gap-3 rounded-xl border-2 border-foreground/90 bg-card p-6 text-card-foreground shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="block text-sm font-bold uppercase tracking-[0.18em] text-muted-foreground">Account</span>
                    <strong className="font-display text-4xl font-medium">Free</strong>
                  </div>
                  <Badge tone="success">No seed data</Badge>
                </div>
                <Button size="xl" className="w-full whitespace-normal" onClick={onSignUp}>
                  <span>Create your account</span>
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
                <Button size="xl" variant="outline" className="w-full whitespace-normal" onClick={onSignIn}>
                  Already have an account? Sign in
                </Button>
                <Alert tone="info" className="mt-1">
                  <AlertDescription>
                    <p className="m-0 text-sm">Camera and microphone work best over HTTPS — this site is served that way.</p>
                  </AlertDescription>
                </Alert>
              </div>
            </Reveal>
          </Card>
        </div>
      </section>

      {/* ── Voice control (tap-to-talk orb) ─────────────────── */}
      {/* Voice-run demo exchanges land in the SAME conversation log the demo
          section renders, so what the visitor said and heard stays visible. */}
      <LandingVoiceControl
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onNavigate={goto}
        onDemoExchange={(exchange) =>
          setDemoLines((prev) => [
            ...prev,
            { who: 'you', text: exchange.transcript },
            {
              who: 'watchora',
              text: exchange.reply.say,
              note: exchange.reply.note || undefined,
              intent: exchange.intent,
              requiresConfirmation: exchange.requiresConfirmation,
            },
          ])
        }
      />

      {/* ── Ink footer band ─────────────────────────────────── */}
      <footer className="bg-foreground text-background">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
              <Waveform />
              <span>watchora</span>
            </div>
            <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer">
              <a href="#wispr-demo" className="text-background/80 no-underline hover:text-background hover:underline" onClick={(e) => { e.preventDefault(); goto('wispr-demo'); }}>
                Live demo
              </a>
              <a href="#wispr-features" className="text-background/80 no-underline hover:text-background hover:underline" onClick={(e) => { e.preventDefault(); goto('wispr-features'); }}>
                What it does
              </a>
              <a href="#wispr-safety" className="text-background/80 no-underline hover:text-background hover:underline" onClick={(e) => { e.preventDefault(); goto('wispr-safety'); }}>
                Safety
              </a>
              <a href="/install-guide.html" className="text-background/80 no-underline hover:text-background hover:underline">
                Install guide
              </a>
              <a href="/commitment.html" className="text-background/80 no-underline hover:text-background hover:underline">
                Our commitment
              </a>
              <Button
                variant="ghost"
                className="border-transparent bg-transparent text-background hover:bg-background/10"
                onClick={onSignIn}
              >
                Sign in
              </Button>
            </nav>
          </div>
          <div className="mt-10 flex flex-col justify-between gap-2 border-t-2 border-background/20 pt-6 text-sm text-background/70 md:flex-row">
            <span>© 2026 watchora · Built for people who can't wait to see.</span>
            <span>Camera-to-voice assistance</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

/** Module-level speech availability for the feature cards (they render outside
 * DemoSection's stateful tree; same check, evaluated lazily per render). */
function canSpeakGlobally(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
