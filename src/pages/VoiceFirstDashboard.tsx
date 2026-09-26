// Voice-first dashboard (v0.6): calm instrument panel rebuilt on the Watchora
// UI kit (src/components/ui) + Tailwind token utilities from src/theme.css.
// A single max-w-3xl column arranged as the three bands DESIGN.md section 4
// specifies, in priority order: Status (one line, always visible), Command
// (the orb and the type-to-Jarvis bar — the two ways in), and Do (the primary
// actions, large and few). Everything below Do is supporting context, and
// navigation lives in the sidebar rather than here.
//
// The v0.5 "quick nav" outline row (Places / Contacts / Community / Settings)
// was removed: all four were `onOpenTab(...)` calls onto destinations that are
// already tabs in the sidebar, so they were four pure-duplicate tab stops.
//
// Props signature, state, effects, handlers, emergency wiring, and every
// spoken and announced string are unchanged. Nothing in this file adds,
// removes, or rewords a single utterance.

import { useEffect, useRef, useState, type ComponentType } from 'react';
import {
  BookOpen,
  CheckCircle2,
  MapPin,
  Mic,
  Shield,
  Siren,
} from 'lucide-react';
import { EmergencyControl, type EmergencyStatus } from '../components/EmergencyControl';
import { PermissionStatusCard } from '../permissions/PermissionStatusCard';
import { VoiceControlButton } from '../voice/VoiceControlButton';
import { TypeToJarvis } from '../voice/TypeToJarvis';
import { WatchoraOrb, type OrbState } from '../components/WatchoraOrb';
import { MapView } from '../MapView';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type BadgeProps,
} from '../components/ui';
import type { PermissionService } from '../permissions/permissionService';
import type { VoiceState } from '../voice/VoiceAssistantProvider';

export type DashboardTab = 'tracking' | 'journey' | 'sos' | 'routes' | 'community' | 'settings';

/** Maps the real voice-assistant state to the orb visual. Hazard speech
 *  overrides everything (red orb) via the `hazardActive` flag from App.
 *  Offline / permission-missing / unsupported are *availability* states, not
 *  failures — a red "Voice error" orb alarmed blind users on devices without
 *  SpeechRecognition, so they present as calm standing-by instead; the
 *  dedicated banners and the permission centre explain what to do. */
function orbStateFor(voice: VoiceState, hazardActive: boolean): OrbState {
  if (hazardActive) return 'hazard';
  switch (voice) {
    case 'listening': return 'listening';
    case 'processing': return 'processing';
    case 'speaking': return 'speaking';
    case 'error': return 'error';
    default: return 'idle';
  }
}

/** PrimaryActionCard's stateTone mapped onto kit Badge tones. */
const STATE_TONE_TO_BADGE: Record<'ok' | 'warn' | 'danger' | 'neutral', NonNullable<BadgeProps['tone']>> = {
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  neutral: 'neutral',
};

/** Dashboard primary action card: the legacy PrimaryActionCard rebuilt inline
 *  with kit Card + Button. The accessible name (aria-label), title,
 *  explanation, button label, voice hint, and live-region state line are
 *  byte-for-byte the originals — only the presentation changed. */
function DashboardActionCard({
  icon: Icon,
  title,
  explanation,
  buttonLabel,
  onActivate,
  voiceHint,
  state,
  stateTone = 'neutral',
  buttonVariant = 'primary',
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  explanation: string;
  buttonLabel: string;
  onActivate: () => void;
  voiceHint?: string;
  state?: string;
  stateTone?: 'ok' | 'warn' | 'danger' | 'neutral';
  buttonVariant?: 'primary' | 'destructive';
}) {
  return (
    <Card role="article" aria-label={title} className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border-2 border-foreground/90 bg-muted text-foreground"
            aria-hidden="true"
          >
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-2xl">{title}</CardTitle>
            <CardDescription className="mt-1 text-base leading-relaxed">{explanation}</CardDescription>
          </div>
        </div>
      </CardHeader>
      {state && (
        <CardContent className="p-0 px-5 pb-3">
          <p aria-live="polite">
            <Badge tone={STATE_TONE_TO_BADGE[stateTone]}>{state}</Badge>
          </p>
        </CardContent>
      )}
      <CardContent className="mt-auto flex flex-col gap-2 p-5 pt-0">
        <Button variant={buttonVariant} size="xl" className="w-full" onClick={onActivate}>
          {buttonLabel}
        </Button>
        {voiceHint && (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Mic className="size-4" aria-hidden="true" />
            Say: “{voiceHint}”
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Live Location card: continuous GPS watch with map, accuracy ring, and a
 *  screen-reader-friendly accuracy summary. When GPS is denied or absent the
 *  card falls back to an approximate city-level network fix so the Home map is
 *  never empty; the approximation is always disclosed out loud and in text. */
function LiveLocationCard({
  onOpenJourney,
  permissionService,
  places = [],
  speak,
}: {
  onOpenJourney: () => void;
  permissionService: PermissionService;
  places?: Array<{ id: string; label: string; latitude: number | null; longitude: number | null }>;
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
}) {
  const [pos, setPos] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [approximate, setApproximate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ipFallbackTriedRef = useRef(false);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setError('This device does not support location services.');
    }
  }, []);

  // One-shot network fallback: runs when GPS produces no fix (denied, timed
  // out, or unsupported). Marks the permission centre with an honest
  // "approximate — city level" state instead of leaving it "not allowed".
  useEffect(() => {
    if (pos || ipFallbackTriedRef.current) return;
    const t = setTimeout(() => {
      if (ipFallbackTriedRef.current) return;
      ipFallbackTriedRef.current = true;
      void import('../permissions/autoDetect').then((m) =>
        m.autoDetectLocation({
          permissionService,
          onLocation: (loc) => {
            setError(null);
            setApproximate(!loc.precise);
            setPos({ lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy });
          },
          onStatus: (message) => speak(message, 4, 'ip-location'),
        }),
      );
    }, 7000);
    return () => clearTimeout(t);
  }, [pos, permissionService, speak]);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setApproximate(false);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
      },
      (err) => setError(err.message || 'Location unavailable.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const enablePreciseLocation = () => {
    if (!('geolocation' in navigator)) {
      speak('This device does not support precise location.', 4, 'precise-unsupported');
      return;
    }
    speak('Requesting precise location.', 4, 'precise-requesting');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setApproximate(false);
        setError(null);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) });
        permissionService.set('location', 'allowed', `Accuracy approximately ${Math.round(p.coords.accuracy)} metres.`);
        speak(`Precise location enabled. Accuracy about ${Math.round(p.coords.accuracy)} metres.`, 4, 'precise-ok');
      },
      (err) => {
        speak(`Precise location is still unavailable. ${err.message || 'Permission was not granted.'}`, 4, 'precise-fail');
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  };

  const quality =
    pos == null || pos.accuracy == null
      ? null
      : pos.accuracy <= 10
        ? { label: 'Excellent', tone: 'ok' }
        : pos.accuracy <= 25
          ? { label: 'Good', tone: 'ok' }
          : pos.accuracy <= 60
            ? { label: 'Fair', tone: 'warn' }
            : { label: 'Poor', tone: 'warn' };

  const markers = places
    .filter((p) => p.latitude != null && p.longitude != null)
    .map((p) => ({ lat: p.latitude as number, lng: p.longitude as number, label: p.label }));

  const summary = approximate
    ? 'Approximate location — city-level fix from your network. Enable precise location for turn-by-turn accuracy.'
    : error
      ? `Location unavailable: ${error}`
      : pos
        ? `Latitude ${pos.lat.toFixed(5)}, longitude ${pos.lng.toFixed(5)}.${pos.accuracy != null ? ` Accuracy ${pos.accuracy} metres — ${quality?.label ?? 'unknown'}.` : ''}`
        : 'Finding your position…';

  return (
    <Card role="region" aria-label="Live location">
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border-2 border-foreground/90 bg-muted text-foreground"
            aria-hidden="true"
          >
            <MapPin className="size-6" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-xl">Live location</CardTitle>
            <p className="mt-1 text-base leading-relaxed" aria-live="polite">{summary}</p>
          </div>
        </div>
      </CardHeader>
      {/* The map is always visible on Home — even before any fix arrives. */}
      <CardContent className="pt-0">
        <MapView
          userLat={pos?.lat ?? null}
          userLng={pos?.lng ?? null}
          accuracyMeters={approximate ? undefined : pos?.accuracy ?? undefined}
          markers={markers}
          height="240px"
          zoom={17}
          showCompass={false}
        />
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {approximate && (
            <Button variant="ghost" size="lg" className="w-full sm:w-auto" onClick={enablePreciseLocation}>
              Enable precise location
            </Button>
          )}
          <Button variant="primary" size="lg" className="w-full sm:w-auto" onClick={onOpenJourney}>
            Start a monitored Safe Journey with this location
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function VoiceFirstDashboard({
  permissionService,
  emergency,
  activeJourney,
  offline,
  voiceState,
  hazardActive = false,
  places = [],
  onOrbToggle,
  onOpenTab,
  onOpenPermissions,
  onEmergency,
  onCancelEmergency,
  onResolveEmergency,
  speak,
}: {
  permissionService: PermissionService;
  emergency: EmergencyStatus;
  activeJourney: { destination: string; status: string } | null;
  offline: boolean;
  /** Live voice-assistant state drives the orb. */
  voiceState?: VoiceState;
  /** True while hazard/emergency speech is active — turns the orb red. */
  hazardActive?: boolean;
  /** Saved places pinned on the Home map. */
  places?: Array<{ id: string; label: string; latitude: number | null; longitude: number | null }>;
  onOrbToggle?: () => void;
  onOpenTab: (tab: DashboardTab) => void;
  onOpenPermissions: () => void;
  onEmergency: (payload: { lat?: number; lng?: number; battery?: number }) => void;
  onCancelEmergency: () => void;
  onResolveEmergency: () => void;
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-10 pt-2">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Command centre</p>
      </header>

      {/* DESIGN.md section 4: Home is three bands in priority order — Status,
          Command, Do. Everything else is navigation and belongs in the sidebar.

          Band 1 — Status: one line, always visible. The heading lives on the
          status card rather than on a kicker so the screen keeps a real
          heading outline (the thing blind users navigate by). */}
      <section aria-label="Status" className="mt-4 grid gap-4 md:grid-cols-2">
        <Card role="region" aria-label="Watchora status" className="flex flex-col">
          <CardContent className="flex flex-1 items-start gap-3 p-5">
            <span
              className={
                'flex size-11 shrink-0 items-center justify-center rounded-lg border-2 ' +
                (emergency.state === 'active'
                  ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : activeJourney
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-success/60 bg-success/10 text-success')
              }
              aria-hidden="true"
            >
              {emergency.state === 'active' ? (
                <Siren className="size-6" />
              ) : activeJourney ? (
                <Shield className="size-6" />
              ) : (
                <CheckCircle2 className="size-6" />
              )}
            </span>
            <div className="min-w-0">
              <CardTitle className="text-xl">Status</CardTitle>
              <p className="mt-1 text-base leading-relaxed text-foreground" aria-live="polite">
                {emergency.state === 'active'
                  ? 'Emergency active.'
                  : activeJourney
                    ? `Safe journey to ${activeJourney.destination} (${activeJourney.status}).`
                    : 'Ready.'}
              </p>
            </div>
          </CardContent>
        </Card>
        <PermissionStatusCard service={permissionService} onOpen={onOpenPermissions} />
      </section>

      {offline && (
        <Alert tone="warning" politeness="polite" className="mt-4">
          <p className="text-base leading-relaxed">
            You are offline. Local hazard detection, saved information, and OCR remain available. Cloud scene descriptions and remote emergency delivery may be unavailable.
          </p>
        </Alert>
      )}

      {/* Band 2 — Command: the orb and the type-to-Jarvis bar. These are the
          two ways in, so they sit together and ahead of every action. */}
      <section aria-label="Give Watchora a command" className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Command</p>
        {/* pb-9 reserves the strip the orb's absolutely-positioned state label
            needs (it sits 1.7rem below the orb) so the label never collides
            with the command bar below it. */}
        <div className="mt-3 flex justify-center pb-9">
          {voiceState !== undefined && onOrbToggle ? (
            <WatchoraOrb
              state={orbStateFor(voiceState, hazardActive)}
              size={110}
              onClick={onOrbToggle}
            />
          ) : (
            <VoiceControlButton />
          )}
        </div>
        <div>
          <TypeToJarvis autoFocus={voiceState !== undefined && (voiceState === 'unsupported' || voiceState === 'permission-needed')} />
        </div>
      </section>

      {emergency.state === 'active' && (
        <div className="mt-6">
          <EmergencyControl status={emergency} onTrigger={onEmergency} onCancel={onCancelEmergency} onResolve={onResolveEmergency} speak={speak} />
        </div>
      )}

      {/* Band 3 — Do: the primary actions, large and few.

          The v0.5 "quick nav" outline row (Places / Contacts / Community /
          Settings) is gone. All four called onOpenTab('routes' | 'sos' |
          'community' | 'settings'), and all four of those are already tabs in
          the sidebar (App.tsx `tabs`) — so it was four extra tab stops
          duplicating navigation that already exists, and it put them between
          the command bar and the real actions. Nothing became unreachable. */}
      <section aria-label="Primary actions" className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Do</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <DashboardActionCard
            icon={MapPin}
            title="Assist"
            explanation="Use the camera to understand your surroundings."
            buttonLabel="Start Assist"
            onActivate={() => onOpenTab('tracking')}
            voiceHint="Describe what is ahead"
          />
          <DashboardActionCard
            icon={Shield}
            title="Safe Journey"
            explanation="Watchora monitors your trip and asks if you need help."
            buttonLabel={activeJourney ? 'Open active journey' : 'Start Safe Journey'}
            onActivate={() => onOpenTab('journey')}
            voiceHint="Start a safe journey"
            state={activeJourney ? `Active: ${activeJourney.destination}` : 'No active journey'}
            stateTone={activeJourney ? 'ok' : 'neutral'}
          />
          <DashboardActionCard
            icon={BookOpen}
            title="Read"
            explanation="Point at text and hear it read aloud."
            buttonLabel="Read text"
            onActivate={() => onOpenTab('tracking')}
            voiceHint="Read this"
          />
          <DashboardActionCard
            icon={Siren}
            title="Emergency"
            explanation="Share your location with trusted contacts."
            buttonLabel="Open emergency"
            onActivate={() => onOpenTab('sos')}
            voiceHint="Emergency"
            buttonVariant="destructive"
          />
        </div>
      </section>

      {/* Supporting context, below the primary band: the live fix, its
          accuracy, and the location-scoped journey shortcut. */}
      <section aria-label="Location" className="mt-6">
        <LiveLocationCard
          onOpenJourney={() => onOpenTab('journey')}
          permissionService={permissionService}
          places={places}
          speak={speak}
        />
      </section>

      {emergency.state !== 'active' && (
        <section aria-label="Emergency" className="mt-6">
          <EmergencyControl status={emergency} onTrigger={onEmergency} onCancel={onCancelEmergency} onResolve={onResolveEmergency} speak={speak} />
        </section>
      )}
    </div>
  );
}
