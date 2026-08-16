const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000';
const TOKEN_KEY = 'watchora_token';
const REFRESH_KEY = 'watchora_refresh';
const USER_CACHE_KEY = 'watchora_user';

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: 'BLIND_USER' | 'CAREGIVER' | 'ADMIN';
  preferredLanguage: string;
};

export type TrustedContact = {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  email: string | null;
  canReceiveAlerts: boolean;
  canSeeLocation: boolean;
};

export type SavedPlace = {
  id: string;
  label: string;
  notes: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
};

export type IncidentReport = {
  id: string;
  category: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  createdAt: string;
  reporter: { fullName: string };
};

export type AssistanceRequest = {
  id: string;
  message: string;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'RESOLVED';
  locationShare: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

export type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: 'BLIND_USER' | 'CAREGIVER' | 'ADMIN';
  isActive: boolean;
  createdAt: string;
};

export type AdminIncident = IncidentReport & { reporter: { fullName: string; email: string } };

export type AdminAssistanceRequest = AssistanceRequest & { user: { fullName: string; email: string } };

export type AiStats = {
  total: number;
  successCount: number;
  failureCount: number;
  demoCount: number;
  liveCount: number;
  averageLatencyMs: number | null;
  byMode: Array<{ mode: string; count: number }>;
  recentErrors: Array<{ id: string; mode: string; errorMessage: string | null; createdAt: string }>;
};

export type AccessibilityPreferences = {
  id: string;
  speechRate: number;
  voiceName: string | null;
  instructionDetail: number;
  vibrationEnabled: boolean;
  audioEnabled: boolean;
  reducedMotion: boolean;
  textScale: number;
  lowConnectivityMode: boolean;
  imageRetentionHours: number;
};

export type ReadingEntry = {
  id: string;
  source: string;
  extractedText: string;
  language: string | null;
  createdAt: string;
};

export type ConsentGrant = {
  id: string;
  scope: 'LOCATION_SHARING' | 'TRUSTED_CONTACTS' | 'EMERGENCY_ALERTS' | 'ACTIVITY_HISTORY' | 'READING_HISTORY';
  grantedAt: string;
  revokedAt: string | null;
  metadata: Record<string, unknown> | null;
};

export type Journey = {
  id: string;
  destination: string;
  mode: string;
  startedAt: string;
  endedAt: string | null;
};

export type AuditLogRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: { email: string; fullName: string } | null;
};

export type CaregiverLiveLocation = {
  consent: boolean;
  journey: {
    id: string;
    destination: string;
    status: string;
    startedAt: string;
    eta: string | null;
    lastLat: number | null;
    lastLng: number | null;
    lastBearing: number | null;
    lastLocationAt: string | null;
  } | null;
  trail: Array<{ lat: number; lng: number; recordedAt: string }>;
};

export type CaregiverOverview = {
  caregiver: { id: string; email: string; fullName: string };
  contacts: Array<{ userId: string; name: string; relationship: string | null; canReceiveAlerts: boolean; canSeeLocation: boolean }>;
  blindUsers: Array<{ id: string; email: string; fullName: string; preferredLanguage: string }>;
  openAssistance: Array<AssistanceRequest & { user: { fullName: string; email: string } }>;
  recentJourneys: Array<{ id: string; destination: string; mode: string; startedAt: string; user: { fullName: string } }>;
  savedPlaces: Array<SavedPlace & { user: { fullName: string } }>;
};

export type PromptVersion = {
  id: string;
  mode: string;
  version: number;
  prompt: string;
  isActive: boolean;
  createdAt: string;
};

export type TtsVoice = {
  shortName: string;
  locale: string;
  language: string;
  native: string;
  gender: 'Male' | 'Female';
};

export type SafeJourney = {
  id: string;
  destination: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ESCALATED';
  startedAt: string;
  eta: string | null;
  checkInIntervalMinutes: number;
  shareLive: boolean;
  deviationThresholdMeters: number;
  trustedContactId: string | null;
  trustedContact: { id: string; name: string } | null;
  lastLat: number | null;
  lastLng: number | null;
  lastAccuracy: number | null;
  lastBearing: number | null;
  lastLocationAt: string | null;
  lastCheckInAt: string | null;
  promptCount: number;
  escalatedAt: string | null;
  safetyState: 'ok' | 'check-in-due';
  promptDue: boolean;
  missedArrival: boolean;
};

export type EmergencySession = {
  id: string;
  status: 'ACTIVE' | 'CANCELLED' | 'RESOLVED' | 'EXPIRED';
  triggeredAt: string;
  cancelledAt: string | null;
  resolvedAt: string | null;
  expiresAt: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  battery: number | null;
  heading: number | null;
  speed: number | null;
  mapsUrl: string | null;
  journeyId: string | null;
  acknowledgements: Array<{ id: string; acknowledgedAt: string; note: string | null }>;
};

export function localeFromVoice(shortName: string): string {
  const m = /^([a-z]{2}-[A-Z]{2})/.exec(shortName);
  return m?.[1] ?? 'en-US';
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

export function setSession(token: string, refreshToken: string) {
  setToken(token);
  setRefreshToken(refreshToken);
}

/**
 * Offline resilience (v0.5): the last-known user profile is kept in
 * localStorage so the app shell, local capabilities (OCR, hazard layer, saved
 * places, emergency info) and the dashboard still work while offline. It is
 * only a cache — permissions are still re-checked against the real browser
 * state on every session.
 */
export function getCachedUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  } catch {
    return null;
  }
}

export function setCachedUser(user: PublicUser) {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    // Storage full/unavailable: offline fallback silently unavailable.
  }
}

export function clearSession() {
  setToken(null);
  setRefreshToken(null);
  localStorage.removeItem(USER_CACHE_KEY);
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// One in-flight refresh at a time; returns true when a new access token landed.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token || !body.refreshToken) {
      clearSession();
      return false;
    }
    setSession(body.token, body.refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.headers) Object.assign(headers, options.headers);
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  // On 401, try a refresh once and retry the original request.
  if (response.status === 401 && !path.startsWith('/api/auth/')) {
    refreshing = refreshing ?? tryRefresh();
    const ok = await refreshing;
    refreshing = null;
    if (ok) return request<T>(path, options);
  }

  if (response.status === 204) return undefined as T;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(typeof body.error === 'string' ? body.error : `Request failed (${response.status})`, response.status);
  }
  return body as T;
}

export const api = {
  signup: (input: { email: string; password: string; fullName: string; role?: string }) =>
    request<{ token: string; refreshToken: string; user: PublicUser }>('/api/auth/signup', { method: 'POST', body: JSON.stringify(input) }),
  login: (input: { email: string; password: string }) =>
    request<{ token: string; refreshToken: string; user: PublicUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }),
  me: () => request<{ user: PublicUser }>('/api/auth/me'),
  logout: (refreshToken?: string) =>
    request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; devToken?: string }>('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean; token: string; refreshToken: string; user: PublicUser }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  listContacts: () => request<{ contacts: TrustedContact[] }>('/api/contacts'),
  createContact: (input: { name: string; relationship?: string; phone?: string; email?: string; canReceiveAlerts?: boolean; canSeeLocation?: boolean }) =>
    request<{ contact: TrustedContact }>('/api/contacts', { method: 'POST', body: JSON.stringify(input) }),
  updateContact: (id: string, input: { canSeeLocation?: boolean; canReceiveAlerts?: boolean }) =>
    request<{ contact: TrustedContact }>(`/api/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteContact: (id: string) => request<void>(`/api/contacts/${id}`, { method: 'DELETE' }),

  listPlaces: () => request<{ places: SavedPlace[] }>('/api/places'),
  createPlace: (input: { label: string; notes?: string; address?: string; latitude?: number; longitude?: number }) =>
    request<{ place: SavedPlace }>('/api/places', { method: 'POST', body: JSON.stringify(input) }),
  deletePlace: (id: string) => request<void>(`/api/places/${id}`, { method: 'DELETE' }),

  listIncidents: () => request<{ incidents: IncidentReport[] }>('/api/incidents'),
  createIncident: (input: { category: string; description: string; severity: IncidentReport['severity'] }) =>
    request<{ incident: IncidentReport }>('/api/incidents', { method: 'POST', body: JSON.stringify(input) }),
  deleteIncident: (id: string) => request<void>(`/api/incidents/${id}`, { method: 'DELETE' }),

  listAssistanceRequests: () => request<{ requests: AssistanceRequest[] }>('/api/assistance'),
  createAssistanceRequest: (input: { message: string; locationShare?: boolean }) =>
    request<{ request: AssistanceRequest }>('/api/assistance', { method: 'POST', body: JSON.stringify(input) }),
  resolveAssistanceRequest: (id: string) => request<{ request: AssistanceRequest }>(`/api/assistance/${id}/resolve`, { method: 'PATCH' }),

  adminListUsers: () => request<{ users: AdminUser[] }>('/api/admin/users'),
  adminSetUserRole: (id: string, role: AdminUser['role']) =>
    request<{ user: AdminUser }>(`/api/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  adminSetUserActive: (id: string, isActive: boolean) =>
    request<{ user: AdminUser }>(`/api/admin/users/${id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  adminListIncidents: () => request<{ incidents: AdminIncident[] }>('/api/admin/incidents'),
  adminDeleteIncident: (id: string) => request<void>(`/api/admin/incidents/${id}`, { method: 'DELETE' }),
  adminListAssistanceRequests: () => request<{ requests: AdminAssistanceRequest[] }>('/api/admin/assistance'),
  adminAiStats: () => request<AiStats>('/api/admin/ai-stats'),
  adminListAuditLogs: (limit = 100) => request<{ logs: AuditLogRow[] }>(`/api/audit-logs?limit=${limit}`),

  getPreferences: () => request<{ preferences: AccessibilityPreferences }>('/api/preferences'),
  updatePreferences: (input: Partial<Pick<AccessibilityPreferences, 'speechRate' | 'voiceName' | 'instructionDetail' | 'vibrationEnabled' | 'audioEnabled' | 'reducedMotion' | 'textScale' | 'lowConnectivityMode' | 'imageRetentionHours'>>) =>
    request<{ preferences: AccessibilityPreferences }>('/api/preferences', { method: 'PUT', body: JSON.stringify(input) }),

  listReadingEntries: () => request<{ entries: ReadingEntry[] }>('/api/reading-entries'),
  createReadingEntry: (input: { source: string; extractedText: string; language?: string }) =>
    request<{ entry: ReadingEntry }>('/api/reading-entries', { method: 'POST', body: JSON.stringify(input) }),
  deleteReadingEntry: (id: string) => request<void>(`/api/reading-entries/${id}`, { method: 'DELETE' }),

  listConsents: () => request<{ consents: ConsentGrant[] }>('/api/consents'),
  grantConsent: (input: { scope: ConsentGrant['scope']; metadata?: Record<string, unknown> }) =>
    request<{ consent: ConsentGrant }>('/api/consents', { method: 'POST', body: JSON.stringify(input) }),
  revokeConsent: (id: string) => request<{ consent: ConsentGrant }>(`/api/consents/${id}`, { method: 'DELETE' }),

  listJourneys: () => request<{ journeys: Journey[] }>('/api/journeys'),
  createJourney: (input: { destination: string; mode: Journey['mode'] }) =>
    request<{ journey: Journey }>('/api/journeys', { method: 'POST', body: JSON.stringify(input) }),

  caregiverOverview: () => request<CaregiverOverview>('/api/caregiver/overview'),

  adminListPrompts: () => request<{ prompts: PromptVersion[] }>('/api/admin/prompts'),
  adminCreatePrompt: (input: { mode: PromptVersion['mode']; prompt: string }) =>
    request<{ prompt: PromptVersion }>('/api/admin/prompts', { method: 'POST', body: JSON.stringify(input) }),
  adminActivatePrompt: (id: string) =>
    request<{ ok: boolean; prompt: PromptVersion }>(`/api/admin/prompts/${id}/activate`, { method: 'POST' }),
  adminSetIncidentStatus: (id: string, status: 'OPEN' | 'REVIEWED' | 'REMOVED') =>
    request<{ incident: IncidentReport }>(`/api/admin/incidents/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  ttsVoices: () => request<{ voices: TtsVoice[]; count: number }>('/api/tts/voices'),
  /** Synthesizes speech to a playable object URL (backend neural TTS). */
  ttsAudioUrl: async (text: string, voice: string, rate = 1): Promise<string> => {
    const token = getToken();
    const params = new URLSearchParams({ text, voice, rate: String(rate) });
    const res = await fetch(`${API_BASE_URL}/api/tts/audio?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError('Speech service unavailable', res.status);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  // ── Safe Journey (v0.3) ──
  startJourney: (input: {
    destination: string;
    eta?: string;
    trustedContactId?: string;
    checkInIntervalMinutes?: number;
    shareLive?: boolean;
    deviationThresholdMeters?: number;
  }) => request<{ journey: SafeJourney }>('/api/safe-journey', { method: 'POST', body: JSON.stringify(input) }),
  activeJourney: () => request<{ journey: SafeJourney | null }>('/api/safe-journey/active'),
  journeyLocation: (id: string, input: { lat: number; lng: number; accuracy?: number; heading?: number; speed?: number; battery?: number }) =>
    request<{ ok: boolean }>(`/api/safe-journey/${id}/location`, { method: 'POST', body: JSON.stringify(input) }),
  journeyDeviation: (id: string, currentLat: number, currentLng: number) =>
    request<{ ok: boolean; deviationMeters: number; threshold: number; action: 'none' | 'prompt' | 'escalate' }>(
      `/api/safe-journey/${id}/deviation`,
      { method: 'POST', body: JSON.stringify({ currentLat, currentLng }) },
    ),
  journeyCheckIn: (id: string) => request<{ journey: SafeJourney }>(`/api/safe-journey/${id}/check-in`, { method: 'POST' }),
  journeyLost: (id: string) => request<{ ok: boolean }>(`/api/safe-journey/${id}/lost`, { method: 'POST' }),
  endJourney: (id: string) => request<{ journey: SafeJourney }>(`/api/safe-journey/${id}/end`, { method: 'POST' }),
  journeyHistory: () => request<{ journeys: SafeJourney[] }>('/api/safe-journey/history'),

  // ── Emergency (v0.3) ──
  triggerEmergency: (input: {
    lat?: number;
    lng?: number;
    accuracy?: number;
    battery?: number;
    heading?: number;
    speed?: number;
    journeyId?: string;
    emergencyType?: string;
  }) => request<{ session: EmergencySession; cancelWindowSeconds: number }>('/api/emergency', { method: 'POST', body: JSON.stringify(input) }),
  cancelEmergency: (id: string) => request<{ session: EmergencySession }>(`/api/emergency/${id}/cancel`, { method: 'POST' }),
  emergencyLocation: (id: string, input: { lat: number; lng: number; accuracy?: number; battery?: number; heading?: number; speed?: number }) =>
    request<{ session: EmergencySession }>(`/api/emergency/${id}/location`, { method: 'POST', body: JSON.stringify(input) }),
  activeEmergency: () => request<{ session: EmergencySession | null }>('/api/emergency/active'),
  resolveEmergency: (id: string) => request<{ session: EmergencySession }>(`/api/emergency/${id}/resolve`, { method: 'POST' }),
  acknowledgeEmergency: (id: string) =>
    request<{ acknowledgement: { id: string; acknowledgedAt: string } }>(`/api/emergency/${id}/acknowledge`, { method: 'POST' }),


  // ── AI intent parsing (v0.4, server-side, key never exposed) ──
  aiIntent: (transcript: string) =>
    request<{ intent: string; parameters: Record<string, string | number | boolean>; confidence: number; requiresConfirmation: boolean }>(
      '/api/ai/intent',
      { method: 'POST', body: JSON.stringify({ transcript }) },
    ),

  // ── Caregiver live-location map (consent-gated) ──
  caregiverUserLocation: (userId: string) =>
    request<CaregiverLiveLocation>(`/api/caregiver/location/${userId}`),
};

export { ApiError };
