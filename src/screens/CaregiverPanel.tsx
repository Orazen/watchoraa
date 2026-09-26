import { useEffect, useState } from 'react';
import { AudioLines, BrainCircuit, MapPin, Monitor, Route, Settings2, Siren, Users } from 'lucide-react';
import { api, ApiError, type CaregiverLiveLocation, type CaregiverOverview, type WardPreferencesPatch, type WardSettings } from '../api';
import { FREE_MODEL_PRESETS } from '../AiProviderSettings';
import { MapView } from '../MapView';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
} from '../components/ui';
import type { Tone } from './shared';

/** Section heading for the caregiver instrument panel: kicker, icon, title. */
function PanelHeading({ kicker, icon, title }: { kicker: string; icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{kicker}</p>
      <h2 className="mt-1 flex items-center gap-2.5 font-display text-xl font-semibold tracking-tight text-foreground">
        {icon}
        {title}
      </h2>
    </div>
  );
}

export function CaregiverTab({ announce }: { announce: (message: string, tone?: Tone) => void }) {
  const [overview, setOverview] = useState<CaregiverOverview | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [locData, setLocData] = useState<Record<string, CaregiverLiveLocation | null>>({});
  const [locLoading, setLocLoading] = useState(false);
  const [settingsUserId, setSettingsUserId] = useState<string | null>(null);

  useEffect(() => {
    api
      .caregiverOverview()
      .then((res) => setOverview(res))
      .catch(() => announce('Could not load your caregiver overview.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleLocation(userId: string) {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    setLocLoading(true);
    try {
      const res = await api.caregiverUserLocation(userId);
      setLocData((prev) => ({ ...prev, [userId]: res }));
      if (res.journey) {
        announce(`Live location shared for this user's active journey.`);
      } else {
        announce(res.consent ? 'No active journey sharing location right now.' : 'This user has not granted live location access.');
      }
    } catch {
      setLocData((prev) => ({ ...prev, [userId]: null }));
      announce('Could not load live location for this user.', 'warning');
    } finally {
      setLocLoading(false);
    }
  }

  if (!overview) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <section className="mt-6">
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Loading your caregiver overview…</p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <section className="mt-6">
        <PanelHeading
          kicker="caregiver"
          icon={<Users aria-hidden="true" className="size-5 shrink-0 text-primary" />}
          title="People you support"
        />
        {overview.blindUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one has listed you as a trusted contact yet. When a blind user adds your email as a trusted contact, they appear here.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {overview.blindUsers.map((u) => {
              const loc = locData[u.id];
              const expanded = expandedUserId === u.id;
              return (
                <Card key={u.id} className="flex flex-col">
                  <CardHeader>
                    <CardTitle className="text-lg">{u.fullName}</CardTitle>
                    <CardDescription className="break-all">{u.email}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{u.preferredLanguage}</Badge>
                      {loc && loc.consent && loc.journey && (
                        <Badge tone="success">
                          <MapPin aria-hidden="true" className="size-3.5 shrink-0" /> Live location
                        </Badge>
                      )}
                      {loc && loc.consent && !loc.journey && <Badge tone="warning">No active journey</Badge>}
                      {loc && !loc.consent && <Badge tone="danger">No location consent</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => toggleLocation(u.id)} aria-expanded={expanded}>
                        {expanded ? 'Hide location' : <><MapPin aria-hidden="true" className="size-4 shrink-0" /> Live location</>}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setSettingsUserId(settingsUserId === u.id ? null : u.id)}
                        aria-expanded={settingsUserId === u.id}
                      >
                        {settingsUserId === u.id ? 'Close settings' : <><Settings2 aria-hidden="true" className="size-4 shrink-0" /> Adjust settings</>}
                      </Button>
                    </div>
                    {settingsUserId === u.id && (
                      <WardSettingsPanel userId={u.id} wardName={u.fullName} announce={announce} />
                    )}
                    {expanded && (
                      <div className="flex flex-col">
                        {locLoading ? (
                          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Loading live location…</p>
                        ) : loc && loc.journey ? (
                          <>
                            <MapView
                              userLat={loc.journey.lastLat}
                              userLng={loc.journey.lastLng}
                              trail={loc.trail}
                              height="260px"
                            />
                            <p className="mt-2 text-sm text-muted-foreground">
                              {u.fullName} → {loc.journey.destination} · Last update {loc.journey.lastLocationAt ? new Date(loc.journey.lastLocationAt).toLocaleTimeString() : 'unknown'}
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {loc && !loc.consent
                              ? 'This user has not granted you live location access.'
                              : 'No active journey is sharing live location right now.'}
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-6">
        <PanelHeading
          kicker="assistance"
          icon={<Siren aria-hidden="true" className="size-5 shrink-0 text-destructive" />}
          title="Open SOS requests"
        />
        <Card>
          <CardContent className="pt-5">
            {overview.openAssistance.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">No open SOS requests right now.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {overview.openAssistance.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-muted/60 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{r.user.fullName} — {new Date(r.createdAt).toLocaleString()}</p>
                      <p className="text-sm text-muted-foreground">{r.message}{r.locationShare ? ' · location shared' : ''}</p>
                    </div>
                    <Badge tone="danger">OPEN</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <PanelHeading
          kicker="activity"
          icon={<Route aria-hidden="true" className="size-5 shrink-0 text-primary" />}
          title="Recent journeys"
        />
        <Card>
          <CardContent className="pt-5">
            {overview.recentJourneys.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">No recent journeys.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {overview.recentJourneys.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-muted/60 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{j.user.fullName} → {j.destination}</p>
                      <p className="text-sm text-muted-foreground">{new Date(j.startedAt).toLocaleString()} · {j.mode}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/** Toggle chip for a boolean ward preference: pressed state drives the variant
 *  so On/Off is conveyed visually and via aria-pressed. */
function WardToggle({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <Button variant={pressed ? 'secondary' : 'outline'} aria-pressed={pressed} onClick={onToggle}>
      {label}: {pressed ? 'On' : 'Off'}
    </Button>
  );
}

/** Remote-config panel: a caregiver adjusts the linked ward's accessibility
 *  settings from their own account. Scope is deliberately narrow — only the
 *  same accessibility fields the ward can change themselves; the AI key is
 *  surfaced read-only as hasKey and can never be read or replaced here. Every
 *  view and save is audit-logged server-side and the ward can revoke consent
 *  at any time from their contacts list. */
function WardSettingsPanel({ userId, wardName, announce }: { userId: string; wardName: string; announce: (message: string, tone?: Tone) => void }) {
  const [settings, setSettings] = useState<WardSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [draft, setDraft] = useState<WardPreferencesPatch>({});
  const [aiProvider, setAiProvider] = useState<'GEMINI' | 'OPENAI_COMPATIBLE'>('GEMINI');
  const [aiModel, setAiModel] = useState('');
  const [aiBaseUrl, setAiBaseUrl] = useState('');
  const [aiKey, setAiKey] = useState('');

  useEffect(() => {
    api
      .caregiverWardPreferences(userId)
      .then((s) => {
        setSettings(s);
        setDraft(s.preferences ? {
          speechRate: s.preferences.speechRate,
          voiceName: s.preferences.voiceName ?? undefined,
          instructionDetail: s.preferences.instructionDetail,
          vibrationEnabled: s.preferences.vibrationEnabled,
          audioEnabled: s.preferences.audioEnabled,
          reducedMotion: s.preferences.reducedMotion,
          textScale: s.preferences.textScale,
          lowConnectivityMode: s.preferences.lowConnectivityMode,
          imageRetentionHours: s.preferences.imageRetentionHours,
        } : {});
        setAiProvider(s.aiProvider.provider);
        setAiModel(s.aiProvider.model ?? '');
        setAiBaseUrl(s.aiProvider.baseUrl ?? '');
      })
      .catch(() => setLoadError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (loadError) {
    return <p className="text-sm font-medium text-destructive" role="status" aria-live="polite">Could not load settings. This user may not have granted you remote-care access.</p>;
  }
  if (!settings) {
    return <p className="text-sm text-muted-foreground" role="status" aria-live="polite">Loading settings…</p>;
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api.updateCaregiverWardPreferences(userId, draft);
      setSettings(res);
      setSavedAt(new Date().toLocaleTimeString());
      announce(`Settings for ${wardName} saved.`, 'online');
    } catch {
      announce('Could not save settings for this user.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function applyAiPreset(presetId: string) {
    const preset = FREE_MODEL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setAiProvider(preset.provider);
    setAiModel(preset.model);
    setAiBaseUrl(preset.baseUrl ?? '');
    announce(`${preset.label} selected for ${wardName}. ${preset.keyHint}`, 'online');
  }

  async function saveAiProvider() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.updateCaregiverWardPreferences(userId, {
        aiProvider: {
          provider: aiProvider,
          model: aiModel.trim() || null,
          baseUrl: aiProvider === 'OPENAI_COMPATIBLE' ? aiBaseUrl.trim() || null : null,
          ...(aiKey.trim() ? { apiKey: aiKey.trim() } : {}),
        },
      });
      setSettings(res);
      setAiKey('');
      setSavedAt(new Date().toLocaleTimeString());
      announce(`AI provider for ${wardName} saved. ${res.aiProvider.hasKey ? `Key on file ${res.aiProvider.maskedKey ?? ''}`.trim() : 'No key stored yet — AI will use the platform provider or demo mode.'}`, 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : `Could not save the AI provider for ${wardName}.`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removeAiKey() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.updateCaregiverWardPreferences(userId, {
        aiProvider: { provider: aiProvider, apiKey: null },
      });
      setSettings(res);
      setAiKey('');
      announce(`AI key removed for ${wardName}.`, 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : `Could not remove the AI key for ${wardName}.`, 'error');
    } finally {
      setSaving(false);
    }
  }

  const d = { ...(settings.preferences ?? {}), ...draft } as Partial<import('../api').AccessibilityPreferences> & WardPreferencesPatch;

  return (
    <div className="mt-1 flex flex-col gap-4 border-t border-foreground/15 pt-4">
      <p className="text-sm text-muted-foreground">
        Remote care for <strong className="font-semibold text-foreground">{settings.ward.fullName}</strong> · preferred language {settings.ward.preferredLanguage}.
        Every change below is logged, the AI key is never visible once saved (only a masked preview like ••1234), and{' '}
        {settings.ward.fullName.split(' ')[0] ?? 'this user'} can revoke access or change anything at any time.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <AudioLines aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Voice &amp; speech
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">Speech rate</span>
              {d.speechRate != null && <Badge tone="outline" className="tabular-nums">{Number(d.speechRate).toFixed(2)}x</Badge>}
            </div>
            <input
              type="range" min={0.5} max={2} step={0.05}
              aria-label={`${wardName} speech rate`}
              value={d.speechRate ?? 1}
              onChange={(e) => setDraft((p) => ({ ...p, speechRate: Number(e.target.value) }))}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">Instruction detail</span>
              {d.instructionDetail != null && <Badge tone="outline" className="tabular-nums">{Number(d.instructionDetail)}</Badge>}
            </div>
            <input
              type="range" min={1} max={3} step={1}
              aria-label={`${wardName} instruction detail level`}
              value={d.instructionDetail ?? 2}
              onChange={(e) => setDraft((p) => ({ ...p, instructionDetail: Number(e.target.value) }))}
            />
          </div>
          <Field label="Voice" htmlFor={`ward-voice-${userId}`}>
            <Input
              id={`ward-voice-${userId}`}
              type="text"
              aria-label={`${wardName} preferred voice name`}
              placeholder="Device default"
              value={d.voiceName ?? ''}
              onChange={(e) => setDraft((p) => ({ ...p, voiceName: e.target.value || undefined }))}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <WardToggle
              label="Audio descriptions"
              pressed={Boolean(d.audioEnabled)}
              onToggle={() => setDraft((p) => ({ ...p, audioEnabled: !p.audioEnabled }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <Monitor aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Display
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">Text scale</span>
              {d.textScale != null && <Badge tone="outline" className="tabular-nums">{Number(d.textScale).toFixed(2)}x</Badge>}
            </div>
            <input
              type="range" min={1} max={1.6} step={0.05}
              aria-label={`${wardName} text scale`}
              value={d.textScale ?? 1}
              onChange={(e) => setDraft((p) => ({ ...p, textScale: Number(e.target.value) }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <WardToggle
              label="Vibration cues"
              pressed={Boolean(d.vibrationEnabled)}
              onToggle={() => setDraft((p) => ({ ...p, vibrationEnabled: !p.vibrationEnabled }))}
            />
            <WardToggle
              label="Reduced motion"
              pressed={Boolean(d.reducedMotion)}
              onToggle={() => setDraft((p) => ({ ...p, reducedMotion: !p.reducedMotion }))}
            />
            <WardToggle
              label="Low-connectivity mode"
              pressed={Boolean(d.lowConnectivityMode)}
              onToggle={() => setDraft((p) => ({ ...p, lowConnectivityMode: !p.lowConnectivityMode }))}
            />
          </div>
        </CardContent>
        <CardFooter className="flex-wrap">
          <Button size="lg" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
          {savedAt && <Badge tone="success" role="status">Saved {savedAt}</Badge>}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <BrainCircuit aria-hidden="true" className="size-5 shrink-0 text-primary" />
            AI provider for {wardName}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Set up the AI that powers scene descriptions and answers for this user — for example a free Groq or Cerebras
            key. The key is stored encrypted and is never shown back; {settings.ward.fullName.split(' ')[0] ?? 'this user'}
            {' '}can change or remove it anytime in their own AI settings.
          </p>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-foreground">Free preset</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label={`Free model presets for ${wardName}`}>
              {FREE_MODEL_PRESETS.map((preset) => (
                <Button key={preset.id} variant="outline" size="md" onClick={() => applyAiPreset(preset.id)}>
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <Field label="Provider" htmlFor={`ward-ai-provider-${userId}`}>
            <Select
              id={`ward-ai-provider-${userId}`}
              value={aiProvider}
              onChange={(event) => setAiProvider(event.target.value === 'OPENAI_COMPATIBLE' ? 'OPENAI_COMPATIBLE' : 'GEMINI')}
              aria-label={`AI provider for ${wardName}`}
            >
              <option value="GEMINI">Google Gemini</option>
              <option value="OPENAI_COMPATIBLE">OpenAI-compatible (Groq, Cerebras, OpenRouter…)</option>
            </Select>
          </Field>
          <Field label="Model" htmlFor={`ward-ai-model-${userId}`}>
            <Input
              id={`ward-ai-model-${userId}`}
              type="text"
              value={aiModel}
              onChange={(event) => setAiModel(event.target.value)}
              placeholder={aiProvider === 'GEMINI' ? 'gemini-3.6-flash' : 'llama-3.3-70b-versatile'}
              aria-label={`AI model for ${wardName}`}
            />
          </Field>
          {aiProvider === 'OPENAI_COMPATIBLE' && (
            <Field label="API base URL" htmlFor={`ward-ai-base-url-${userId}`}>
              <Input
                id={`ward-ai-base-url-${userId}`}
                type="url"
                value={aiBaseUrl}
                onChange={(event) => setAiBaseUrl(event.target.value)}
                placeholder="https://api.groq.com/openai/v1"
                aria-label={`API base URL for ${wardName}`}
              />
            </Field>
          )}
          <Field label="API key" htmlFor={`ward-ai-key-${userId}`}>
            <Input
              id={`ward-ai-key-${userId}`}
              type="password"
              value={aiKey}
              onChange={(event) => setAiKey(event.target.value)}
              placeholder={settings.aiProvider.hasKey ? `Stored (${settings.aiProvider.maskedKey ?? 'saved'}) — type to replace` : 'Paste an API key'}
              aria-label={`API key for ${wardName}`}
              autoComplete="off"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={saving} onClick={saveAiProvider}>
              {saving ? 'Saving…' : 'Save AI provider'}
            </Button>
            {settings.aiProvider.hasKey && (
              <Button variant="ghost" disabled={saving} onClick={removeAiKey}>
                Remove key
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            AI provider currently: {settings.aiProvider.provider}
            {settings.aiProvider.model ? ` · ${settings.aiProvider.model}` : ''} ·{' '}
            {settings.aiProvider.hasKey ? `key on file ${settings.aiProvider.maskedKey ?? ''}`.trim() : 'no AI key yet (set one above, or the platform AI / demo mode applies)'}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
