import { useEffect, useState } from 'react';
import {
  CircleCheck,
  CircleX,
  Clock,
  MapPin,
  ShieldAlert,
  Siren,
  Trash,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import { api, ApiError, type AssistanceRequest, type TrustedContact } from '../api';
import type { SpeechPriority } from '../speechPriority';
import type { Tone } from './shared';
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, Field, Input, Textarea } from '../components/ui';

export function SosTab({
  contacts,
  assistanceRequests,
  onContactCreated,
  onContactDeleted,
  onRequestCreated,
  onRequestResolved,
  announce,
  speak,
}: {
  contacts: TrustedContact[] | null;
  assistanceRequests: AssistanceRequest[] | null;
  onContactCreated: (contact: TrustedContact) => void;
  onContactDeleted: (id: string) => void;
  onRequestCreated: (request: AssistanceRequest) => void;
  onRequestResolved: (request: AssistanceRequest) => void;
  announce: (message: string, tone?: Tone) => void;
  speak: (text: string, priority?: SpeechPriority, dedupeKey?: string) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [sosMessage, setSosMessage] = useState('I need help. Please check on me.');
  const [sending, setSending] = useState(false);
  const [shareLocOnAdd, setShareLocOnAdd] = useState(false);
  const [manageOnAdd, setManageOnAdd] = useState(false);
  // Apple-style SOS: full-screen takeover with a spoken countdown, then an
  // automatic deterministic emergency session. window.confirm is unusable
  // non-visually; the countdown IS the confirmation.
  const [countdown, setCountdown] = useState<number | null>(null);
  const [activeEmergency, setActiveEmergency] = useState<{ id: string; cancelable: boolean } | null>(null);

  function startSosCountdown() {
    if (countdown != null || sending) return;
    setCountdown(5);
    speak('Emergency. Sending S O S in five. Say or tap cancel to stop.', 1, 'sos-countdown-5');
  }

  function cancelSosCountdown() {
    if (countdown == null) return;
    setCountdown(null);
    speak('Emergency cancelled.', 1, 'sos-cancelled');
    announce('Emergency cancelled.', 'online');
  }

  // Countdown tick + auto-send.
  useEffect(() => {
    if (countdown == null || countdown <= 0) return;
    const t = setTimeout(() => {
      const next = countdown - 1;
      setCountdown(next);
      if (next > 0) speak(String(next), 1, `sos-countdown-${next}`);
    }, 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown !== 0) return;
    let cancelled = false;
    (async () => {
      setSending(true);
      try {
        // Grab current position so the session carries live coordinates.
        let coords: { lat: number; lng: number; accuracy?: number } | undefined;
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 5000, maximumAge: 10_000 });
          });
          coords = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        } catch {
          // Location unavailable: SOS still fires without coordinates.
        }
        const { session } = await api.triggerEmergency({
          lat: coords?.lat,
          lng: coords?.lng,
          accuracy: coords?.accuracy,
          emergencyType: 'sos-button',
        });
        if (!cancelled) {
          setActiveEmergency({ id: session.id, cancelable: true });
          speak('S O S sent. Your trusted contacts are being notified. Your location is being shared.', 1, 'sos-sent-live');
          announce('SOS sent. Emergency session active.', 'error');
        }
      } catch (error) {
        if (!cancelled) {
          // Fallback to the deterministic assistance-request log if the
          // emergency session endpoint is unreachable.
          try {
            const { request } = await api.createAssistanceRequest({ message: sosMessage.trim() || 'I need help.', locationShare: true });
            onRequestCreated(request);
            api.grantConsent({ scope: 'LOCATION_SHARING', metadata: { source: 'sos', assistanceRequestId: request.id } }).catch(() => {});
            announce('SOS request recorded.', 'error');
            speak('S O S request sent.', 1, 'sos-sent');
          } catch {
            announce(error instanceof ApiError ? error.message : 'Could not send the SOS request.', 'error');
            speak('S O S failed. Try again or call your emergency number.', 1, 'sos-failed');
          }
        }
      } finally {
        setSending(false);
        setCountdown(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countdown]);

  async function cancelActiveEmergency() {
    if (!activeEmergency) return;
    try {
      await api.cancelEmergency(activeEmergency.id);
      setActiveEmergency(null);
      announce('Emergency cancelled.', 'online');
      speak('Emergency cancelled. Your contacts were not notified.', 1, 'sos-live-cancelled');
    } catch {
      announce('The cancellation window has closed. Use Resolve when you are safe.', 'warning');
    }
  }

  async function resolveActiveEmergency() {
    if (!activeEmergency) return;
    try {
      await api.resolveEmergency(activeEmergency.id);
      setActiveEmergency(null);
      announce('Marked as resolved. You are safe.', 'online');
      speak('Marked as resolved. You are safe.', 1, 'sos-resolved');
    } catch {
      announce('Could not resolve this emergency session.', 'error');
    }
  }

  async function addContact() {
    if (!name.trim()) {
      announce('Enter a contact name.', 'warning');
      return;
    }
    try {
      const { contact } = await api.createContact({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        relationship: relationship.trim() || undefined,
        canSeeLocation: shareLocOnAdd,
        canManageSettings: manageOnAdd,
      });
      onContactCreated(contact);
      setName('');
      setPhone('');
      setEmail('');
      setRelationship('');
      setShareLocOnAdd(false);
      setManageOnAdd(false);
      announce(
        manageOnAdd
          ? 'Contact added. Once they create a Watchora account with this email, they can adjust your settings remotely.'
          : 'Contact added.',
        'online',
      );
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not add this contact.', 'error');
    }
  }

  async function removeContact(id: string) {
    try {
      await api.deleteContact(id);
      onContactDeleted(id);
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not remove this contact.', 'error');
    }
  }

  async function toggleLocationConsent(contact: TrustedContact) {
    try {
      const { contact: updated } = await api.updateContact(contact.id, { canSeeLocation: !contact.canSeeLocation });
      onContactCreated(updated); // same shape; replace in list
      announce(
        updated.canSeeLocation
          ? `${contact.name} can now see your live location during safe journeys.`
          : `Live location sharing with ${contact.name} is off.`,
        'online',
      );
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not update location sharing.', 'error');
    }
  }

  async function toggleManageConsent(contact: TrustedContact) {
    try {
      const { contact: updated } = await api.updateContact(contact.id, { canManageSettings: !contact.canManageSettings });
      onContactCreated(updated); // same shape; replace in list
      speak(
        updated.canManageSettings
          ? `${contact.name} can now manage your Watchora settings from their own account. They will never see or change your AI key.`
          : `Remote settings management for ${contact.name} is off.`,
        4,
        `manage-consent-${contact.id}`,
      );
      announce(
        updated.canManageSettings
          ? `${contact.name} can now manage your settings remotely.`
          : `Remote settings management for ${contact.name} is off.`,
        'online',
      );
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not update remote management.', 'error');
    }
  }

  async function triggerSOS() {
    // Apple-style: replace window.confirm (unusable non-visually) with the
    // spoken countdown takeover.
    startSosCountdown();
  }

  async function resolveRequest(id: string) {
    try {
      const { request } = await api.resolveAssistanceRequest(id);
      onRequestResolved(request);
      announce('Marked as resolved.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not update this request.', 'error');
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl pb-12">
      {/* Apple-style full-screen SOS takeover: countdown or live session. */}
      {(countdown !== null || activeEmergency) && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Emergency"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 overflow-y-auto bg-destructive p-6 text-center text-destructive-foreground"
        >
          {countdown !== null && countdown > 0 ? (
            <>
              <ShieldAlert aria-hidden="true" className="h-14 w-14" />
              <p className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Emergency SOS</p>
              <p aria-live="assertive" className="font-display text-8xl font-black leading-none tabular-nums sm:text-[9rem]">
                {countdown}
              </p>
              <p className="max-w-sm text-lg leading-relaxed">Sending SOS and your location when the countdown ends.</p>
              <Button
                variant="secondary"
                size="xl"
                onClick={cancelSosCountdown}
                autoFocus
                className="h-20 w-full max-w-sm text-2xl font-bold sm:text-3xl"
              >
                <CircleX aria-hidden="true" className="h-7 w-7" />
                Cancel emergency
              </Button>
            </>
          ) : countdown === 0 || sending ? (
            <>
              <p className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Sending…</p>
              <p aria-hidden="true" className="leading-none">
                <Siren aria-hidden="true" className="h-24 w-24 animate-pulse" />
              </p>
              <p className="max-w-sm text-lg leading-relaxed">Contacting your trusted contacts.</p>
            </>
          ) : activeEmergency ? (
            <>
              <p className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">SOS active</p>
              <p role="status" aria-live="assertive" className="max-w-md text-lg leading-relaxed">
                Your emergency is live. Trusted contacts are being notified with your location.
              </p>
              <div className="flex w-full max-w-sm flex-col gap-3">
                <Button
                  variant="secondary"
                  size="xl"
                  onClick={cancelActiveEmergency}
                  autoFocus
                  className="h-20 w-full text-2xl font-bold sm:text-3xl"
                >
                  <CircleX aria-hidden="true" className="h-7 w-7" />
                  I'm safe — cancel
                </Button>
                <Button variant="outline" size="xl" onClick={resolveActiveEmergency} className="h-14 w-full text-lg font-semibold">
                  <CircleCheck aria-hidden="true" className="h-5 w-5" />
                  Resolve (I'm fine now)
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* The trigger: one huge, unmissable destructive action on its own card. */}
      <Card className="border-destructive bg-destructive/5 shadow-lg shadow-destructive/20">
        <CardHeader className="gap-2 p-6 pb-4">
          <div className="flex items-center gap-2.5">
            <ShieldAlert aria-hidden="true" className="h-6 w-6 text-destructive" />
            <h2 className="font-display text-2xl font-semibold tracking-tight">SOS center</h2>
          </div>
          <CardDescription>One tap starts a five-second countdown you can cancel.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-6 pt-2">
          <Field label="Message sent with the SOS" htmlFor="sos-message">
            <Textarea
              id="sos-message"
              aria-label="Message sent with the SOS"
              rows={2}
              value={sosMessage}
              onChange={(event) => setSosMessage(event.target.value)}
            />
          </Field>
          <Button
            variant="destructive"
            size="xl"
            onClick={triggerSOS}
            disabled={sending || countdown != null}
            className="h-20 w-full gap-3 text-2xl font-bold sm:h-24 sm:gap-4 sm:text-3xl"
          >
            <Siren aria-hidden="true" className="h-9 w-9 sm:h-11 sm:w-11" />
            {sending ? 'Sending…' : 'Send SOS'}
          </Button>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Your trusted contacts are alerted and your live location is shared. You always get five seconds to cancel.
          </p>
        </CardContent>
      </Card>

      <section className="mt-6">
        <Card>
          <CardHeader className="gap-2 p-6 pb-4">
            <div className="flex items-center gap-2.5">
              <Users aria-hidden="true" className="h-6 w-6 text-primary" />
              <h3 className="font-display text-2xl font-semibold tracking-tight">Emergency contacts</h3>
            </div>
            <CardDescription>The people notified when you send an SOS.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 p-6 pt-2">
            {contacts === null ? (
              <Alert politeness="polite" tone="info">
                Loading…
              </Alert>
            ) : contacts.length === 0 ? (
              <Alert politeness="polite" tone="info">
                No emergency contacts yet.
              </Alert>
            ) : (
              <ul className="flex flex-col gap-3">
                {contacts.map((contact, index) => (
                  <li key={contact.id} className="rounded-xl border-2 border-foreground/90 bg-card p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-base">
                        <span className="mr-1.5 text-sm font-semibold text-muted-foreground">{index + 1}.</span>
                        <span className="font-semibold">{contact.name}</span>
                        {contact.relationship ? <span className="text-muted-foreground"> ({contact.relationship})</span> : null}
                      </p>
                      <p className="text-sm text-muted-foreground">{contact.phone || contact.email || '—'}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant={contact.canSeeLocation ? 'primary' : 'outline'}
                        aria-pressed={contact.canSeeLocation}
                        onClick={() => toggleLocationConsent(contact)}
                        title="Let this contact see your live location during safe journeys"
                      >
                        <MapPin aria-hidden="true" className="h-4 w-4" />
                        {contact.canSeeLocation ? 'Location on' : 'Location off'}
                      </Button>
                      {contact.email && (
                        <Button
                          variant={contact.canManageSettings ? 'primary' : 'outline'}
                          aria-pressed={contact.canManageSettings}
                          onClick={() => toggleManageConsent(contact)}
                          title="Let this contact adjust your settings from their own Watchora account"
                        >
                          <Wrench aria-hidden="true" className="h-4 w-4" />
                          {contact.canManageSettings ? 'Remote care on' : 'Remote care off'}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="border-destructive/60 text-destructive hover:bg-destructive/10"
                        onClick={() => removeContact(contact.id)}
                        aria-label={`Remove ${contact.name}`}
                      >
                        <Trash aria-hidden="true" className="h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-2 flex flex-col gap-4 rounded-xl bg-muted/60 p-4 sm:p-5">
              <h4 className="font-display text-lg font-semibold">Add a contact</h4>
              <Field label="Contact name" htmlFor="sos-contact-name">
                <Input
                  id="sos-contact-name"
                  aria-label="Contact name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name"
                />
              </Field>
              <Field label="Relationship (optional)" htmlFor="sos-contact-relationship">
                <Input
                  id="sos-contact-relationship"
                  aria-label="Relationship (optional)"
                  value={relationship}
                  onChange={(event) => setRelationship(event.target.value)}
                  placeholder="e.g. Daughter"
                />
              </Field>
              <Field label="Phone (optional)" htmlFor="sos-contact-phone">
                <Input
                  id="sos-contact-phone"
                  aria-label="Phone (optional)"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Phone number"
                />
              </Field>
              <Field label="Email (needed for remote care linking)" htmlFor="sos-contact-email">
                <Input
                  id="sos-contact-email"
                  aria-label="Email (needed for remote care linking)"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="their@email.com"
                />
              </Field>
              <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-foreground/25 bg-card px-3.5 py-2">
                <span className="text-sm font-semibold">Share live location with this contact</span>
                <Button
                  variant={shareLocOnAdd ? 'primary' : 'outline'}
                  aria-pressed={shareLocOnAdd}
                  aria-label="Share live location with this contact"
                  onClick={() => setShareLocOnAdd(!shareLocOnAdd)}
                >
                  {shareLocOnAdd ? 'On' : 'Off'}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-foreground/25 bg-card px-3.5 py-2">
                <span className="text-sm font-semibold">Let this contact manage my settings</span>
                <Button
                  variant={manageOnAdd ? 'primary' : 'outline'}
                  aria-pressed={manageOnAdd}
                  aria-label="Let this contact manage my settings"
                  onClick={() => setManageOnAdd(!manageOnAdd)}
                >
                  {manageOnAdd ? 'On' : 'Off'}
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Remote care: once this contact signs up with the same email, they can adjust your speech, display, and
                connectivity settings from their own Watchora account — nothing else. Your AI key is never visible to
                them, every change is logged, and you can turn this off at any time.
              </p>
              <Button variant="secondary" size="lg" className="w-full" onClick={addContact}>
                <UserPlus aria-hidden="true" className="h-5 w-5" />
                Add contact
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader className="gap-2 p-6 pb-4">
            <div className="flex items-center gap-2.5">
              <Clock aria-hidden="true" className="h-6 w-6 text-primary" />
              <h2 className="font-display text-2xl font-semibold tracking-tight">SOS history</h2>
            </div>
          </CardHeader>
          <CardContent className="p-6 pt-2">
            {assistanceRequests === null ? (
              <Alert politeness="polite" tone="info">
                Loading…
              </Alert>
            ) : assistanceRequests.length === 0 ? (
              <Alert politeness="polite" tone="info">
                No SOS requests yet.
              </Alert>
            ) : (
              <ol className="flex flex-col gap-3">
                {assistanceRequests.map((req) => (
                  <li
                    key={req.id}
                    className="flex flex-col gap-2.5 rounded-xl border-2 border-foreground/90 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                        <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                        {new Date(req.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-sm">{req.message}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                      <Badge tone={req.status === 'RESOLVED' ? 'success' : 'danger'}>{req.status}</Badge>
                      {req.status !== 'RESOLVED' ? (
                        <Button
                          variant="outline"
                          onClick={() => resolveRequest(req.id)}
                          aria-label={`Mark resolved — ${new Date(req.createdAt).toLocaleString()}`}
                        >
                          <CircleCheck aria-hidden="true" className="h-4 w-4" />
                          Mark resolved
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
