import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, Clock, Flag, Navigation, Route, ShieldCheck, Siren } from 'lucide-react';
import { api, ApiError, type SafeJourney, type TrustedContact } from '../api';
import type { SpeechPriority } from '../speechPriority';
import { MapView } from '../MapView';
import { PermissionService } from '../permissions/permissionService';
import type { Tone } from './shared';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from '../components/ui';

/** Status → Badge tone: ACTIVE reads as healthy, PAUSED as caution, ESCALATED as alarm. */
const STATUS_TONES: Record<SafeJourney['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  ESCALATED: 'danger',
  COMPLETED: 'neutral',
  CANCELLED: 'neutral',
};

export function SafeJourneyTab({
  contacts,
  onNeedContacts,
  announce,
  speak,
  permissionService,
}: {
  contacts: TrustedContact[] | null;
  onNeedContacts: () => void;
  announce: (message: string, tone?: Tone) => void;
  speak: (text: string, priority?: SpeechPriority, dedupeKey?: string) => void;
  permissionService: PermissionService;
}) {
  const [journey, setJourney] = useState<SafeJourney | null>(null);
  const [destination, setDestination] = useState('');
  const [eta, setEta] = useState('');
  const [contactId, setContactId] = useState('');
  const [intervalMin, setIntervalMin] = useState(15);
  const [shareLive, setShareLive] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [battery, setBattery] = useState<number | null>(null);
  const [livePos, setLivePos] = useState<{ lat: number; lng: number } | null>(null);
  const locRef = useRef<{ watchId: number; timer: ReturnType<typeof setInterval> | null } | null>(null);

  const loadActive = useCallback(() => {
    api
      .activeJourney()
      .then((res) => {
        setJourney(res.journey);
        // This tab unmounts on tab switch, which clears the geolocation watch.
        // If we come back to an in-flight journey, the watch MUST restart —
        // otherwise monitoring silently stops while the UI implies otherwise.
        if (res.journey && !locRef.current) beginLocation(res.journey.id);
      })
      .catch(() => setJourney(null));
  }, []);

  useEffect(() => {
    loadActive();
    // Battery level: only read if user has explicitly granted battery permission.
    if (permissionService.get('battery').state === 'allowed') {
      const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
      nav.getBattery?.().then((b) => setBattery(Math.round(b.level * 100))).catch(() => {});
    }
    return () => {
      if (locRef.current) {
        navigator.geolocation.clearWatch(locRef.current.watchId);
        if (locRef.current.timer) clearInterval(locRef.current.timer);
        locRef.current = null;
      }
    };
  }, [loadActive, permissionService]);

  async function start() {
    if (!destination.trim()) {
      announce('Enter a destination to start a safe journey.', 'warning');
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await api.startJourney({
        destination: destination.trim(),
        eta: eta || undefined,
        trustedContactId: contactId || undefined,
        checkInIntervalMinutes: intervalMin,
        shareLive,
      });
      setJourney(res.journey);
      speak(`Safe journey started to ${res.journey.destination}. I will monitor your progress.`, 5, 'journey-start');
      beginLocation(res.journey.id);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Could not start journey.';
      setError(message);
      announce(message, 'error');
    } finally {
      setStarting(false);
    }
  }

  // Reports location periodically + checks deviation while the journey is active.
  function beginLocation(jid: string) {
    if (!('geolocation' in navigator)) return;
    if (locRef.current) navigator.geolocation.clearWatch(locRef.current.watchId);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setLivePos({ lat: latitude, lng: longitude });
        api.journeyLocation(jid, { lat: latitude, lng: longitude, accuracy, battery: battery ?? undefined }).catch(() => {});
        api.journeyDeviation(jid, latitude, longitude).then((d) => {
          if (d.action === 'prompt') {
            announce(`You have moved about ${d.deviationMeters} metres off your route. Are you safe?`, 'warning');
            speak(`You have moved about ${d.deviationMeters} metres off your route. Are you safe?`, 3, `deviation-${Math.floor(d.deviationMeters / 100)}`);
          } else if (d.action === 'escalate') {
            announce('No response received. Your trusted contact has been alerted.', 'error');
            speak('No response received. Your trusted contact has been alerted.', 1, 'escalated');
          }
        }).catch(() => {});
      },
      (err) => announce(`Location error: ${err.message}`, 'warning'),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    const timer = setInterval(() => {
      api.activeJourney().then((res) => {
        setJourney(res.journey);
        if (res.journey?.missedArrival) {
          announce(`Your expected arrival time has passed. Are you safe?`, 'warning');
          speak(`Your expected arrival time has passed. Are you safe?`, 3, 'missed-arrival');
        } else if (res.journey?.promptDue) {
          announce(`Check-in due. Are you safe?`, 'warning');
          speak(`Check-in due. Are you safe?`, 3, 'checkin-due');
        }
      }).catch(() => {});
    }, 60_000);
    locRef.current = { watchId, timer };
  }

  async function checkIn() {
    if (!journey) return;
    await api.journeyCheckIn(journey.id);
    announce('Checked in. I will keep monitoring.', 'online');
    speak('Checked in. I will keep monitoring.');
    loadActive();
  }

  async function lost() {
    if (!journey) return;
    await api.journeyLost(journey.id);
    announce('Help requested. Your trusted contact has been notified.', 'error');
    speak('Help requested. Your trusted contact has been notified.');
  }

  async function end() {
    if (!journey) return;
    await api.endJourney(journey.id);
    if (locRef.current) {
      navigator.geolocation.clearWatch(locRef.current.watchId);
      if (locRef.current.timer) clearInterval(locRef.current.timer);
      locRef.current = null;
    }
    announce('Journey ended. You are safe.', 'online');
    speak('Journey ended. You are safe.');
    setLivePos(null);
    setJourney(null);
  }

  return (
    <div className="mx-auto w-full max-w-2xl pb-12">
      {journey ? (
        <section className="mt-6">
          <Card>
            <CardHeader className="gap-2 p-6 pb-4">
              <div className="flex items-center gap-2.5">
                <Navigation aria-hidden="true" className="h-5 w-5 text-primary" />
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">safe journey</p>
              </div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">Journey in progress</h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-6 pt-2">
              <div className="overflow-hidden rounded-xl border-2 border-foreground/20">
                <MapView
                  userLat={livePos?.lat ?? journey.lastLat}
                  userLng={livePos?.lng ?? journey.lastLng}
                  height="320px"
                />
              </div>

              <div className="flex flex-col gap-2">
                <CardTitle className="font-display text-2xl">{journey.destination}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONES[journey.status]}>{journey.status}</Badge>
                  {journey.eta && (
                    <Badge tone="info">
                      <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                      Expected arrival {new Date(journey.eta).toLocaleTimeString()}
                    </Badge>
                  )}
                  {journey.lastCheckInAt && (
                    <Badge tone="outline">
                      <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
                      Last check-in {new Date(journey.lastCheckInAt).toLocaleTimeString()}
                    </Badge>
                  )}
                </div>
              </div>

              {journey.trustedContact && (
                <p className="text-sm text-muted-foreground">
                  Monitored by <span className="font-semibold text-foreground">{journey.trustedContact.name}</span>
                </p>
              )}

              {journey.missedArrival && (
                <Alert tone="danger" politeness="assertive">
                  <AlertDescription>
                    <p className="font-semibold">Your expected arrival time has passed.</p>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button variant="secondary" size="lg" onClick={checkIn} className="flex-1">
                  <CircleCheck aria-hidden="true" className="h-5 w-5" />
                  I'm safe (check-in)
                </Button>
                <Button variant="destructive" size="lg" onClick={lost} className="flex-1">
                  <Siren aria-hidden="true" className="h-5 w-5" />
                  I'm lost
                </Button>
                <Button variant="outline" size="lg" onClick={end}>
                  <Flag aria-hidden="true" className="h-5 w-5" />
                  End journey
                </Button>
              </div>

              <p className="text-sm leading-relaxed text-muted-foreground">
                {journey.shareLive ? 'Live location sharing is on for your trusted contact.' : 'Live location sharing is off.'} · Check-in every {journey.checkInIntervalMinutes} min
              </p>
            </CardContent>
          </Card>
        </section>
      ) : (
        <section className="mt-6">
          <Card>
            <CardHeader className="gap-2 p-6 pb-4">
              <div className="flex items-center gap-2.5">
                <ShieldCheck aria-hidden="true" className="h-5 w-5 text-primary" />
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-primary">safe journey</p>
              </div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">Start a safe journey</h2>
              <CardDescription>Tell Watchora where you are going and how often to check in.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 p-6 pt-2">
              <Field label="Destination" htmlFor="journey-destination">
                <Input
                  id="journey-destination"
                  aria-label="Destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="e.g. Home, Hospital, Work"
                />
              </Field>

              <Field label="Expected arrival (optional)" htmlFor="journey-eta">
                <Input
                  id="journey-eta"
                  aria-label="Expected arrival (optional)"
                  type="datetime-local"
                  value={eta}
                  onChange={(e) => setEta(e.target.value)}
                />
              </Field>

              <Field label="Trusted contact (optional)" htmlFor="journey-contact">
                {contacts && contacts.length > 0 ? (
                  <Select id="journey-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">No contact</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                ) : (
                  <Button variant="outline" onClick={onNeedContacts}>
                    Add a trusted contact in SOS first
                  </Button>
                )}
              </Field>

              <Field label="Check-in every (minutes)" htmlFor="journey-interval">
                <Select
                  id="journey-interval"
                  aria-label="Check-in every (minutes)"
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                >
                  {[5, 10, 15, 30, 60].map((n) => (
                    <option key={n} value={n}>{n} minutes</option>
                  ))}
                </Select>
              </Field>

              <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-foreground/20 bg-muted/50 px-3.5 py-2.5">
                <span className="text-sm font-semibold text-foreground">Share live location</span>
                <Button variant="outline" aria-pressed={shareLive} onClick={() => setShareLive(!shareLive)}>
                  {shareLive ? 'On' : 'Off'}
                </Button>
              </div>

              {error && (
                <Alert tone="danger" politeness="assertive">
                  <AlertDescription>
                    <p className="font-semibold">{error}</p>
                  </AlertDescription>
                </Alert>
              )}

              <Button variant="primary" size="xl" onClick={start} disabled={starting} className="w-full">
                {starting ? 'Starting…' : (
                  <>
                    <Route aria-hidden="true" className="h-5 w-5" />
                    Start safe journey
                  </>
                )}
              </Button>

              <p className="text-sm leading-relaxed text-muted-foreground">
                Watchora will ask you if you deviate from your route or miss your arrival, and alert your trusted contact if you do not respond.
              </p>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
