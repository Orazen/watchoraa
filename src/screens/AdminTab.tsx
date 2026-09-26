import { useEffect, useState } from 'react';
import { BrainCircuit, Megaphone, ScrollText, Siren, UsersRound } from 'lucide-react';
import {
  api,
  ApiError,
  type AdminAssistanceRequest,
  type AdminIncident,
  type AdminUser,
  type AiStats,
  type AuditLogRow,
  type PromptVersion,
} from '../api';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  Skeleton,
  Textarea,
} from '../components/ui';
import type { Tone } from './shared';

/** Small stat tile: muted label over a big display-serif number. Values are
 *  rendered exactly as the server reports them — no derived or invented data. */
function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card className="p-3.5">
      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold leading-none tabular-nums text-foreground">{value}</p>
    </Card>
  );
}

/** Loading placeholder row set. The role="status" aria-live="polite" wrapper is
 *  preserved from the previous markup; each Skeleton carries an honest
 *  aria-label so screen-reader users hear what is loading. */
function LoadingRows({ label, rows = 3, className }: { label: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={className ?? 'flex flex-col gap-2.5'}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" label={label} />
      ))}
    </div>
  );
}

/** Bordered list-row title row with the section's lucide icon, paired with
 *  visible text (icons are decorative and hidden from the a11y tree). */
function SectionCardTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2.5">
      {icon}
      {children}
    </CardTitle>
  );
}

export function AdminTab({ announce }: { announce: (message: string, tone?: Tone) => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [incidents, setIncidents] = useState<AdminIncident[] | null>(null);
  const [assistanceRequests, setAssistanceRequests] = useState<AdminAssistanceRequest[] | null>(null);
  const [aiStats, setAiStats] = useState<AiStats | null>(null);
  const [prompts, setPrompts] = useState<PromptVersion[] | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[] | null>(null);
  const [promptMode, setPromptMode] = useState<PromptVersion['mode']>('NAVIGATION');
  const [promptText, setPromptText] = useState('');
  const [section, setSection] = useState<'users' | 'incidents' | 'sos' | 'ai' | 'prompts' | 'audit'>('users');

  useEffect(() => {
    api
      .adminListUsers()
      .then((res) => setUsers(res.users))
      .catch(() => announce('Could not load users.', 'error'));
    api
      .adminListIncidents()
      .then((res) => setIncidents(res.incidents))
      .catch(() => announce('Could not load incidents.', 'error'));
    api
      .adminListAssistanceRequests()
      .then((res) => setAssistanceRequests(res.requests))
      .catch(() => announce('Could not load SOS requests.', 'error'));
    api
      .adminAiStats()
      .then(setAiStats)
      .catch(() => announce('Could not load AI usage stats.', 'error'));
    api
      .adminListPrompts()
      .then((res) => setPrompts(res.prompts))
      .catch(() => announce('Could not load prompts.', 'error'));
    api
      .adminListAuditLogs()
      .then((res) => setAuditLogs(res.logs))
      .catch(() => announce('Could not load audit logs.', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setRole(id: string, role: AdminUser['role']) {
    try {
      const { user } = await api.adminSetUserRole(id, role);
      setUsers((prev) => (prev ?? []).map((u) => (u.id === id ? user : u)));
      announce('Role updated.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not update role.', 'error');
    }
  }

  async function setActive(id: string, isActive: boolean) {
    try {
      const { user } = await api.adminSetUserActive(id, isActive);
      setUsers((prev) => (prev ?? []).map((u) => (u.id === id ? user : u)));
      announce(isActive ? 'User reactivated.' : 'User deactivated.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not update user.', 'error');
    }
  }

  async function removeIncident(id: string) {
    try {
      await api.adminDeleteIncident(id);
      setIncidents((prev) => (prev ?? []).filter((i) => i.id !== id));
      announce('Incident removed.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not remove incident.', 'error');
    }
  }

  async function setIncidentStatus(id: string, status: 'OPEN' | 'REVIEWED' | 'REMOVED') {
    try {
      await api.adminSetIncidentStatus(id, status);
      announce(`Incident marked ${status.toLowerCase()}.`, 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not update incident status.', 'error');
    }
  }

  async function createPrompt() {
    if (!promptText.trim()) {
      announce('Enter a prompt first.', 'warning');
      return;
    }
    try {
      await api.adminCreatePrompt({ mode: promptMode, prompt: promptText.trim() });
      setPromptText('');
      const res = await api.adminListPrompts();
      setPrompts(res.prompts);
      announce('Prompt version created.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not create prompt.', 'error');
    }
  }

  async function activatePrompt(id: string) {
    try {
      await api.adminActivatePrompt(id);
      const res = await api.adminListPrompts();
      setPrompts(res.prompts);
      announce('Prompt activated.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not activate prompt.', 'error');
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <section className="mt-6">
        <div className="mb-4">
          <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Moderation</p>
          <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight text-foreground">Admin</h2>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
          {(['users', 'incidents', 'sos', 'ai', 'prompts', 'audit'] as const).map((key) => (
            <Button
              key={key}
              role="tab"
              aria-selected={section === key}
              variant={section === key ? 'secondary' : 'ghost'}
              onClick={() => setSection(key)}
            >
              {key === 'users'
                ? 'Users'
                : key === 'incidents'
                  ? 'Incidents'
                  : key === 'sos'
                    ? 'SOS'
                    : key === 'ai'
                      ? 'AI usage'
                      : key === 'prompts'
                        ? 'Prompts'
                        : 'Audit'}
            </Button>
          ))}
        </div>
      </section>

      {section === 'users' && (
        <section className="mt-6">
          <Card>
            <CardHeader>
              <SectionCardTitle icon={<UsersRound aria-hidden="true" className="size-5 shrink-0 text-primary" />}>
                Users
              </SectionCardTitle>
              <CardDescription>Roles and account status for everyone on the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              {users === null ? (
                <LoadingRows label="Loading users…" />
              ) : users.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  No users found.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-foreground/10">
                  {users.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{u.fullName}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {u.email} · {u.isActive ? 'Active' : 'Deactivated'}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Select
                          className="w-auto"
                          aria-label={`Role for ${u.fullName}`}
                          value={u.role}
                          onChange={(event) => setRole(u.id, event.target.value as AdminUser['role'])}
                        >
                          <option value="BLIND_USER">Blind user</option>
                          <option value="CAREGIVER">Caregiver</option>
                          <option value="ADMIN">Admin</option>
                        </Select>
                        <Button variant="outline" onClick={() => setActive(u.id, !u.isActive)}>
                          {u.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {section === 'incidents' && (
        <section className="mt-6">
          <Card>
            <CardHeader>
              <SectionCardTitle icon={<Megaphone aria-hidden="true" className="size-5 shrink-0 text-primary" />}>
                Incidents
              </SectionCardTitle>
              <CardDescription>Journey incidents reported by users, newest moderation surface first.</CardDescription>
            </CardHeader>
            <CardContent>
              {incidents === null ? (
                <LoadingRows label="Loading incidents…" />
              ) : incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  No incidents reported.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-foreground/10">
                  {incidents.map((incident) => (
                    <li key={incident.id} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{incident.category}</span>
                        <Badge tone="neutral">{incident.severity}</Badge>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground">{incident.description}</p>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm text-muted-foreground">
                          {incident.reporter.fullName} ({incident.reporter.email})
                        </span>
                        <Button variant="destructive" onClick={() => removeIncident(incident.id)}>
                          Remove
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {section === 'sos' && (
        <section className="mt-6">
          <Card>
            <CardHeader>
              <SectionCardTitle icon={<Siren aria-hidden="true" className="size-5 shrink-0 text-destructive" />}>
                SOS
              </SectionCardTitle>
              <CardDescription>Assistance requests raised from the SOS button.</CardDescription>
            </CardHeader>
            <CardContent>
              {assistanceRequests === null ? (
                <LoadingRows label="Loading SOS requests…" />
              ) : assistanceRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  No assistance requests.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-foreground/10">
                  {assistanceRequests.map((req) => (
                    <li key={req.id} className="flex flex-col gap-1.5 py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 text-sm text-foreground">
                          <strong className="font-semibold">{req.user.fullName}</strong> ({req.user.email}) —{' '}
                          {new Date(req.createdAt).toLocaleString()}
                        </span>
                        <Badge tone={req.status === 'RESOLVED' ? 'success' : 'danger'}>{req.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{req.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {section === 'ai' && (
        <section className="mt-6">
          <Card>
            <CardHeader>
              <SectionCardTitle icon={<BrainCircuit aria-hidden="true" className="size-5 shrink-0 text-primary" />}>
                AI usage
              </SectionCardTitle>
              <CardDescription>Platform-wide request volume, success and latency, live vs demo.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {aiStats === null ? (
                <div role="status" aria-live="polite" className="grid grid-cols-2 gap-3">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} className="h-24" label="Loading AI usage stats…" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <StatCard label="Total requests" value={aiStats.total} />
                    <StatCard
                      label="Success rate"
                      value={`${aiStats.total ? Math.round((aiStats.successCount / aiStats.total) * 100) : 0}%`}
                    />
                    <StatCard label="Live vs demo" value={`${aiStats.liveCount} / ${aiStats.demoCount}`} />
                    <StatCard label="Avg latency" value={`${aiStats.averageLatencyMs ?? '—'} ms`} />
                  </div>
                  <div>
                    <h4 className="font-display text-lg font-semibold tracking-tight text-foreground">By mode</h4>
                    <ul className="mt-2 flex flex-col divide-y divide-foreground/10">
                      {aiStats.byMode.map((entry) => (
                        <li key={entry.mode} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                          <span className="text-sm text-foreground">{entry.mode}</span>
                          <span className="font-display text-lg font-semibold tabular-nums text-foreground">{entry.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {aiStats.recentErrors.length > 0 ? (
                    <div>
                      <h4 className="font-display text-lg font-semibold tracking-tight text-foreground">Recent errors</h4>
                      <ul className="mt-2 flex flex-col divide-y divide-foreground/10">
                        {aiStats.recentErrors.map((err) => (
                          <li
                            key={err.id}
                            className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="font-mono text-sm text-muted-foreground">
                              {err.mode} · {new Date(err.createdAt).toLocaleString()}
                            </span>
                            <span className="min-w-0 text-sm text-destructive">{err.errorMessage}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {section === 'prompts' && (
        <section className="mt-6">
          <Card>
            <CardHeader>
              <SectionCardTitle icon={<ScrollText aria-hidden="true" className="size-5 shrink-0 text-primary" />}>
                Prompt versions
              </SectionCardTitle>
              <CardDescription>
                Active prompts are used by /api/ai/generate for their mode. Safety teams can tune each mode and activate a
                version.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-foreground">Mode</span>
                  <Select
                    aria-label="Mode"
                    value={promptMode}
                    onChange={(event) => setPromptMode(event.target.value as PromptVersion['mode'])}
                  >
                    <option value="NAVIGATION">Navigation</option>
                    <option value="ENVIRONMENT">Environment</option>
                    <option value="READING">Reading</option>
                    <option value="ASSISTANT">Assistant</option>
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-foreground">Prompt</span>
                  <Textarea
                    aria-label="Prompt"
                    rows={5}
                    value={promptText}
                    onChange={(event) => setPromptText(event.target.value)}
                    placeholder="Write the system prompt for this mode…"
                  />
                </label>
                <div>
                  <Button onClick={createPrompt}>Create version</Button>
                </div>
              </div>
              {prompts === null ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  Loading…
                </p>
              ) : prompts.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  No prompt versions yet. Create one above.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-foreground/10">
                  {prompts.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                          {p.mode} v{p.version} {p.isActive ? <Badge tone="success">ACTIVE</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {p.prompt.slice(0, 120)}
                          {p.prompt.length > 120 ? '…' : ''}
                        </p>
                      </div>
                      {!p.isActive && (
                        <Button variant="secondary" onClick={() => activatePrompt(p.id)}>
                          Activate
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {section === 'audit' && (
        <section className="mt-6">
          <Card>
            <CardHeader>
              <SectionCardTitle icon={<ScrollText aria-hidden="true" className="size-5 shrink-0 text-primary" />}>
                Audit log
              </SectionCardTitle>
              <CardDescription>Recorded administrative and caregiver actions across the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              {auditLogs === null ? (
                <LoadingRows label="Loading audit logs…" rows={5} />
              ) : auditLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                  No audit entries yet.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-foreground/10">
                  {auditLogs.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Badge tone="outline">{row.action}</Badge>
                        <span className="min-w-0 truncate text-sm text-muted-foreground">
                          {row.entityType}
                          {row.entityId ? ` · ${row.entityId}` : ''}
                          {row.actor ? ` · ${row.actor.email}` : ''}
                        </span>
                      </div>
                      <span className="font-mono text-sm text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
