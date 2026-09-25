import {
  ArrowRight,
  Banknote,
  BookOpen,
  Check,
  ChevronDown,
  MessageCircleHeart,
  ScanEye,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle } from './components/ui';

// Watchora landing page — the logged-out front door, set in the Watchora token
// system (src/theme.css + the kit in src/components/ui): cream broadsheet
// (#ffffeb), ink chambers (#1a1a1a), EB Garamond at display scale, lavender
// (#f0d7ff) and forest (#034f46) accents, 2px ink borders, oversized radii.
//
// Sections alternate cream → ink → cream → ink like rooms in a building. The
// waveform visualizer is the signature "mic is listening" motif — for a
// camera-to-voice app it doubles as honest product communication.

type LandingProps = {
  onSignIn: () => void;
  onSignUp: () => void;
};

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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

const MODES = ['Navigation', 'Reading', 'Environment', 'Assistant'];

const FEATURES = [
  {
    title: 'Camera-to-voice AI',
    body: 'Real Gemini vision calls, server-side, spoken aloud. Summary, details, warnings, and confidence — never a wall of text.',
    tag: 'Four modes',
    icon: ScanEye,
  },
  {
    title: 'Local hazard layer',
    body: 'YOLO object detection runs on your device the moment the camera is on. Sub-second, offline, private — and it never leaves your phone.',
    tag: 'On-device',
    icon: ShieldCheck,
  },
  {
    title: 'Read text, even offline',
    body: 'Local OCR reads signs, labels, and documents in seconds with zero network. Low confidence falls back to the cloud read instead of guessing.',
    tag: 'Offline-first',
    icon: BookOpen,
  },
  {
    title: 'SOS that never lies',
    body: 'Emergency requests are a deterministic log, separate from AI scene analysis. Trusted contacts get real SMS and email alerts, and the app tells you exactly what was delivered.',
    tag: 'Trust',
    icon: Siren,
  },
  {
    title: 'Money, colors, expiry dates',
    body: 'Say "what money is this", "what color is this", or "read the expiry" — daily tasks done by voice. It never guesses between two similar banknotes and always says when lighting makes it unsure.',
    tag: 'Daily living',
    icon: Banknote,
  },
  {
    title: 'A companion, not a command line',
    body: 'Say "I\'m scared" or "I feel lost" and Watchora responds with practical help, right on your device — never sent anywhere, never interrupting a safety alert.',
    tag: 'With you',
    icon: MessageCircleHeart,
  },
];

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
    body: 'Camera frames are processed in memory and discarded after each request. Your Gemini key never leaves the server. Rate limits and size caps are enforced.',
  },
];

const CHECKLIST = [
  'Free account — real row in Postgres, no seeded demo data',
  'Installable PWA — add it to your home screen',
  'Trusted contacts, saved places, SOS history, community reports',
];

export function LandingPage({ onSignIn, onSignUp }: LandingProps) {
  return (
    <main className="bg-background font-sans text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-lg focus:border-2 focus:border-foreground/90 focus:bg-primary focus:px-4 focus:text-base focus:font-semibold focus:text-primary-foreground"
        href="#wispr-features"
        onClick={(e) => {
          // Same real fix as the dashboard skip link (App.tsx): a bare
          // hash-link scrolls but does not reliably move keyboard/screen-
          // reader focus in every browser, so the skip link does not
          // actually let a screen-reader user skip the nav/hero content.
          e.preventDefault();
          document.getElementById('wispr-features')?.focus();
        }}
      >
        Skip to what watchora does
      </a>

      {/* Floating nav pill */}
      <nav className="sticky top-4 z-40 mx-auto mt-6 w-fit max-w-[calc(100%-2rem)]" aria-label="Primary">
        <div className="flex items-center gap-1 rounded-full border-2 border-foreground/90 bg-card py-1.5 pe-1.5 ps-4 shadow-sm">
          <a className="flex items-center gap-2 pe-2 font-display text-lg font-semibold tracking-tight" href="#wispr-top">
            <Waveform />
            <span>watchora</span>
          </a>
          <a
            className="hidden rounded-full px-3 py-2 text-sm font-semibold no-underline hover:bg-muted md:inline-flex"
            href="#wispr-features"
          >
            What it does
          </a>
          <a
            className="hidden rounded-full px-3 py-2 text-sm font-semibold no-underline hover:bg-muted md:inline-flex"
            href="#wispr-safety"
          >
            How it stays safe
          </a>
          <span className="mx-1 hidden h-6 w-px bg-foreground/20 md:block" aria-hidden="true" />
          <Button variant="ghost" onClick={onSignIn}>
            Sign in
          </Button>
          <Button variant="primary" onClick={onSignUp}>
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
              SOS, and community hazard reports.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="xl" onClick={onSignUp}>
                <span>Create your account</span>
                <ArrowRight size={18} aria-hidden="true" />
              </Button>
              <Button size="xl" variant="outline" onClick={() => document.querySelector('#wispr-features')?.scrollIntoView({ behavior: 'smooth' })}>
                See what it does
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

      {/* ── Ink chamber: features ───────────────────────────── */}
      <section
        className="bg-[radial-gradient(50%_40%_at_50%_0%,color-mix(in_srgb,var(--secondary)_12%,transparent),transparent)] bg-foreground text-background focus:outline-none"
        id="wispr-features"
        tabIndex={-1}
      >
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <Reveal>
                <h2 className="m-0 font-display text-4xl font-medium tracking-tight md:text-5xl">What watchora does</h2>
              </Reveal>
              <Reveal delay={80}>
                <p className="m-0 mt-3 max-w-xl text-lg leading-relaxed text-background/70">
                  Real capabilities, verified live — from hazard warnings to reading a banknote.
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
                      <span className="text-xs font-bold uppercase tracking-[0.18em] text-primary">{feature.tag}</span>
                      <feature.icon
                        size={22}
                        aria-hidden="true"
                        className={feature.title === 'SOS that never lies' ? 'text-accent' : 'text-primary'}
                      />
                    </div>
                    <CardTitle className="font-display text-2xl">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="m-0 leading-relaxed text-muted-foreground">{feature.body}</p>
                  </CardContent>
                </Card>
              </Reveal>
            ))}
          </div>

          {/* Phone mockup — cream device with ink border, chat bubbles verbatim */}
          <Reveal delay={120}>
            <div
              className="mx-auto mt-16 w-full max-w-sm rounded-[2rem] border-2 border-foreground/90 bg-background p-3 text-foreground shadow-xl"
              aria-hidden="true"
            >
              <div className="rounded-[1.6rem] border-2 border-foreground/15 bg-card p-4">
                <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-foreground/30" />
                <div className="flex flex-col gap-3">
                  <div className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
                    <span>Describe what's in front of me.</span>
                  </div>
                  <div className="flex max-w-[85%] flex-col gap-2 self-start rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
                    <span>Stop. There is a chair ahead on your left.</span>
                    <Waveform />
                  </div>
                  <div className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
                    <span>And the sign?</span>
                  </div>
                  <div className="max-w-[85%] self-start rounded-2xl rounded-bl-sm bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
                    <span>Reception Desk. Stairs to your right.</span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Cream chamber: comparison ───────────────────────── */}
      <section className="bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <h2 className="m-0 font-display text-4xl font-medium tracking-tight md:text-5xl">
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
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.18em] text-background/60">Cloud round-trip</p>
                  <p className="m-0 font-display text-6xl font-medium leading-none">15s</p>
                </CardHeader>
                <CardContent>
                  <p className="m-0 leading-relaxed text-background/70">
                    Worst-case latency for a single photo sent to the model — the old way of doing this.
                  </p>
                </CardContent>
              </Card>
            </Reveal>
            <Reveal delay={100}>
              <Card className="h-full">
                <CardHeader>
                  <p className="m-0 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Local hazard layer</p>
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
      >
        <div className="mx-auto max-w-6xl px-6 py-24">
          <Reveal>
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
              <div>
                <h2 className="m-0 font-display text-4xl font-medium tracking-tight md:text-5xl">
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
      <section className="bg-background text-foreground">
        <div className="mx-auto max-w-5xl px-6 py-24">
          <Card className="grid gap-10 border-2 p-8 md:grid-cols-[1.2fr_1fr] md:p-12">
            <Reveal>
              <div>
                <h2 className="m-0 font-display text-4xl font-medium leading-tight tracking-tight md:text-5xl">
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
                    <span className="block text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Account</span>
                    <strong className="font-display text-4xl font-medium">Free</strong>
                  </div>
                  <Badge tone="success">No seed data</Badge>
                </div>
                <Button size="xl" className="w-full" onClick={onSignUp}>
                  <span>Create your account</span>
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
                <Button size="xl" variant="outline" className="w-full" onClick={onSignIn}>
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

      {/* ── Ink footer band ─────────────────────────────────── */}
      <footer className="bg-foreground text-background">
        <div className="mx-auto max-w-6xl px-6 py-14">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
              <Waveform />
              <span>watchora</span>
            </div>
            <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label="Footer">
              <a href="#wispr-features" className="text-background/80 no-underline hover:text-background hover:underline">
                What it does
              </a>
              <a href="#wispr-safety" className="text-background/80 no-underline hover:text-background hover:underline">
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
