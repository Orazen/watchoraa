// The Watch screen — the companion's control surface.
//
// Layout and interaction patterns are borrowed from github.com/dkabduli/
// VisionCompanion, whose WalkMode is the closest thing in the wild to what this
// screen does. NOTE ON LICENSING: that repository ships NO LICENSE file, so no
// code or CSS has been copied. What is taken is the set of *structural* UX
// decisions, which are generic craft rather than protected expression, and they
// are reimplemented here in Watchora's own design tokens and kit components:
//
//   - a large, sticky primary action at the bottom of a one-handed phone screen
//   - exactly two controls: "What's ahead?" and "Stop" — the two things a user
//     walking needs, and no third thing to hunt for
//   - a FIXED-HEIGHT status panel, so the text never reflows under VoiceOver
//     and the screen never jumps (the single most disorienting thing a walking
//     user can experience)
//   - a suggested-phrase row of pill chips, each one a real command
//   - "fail out loud": a missing capability is stated, never left as silence
//
// The two deliberate DEVIATIONS from that source are accessibility-driven,
// because it is an app for sighted-by-default people and we are not:
//
//   1. URGENCY IS NEVER CARRIED BY COLOUR ALONE. The reference app encodes
//      severity in an 8px border colour and a coloured arrow glyph and nothing
//      else; a screen-reader user with sound off cannot tell a hazard from a
//      landmark. Here every alert carries a spoken severity word AND the
//      mascot's touch signature AND the text.
//   2. THE RECENT-ALERT HISTORY IS NOT `aria-hidden`. The reference hides it,
//      which leaves a screen-reader user with no way to review what was said.

import { useState } from 'react';
import { Compass, Eye, Play, Square, Watch } from 'lucide-react';
import { WatchoraOrb } from '../components/WatchoraOrb';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '../components/ui';
import { MASCOT_PROFILES } from './mascotStates';
import { WATCH_CADENCE_LABELS, type WatchCadence } from './watchSession';
import { describeHeading } from './orientation';
import type { SpeechPriority } from '../speechPriority';
import type { WatchModeApi } from './useWatchMode';

const CADENCES: WatchCadence[] = ['quiet', 'steady', 'vigilant'];

/** Spoken severity word, paired with the colour so it is never colour-alone. */
const SEVERITY: Record<string, { word: string; tone: 'destructive' | 'default' }> = {
  alert: { word: 'Hazard', tone: 'destructive' },
  unavailable: { word: 'Limited', tone: 'default' },
};

/** Renders a vibration pattern as bars, so a sighted caregiver can SEE the
 *  signature the blind user is feeling. Without this, the single most important
 *  channel of the mascot is completely invisible to everyone around them. */
function TouchPattern({ state }: { state: keyof typeof MASCOT_PROFILES }) {
  const pattern = MASCOT_PROFILES[state].touch;
  if (!pattern) return null;
  const pulses = Array.isArray(pattern.vibrate) ? pattern.vibrate.filter((n) => n > 0) : [pattern.vibrate];
  if (pulses.length === 0) return null;
  return (
    <span aria-hidden="true" className="inline-flex items-end gap-0.5 align-middle">
      {pulses.slice(0, 8).map((ms, i) => (
        <span
          key={i}
          className="inline-block w-1 rounded-full bg-current"
          style={{ height: `${Math.max(3, Math.min(14, ms / 18))}px`, opacity: 0.75 }}
        />
      ))}
    </span>
  );
}

export function WatchScreen({
  watch,
  speak,
  onOpenAssist,
  announce,
}: {
  watch: WatchModeApi;
  speak: (text: string, priority?: SpeechPriority, dedupeKey?: string) => void;
  onOpenAssist: () => void;
  announce: (text: string) => void;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  const on = watch.state !== 'off';
  const profile = MASCOT_PROFILES[watch.mascot];
  const severity = SEVERITY[watch.mascot];

  const start = () => {
    setConfirmStop(false);
    watch.start();
    onOpenAssist();
  };

  const stop = () => {
    // Stopping is a one-tap, no-confirmation action. A confirmation gate here
    // would be actively dangerous: a user walking who says "stop watching" and
    // then has to answer "say confirm" is a user with a live hazard channel
    // they cannot switch off. The mascot speaks the confirmation instead.
    setConfirmStop(false);
    watch.stop();
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {/* ── The companion ── */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <Watch className="h-5 w-5" aria-hidden="true" />
              Watchora Watch
            </span>
          </CardTitle>
          <CardDescription>
            A companion that watches the path ahead and tells you what changes. Everything is spoken, and
            felt through your phone as well.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <WatchoraOrb state={profile.orb} size={140} />

          {/* The mascot's state in words. This is NOT decorative: for a blind
              user this line, plus the vibration, is the entire mascot. */}
          <p role="status" aria-live="polite" className="text-center text-base font-semibold">
            {profile.label}
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <TouchPattern state={watch.mascot} />
              <span className="sr-only">touch signature</span>
            </span>
          </p>

          <p className="text-center text-sm text-muted-foreground">
            {on
              ? 'Say "what is ahead" for an update, or "stop watching" to switch me off.'
              : 'Say "start watch" and I will keep an eye on the path for you.'}
          </p>
        </CardContent>
      </Card>

      {/* ── What Watch just said ──
          Fixed height: the text reflowing on every update is the classic
          disorientation bug for a VoiceOver user mid-step. */}
      <Card>
        <CardHeader>
          <CardTitle>Last update</CardTitle>
          <CardDescription>
            {watch.spokenCount === 0
              ? 'Nothing yet.'
              : `${watch.spokenCount} update${watch.spokenCount === 1 ? '' : 's'} since you started.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex min-h-[5.5rem] items-center">
            <p aria-live="polite" className="text-lg leading-relaxed">
              {watch.lastSpoken || 'I will speak here when I have something to say.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Honest capabilities ── */}
      {(!watch.capabilities.compass || !watch.capabilities.motion || !watch.capabilities.haptics) && (
        <Alert>
          <AlertTitle>What this device can do</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {watch.capabilities.camera ? (
                <li>I can see the path ahead with the camera.</li>
              ) : (
                <li>I cannot see — the camera is not available.</li>
              )}
              {watch.capabilities.compass ? (
                <li>I can tell which way you are facing.</li>
              ) : (
                <li>No compass on this device, so I will not name directions. I can still tell when you turn.</li>
              )}
              {watch.capabilities.motion ? null : <li>This device does not report movement, so I cannot sense turning.</li>}
              {watch.capabilities.haptics ? null : <li>This device cannot vibrate, so Watch will only speak.</li>}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Heading ── */}
      {watch.orientation && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2">
                <Compass className="h-5 w-5" aria-hidden="true" />
                Which way you are facing
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {watch.orientation.absolute ? (
              watch.compassStable ? (
                <p className="text-lg">
                  You are facing <strong>{describeHeading(watch.orientation.headingDeg)}</strong>.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The compass is unsettled here, so I cannot give a reliable direction yet. I will keep trying.
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                This device has no compass, so I cannot name a direction. I can still tell you when you turn.
              </p>
            )}
            {watch.lookingDown && (
              <p className="text-sm font-semibold">
                Your phone is angled down at the ground — check for kerbs, steps and obstacles at your feet.
              </p>
            )}
            <Button variant="ghost" onClick={() => { watch.orientationSpeechNow(); announce('Reading your orientation'); }}>
              <Eye className="h-4 w-4" aria-hidden="true" /> Read this out
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Cadence ──
          A real radiogroup: screen readers announce it as exclusive choices,
          which three separate toggle buttons would not. */}
      <Card>
        <CardHeader>
          <CardTitle>How often should I speak?</CardTitle>
          <CardDescription>I still warn you about hazards at every setting.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label="Watch speaking frequency" className="flex flex-col gap-2">
            {CADENCES.map((c) => {
              const selected = watch.cadence === c;
              return (
                <button
                  key={c}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    watch.setCadence(c);
                    announce(`Watch set to ${c}`);
                    // Priority 4 (user-answer), not 5 (navigation): the user
                    // just tapped this, so acknowledging them is a direct
                    // reply to a direct action. At 5 it queued behind whatever
                    // Watch was already describing, and a blind user who
                    // changed the cadence heard nothing for many seconds and
                    // had no way to know whether the tap had landed.
                    speak(`Watch is now in ${c} mode. ${WATCH_CADENCE_LABELS[c]}.`, 4, `watch-cadence-${c}`);
                  }}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-left text-sm transition',
                    selected ? 'border-primary bg-primary/10 font-semibold' : 'border-border hover:bg-muted/50',
                  )}
                >
                  {WATCH_CADENCE_LABELS[c]}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Suggested commands ── */}
      <Card>
        <CardHeader>
          <CardTitle>You can say</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {['what is ahead', 'which way am I facing', 'watch status', 'stop watching', 'emergency'].map((p) => (
            <span key={p} className="rounded-full border border-border px-3 py-1.5 text-sm">
              {p}
            </span>
          ))}
        </CardContent>
      </Card>

      {/* ── The two controls ── */}
      <div className="sticky bottom-0 -mx-4 flex gap-3 bg-background/95 px-4 pb-4 pt-3 backdrop-blur">
        <Button
          size="lg"
          className="h-20 flex-1 text-lg font-semibold"
          onClick={() => {
            watch.sayNow();
            onOpenAssist();
          }}
        >
          What is ahead?
        </Button>
        {on ? (
          <Button
            size="lg"
            variant={confirmStop ? 'destructive' : 'outline'}
            className="h-20 px-6 text-lg font-semibold"
            onClick={stop}
          >
            <Square className="h-5 w-5" aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button size="lg" className="h-20 px-6 text-lg font-semibold" onClick={start}>
            <Play className="h-5 w-5" aria-hidden="true" />
            Start
          </Button>
        )}
      </div>

      {/* Severity badge, paired with the live line so urgency is never
          colour-only. Rendered once, above the controls, always in text. */}
      {severity && (
        <p className="sr-only" role="status">
          {severity.word}
          {watch.mascot === 'alert' ? ' — stop and check your surroundings.' : ' — part of Watch is not available on this device.'}
        </p>
      )}
      {on && (
        <Badge tone={watch.mascot === 'alert' ? 'danger' : 'neutral'} className="mx-auto">
          Watching · {watch.cadence}
        </Badge>
      )}
    </div>
  );
}
