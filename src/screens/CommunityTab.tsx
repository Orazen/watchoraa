import { useState } from 'react';
import {
  Bus,
  CircleHelp,
  Construction,
  Footprints,
  Lightbulb,
  Megaphone,
  Milestone,
  Send,
  Signpost,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError, type IncidentReport } from '../api';
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
  Select,
  Textarea,
} from '../components/ui';

/** Category → icon. The visible text label always rides alongside (icons are
 *  aria-hidden decoration), so the mapping is purely visual. */
const categoryIcons: Record<string, LucideIcon> = {
  Sidewalk: Footprints,
  Crosswalk: Milestone,
  Construction: Construction,
  Lighting: Lightbulb,
  Signage: Signpost,
  Transit: Bus,
  Other: CircleHelp,
};

/** LOW/MEDIUM/HIGH/CRITICAL → kit Badge tones (task contract). */
function severityBadgeTone(severity: IncidentReport['severity']): 'neutral' | 'info' | 'warning' | 'danger' {
  switch (severity) {
    case 'LOW':
      return 'neutral';
    case 'MEDIUM':
      return 'info';
    case 'HIGH':
      return 'warning';
    case 'CRITICAL':
      return 'danger';
  }
}

/** Keeps the old feed-card colour semantics: LOW success, MEDIUM warning,
 *  HIGH/CRITICAL danger — carried by the category icon tint. */
function severityIconTone(severity: IncidentReport['severity']): string {
  switch (severity) {
    case 'LOW':
      return 'text-success';
    case 'MEDIUM':
      return 'text-warning';
    default:
      return 'text-destructive';
  }
}

export function CommunityTab({
  incidents,
  onCreated,
  announce,
}: {
  incidents: IncidentReport[] | null;
  onCreated: (incident: IncidentReport) => void;
  announce: (message: string, tone?: Tone) => void;
}) {
  const [category, setCategory] = useState('Sidewalk');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<IncidentReport['severity']>('MEDIUM');
  const [saving, setSaving] = useState(false);

  async function addReport() {
    if (!description.trim()) {
      announce('Describe the hazard before submitting.', 'warning');
      return;
    }
    setSaving(true);
    try {
      // Auto-attach current position so blind reporters never type an address.
      // Best-effort: the report is still submitted if GPS fails (it just won't
      // appear in near-me queries).
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 6000, maximumAge: 30_000 });
        });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {
        // No location: submit without coordinates.
      }
      const { incident } = await api.createIncident({ category: category.trim() || 'General', description: description.trim(), severity, lat, lng });
      onCreated(incident);
      setDescription('');
      announce(lat != null ? 'Report submitted and pinned to your current location.' : 'Report submitted.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not submit this report.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <section>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">Community reports</h2>
        {incidents === null ? (
          <Alert politeness="polite" role="status" aria-live="polite" className="mt-4">
            <AlertDescription>Loading…</AlertDescription>
          </Alert>
        ) : incidents.length === 0 ? (
          <Alert politeness="polite" role="status" aria-live="polite" className="mt-4">
            <AlertDescription>No reports yet. Be the first to add one.</AlertDescription>
          </Alert>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {incidents.map((incident) => {
              const CategoryIcon = categoryIcons[incident.category] ?? Megaphone;
              return (
                <Card key={incident.id}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2.5">
                      <CategoryIcon
                        aria-hidden="true"
                        className={`size-5 shrink-0 ${severityIconTone(incident.severity)}`}
                      />
                      {incident.category}
                    </CardTitle>
                    <CardDescription>
                      {/* Privacy contract: the public feed never attaches a name —
                          show one only if the API supplied it, otherwise stay
                          anonymous. Never add identifying info here. */}
                      {incident.reporter?.fullName ? `Reported by ${incident.reporter.fullName}` : 'Reported anonymously'}
                      {' · '}
                      {new Date(incident.createdAt).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-base leading-relaxed text-foreground">{incident.description}</p>
                    <Badge tone={severityBadgeTone(incident.severity)} className="self-start">
                      {incident.severity}
                    </Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <Megaphone aria-hidden="true" className="size-5 shrink-0 text-primary" />
              Add a report
            </CardTitle>
            <CardDescription>
              Your current location is attached automatically when available — no address typing needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Report type" htmlFor="community-report-type">
              <Select
                id="community-report-type"
                aria-label="Report type"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="Sidewalk">Sidewalk obstacle</option>
                <option value="Crosswalk">Crosswalk / intersection</option>
                <option value="Construction">Construction / roadwork</option>
                <option value="Lighting">Poor lighting</option>
                <option value="Signage">Missing or unclear signage</option>
                <option value="Transit">Public transit access</option>
                <option value="Other">Other</option>
              </Select>
            </Field>
            <Field label="Severity" htmlFor="community-severity">
              <Select
                id="community-severity"
                aria-label="Severity"
                value={severity}
                onChange={(event) => setSeverity(event.target.value as IncidentReport['severity'])}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </Select>
            </Field>
            <Field label="Details" htmlFor="community-details">
              <Textarea
                id="community-details"
                aria-label="Details"
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the hazard or safety note here."
              />
            </Field>
            <Button onClick={addReport} disabled={saving} size="lg">
              {saving ? 'Sending…' : <><Send aria-hidden="true" className="size-4 shrink-0" /> Send report</>}
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
