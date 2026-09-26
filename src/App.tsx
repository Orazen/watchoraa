import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, getToken, getRefreshToken, setSession, clearSession, setToken, localeFromVoice, getCachedUser, setCachedUser } from './api';
import { scanBarcode, cachedProduct, rememberProduct, formatProductSpeech, type ScanHandle } from './barcode/productScan';
import type {
  AssistanceRequest,
  ConsentGrant,
  EmergencySession,
  IncidentReport,
  PublicUser,
  ReadingEntry,
  SavedPlace,
  TrustedContact,
  TtsVoice,
} from './api';
import { useHazardDetection } from './useHazardDetection';
import { summarizeEnvironment, describeEnvironment, detectionGroundingPrompt, type PlaceContext } from './environment';
import { useNavigationCoach } from './navigation/useNavigationCoach';
import { useDeviceMotion } from './navigation/useDeviceMotion';
import { playDirectionalCue } from './navigation/spatialAudio';
import type { CoachDetection, CoachMode } from './navigation/navigationCoach';
import { fireHapticEvent, type HapticSettings } from './haptics';
import { useDepthSafety, depthAlertSpeech, type DepthAlert } from './useDepthSafety';
import { getCurrentPosition, describePlaceAsSpoken, distanceMeters, type Coordinates } from './geo';
import { recognizeText, OCR_FALLBACK_CONFIDENCE_THRESHOLD } from './ocr';
import { SpeechPriorityManager, type SpeechPriority } from './speechPriority';
import { LiveAnnouncer, useLiveAnnouncer } from './accessibility/LiveAnnouncer';
import { PermissionOnboarding, type OnboardingResult } from './permissions/PermissionOnboarding';
import { PermissionCenter } from './permissions/PermissionCenter';
import { VoiceAssistantProvider, useVoiceAssistant } from './voice/VoiceAssistantProvider';
import type { VoiceSettings } from './voice/voiceTypes';
import { VoiceFirstDashboard, type DashboardTab } from './pages/VoiceFirstDashboard';
import type { EmergencyStatus } from './components/EmergencyControl';
import { PermissionSettings } from './pages/PermissionSettings';

import type { VoiceIntent } from './voice/voiceTypes';
import { HELP_MESSAGE } from './voice/voiceTypes';
import type { VoiceBridge } from './VoiceFirstShell';
import { LandingPage } from './LandingPage';
import { VoiceFirstShell, createVoiceBridge, usePermissionService } from './VoiceFirstShell';
import { getVoiceTestPhrase, getStepSpeech, getPhoneticFallback } from './voice/voicePhrases';

import { AuthScreen } from './screens/AuthScreen';
import { PlacesTab } from './screens/PlacesTab';
import { SosTab } from './screens/SosTab';
import { CommunityTab } from './screens/CommunityTab';
import { CaregiverTab } from './screens/CaregiverPanel';
import { SafeJourneyTab } from './screens/SafeJourneyTab';
import { SettingsTab } from './screens/SettingsTab';
import { AdminTab } from './screens/AdminTab';
import type { Tone } from './screens/shared';
import { Home, ScanEye, MapPin, Route, Siren, Users, HeartHandshake, Settings, Wrench, type LucideIcon } from 'lucide-react';
import { buttonVariants } from './components/ui';
type TabKey = 'home' | 'tracking' | 'routes' | 'journey' | 'sos' | 'community' | 'caregiver' | 'settings' | 'admin';

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const tabs: Array<{ key: TabKey; label: string; icon: LucideIcon; note: string }> = [
  { key: 'home', label: 'Home', icon: Home, note: 'Command centre' },
  { key: 'tracking', label: 'Assist', icon: ScanEye, note: 'Camera + voice' },
  { key: 'routes', label: 'Places', icon: MapPin, note: 'Saved places' },
  { key: 'journey', label: 'Safe Journey', icon: Route, note: 'Safety monitoring' },
  { key: 'sos', label: 'SOS', icon: Siren, note: 'Emergency' },
  { key: 'community', label: 'Community', icon: Users, note: 'Reports' },
  { key: 'caregiver', label: 'Caregiver', icon: HeartHandshake, note: 'People you support' },
  { key: 'settings', label: 'Settings', icon: Settings, note: 'Voice and account' },
  { key: 'admin', label: 'Admin', icon: Wrench, note: 'Operations' },
];

/** Width (px) at which the shell swaps the sidebar for the fixed bottom bar.
 *  Must stay identical to the `max-width: 720px` breakpoint in styles.css:
 *  `.sidebar { display: none }` and `.bottom-nav { display: block }` are both
 *  declared inside that one media query (styles.css:1193 and styles.css:1207),
 *  so at every viewport exactly one of the two nav surfaces is rendered. */
const COMPACT_NAV_MEDIA = '(max-width: 720px)';

/** True when the bottom bar is the visible navigation surface.
 *
 *  The nine tabs are rendered twice — once in `.sidebar`, once in `.bottom-nav`
 *  — because the responsive layout needs both. `display: none` already takes the
 *  inactive one out of the accessibility tree and out of the tab order, so the
 *  *rendered* duplication is handled by CSS alone; a
 *  `document.querySelectorAll('[role="tablist"]').length === 2` count measures
 *  DOM nodes, not accessibility-tree nodes, and so does not show a
 *  duplication a screen reader would ever walk.
 *
 *  This hook states the same invariant in React anyway. The app is a PWA whose
 *  service worker precaches the hashed Vite bundle (public/sw.js), so a deploy
 *  can briefly serve a new JS bundle against a stale stylesheet; when that
 *  happens `display: none` stops doing its job and all eighteen tabs become
 *  reachable. `aria-hidden` here makes that failure mode impossible rather than
 *  merely unlikely. matchMedia is used rather than a resize listener because the
 *  breakpoint is a media query, so this is the same signal with no layout
 *  thrash. */
function useCompactNav(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_NAV_MEDIA).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(COMPACT_NAV_MEDIA);
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    // Re-sync on mount: the initial state was read during the first render,
    // which on a slow first paint can predate a real layout.
    setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return compact;
}

type AnalysisMode = 'navigation' | 'assistant' | 'reading' | 'environment';

type AiResult = {
  mode: AnalysisMode;
  summary: string;
  details: string[];
  warnings: string[];
  confidence: 'low' | 'medium' | 'high';
  shouldStop: boolean;
  demo: boolean;
  // Where this result actually came from — surfaced in the UI so "local OCR" is
  // never mislabeled as "Gemini live" (a real bug caught during live verification
  // of Phase B: the source pill previously only checked `demo`, which is false
  // for both a genuine Gemini call and a local Tesseract.js read).
  source: 'gemini' | 'local-ocr' | 'ai-ocr' | 'your-ai-key';
};

const ANALYSIS_TIMEOUT_MS = 20_000;

// One-tap audio unlock payload: a 60 ms silent WAV played from inside a real
// user gesture. iOS/Safari/WebView autoplay policy then keeps this single
// persistent <audio> element unlocked for every later programmatic play
// (swapping .src does not re-lock it), which is what makes neural TTS audible.
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRuQDAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YcADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const analysisModes: Array<{ key: AnalysisMode; label: string }> = [
  { key: 'navigation', label: 'Navigation' },
  { key: 'environment', label: 'Environment' },
  { key: 'reading', label: 'Reading' },
  { key: 'assistant', label: 'Assistant' },
];

function compressImage(canvas: HTMLCanvasElement, maxDimension = 1280, quality = 0.8): string {
  const { width, height } = canvas;
  const scale = Math.min(1, maxDimension / Math.max(width, height));

  if (scale >= 1) {
    return canvas.toDataURL('image/jpeg', quality);
  }

  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = Math.round(width * scale);
  scaledCanvas.height = Math.round(height * scale);
  const context = scaledCanvas.getContext('2d');
  if (!context) return canvas.toDataURL('image/jpeg', quality);

  context.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
  return scaledCanvas.toDataURL('image/jpeg', quality);
}

function App() {
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const voiceBridge = useRef(createVoiceBridge());

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api
      .me()
      .then(({ user }) => {
        setCachedUser(user);
        setCurrentUser(user);
      })
      .catch(() => {
        // Offline or server unreachable: keep the last-known session so the
        // shell, dashboard, and local capabilities (OCR, hazard layer, saved
        // places, emergency info) still work. The token stays in place so the
        // session refreshes the moment connectivity returns. A real 401 already
        // cleared the session in the request layer before reaching here.
        const cached = getCachedUser();
        if (cached) {
          setCurrentUser(cached);
        } else {
          clearSession();
        }
      })
      .finally(() => setAuthChecked(true));
  }, []);

  function handleLogout() {
    // Best-effort server-side revoke of the refresh token, then clear locally.
    api.logout(getRefreshToken() ?? undefined).catch(() => {});
    clearSession();
    setCurrentUser(null);
  }

  // Cold start. This used to `return null`, which left the document with no
  // <main>, no landmark, no heading and no text while the session check ran.
  // A screen-reader user launching the installed PWA got a silent, structureless
  // page and had no way to tell "still starting" from "failed to launch" from
  // "signed out". A live region plus a real heading gives the wait an identity.
  if (!authChecked) {
    return (
      <div className="app-loading" role="status" aria-live="polite">
        <h1>Watchora</h1>
        <p>Starting up. Checking your session.</p>
      </div>
    );
  }

  if (!currentUser) {
    // Logged-out front door: the landing page IS the index route. The existing
    // AuthScreen dialog opens on top when someone chooses to sign in / sign up,
    // instead of being the first thing a visitor sees.
    return (
      <>
        <LandingPage
          onSignIn={() => {
            setAuthMode('login');
            setAuthOpen(true);
          }}
          onSignUp={() => {
            setAuthMode('signup');
            setAuthOpen(true);
          }}
        />
        {authOpen ? (
          <AuthScreen
            initialMode={authMode}
            onAuthenticated={(user) => {
              setAuthOpen(false);
              setCachedUser(user);
              setCurrentUser(user);
            }}
            onClose={() => setAuthOpen(false)}
          />
        ) : null}
      </>
    );
  }

  return (
    <VoiceFirstShell bridge={voiceBridge}>
      <MainApp user={currentUser} onLogout={handleLogout} voiceBridge={voiceBridge} />
    </VoiceFirstShell>
  );
}

function MainApp({
  user,
  onLogout,
  voiceBridge,
}: {
  user: PublicUser;
  onLogout: () => void;
  voiceBridge: { current: VoiceBridge };
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const permissionService = usePermissionService();
  const voiceAssistant = useVoiceAssistant();
  const [showPermissions, setShowPermissions] = useState(false);
  const [statusMessage, setStatusMessage] = useState(`Signed in as ${user.fullName}`);
  const [statusTone, setStatusTone] = useState<Tone>('online');
  const [prompt, setPrompt] = useState('Describe the environment in front of me and warn about obstacles.');
  const [response, setResponse] = useState('Live camera output will appear here.');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('navigation');
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [voiceRate, setVoiceRate] = useState(1.05);
  const [language, setLanguage] = useState('English');
  const [voice, setVoice] = useState('en-US-JennyNeural');
  // Mirrors for the speech manager: it is created once, so its play closure
  // reads the ref instead of the render-scoped state (which would freeze at
  // first-render values forever).
  const voiceRateRef = useRef(voiceRate);
  const voiceRef = useRef(voice);
  voiceRateRef.current = voiceRate;
  voiceRef.current = voice;
  const [voices, setVoices] = useState<TtsVoice[] | null>(null);
  const [themeMode, setThemeMode] = useState<'Light' | 'Dark'>('Light');
  const [hazardLayerEnabled, setHazardLayerEnabled] = useState(true);
  // Vision coaching mode (v0.5): proactive, deterministic navigation/reading/
  // exploration/shopping guidance layered on the local hazard detections.
  const [coachMode, setCoachMode] = useState<CoachMode>('off');
  // True while hazard/emergency speech is in the air — drives the red orb.
  const [hazardActive, setHazardActive] = useState(false);
  const [hapticSettings, setHapticSettings] = useState<HapticSettings>({
    hapticsEnabled: true,
    toneEnabled: true,
    intensity: 'medium',
  });

  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  const [contacts, setContacts] = useState<TrustedContact[] | null>(null);
  const [incidents, setIncidents] = useState<IncidentReport[] | null>(null);
  const [assistanceRequests, setAssistanceRequests] = useState<AssistanceRequest[] | null>(null);
  const [readingEntries, setReadingEntries] = useState<ReadingEntry[] | null>(null);
  // Real emergency + journey state for the Home dashboard cards — refetched
  // every time Home opens so SOS/journey tab actions are reflected there.
  const [homeEmergency, setHomeEmergency] = useState<EmergencyStatus>({ state: 'idle' });
  const [homeJourney, setHomeJourney] = useState<{ destination: string; status: string } | null>(null);
  const prefsLoadedRef = useRef(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const onboardingKey = `watchora_onboarding_${user.id}`;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const speechLockRef = useRef(false);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsUrlRef = useRef<string | null>(null);
  // Persistent, gesture-unlocked audio element. Created once; every TTS play
  // reuses it so the browser's autoplay policy never blocks playback after
  // the initial user gesture unlocked it.
  const ttsElementRef = useRef<HTMLAudioElement | null>(null);
  const ttsUnlockRef = useRef(false);
  const speakSeqRef = useRef(0);
  // Active barcode scan (so a new scan stops the previous loop).
  const productScanRef = useRef<ScanHandle | null>(null);
  const speechManagerRef = useRef<SpeechPriorityManager | null>(null);
  const lastSpokenRef = useRef('');
  // Tracks how many utterances are currently playing so the voice provider
  // can pause mic recognition while Watchora itself is talking (its own
  // voice in the mic would otherwise trigger spurious wake phrases/loops).
  const speechActiveCountRef = useRef(0);
  // Tracks the in-flight speechSynthesis fallback utterance so its release
  // (real end event or the bound-pause timer) can't touch a newer one.
  const fallbackUtterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const fallbackEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setSpeechActive(on: boolean) {
    if (on) speechActiveCountRef.current += 1;
    else speechActiveCountRef.current = Math.max(0, speechActiveCountRef.current - 1);
    voiceBridge.current.onSpeechChange?.(speechActiveCountRef.current > 0);
  }

  // Reuse ONE audio element for every utterance. A fresh `new Audio()` created
  // after an async TTS fetch is never gesture-bound, so iOS/Safari/WebView
  // autoplay policy rejects play() and the user hears nothing. The unlock
  // effect below plays this element once inside a real user gesture; after
  // that, swapping .src on it stays unlocked for the session.
  function getTtsElement(): HTMLAudioElement {
    if (!ttsElementRef.current) {
      ttsElementRef.current = new Audio();
      ttsElementRef.current.preload = 'auto';
    }
    return ttsElementRef.current;
  }

  // Priority-aware speech: danger/emergency interrupts anything lower.
  // voice/voiceRate live in refs so the once-created manager never speaks with
  // stale settings — settings changes must apply to the very next utterance.
  function speakWithPriority(text: string, priority: SpeechPriority = 5, dedupeKey?: string, rateOverride?: number, cooldownMs?: number) {
    if (!speechManagerRef.current) {
      speechManagerRef.current = new SpeechPriorityManager({
        play: (t, p, customRate) => {
          stopSpeaking();
          const seq = ++speakSeqRef.current;
          const locale = localeFromVoice(voiceRef.current);
          const effectiveRate = customRate ?? voiceRateRef.current;
          api
            .ttsAudioUrl(t, voiceRef.current, effectiveRate)
            .then((url) => {
              if (seq !== speakSeqRef.current) {
                URL.revokeObjectURL(url);
                return;
              }
              ttsUrlRef.current = url;
              const audio = getTtsElement();
              audio.src = url;
              ttsAudioRef.current = audio;
              audio.playbackRate = 1.0;
              // Recognition must pause while we talk: the mic would hear our
              // own voice and could loop. Signal both edges here.
              audio.onplay = () => setSpeechActive(true);
              audio.onended = () => {
                if (ttsAudioRef.current === audio) ttsAudioRef.current = null;
                if (ttsUrlRef.current) {
                  URL.revokeObjectURL(ttsUrlRef.current);
                  ttsUrlRef.current = null;
                }
                setSpeechActive(false);
                fallbackSpeak(t, locale, effectiveRate);
                speechManagerRef.current?.onEnded();
              };
              audio.onerror = () => {
                if (ttsAudioRef.current === audio) ttsAudioRef.current = null;
                if (ttsUrlRef.current) {
                  URL.revokeObjectURL(ttsUrlRef.current);
                  ttsUrlRef.current = null;
                }
                setSpeechActive(false);
                fallbackSpeak(t, locale, effectiveRate);
                speechManagerRef.current?.onEnded();
              };
              audio.play().catch(() => {
                if (ttsAudioRef.current === audio) ttsAudioRef.current = null;
                if (ttsUrlRef.current) {
                  URL.revokeObjectURL(ttsUrlRef.current);
                  ttsUrlRef.current = null;
                }
                fallbackSpeak(t, locale, effectiveRate);
                setSpeechActive(false);
                speechManagerRef.current?.onEnded();
              });
            })
            .catch(() => {
              if (seq !== speakSeqRef.current) return;
              fallbackSpeak(t, locale, effectiveRate);
              speechManagerRef.current?.onEnded();
            });
        },
        stop: () => stopSpeaking(),
        verbosity: voiceAssistant.settings.verbosity,
      });
    }
    speechManagerRef.current.speak({ text, priority, dedupeKey, rate: rateOverride, cooldownMs });
  }

  // Same fallback contract as api.ts: same-origin when deployed, localhost
  // only when actually running on a dev machine (never in a production build).
  const isDevHost = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? (isDevHost ? 'http://127.0.0.1:4000' : '');

  // Phase A: local, low-latency hazard detection (YOLOv8n via onnxruntime-web, in a
  // Web Worker). Runs continuously while the camera is on, independent of the
  // on-demand Gemini "Capture & analyze" flow — see docs/yolo-ocr-slam-plan.md.
  //
  // Ambient environment approximator (researched vs Seeing AI/Envision/Wayfindr
  // ITU-T F.921, 2026-09): when new objects cross the tracker's confirmation
  // gate, speak ONE short deterministic sentence (≤ ~25 words) describing the
  // scene approximately — no cloud call, no per-object spam. Rate-limited to
  // one callout per 25s, deduped by identical summary, and gated by verbosity
  // (Essential mode keeps only hazard/emergency speech; Standard/Detailed get
  // the ambient description). Place context comes from a cached reverse
  // geocode refreshed at most every 2 minutes while the camera runs.
  const ambientEnvRef = useRef<{ lastSpokenAt: number; lastSummary: string; place: PlaceContext | null; placeFetchedAt: number }>({
    lastSpokenAt: 0,
    lastSummary: '',
    place: null,
    placeFetchedAt: 0,
  });
  const ambientVerbosityRef = useRef(voiceAssistant.settings.verbosity);
  ambientVerbosityRef.current = voiceAssistant.settings.verbosity;
  const speakRef = useRef(speak);
  speakRef.current = speak;

  const fetchAmbientPlaceContext = useCallback(async () => {
    const cache = ambientEnvRef.current;
    if (Date.now() - cache.placeFetchedAt < 120_000) return cache.place;
    try {
      const coords = await getCurrentPosition(6000);
      const place = await api.reverseGeocode(coords.latitude, coords.longitude).catch(() => null);
      cache.place = place ? { road: place.road, city: place.city, suburb: place.suburb, name: place.name, addresstype: place.addresstype } : null;
    } catch {
      cache.place = null; // indoors / no GPS — object-based inference still works
    }
    cache.placeFetchedAt = Date.now();
    return cache.place;
  }, []);

  const onConfirmedDetections = useCallback(
    (confirmed: Array<{ className: string; confidence: number; bearingClock: number }>) => {
      const now = Date.now();
      const cache = ambientEnvRef.current;
      const verbosity = ambientVerbosityRef.current;
      if (verbosity === 0) return; // Essential: hazards only
      if (now - cache.lastSpokenAt < 25_000) return; // anti-spam cadence
      const summary = summarizeEnvironment({ detections: confirmed, place: cache.place });
      if (summary === cache.lastSummary) return; // nothing new to say
      cache.lastSpokenAt = now;
      cache.lastSummary = summary;
      speakRef.current(summary, 4, 'ambient-env');
      // Refresh place context opportunistically after speaking, not blocking.
      void fetchAmbientPlaceContext();
    },
    [fetchAmbientPlaceContext],
  );

  const hazardState = useHazardDetection(videoRef, cameraActive && hazardLayerEnabled, hapticSettings, onConfirmedDetections);

  // Depth safety layer (Eyeris-inspired): on-device monocular depth catches
  // close surfaces YOLO cannot classify — walls, poles, overhangs. Runs at
  // its own ~4s cadence when the camera is on; alerts speak at priority 2.
  const onDepthAlert = useCallback((alert: DepthAlert) => {
    const text = depthAlertSpeech(alert);
    if (alert.level === 'very-close') fireHapticEvent('hazard-immediate', hapticSettings);
    else fireHapticEvent('hazard-nearby', hapticSettings);
    speak(text, 2, `depth-${alert.zone}-${alert.level}`);
  }, [hapticSettings, speak]);
  const depthSafety = useDepthSafety(cameraActive && hazardLayerEnabled, onDepthAlert, hapticSettings);
  useEffect(() => {
    if (!cameraActive || !hazardLayerEnabled || depthSafety.status !== 'running') return;
    const t = setInterval(() => {
      depthSafety.submitFrame(videoRef.current);
    }, 4000);
    return () => clearInterval(t);
  }, [cameraActive, hazardLayerEnabled, depthSafety.status, depthSafety.submitFrame]);

  // Home dashboard reflects REAL emergency/journey state: refetched whenever
  // the Home tab opens (SOS and Safe Journey tabs mutate their own state, so
  // this is the honest sync point). Silent catch — absence of data renders
  // the same idle cards as before, never a fake "active" state.
  useEffect(() => {
    if (activeTab !== 'home') return;
    api
      .activeEmergency()
      .then(({ session }) =>
        setHomeEmergency(
          session
            ? { state: 'active', sessionId: session.id, contactsNotified: true, liveSharing: true }
            : { state: 'idle' },
        ),
      )
      .catch(() => {});
    api
      .activeJourney()
      .then(({ journey }) => setHomeJourney(journey ? { destination: journey.destination, status: journey.status.toLowerCase() } : null))
      .catch(() => {});
  }, [activeTab]);

  // Real-device performance audit (2026-08-07) found the YOLOv8n model is
  // ~12MB — on throttled mobile data (e.g. 4G) that can take up to a minute
  // on a first-ever visit before local hazard detection is ready (cached by
  // the service worker after that, so it's a one-time cost). The visual
  // status bar already says "Loading local detection model…" but its
  // aria-live is off unless a hazard exists, so a blind user got total
  // silence during that wait. Speak the state transitions explicitly so
  // they always know detection is starting up rather than broken.
  const hazardWarmupSpokenRef = useRef(false);
  const hazardSlowWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (hazardState.status === 'warming-up' && !hazardWarmupSpokenRef.current) {
      hazardWarmupSpokenRef.current = true;
      speak('Loading local hazard detection. This can take a little while on a slow connection, and only happens once.', 3, 'hazard-warmup');
      hazardSlowWarningTimerRef.current = setTimeout(() => {
        speak('Local hazard detection is still loading. You can keep using the camera in the meantime.', 3, 'hazard-warmup-slow');
      }, 15_000);
    }
    if (hazardState.status !== 'warming-up') {
      hazardWarmupSpokenRef.current = false;
      if (hazardSlowWarningTimerRef.current) {
        clearTimeout(hazardSlowWarningTimerRef.current);
        hazardSlowWarningTimerRef.current = null;
      }
    }
    return () => {
      if (hazardSlowWarningTimerRef.current) {
        clearTimeout(hazardSlowWarningTimerRef.current);
        hazardSlowWarningTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hazardState.status]);


  // ── Navigation Coach (v0.5): turns live detections into deterministic spoken
  // guidance (SPOTTED -> TRACKING -> PASSING -> CLEARED, directional + clock
  // positions, obstacle chaining, silence breaker). Safety output never depends
  // on AI. The onAnnounce callback speaks + haptics + pans a spatial cue.
  const coachDetections = useMemo<CoachDetection[]>(
    () => hazardState.detections.map((d) => ({ className: d.className, confidence: d.confidence, box: d.box })),
    [hazardState.detections],
  );
  // Motion cadence (v0.6): only active once the user has explicitly granted
  // the motion permission (PermissionOnboarding/PermissionCenter). Without it
  // the coach stays at the conservative stationary cadence — it never
  // pretends to sense motion it does not have permission to read.
  const motionGranted = permissionService.get('motion').state === 'allowed';
  const motionLevel = useDeviceMotion(motionGranted && coachMode !== 'off' && cameraActive);
  useNavigationCoach({
    active: coachMode !== 'off' && cameraActive && hazardLayerEnabled,
    detections: coachDetections,
    motion: motionLevel,
    onAnnounce: (a) => {
      if (a.haptic === 'hazard-immediate') fireHapticEvent('hazard-immediate', hapticSettings);
      else if (a.haptic === 'hazard-nearby') fireHapticEvent('hazard-nearby', hapticSettings);
      else if (a.haptic === 'clear') fireHapticEvent('clear', hapticSettings);
      playDirectionalCue(a.pan);
      if (a.haptic === 'hazard-immediate' || a.haptic === 'hazard-nearby') setHazardActive(true);
      speak(a.text, a.priority as SpeechPriority, a.dedupeKey);
      if (a.haptic !== 'clear') setHazardActive(false);
    },
  });

  // Browser-speech fallback when the neural TTS service is unreachable.
  function fallbackSpeak(text: string, locale?: string, rate?: number) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const voices = window.speechSynthesis.getVoices() || [];
    const isMale = voiceRef.current.toLowerCase().includes('guy') || voiceRef.current.toLowerCase().includes('ryan') || voiceRef.current.toLowerCase().includes('prabhat') || voiceRef.current.toLowerCase().includes('madhur') || voiceRef.current.toLowerCase().includes('valluvar') || voiceRef.current.toLowerCase().includes('mohan') || voiceRef.current.toLowerCase().includes('gagan') || voiceRef.current.toLowerCase().includes('midhun') || voiceRef.current.toLowerCase().includes('bashkar') || voiceRef.current.toLowerCase().includes('alvaro') || voiceRef.current.toLowerCase().includes('katja');
    const langPrefix = (locale || 'en').split('-')[0].toLowerCase();
    const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));

    let textToSpeak = text;
    let effectiveLang = locale || 'en-US';
    let chosenVoice: SpeechSynthesisVoice | null = null;

    if (langVoices.length > 0) {
      chosenVoice = langVoices.find((v) => {
        const name = v.name.toLowerCase();
        if (isMale && (name.includes('male') || name.includes('madhur') || name.includes('neel') || name.includes('hemant') || name.includes('valluvar') || name.includes('mohan') || name.includes('gagan') || name.includes('midhun') || name.includes('bashkar') || name.includes('alvaro') || name.includes('guy') || name.includes('david'))) return true;
        if (!isMale && (name.includes('female') || name.includes('swara') || name.includes('lekha') || name.includes('veena') || name.includes('pallavi') || name.includes('shruti') || name.includes('sapna') || name.includes('sobhana') || name.includes('tanishaa') || name.includes('dhwani') || name.includes('elvira') || name.includes('jenny') || name.includes('samantha'))) return true;
        return /natural|premium|enhanced|google|apple/i.test(name);
      }) || langVoices[0];
      effectiveLang = chosenVoice.lang || locale || 'en-US';
    } else {
      textToSpeak = getPhoneticFallback(text, voiceRef.current);
      chosenVoice =
        voices.find((v) => v.lang.toLowerCase().startsWith('en-in') || v.lang.toLowerCase().includes('in')) ||
        voices.find((v) => {
          const name = v.name.toLowerCase();
          if (isMale && (name.includes('guy') || name.includes('daniel') || name.includes('male') || name.includes('david'))) return true;
          if (!isMale && (name.includes('jenny') || name.includes('samantha') || name.includes('karen') || name.includes('female') || name.includes('victoria') || name.includes('zira'))) return true;
          return /natural|premium|enhanced|google|apple/i.test(name);
        }) ||
        voices[0] ||
        null;
      effectiveLang = chosenVoice?.lang || 'en-IN';
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.rate = Math.max(0.5, Math.min(2.0, rate ?? voiceRateRef.current));
    utterance.pitch = 1;
    utterance.lang = effectiveLang;
    if (chosenVoice) utterance.voice = chosenVoice;

    // Signal the voice provider so microphone recognition pauses while we
    // talk (the mic would otherwise hear our own voice and could loop).
    // Some embedded browsers start the utterance and never fire its end
    // event — speechActive would stay true forever, leaving the orb stuck on
    // "Speaking" and the microphone paused for good. Bound the pause by an
    // estimated speaking time; in working browsers the real end event
    // releases first and this timer is just cancelled.
    const releaseFallback = (viaTimer: boolean) => {
      if (fallbackUtterRef.current !== utterance) return; // superseded
      fallbackUtterRef.current = null;
      if (fallbackEndTimerRef.current) {
        clearTimeout(fallbackEndTimerRef.current);
        fallbackEndTimerRef.current = null;
      }
      setSpeechActive(false);
      // The priority manager has its own 12s lock watchdog, so the timer
      // path must not also pop its queue (it would double-play what's next).
      if (!viaTimer) speechManagerRef.current?.onEnded();
    };

    utterance.onstart = () => {
      fallbackUtterRef.current = utterance;
      setSpeechActive(true);
      // ~14 chars/sec is typical TTS pace; add headroom for slow voices.
      const estMs = Math.min(
        120_000,
        4_000 + (textToSpeak.length / (14 * Math.max(0.5, utterance.rate || 1))) * 1000,
      );
      if (fallbackEndTimerRef.current) clearTimeout(fallbackEndTimerRef.current);
      fallbackEndTimerRef.current = setTimeout(() => releaseFallback(true), estMs);
    };
    utterance.onend = () => releaseFallback(false);
    utterance.onerror = () => releaseFallback(false);
    window.speechSynthesis.speak(utterance);
  }

  // High-quality neural speech: prefers the backend (free Edge neural voices,
  // 30+ languages incl. all Indian languages), falls back to the on-device
  // voice if the service is unavailable.
  // High-quality neural speech with priority: default priority 5 (navigation).
  // Danger/emergency call sites pass higher priorities (1-3) which interrupt.
  function speak(text: string, priority: SpeechPriority = 5, dedupeKey?: string, rateOverride?: number) {
    const cleanText = text.trim();
    if (!cleanText) return;
    lastSpokenRef.current = cleanText;
    speakWithPriority(cleanText, priority, dedupeKey, rateOverride);
  }

  function stopSpeaking() {
    speakSeqRef.current++; // invalidate any in-flight TTS
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    if (ttsUrlRef.current) {
      URL.revokeObjectURL(ttsUrlRef.current);
      ttsUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();
    // Nothing is speaking anymore; tell the voice provider it may resume
    // listening (any fallback utterance queued by the interrupt will signal
    // its own start shortly).
    speechActiveCountRef.current = 0;
    voiceBridge.current.onSpeechChange?.(false);
  }

  /**
   * Stops speech on the user's own instruction (stop control, "be quiet", a
   * screen-reader shortcut) and tells the priority manager the utterance is
   * over so the queue resumes.
   *
   * Distinct from stopSpeaking(), which is also called from inside the
   * manager's own play/interrupt path — there the manager is already tracking
   * the queue, and releasing would double-advance it. The distinction matters:
   * because `pause()` fires neither `ended` nor `error`, an external stop used
   * to leave the manager locked, and every following question was queued into
   * a queue that nothing would ever drain.
   */
  function stopSpeechNow() {
    stopSpeaking();
    speechManagerRef.current?.releasedExternally();
  }

  // Autoplay-policy unlock: iOS/Safari/in-app WebViews refuse programmatic
  // audio.play() unless a real user gesture has already played audio. Play
  // the persistent element once (a 60 ms silent WAV) inside the first
  // pointer/key gesture; from then on it stays unlocked for every later TTS
  // utterance, including ones created after async network fetches.
  useEffect(() => {
    const unlock = () => {
      if (ttsUnlockRef.current) return;
      const el = getTtsElement();
      if (!el.paused && el.src) return; // already talking — don't interrupt
      el.src = SILENT_WAV_DATA_URI;
      el.play()
        .then(() => {
          ttsUnlockRef.current = true;
          el.pause();
        })
        .catch(() => {
          // Not treated as a qualifying gesture (or policy quirk); the next
          // genuine gesture retries.
        });
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('touchend', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('touchend', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
      if (ttsElementRef.current) {
        ttsElementRef.current.pause();
        ttsElementRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function announce(message: string, tone: Tone = 'online') {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  // ── Voice command handler (v0.4): maps a parsed VoiceIntent to app actions.
  const journeyIntentRef = useRef<{ destination: string } | null>(null);
  const voiceEmergencyRef = useRef<(() => void) | null>(null);
  // A safety-critical action that has been announced to the user but not yet
  // authorized. These commands (emergency, cancel emergency, end journey, share
  // location) must not act on the first utterance: a voice user mis-hears
  // themselves constantly, and on a busy street a bystander's "emergency" can
  // raise somebody's real SOS. The action is parked here and only a real
  // "confirm" runs it.
  //
  // This used to be a lie told to the user: the app spoke "say confirm" and
  // nothing was ever armed, so "confirm" fell through to the default case and
  // the user was read the entire command menu instead. Every voice-triggered
  // safety command was unreachable.
  //
  // The gate lives here rather than in the voice provider because BOTH the
  // spoken path and the typed-command path (VoiceFirstShell -> bridge ->
  // handleVoiceCommand) funnel through this function. Gating upstream would
  // leave typed commands unguarded.
  const pendingConfirmRef = useRef<(() => void) | null>(null);

  function handleVoiceCommand(intent: VoiceIntent) {
    // Shadows the outer speak() for this whole handler — including inside
    // .then() continuations, which run long after this function returns but
    // still close over this binding. Every utterance here is an answer to
    // something the user just asked, so the dedupe cooldown must not be
    // allowed to swallow it: a voice user who asks the same thing twice has
    // asked twice, and silence is indistinguishable from the app having
    // failed to hear them. Dedupe still applies to ambient warnings, which
    // are spoken from outside this handler.
    const speak = (text: string, priority: SpeechPriority = 5, dedupeKey?: string, rateOverride?: number) => {
      const cleanText = text.trim();
      if (!cleanText) return;
      lastSpokenRef.current = cleanText;
      speakWithPriority(cleanText, priority, dedupeKey, rateOverride, 0);
    };
    const tab = (t: TabKey) => setActiveTab(t);
    const params = intent.parameters as Record<string, string>;

    // Confirmation answers are handled before the switch: they are replies to a
    // pending action, not commands in their own right. Handling them here is
    // what makes the "say confirm" prompts honest.
    if (intent.intent === 'confirm') {
      const run = pendingConfirmRef.current;
      pendingConfirmRef.current = null;
      if (run) run();
      else speak('There is nothing waiting for your confirmation.', 5);
      return;
    }
    if (intent.intent === 'cancel') {
      if (pendingConfirmRef.current) {
        pendingConfirmRef.current = null;
        speak('Cancelled.', 5);
      } else {
        // Nothing was waiting. Saying "cancelled" here would claim an action
        // that did not happen, and moving the user somewhere unasked is
        // disorienting — a blind user who says "cancel" to stop a wrong
        // recognition needs to be told there is nothing to stop, not moved.
        speak('There is nothing to cancel.', 5);
      }
      return;
    }

    switch (intent.intent) {
      case 'emergency':
        // Parked, not performed. The user has been asked to confirm; nothing is
        // sent until they say "confirm". Confirming opens the emergency
        // screen, where sending runs its own visible countdown — a second,
        // deliberate gate rather than a single spoken "confirm" firing an SOS
        // at a bystander's "emergency".
        pendingConfirmRef.current = () => {
          tab('sos');
          announce('Emergency requested. Confirm to share your location with trusted contacts.', 'error');
        };
        speak('Emergency requested. Say confirm to share your location with trusted contacts, or cancel.', 1, 'emergency-voice');
        break;
      case 'cancel_emergency':
        // Cancelling is always the safe direction, so when an activation
        // countdown is actually running it is stopped IMMEDIATELY rather than
        // parked behind a confirm. A "cancel" that waits for a second
        // "confirm" is a cancel that does not cancel — and the countdown it
        // was meant to stop fires anyway 5 seconds later.
        if (voiceEmergencyRef.current) {
          voiceEmergencyRef.current();
          voiceEmergencyRef.current = null;
          speak('Emergency cancelled.', 1, 'emergency-cancel-voice');
          break;
        }
        // No countdown running: this means cancelling an emergency that is
        // already live, which does need confirming.
        pendingConfirmRef.current = () => {
          tab('sos');
        };
        speak('Cancelling emergency. Say confirm to cancel, or cancel to abort.', 1, 'emergency-cancel-voice');
        break;
      case 'describe_scene':
        tab('tracking');
        setAnalysisMode('navigation');
        void voiceCaptureAndAnalyze('navigation', 'Describe what is directly ahead of me in a few words, focusing on immediate obstacles and safe path.');
        break;
      case 'describe_surroundings': {
        // Instant local answer from the on-device detector — no cloud roundtrip.
        if (!cameraActive || !hazardLayerEnabled) {
          speak('Start the camera first so I can sense what is around you. Double-tap the screen to start tracking.', 5, 'describe-surroundings-no-camera');
          break;
        }
        const sentences = describeEnvironment({ detections: hazardState.detections, place: ambientEnvRef.current.place });
        speak(sentences.join(' '), 5, 'describe-surroundings');
        break;
      }
      case 'read_text':
        tab('tracking');
        setAnalysisMode('reading');
        void voiceCaptureAndAnalyze('reading', 'Read the text visible in this image aloud, word for word.');
        break;
      case 'identify_color':
        tab('tracking');
        setAnalysisMode('assistant');
        void voiceCaptureAndAnalyze('assistant', 'Identify the main color of the object in the center of this image. If the lighting makes it uncertain, say which colors it could be. One short sentence.');
        break;
      case 'identify_currency':
        tab('tracking');
        setAnalysisMode('assistant');
        void voiceCaptureAndAnalyze('assistant', 'This image shows money (a banknote or coin). Identify its denomination and currency. Note that lighting can mislead: tell me the visual marks you based this on. Never guess between two similar denominations.');
        break;
      case 'read_expiry':
        tab('tracking');
        setAnalysisMode('assistant');
        void voiceCaptureAndAnalyze('assistant', 'Find and read any expiry date, best-before date, or use-by date in this image. Read the date exactly as written. If no date is visible, say so plainly.');
        break;
      case 'scan_product': {
        tab('tracking');
        const runScan = async () => {
          if (!('geolocation' in navigator)) return; // unreachable guard; camera check below matters
          if (!videoRef.current) {
            speak('Turn on the camera first, then say scan the barcode again.', 5, 'scan-no-camera');
            return;
          }
          speak('Hold the camera steady over the barcode.', 5, 'scan-start');
          try {
            const handle = await scanBarcode(
              videoRef.current,
              (code) => {
                void navigator.vibrate?.(80);
                speak('Scanned. Looking up the product.', 5, 'scan-found');
                const cached = cachedProduct(code);
                const lookup = cached
                  ? Promise.resolve({ product: cached, cached: true })
                  : api
                      .productLookup(code)
                      .then((r) => {
                        if (r.product.found) rememberProduct(code, r.product);
                        return r;
                      });
                lookup
                  .then((r) => speak(formatProductSpeech(r.product), 5, `scan-${code}`))
                  .catch(() => speak('The product database is not reachable right now. You can say read this to have the label read aloud instead.', 5, 'scan-error'));
              },
              25_000,
            );
            productScanRef.current = handle;
          } catch {
            speak('Barcode scanning is not supported on this browser. You can say read this to have the label read aloud instead.', 5, 'scan-unsupported');
          }
        };
        if (cameraActive) {
          void runScan();
        } else {
          void (async () => {
            await startCamera();
            await runScan();
          })();
        }
        break;
      }
      case 'teach_thing': {
        tab('tracking');
        setAnalysisMode('assistant');
        const thingName = String(params.name || 'my thing');
        speak(`Learning ${thingName}. Hold it steady in the camera.`, 5, `teach-start-${thingName}`);
        void voiceCaptureAndAnalyze('assistant', `Describe this object in one short reusable description for recognition: its most distinctive visual features (color, shape, material, markings). No speculation.`);
        const stopWatchingTeach = setInterval(() => {
          const latest = aiResult;
          if (latest?.summary && !isAnalyzing) {
            clearInterval(stopWatchingTeach);
            void api
              .createThing(thingName, `${latest.summary} ${latest.details?.[0] ?? ''}`.trim())
              .then((r) => speak(`${r.updated ? 'Updated' : 'Learned'} ${thingName}. Say find my ${thingName} any time.`, 5, `teach-done-${thingName}`))
              .catch(() => speak('I could not save that object. Please try again.', 5, 'teach-error'));
          }
        }, 1200);
        setTimeout(() => clearInterval(stopWatchingTeach), 30_000);
        break;
      }
      case 'find_thing': {
        tab('tracking');
        const target = String(params.name || '').trim();
        if (!target) {
          speak('What is the object called?', 5, 'find-noname');
          break;
        }
        api
          .listThings(target)
          .then(async (r) => {
            const match = r.things[0];
            if (!match) {
              speak(`I do not know ${target} yet. Point the camera at it and say, teach this as ${target}.`, 5, `find-unknown-${target}`);
              return;
            }
            setAnalysisMode('assistant');
            speak(`Looking for ${target}.`, 5, `find-start-${target}`);
            await voiceCaptureAndAnalyze('assistant', `You are looking for the user's personal object called "${match.name}", previously described as: "${match.description}". Is that exact object visible in this image now? If yes, say "Found" and give its direction (left, right, ahead) and approximate distance if visually estimable. If it is not clearly present, say "Not found" and do not guess.`);
          })
          .catch(() => speak('I could not check your taught objects.', 5, 'find-error'));
        break;
      }
      case 'reports_near': {
        // Spoken spatial answer: distance + direction-agnostic summary + age.
        // Always states age — stale reports must not sound current.
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            api
              .incidentsNear(pos.coords.latitude, pos.coords.longitude, 500)
              .then(({ reports }) => {
                if (reports.length === 0) {
                  speak('No community reports within 500 metres in the last 90 days.', 5, 'reports-none');
                  return;
                }
                const parts = reports.map((r) => `${r.category}, ${r.distanceMeters} metres away, reported ${r.ageDays === 0 ? 'today' : `${r.ageDays} day${r.ageDays === 1 ? '' : 's'} ago`}`);
                speak(`${reports.length} report${reports.length === 1 ? '' : 's'} nearby. ${parts.join('. ')}. Say report a hazard to add one.`, 5, 'reports-near');
              })
              .catch(() => speak('I could not check community reports right now.', 5, 'reports-error'));
          },
          () => speak('I need your location to check nearby reports.', 5, 'reports-noloc'),
          { timeout: 8000, maximumAge: 30_000 },
        );
        break;
      }
      case 'follow_up': {
        tab('tracking');
        setAnalysisMode('assistant');
        // Scene memory lives server-side (text summaries, 90s TTL — never
        // frames). The server injects prior context + honesty rules and
        // tells the user plainly when memory is empty.
        void voiceCaptureAndAnalyze(
          'assistant',
          'Tell me MORE about this scene, not less: describe what you did not mention before — background objects, signage, people and their direction of movement. Keep it under three sentences.',
          { followUp: true },
        );
        break;
      }
      case 'start_safe_journey':
        tab('journey');
        if (params.destination) {
          journeyIntentRef.current = { destination: params.destination };
          speak(`Starting a safe journey to ${params.destination}. Review the details on the journey screen.`, 5, 'voice-journey-start');
        } else {
          speak('Safe Journey is open. Tell me the destination, or type it on the screen.', 5, 'voice-journey-open');
        }
        break;
      case 'stop_safe_journey':
        // Previously this only switched tabs and spoke — it never ended the
        // journey. The user was told it was ending while it kept running,
        // kept reporting location, and could still escalate to their contact.
        pendingConfirmRef.current = () => {
          tab('journey');
          api
            .activeJourney()
            .then((r) => {
              if (!r.journey) {
                speak('You do not have an active journey.', 5, 'voice-journey-none');
                return undefined;
              }
              return api
                .endJourney(r.journey.id)
                .then(() => speak('Journey ended. You are safe.', 2, 'voice-journey-end'));
            })
            .catch(() => speak('I could not end the journey.', 5));
        };
        speak('Ending your safe journey. Say confirm, or cancel.', 3, 'voice-journey-stop');
        break;
      case 'check_journey':
        api
          .activeJourney()
          .then((r) => {
            if (r.journey) {
              speak(`Your active journey is to ${r.journey.destination}. Status is ${r.journey.status}.`, 5, 'voice-journey-check');
            } else {
              speak('You do not have an active journey.', 5, 'voice-journey-none');
            }
          })
          .catch(() => speak('I could not check your journey.', 5));
        break;
      case 'i_am_safe':
        api
          .activeJourney()
          .then((r) => {
            if (r.journey) {
              return api.journeyCheckIn(r.journey.id).then(() => speak('Checked in. I will keep monitoring.', 2, 'voice-safe'));
            }
            speak('You do not have an active journey.', 5);
            return undefined;
          })
          .catch(() => speak('I could not check you in.', 5));
        break;
      case 'i_arrived':
        api
          .activeJourney()
          .then((r) => {
            if (r.journey) {
              return api.endJourney(r.journey.id).then(() => speak('Journey completed. You are safe.', 2, 'voice-arrived'));
            }
            speak('You do not have an active journey.', 5);
            return undefined;
          })
          .catch(() => speak('I could not end the journey.', 5));
        break;
      case 'i_am_lost':
        tab('journey');
        api
          .activeJourney()
          .then((r) => {
            if (r.journey) return api.journeyLost(r.journey.id).then(() => speak('Help requested. Your trusted contact has been notified.', 2, 'voice-lost'));
            speak('You do not have an active journey. Say emergency if you need help now.', 5);
            return undefined;
          })
          .catch(() => speak('I could not request help.', 5));
        break;
      case 'send_location':
        // Parked like every other confirmation-gated action, and the
        // confirmation itself only OPENS the send screen — the claim is made
        // only once it is actually true. Announcing "sharing your location"
        // and then merely switching tabs was a second false statement on top
        // of the un-armed confirmation.
        pendingConfirmRef.current = () => {
          tab('sos');
          speak('Confirm the send on the emergency screen to share your location.', 3, 'voice-share-loc-open');
        };
        speak('Sharing your location. Say confirm to open the send screen, or cancel.', 3, 'voice-share-loc');
        break;
      case 'who_acknowledged': {
        // Was routed but had no handler, so the question a frightened user asks
        // after sending an SOS — "did anyone get it?" — was answered with the
        // entire command menu.
        api
          .activeEmergency()
          .then((r) => {
            const session = r.session;
            if (!session) {
              speak('There is no active emergency right now.', 5, 'voice-ack-none');
              return;
            }
            const acks = session.acknowledgements ?? [];
            if (acks.length === 0) {
              speak('Your emergency is active. Nobody has acknowledged it yet.', 3, 'voice-ack-zero');
              return;
            }
            const names = acks
              .map((a) => (a as { name?: string }).name)
              .filter((n): n is string => Boolean(n));
            speak(
              names.length > 0
                ? `Acknowledged by ${names.join(', ')}.`
                : `${acks.length} ${acks.length === 1 ? 'person has' : 'people have'} acknowledged your emergency.`,
              3,
              'voice-ack-list',
            );
          })
          .catch(() => speak('I could not check who has acknowledged your emergency.', 5));
        break;
      }
      case 'start_navigation': {
        // Routed for "take me to the pharmacy" / "how far is the station" but
        // never handled. The app has no turn-by-turn engine, so the honest
        // answer is the safe-journey flow it actually implements — the same
        // one "start a safe journey to X" already uses.
        const dest = (intent.parameters.destination as string) || '';
        if (intent.parameters.query === 'distance') {
          speak('I cannot give walking distances yet. Open Settings and Places to see saved places.', 5, 'voice-nav-nodistance');
          break;
        }
        if (!dest) {
          speak('Tell me where you want to go, for example take me to the pharmacy.', 5, 'voice-nav-needdest');
          break;
        }
        tab('journey');
        journeyIntentRef.current = { destination: dest };
        speak(`Starting a safe journey to ${dest}. Review the details on the journey screen.`, 5, 'voice-nav-start');
        break;
      }
      case 'permission_status':
        setShowPermissions(true);
        speak('Opening Permission Centre.', 5, 'voice-perms');
        break;
      case 'open_tab': {
        const target = (params.tab ?? 'home') as TabKey;
        if (tabs.some((t) => t.key === target)) tab(target);
        else tab('home');
        speak(`Opening ${tabs.find((t) => t.key === target)?.label ?? 'Home'}.`, 5, 'voice-open-tab');
        break;
      }
      case 'repeat':
        speak(lastSpokenRef.current || 'I have nothing to repeat yet.', 5, 'voice-repeat');
        break;
      case 'stop_speech':
        stopSpeechNow();
        speak('Stopping speech. Emergency warnings remain active.', 5, 'voice-stop');
        break;
      case 'speak_slower':
        setVoiceRate((v) => Math.max(0.7, Number((v - 0.1).toFixed(2))));
        speak('Speaking slower.', 5, 'voice-slower');
        break;
      case 'speak_faster':
        setVoiceRate((v) => Math.min(1.5, Number((v + 0.1).toFixed(2))));
        speak('Speaking faster.', 5, 'voice-faster');
        break;
      case 'more_detail':
        speak('Switching to detailed descriptions.', 5, 'voice-detail');
        break;
      case 'shorter_answer':
        speak('Switching to short descriptions.', 5, 'voice-short');
        break;
      case 'change_setting': {
        const setting = params.setting;
        const value = params.value === 'true' || params.value === 'on';
        if (setting === 'hazardVibration') {
          setHapticSettings((h) => ({ ...h, hapticsEnabled: value }));
          speak(`Hazard vibration ${value ? 'on' : 'off'}.`, 5, 'voice-hvib');
        } else if (setting === 'voiceGuidance') {
          speak('Voice guidance is always available for safety. You can reduce verbosity in settings.', 5, 'voice-vguid');
        } else if (setting === 'language') {
          speak(`Language change to ${value} is available in Settings.`, 5, 'voice-lang');
        }
        break;
      }
      case 'set_coach_mode': {
        const mode = String(params.mode ?? 'off') as CoachMode;
        const valid: CoachMode[] = ['navigation', 'reading', 'exploration', 'shopping', 'off'];
        if (!valid.includes(mode)) {
          speak('I did not understand that coaching mode.', 5, 'voice-coach-invalid');
          break;
        }
        setCoachMode(mode);
        if (mode === 'off') {
          speak('Navigation coaching off. Say navigation mode to restart.', 5, 'voice-coach');
        } else {
          if (!cameraActive) {
            tab('tracking');
            speak(`${mode === 'navigation' ? 'Navigation' : mode === 'reading' ? 'Reading' : mode === 'exploration' ? 'Exploration' : 'Shopping'} mode on. Turn on the camera to start coaching.`, 5, 'voice-coach');
          } else {
            speak(`${mode === 'navigation' ? 'Navigation' : mode === 'reading' ? 'Reading' : mode === 'exploration' ? 'Exploration' : 'Shopping'} mode on. Coaching is active.`, 5, 'voice-coach');
          }
        }
        break;
      }
      case 'shopping':
        setCoachMode('shopping');
        tab('tracking');
        speak('Shopping mode. Point the camera at a product or label, then say read this label, or what is this.', 5, 'voice-shop');
        break;
      case 'help':
        speak(HELP_MESSAGE, 5, 'voice-help');
        break;
      case 'where_am_i': {
        // Soundscape-pattern "my location": reverse geocode (road + area) plus
        // the nearest saved place with clock-direction. GPS timeout falls back
        // to the same city-level IP fix the Home map uses, so an indoor user
        // still hears an approximate answer instead of a dead end.
        const whereTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('gps-timeout')), 6000));
        Promise.race([getCurrentPosition(), whereTimeout])
          .then(async (coords) => {
            const geo = api.reverseGeocode(coords.latitude, coords.longitude).catch(() => null);
            const places = api.listPlaces().catch(() => null);
            const [g, p] = await Promise.all([geo, places]);
            const parts: string[] = [];
            if (g?.road) parts.push(`You are on ${g.road}${g.city ? ` in ${g.city}` : ''}.`);
            else if (g?.display) parts.push(`You are near ${g.display.split(',').slice(0, 2).join(',')}.`);
            else parts.push('I could not look up your street right now.');

            const withCoords = (p?.places ?? []).filter((pl) => pl.latitude != null && pl.longitude != null);
            if (withCoords.length > 0) {
              const nearest = withCoords
                .map((pl) => ({ pl, dist: distanceMeters(coords, { latitude: pl.latitude as number, longitude: pl.longitude as number }) }))
                .sort((a, b) => a.dist - b.dist)[0];
              parts.push(`Nearest saved place: ${describePlaceAsSpoken(coords, { latitude: nearest.pl.latitude as number, longitude: nearest.pl.longitude as number }, nearest.pl.label)}`);
            }
            speak(parts.join(' '), 5, 'where-am-i');
          })
          .catch(async () => {
            // GPS never answered: approximate city-level fallback.
            try {
              const ip = await api.geoIpLocation();
              speak(
                ip.city
                  ? `I cannot get a precise fix indoors. Your approximate location is near ${ip.city}${ip.country ? `, ${ip.country}` : ''}. Enable precise location outdoors for street-level detail.`
                  : 'I cannot get a precise fix indoors, and no approximate location is available right now. Try again outdoors.',
                5,
                'where-am-i-ip',
              );
            } catch {
              speak('I could not get your location. Check that location is allowed for Watchora.', 5, 'where-am-i-noloc');
            }
          });
        break;
      }
      case 'what_time_is_it': {
        // Instant local clock answer: no network, no AI roundtrip — a blind
        // user asking the time needs it immediately, even offline.
        const spokenTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        speak(`It is ${spokenTime}.`, 5, 'what-time');
        break;
      }
      case 'list_places': {
        tab('routes');
        // Spoken list (Soundscape pattern): places with distance + clock
        // direction from the current position, capped at three. GPS timeout
        // falls back to the city-level IP fix so indoor users still hear
        // approximate distances instead of a dead end.
        const placesTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('gps-timeout')), 6000));
        const listFromCoords = (coords: Coordinates, approximate: boolean) => {
          api
            .listPlaces()
            .then(({ places }) => {
              const withCoords = places.filter((pl) => pl.latitude != null && pl.longitude != null);
              if (withCoords.length === 0) {
                speak('You have no saved places yet. Say save place at any location to add one.', 5, 'places-empty');
                return;
              }
              const sorted = withCoords
                .map((pl) => ({ pl, dist: distanceMeters({ latitude: coords.latitude, longitude: coords.longitude }, { latitude: pl.latitude as number, longitude: pl.longitude as number }) }))
                .sort((a, b) => a.dist - b.dist)
                .slice(0, 3);
              const parts = sorted.map(({ pl }) => describePlaceAsSpoken({ latitude: coords.latitude, longitude: coords.longitude }, { latitude: pl.latitude as number, longitude: pl.longitude as number }, pl.label));
              speak(
                `${approximate ? 'Using your approximate network location. ' : ''}${withCoords.length} saved place${withCoords.length === 1 ? '' : 's'}. ${parts.join(' ')}`,
                5,
                'places-spoken',
              );
            })
            .catch(() => speak('I could not load your saved places.', 5, 'places-error'));
        };
        Promise.race([getCurrentPosition(), placesTimeout])
          .then((coords) => listFromCoords(coords, false))
          .catch(async () => {
            try {
              const ip = await api.geoIpLocation();
              listFromCoords({ latitude: ip.lat, longitude: ip.lng }, true);
            } catch {
              speak('I need your location to describe your places by distance, and no approximate location is available right now.', 5, 'places-noloc');
            }
          });
        break;
      }
      case 'save_place':
        tab('routes');
        speak(params.label ? `Saving this location as ${params.label}. Use the places screen to confirm.` : 'Open the places screen to save this location.', 5, 'voice-save-place');
        break;
      case 'report_hazard':
        tab('community');
        speak('Opening community reports. You can report a hazard there.', 5, 'voice-hazard');
        break;
      case 'unknown':
      default:
        speak(HELP_MESSAGE, 5, 'voice-unknown');
        break;
    }
  }

  // Register the bridge so the voice provider can reach this handler + speech.
  useEffect(() => {
    voiceBridge.current.speak = (text, priority = 5, dedupeKey) => speak(text, priority as SpeechPriority, dedupeKey);
    voiceBridge.current.handleCommand = (intent) => handleVoiceCommand(intent);
    voiceBridge.current.stopSpeaking = () => stopSpeechNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceBridge]);

  // Global "any touch stops the talking" barge-in. While Watchora is speaking
  // the microphone is paused (so it cannot hear its own voice and loop), which
  // means a blind user cannot interrupt a long reading with their voice. A tap
  // or keypress anywhere is a reflex interrupt: it stops the speech, and the
  // voice provider resumes listening ~450ms later so the next command works.
  useEffect(() => {
    const interrupt = () => {
      if (speechActiveCountRef.current > 0) {
        stopSpeechNow();
        if ('vibrate' in navigator) navigator.vibrate(15);
      }
    };
    window.addEventListener('pointerdown', interrupt);
    window.addEventListener('keydown', interrupt);
    return () => {
      window.removeEventListener('pointerdown', interrupt);
      window.removeEventListener('keydown', interrupt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getRecognitionCtor() {
    const win = window as Window & { SpeechRecognition?: any; webkitSpeechRecognition?: any };
    return (win.SpeechRecognition || win.webkitSpeechRecognition) as (new () => RecognitionLike) | undefined;
  }

  function ensureRecognition() {
    if (recognitionRef.current) return recognitionRef.current;
    const RecognitionCtor = getRecognitionCtor();
    if (!RecognitionCtor) return null;

    const recognition = new RecognitionCtor();
    recognition.lang = language === 'English' ? 'en-US' : language === 'Vietnamese' ? 'vi-VN' : 'es-ES';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      speechLockRef.current = true;
      announce('Listening for a command...', 'busy');
    };
    recognition.onresult = (event: any) => {
      let transcript = '';
      for (const result of event.results) transcript += result[0].transcript;
      setPrompt(transcript.trim());
    };
    recognition.onerror = (event: any) => {
      speechLockRef.current = false;
      announce(`Speech recognition error: ${event.error}.`, 'error');
    };
    recognition.onend = () => {
      speechLockRef.current = false;
      announce('Stopped listening.', 'online');
    };

    recognitionRef.current = recognition;
    return recognition;
  }

  function handleStartListening() {
    const recognition = ensureRecognition();
    if (!recognition) {
      announce('This browser does not support speech recognition.', 'error');
      return;
    }
    if (speechLockRef.current) {
      recognition.stop();
      return;
    }
    recognition.start();
  }

  function handleStopListening() {
    recognitionRef.current?.stop();
    speechLockRef.current = false;
    announce('Stopped listening.', 'online');
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      announce('This browser does not support camera access.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      announce('Live camera connected.', 'online');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown camera error';
      announce(`Could not start camera: ${message}`, 'error');
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    announce('Camera stopped.', 'online');
  }

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return '';
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return compressImage(canvas);
  }

  async function analyzeFrame(mode: AnalysisMode, nextPrompt: string, opts?: { followUp?: boolean }) {
    if (isAnalyzing) return;

    const imageDataUrl = captureFrame();
    if (!imageDataUrl) {
      announce('Start the camera and capture a frame first.', 'warning');
      return;
    }

    // Phase B: reading mode tries local OCR first (fast, offline, private) before
    // falling back to the cloud Gemini path. Other modes are unchanged — natural
    // scene description/navigation genuinely needs the vision model, OCR does not
    // help there. See docs/yolo-ocr-slam-plan.md #2.2 for why this is a hybrid,
    // not an on-device-only replacement.
    if (mode === 'reading') {
      setIsAnalyzing(true);
      announce('Reading the current frame locally.', 'busy');
      try {
        const ocr = await recognizeText(imageDataUrl);
        if (ocr.text && ocr.confidence >= OCR_FALLBACK_CONFIDENCE_THRESHOLD) {
          const result: AiResult = {
            mode: 'reading',
            summary: ocr.text.split('\n').find((line) => line.trim().length > 0)?.trim() || ocr.text.slice(0, 120),
            details: ocr.text.split('\n').map((line) => line.trim()).filter(Boolean).slice(1),
            warnings: [],
            confidence: ocr.confidence >= 80 ? 'high' : 'medium',
            shouldStop: false,
            demo: false,
            source: 'local-ocr',
          };
          setAiResult(result);
          setResponse(result.summary);
          announce('Read locally, on this device.', 'online');
          speak(result.summary);
          setIsAnalyzing(false);
          return;
        }
        // Low-confidence or empty local OCR: try the dedicated AI OCR endpoint
        // (verbatim reading-order extraction) before the general cloud path
        // rather than reading unreliable text aloud with false authority.
        announce('Local reading was unclear. Trying AI text reading.', 'busy');
        try {
          const aiOcr = await api.ocrRead(imageDataUrl, language);
          if (aiOcr.text.trim()) {
            const lines = aiOcr.text.split('\n').map((line) => line.trim()).filter(Boolean);
            const result: AiResult = {
              mode: 'reading',
              summary: lines[0] || aiOcr.text.slice(0, 120),
              details: lines.slice(1),
              warnings: [],
              confidence: 'high',
              shouldStop: false,
              demo: false,
              source: aiOcr.source === 'user' ? 'your-ai-key' : 'ai-ocr',
            };
            setAiResult(result);
            setResponse(result.summary);
            announce('Read with AI text reading.', 'online');
            speak(result.summary);
            setIsAnalyzing(false);
            return;
          }
          // AI OCR found no readable text either — fall through to the
          // general reading path so the user still gets a spoken answer.
          announce('No readable text found. Asking the cloud model for a better read.', 'busy');
        } catch {
          announce('AI text reading unavailable. Asking the cloud model instead.', 'busy');
        }
      } catch {
        announce('Local reading failed. Asking the cloud model instead.', 'busy');
      }
      // isAnalyzing stays true; falls through into the existing Gemini flow below.
    } else {
      setIsAnalyzing(true);
      announce('Analyzing the current frame.', 'busy');
    }

    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), ANALYSIS_TIMEOUT_MS);

    // Ground the cloud answer in what the on-device detector actually measured
    // (deterministic, confidence-hedged) so the vision model confirms and
    // extends local sensing instead of inventing beyond it. Spatial modes only.
    const grounding = mode === 'navigation' || mode === 'environment' ? detectionGroundingPrompt(hazardState.detections) : '';
    const groundedPrompt = [grounding, nextPrompt.trim() || 'Analyze the current frame.'].filter(Boolean).join('\n\n');

    try {
      const httpResponse = await fetch(`${apiBaseUrl}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          prompt: groundedPrompt,
          imageDataUrl,
          followUp: opts?.followUp === true,
        }),
        signal: controller.signal,
      });

      if (!httpResponse.ok) {
        const errorBody = await httpResponse.json().catch(() => ({ error: 'Analysis failed.' }));
        throw new Error(typeof errorBody.error === 'string' ? errorBody.error : 'Analysis failed.');
      }

      const data = (await httpResponse.json()) as Partial<AiResult>;
      if (!data.summary) throw new Error('The server returned an unexpected response.');

      const result: AiResult = {
        mode,
        summary: data.summary,
        details: data.details ?? [],
        warnings: data.warnings ?? [],
        confidence: data.confidence ?? 'low',
        shouldStop: Boolean(data.shouldStop),
        demo: Boolean(data.demo),
        source: 'gemini',
      };

      setAiResult(result);
      setResponse(result.summary);
      announce(result.demo ? 'Demo response received (no API key configured).' : 'Analysis complete.', result.demo ? 'warning' : 'online');

      // Apply the same "binary before nuance" + confidence-aware discipline used by
      // the local hazard layer (docs/yolo-ocr-slam-plan.md #2.4): a low-confidence
      // cloud answer must not be spoken in the same tone as a confident one, and a
      // shouldStop result gets the same immediate-hazard haptic as the local layer
      // rather than only a spoken sentence that could be missed.
      if (result.shouldStop) {
        fireHapticEvent('hazard-immediate', hapticSettings);
        speak(`Caution. ${result.summary}`, 2, 'hazard-immediate');
      } else if (result.confidence === 'low') {
        speak(`I'm not fully sure, but: ${result.summary}`);
      } else {
        speak(result.summary);
      }

      // Record a journey for navigation sessions (best-effort, never blocks the UI).
      if (mode === 'navigation') {
        api
          .createJourney({ destination: nextPrompt.trim().slice(0, 200) || 'Current location', mode: 'NAVIGATION' })
          .catch(() => {});
      }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const message = isTimeout
        ? 'The analysis request timed out. Please try again.'
        : error instanceof Error
          ? error.message
          : 'Could not reach the backend.';

      setAiResult(null);
      setResponse(message);
      announce(message, 'error');
      speak(message);
    } finally {
      clearTimeout(timeout);
      analysisAbortRef.current = null;
      setIsAnalyzing(false);
    }
  }

  function cancelAnalysis() {
    analysisAbortRef.current?.abort();
  }

  // Blind-user-perspective audit (2026-08-07): "describe what is ahead" and
  // "read this" previously only switched tabs/mode and then told the user to
  // "press capture" — defeating the entire point of a hands-free voice
  // command for someone who may be walking with a cane in one hand. This
  // starts the camera if needed (waiting for the video element to actually
  // have a frame ready, not just for getUserMedia to resolve) and then
  // triggers the same analysis a manual "Capture & analyze" tap would.
  async function voiceCaptureAndAnalyze(mode: AnalysisMode, promptText: string, opts?: { followUp?: boolean }) {
    if (!cameraActive) {
      speak('Starting the camera.', 4, 'voice-camera-starting');
      await startCamera();
      // Wait for the video element to actually have pixels — getUserMedia
      // resolving does not guarantee a frame is paintable yet.
      const video = videoRef.current;
      if (video) {
        await new Promise<void>((resolve) => {
          if (video.videoWidth > 0) {
            resolve();
            return;
          }
          const onReady = () => {
            video.removeEventListener('loadeddata', onReady);
            resolve();
          };
          video.addEventListener('loadeddata', onReady);
          // Don't hang forever if the camera never produces a frame.
          setTimeout(() => {
            video.removeEventListener('loadeddata', onReady);
            resolve();
          }, 4000);
        });
      }
    }
    await analyzeFrame(mode, promptText, opts);
  }

  function repeatInstruction() {
    if (aiResult) speak(aiResult.summary);
  }

  async function saveReadingHistory() {
    if (!aiResult || aiResult.mode !== 'reading') return;
    const text = [aiResult.summary, ...aiResult.details].join('\n').trim();
    if (!text) return;
    try {
      const { entry } = await api.createReadingEntry({
        source: 'camera',
        extractedText: text.slice(0, 20_000),
        language,
      });
      setReadingEntries((prev) => [entry, ...(prev ?? [])]);
      announce('Saved to reading history.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not save reading history.', 'error');
    }
  }

  useEffect(() => {
    return () => {
      stopCamera();
      recognitionRef.current?.stop();
      stopSpeechNow();
      analysisAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const label = tabs.find((tab) => tab.key === activeTab)?.label ?? 'Assist';
    document.title = `watchora — ${label}`;
    // Blind-user-perspective audit (2026-08-07): without an explicit spoken cue,
    // a screen-reader user who taps a tab button gets zero feedback that the
    // screen changed — the title updates visually but is not automatically spoken.
    // Speak the tab name on every change (except initial mount where the app
    // shell itself already speaks a welcome).
  }, [activeTab]);

  // Announce tab changes through the live region so screen readers speak them.
  const tabAnnouncedRef = useRef(false);
  useEffect(() => {
    if (!tabAnnouncedRef.current) {
      tabAnnouncedRef.current = true;
      return;
    }
    const label = tabs.find((tab) => tab.key === activeTab)?.label ?? 'Assist';
    announce(`${label} tab`, 'online');
    speak(label, 5, `tab-${activeTab}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'routes' && places === null) {
      api
        .listPlaces()
        .then((res) => setPlaces(res.places))
        .catch(() => announce('Could not load saved places.', 'error'));
    }
    if (activeTab === 'sos') {
      if (contacts === null) {
        api
          .listContacts()
          .then((res) => setContacts(res.contacts))
          .catch(() => announce('Could not load emergency contacts.', 'error'));
      }
      if (assistanceRequests === null) {
        api
          .listAssistanceRequests()
          .then((res) => setAssistanceRequests(res.requests))
          .catch(() => announce('Could not load SOS history.', 'error'));
      }
    }
    if (activeTab === 'community' && incidents === null) {
      api
        .listIncidents()
        .then((res) => setIncidents(res.incidents))
        .catch(() => announce('Could not load community reports.', 'error'));
    }
    if (activeTab === 'settings') {
      if (readingEntries === null) {
        api
          .listReadingEntries()
          .then((res) => setReadingEntries(res.entries))
          .catch(() => announce('Could not load reading history.', 'error'));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // First-run onboarding (roadmap Phase 1): show once per user until completed,
  // persisted locally. Voice-first permission + feedback calibration.
  useEffect(() => {
    if (!localStorage.getItem(onboardingKey)) {
      // Small delay so the dashboard paints first, then the voice-first welcome speaks.
      const timer = setTimeout(() => setShowOnboarding(true), 600);
      return () => clearTimeout(timer);
    }
  }, [onboardingKey]);

  // Load saved accessibility preferences + the neural voice catalog once.
  useEffect(() => {
    api
      .getPreferences()
      .then((res) => {
        prefsLoadedRef.current = true;
        setVoiceRate(res.preferences.speechRate);
        if (res.preferences.voiceName) setVoice(res.preferences.voiceName);
      })
      .catch(() => announce('Could not load your saved settings.', 'warning'));
    api
      .ttsVoices()
      .then((res) => {
        setVoices(res.voices);
        if (res.voices.length) setLanguage(res.voices[0]!.language);
      })
      .catch(() => setVoices([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the displayed language label in sync with the chosen voice.
  useEffect(() => {
    if (!voices) return;
    const v = voices.find((item) => item.shortName === voice);
    if (v) setLanguage(v.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, voices]);

  // Persist preference changes (skip the first mount render before prefs load).
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    const timer = setTimeout(() => {
      api
        .updatePreferences({ speechRate: voiceRate, voiceName: voice })
        .catch(() => announce('Could not save your voice settings.', 'warning'));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRate, voice]);

  const selectedThemeClass = themeMode === 'Dark' ? 'theme-dark' : 'theme-light';
  const activeLabel = tabs.find((tab) => tab.key === activeTab)?.label || 'Assist';
  const visibleTabs =
    user.role === 'ADMIN'
      ? tabs
      : tabs.filter((tab) => tab.key !== 'admin' && (user.role === 'CAREGIVER' || tab.key !== 'caregiver'));

  // Only the nav surface for the current viewport may be in the accessibility
  // tree. Which one that is mirrors the CSS breakpoint exactly (COMPACT_NAV_MEDIA).
  const compactNav = useCompactNav();

  // Crossing the breakpoint while focus sits inside a nav surface would
  // otherwise leave `document.activeElement` inside a container that is now
  // display:none (and aria-hidden), which is an ARIA violation and strands a
  // keyboard or switch-control user with no announced position. Only the
  // surface for the current viewport is rendered, so focus has no business
  // being in either one after a breakpoint change. `<main>` is already
  // focusable (tabIndex={-1}) and holds the panel that tab selected, so moving
  // focus there leaves the user on the screen they were reading. Checked in
  // both directions: the surface being revealed is just as display:none as the
  // one being hidden.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body) return;
    if (!active.closest('.sidebar') && !active.closest('.bottom-nav')) return;
    document.getElementById('main-content')?.focus();
  }, [compactNav]);

  const renderTracking = () => (
    <div className="screen-grid tracking-grid">
      <section className="hero-panel panel">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span className="eyebrow">watchora assist</span>
          </div>
          <h2>Camera-to-voice assistance</h2>
          <p className="hero-subtitle">Point the camera, pick a mode, and get an instant spoken description of your surroundings.</p>
        </div>
        <div className="live-panel">
          <div className="live-panel-head">
            <span className="live-badge">LIVE</span>
            <span className="live-copy">Your camera</span>
          </div>
          <div className="video-frame large">
            <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview" />
            <div className="video-overlay tracking-overlay">
              <div className="overlay-pill">{cameraActive ? 'Camera connected' : 'Camera will appear here'}</div>
            </div>
            {hazardLayerEnabled && cameraActive
              ? hazardState.detections.map((detection, index) => (
                  <div
                    key={index}
                    className={`hazard-box ${detection.className}`}
                    style={{
                      left: `${detection.box.x * 100}%`,
                      top: `${detection.box.y * 100}%`,
                      width: `${detection.box.width * 100}%`,
                      height: `${detection.box.height * 100}%`,
                    }}
                  >
                    <span className="hazard-box-label">{detection.className}</span>
                  </div>
                ))
              : null}
          </div>
          <canvas ref={canvasRef} className="hidden-canvas" />

          <div
            className={`hazard-status-bar hazard-status-${hazardState.status}`}
            role="status"
            aria-live={hazardState.topHazard ? 'assertive' : 'off'}
          >
            <span className="hazard-status-dot" aria-hidden="true" />
            <span>
              {!hazardLayerEnabled
                ? 'Local hazard detection is off.'
                : hazardState.status === 'idle'
                  ? 'Local hazard detection ready — connect the camera to start.'
                  : hazardState.status === 'warming-up'
                    ? 'Loading local detection model…'
                    : hazardState.status === 'error'
                      ? `Local hazard detection unavailable: ${hazardState.errorMessage ?? 'unknown error'}`
                      : hazardState.topHazard
                        ? `${hazardState.topHazard.className} near ${hazardState.topHazard.bearingClock} o'clock`
                        : 'Path looks clear.'}
            </span>
            {hazardLayerEnabled && hazardState.status === 'running' ? (
              <span className="hazard-status-fps">{hazardState.fps} fps</span>
            ) : null}
            <button
              className="ghost-btn hazard-toggle"
              onClick={() => setHazardLayerEnabled((v) => !v)}
              aria-pressed={hazardLayerEnabled}
            >
              {hazardLayerEnabled ? 'Turn off local detection' : 'Turn on local detection'}
            </button>
          </div>

          <div className="tracking-actions">
            <button className="primary-btn" onClick={startCamera} disabled={cameraActive}>
              📡 Connect camera
            </button>
            <button className="secondary-btn" onClick={stopCamera} disabled={!cameraActive}>
              Stop camera
            </button>
          </div>


          <div className="analysis-mode-row" role="radiogroup" aria-label="Analysis mode">
            {analysisModes.map((mode) => (
              <button
                key={mode.key}
                className={`ghost-btn ${analysisMode === mode.key ? 'active' : ''}`}
                role="radio"
                aria-checked={analysisMode === mode.key}
                onClick={() => setAnalysisMode(mode.key)}
              >
                {mode.label}
              </button>
            ))}
          </div>

          <div className="coach-mode-row" role="radiogroup" aria-label="Vision coaching mode">
            {(
              [
                { key: 'off', label: 'Coaching off' },
                { key: 'navigation', label: '🧭 Navigation' },
                { key: 'reading', label: '📖 Reading' },
                { key: 'exploration', label: '🌍 Explore' },
                { key: 'shopping', label: '🛒 Shopping' },
              ] as Array<{ key: CoachMode; label: string }>
            ).map((m) => (
              <button
                key={m.key}
                className={`ghost-btn ${coachMode === m.key ? 'active' : ''}`}
                role="radio"
                aria-checked={coachMode === m.key}
                onClick={() => {
                  setCoachMode(m.key);
                  if (m.key !== 'off') {
                    speak(`${m.label.replace(/[🧭📖🌍🛒 ]/g, '')} mode on. Coaching is active.`, 5, 'voice-coach-ui');
                  } else {
                    speak('Navigation coaching off.', 5, 'voice-coach-ui');
                  }
                }}
              >
                <span aria-hidden="true">{m.label.match(/^[^\w\s]/) ? m.label[0] : ''}</span>{m.label.replace(/^[^\w\s]\s*/, '')}
              </button>
            ))}
          </div>
          {coachMode !== 'off' ? (
            <p className="coach-status" role="status" aria-live="polite">
              <span aria-hidden="true">🎙️</span> {coachMode === 'navigation' ? 'Navigation' : coachMode === 'reading' ? 'Reading' : coachMode === 'exploration' ? 'Exploration' : 'Shopping'} coaching
              {cameraActive && hazardLayerEnabled ? ' active — hazards announced with direction and clock position.' : ' — connect the camera to start.'}
            </p>
          ) : null}

          <div className="tracking-actions">
            <button
              className="primary-btn"
              onClick={() => analyzeFrame(analysisMode, prompt)}
              disabled={!cameraActive || isAnalyzing}
              aria-busy={isAnalyzing}
            >
              {isAnalyzing ? '⏳ Analyzing…' : '📸 Capture & analyze'}
            </button>
            {isAnalyzing ? (
              <button className="secondary-btn" onClick={cancelAnalysis}>
                <span aria-hidden="true">✋</span> Cancel
              </button>
            ) : (
              <>
                <button className="secondary-btn" onClick={repeatInstruction} disabled={!aiResult}>
                  <span aria-hidden="true">🔁</span> Repeat instruction
                </button>
                <button className="secondary-btn" onClick={stopSpeaking}>
                  <span aria-hidden="true">🔇</span> Stop speaking
                </button>
              </>
            )}
          </div>

          <div className="ai-result-panel panel" role="status" aria-live="polite">
            <p className="ai-result-summary">{response}</p>
            {aiResult ? (
              <>
                {aiResult.details.length > 0 ? (
                  <ul className="ai-result-details">
                    {aiResult.details.map((detail, index) => (
                      <li key={index}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
                {aiResult.warnings.length > 0 ? (
                  <div className="ai-result-warnings" role="alert">
                    {aiResult.warnings.map((warning, index) => (
                      <p key={index}><span aria-hidden="true">⚠️</span> {warning}</p>
                    ))}
                  </div>
                ) : null}
                <div className="ai-result-meta">
                  <span
                    className={`pill pill-${aiResult.confidence === 'high' ? 'success' : aiResult.confidence === 'medium' ? 'neutral' : 'warning'}`}
                  >
                    Confidence: {aiResult.confidence}
                  </span>
                  {aiResult.demo ? (
                    <span className="pill pill-neutral">Demo mode</span>
                  ) : aiResult.source === 'local-ocr' ? (
                    <span className="pill pill-success">Read locally, on this device</span>
                  ) : aiResult.source === 'ai-ocr' ? (
                    <span className="pill pill-success">Read with AI text reading</span>
                  ) : aiResult.source === 'your-ai-key' ? (
                    <span className="pill pill-success">Read with your AI key</span>
                  ) : (
                    <span className="pill pill-success">AI live</span>
                  )}
                  {aiResult.shouldStop ? <span className="pill pill-danger">Stop recommended</span> : null}
                </div>
                {aiResult.mode === 'reading' && (
                  <button className="ghost-btn" onClick={saveReadingHistory} aria-label="Save this reading to history">
                    <span aria-hidden="true">💾</span> Save to reading history
                  </button>
                )}
              </>
            ) : null}
          </div>

          <div className="quick-links">
            <button className="ghost-btn" onClick={() => setActiveTab('routes')}>
              <span aria-hidden="true">🗺️</span> Saved places
            </button>
            <button className="ghost-btn" onClick={() => setActiveTab('community')}>
              <span aria-hidden="true">🛡️</span> Community reports
            </button>
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          // Blind-user-perspective audit (2026-08-07): a bare hash-link skip
          // link scrolls but does not reliably move actual keyboard/screen-
          // reader focus in every browser (notably Safari/VoiceOver on
          // macOS/iOS) — verified via a real headless run that
          // document.activeElement stayed on <body> after activating this
          // link. Without focus actually moving, the very next Tab press
          // resumes from wherever it was, defeating the point of a skip
          // link. Force it explicitly rather than relying on default hash
          // navigation.
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to main content
      </a>
      {/* Blind-user-perspective audit (2026-08-07): announce() (used ~85
          times throughout this component for camera errors, journey status,
          SOS confirmations, saved-place/contact confirmations, etc.) only
          ever updated the visible .status-chip text — a plain div with no
          aria-live. Screen readers never announced any of it unless that
          exact element already had focus. Worse, .status-chip lives inside
          .sidebar, which is display:none on the mobile breakpoint (the
          layout the app's own PWA design targets), so on a phone those
          messages were completely invisible AND unannounced: a silent
          failure for exactly the population this app serves. This is a
          dedicated, always-present, visually-hidden live region so every
          announce() call is actually spoken by TalkBack/VoiceOver/NVDA
          regardless of viewport or which visual chip is or isn't rendered. */}
      <div
        className="sr-only"
        aria-live={statusTone === 'error' ? 'assertive' : 'polite'}
        role={statusTone === 'error' ? 'alert' : 'status'}
      >
        {statusMessage}
      </div>
      <div className={`app-shell ${selectedThemeClass}`}>
        {/* `aria-hidden` mirrors the stylesheet's `display: none` at the 720px
            breakpoint (styles.css:1193). It is redundant while the CSS loads,
            and load-bearing if it does not — see useCompactNav. */}
        <aside
          className="sidebar panel"
          aria-label="Primary navigation"
          aria-hidden={compactNav || undefined}
        >
          <div className="brand-block">
            <div className="brand-mark" aria-hidden="true">W</div>
            <div>
              {/* This is app-chrome branding, not page content — using a
                  heading here creates two <h1>s on the Assist tab (the
                  other is the actual page heading "Camera-to-voice
                  assistance"), which breaks the heading outline a screen
                  reader's "jump by heading" navigation relies on. */}
              <p className="brand-name">watchora</p>
              <p>{user.fullName}</p>
            </div>
          </div>
          {/* nav keeps its navigation landmark role; the tablist semantics
              live on an inner div so the region is still a landmark. The
              tablist is named so it is announced as "Dashboard sections, tab
              list" rather than an anonymous tab list. */}
          <nav className="sidebar-nav" aria-label="Dashboard sections">
            <div role="tablist" aria-label="Dashboard sections">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.key}
                  role="tab"
                  id={`tab-${tab.key}`}
                  aria-controls={`panel-${tab.key}`}
                  aria-selected={activeTab === tab.key}
                  className={`nav-item ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  <tab.icon className="size-5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>{tab.label}</strong>
                    <small>{tab.note}</small>
                  </span>
                </button>
              ))}
            </div>
          </nav>
          <div className="sidebar-footer">
            <div className={`status-chip ${statusTone}`}>{statusMessage}</div>
            <button className="ghost-btn" onClick={onLogout}>
              Log out
            </button>
          </div>
        </aside>

        <div className="content-shell">
          <header className="topbar panel">
            <div>
              <p className="topbar-kicker">watchora</p>
              {/* Single h1 per screen. Blind users navigate by heading
                  (VoiceOver rotor / TalkBack "navigate by heading"); every
                  screen must have exactly one level-1 heading so the outline
                  is predictable and the current screen is always announced.
                  Tab bodies use h2/h3 below this. */}
              <h1>{activeLabel}</h1>
            </div>
            <div className="topbar-actions">
              <button
                className={buttonVariants({ variant: 'destructive', size: 'md' })}
                onClick={() => setActiveTab('sos')}
              >
                <Siren className="size-5" aria-hidden="true" /> SOS
              </button>
            </div>
          </header>

          <main id="main-content" className="main-content" tabIndex={-1}>
            {activeTab === 'home' && (
              <section role="tabpanel" id="panel-home" aria-labelledby="tab-home" className="tab-panel">
                <VoiceFirstDashboard
                  permissionService={permissionService}
                  emergency={homeEmergency}
                  activeJourney={homeJourney}
                  offline={!navigator.onLine}
                  voiceState={voiceAssistant.state}
                  hazardActive={hazardActive || hazardState.topHazard != null && hazardState.topHazard.className === 'person'}
                  places={places ?? []}
                  onOrbToggle={() => voiceAssistant.toggleListening()}
                  onOpenTab={(t) => setActiveTab(t as TabKey)}
                  onOpenPermissions={() => setShowPermissions(true)}
                  registerVoiceCancel={(fn) => {
                    // The SOS activation countdown lives inside
                    // EmergencyControl; this is the only handle the voice
                    // layer has on it. Publishing it here is what makes the
                    // component's spoken "Say cancel to stop" true — the
                    // voiceEmergencyRef was declared and read for the lifetime
                    // of the app but never assigned, so spoken "cancel"
                    // silently did nothing and the emergency fired anyway.
                    voiceEmergencyRef.current = fn;
                  }}
                  onEmergency={() => {
                    setActiveTab('sos');
                    announce('Emergency requested. Use the emergency screen to share your location.', 'error');
                    speak('Emergency requested. Use the emergency screen to share your location.', 1, 'dash-emergency');
                  }}
                  onCancelEmergency={() => {
                    if (!homeEmergency.sessionId) return;
                    api
                      .cancelEmergency(homeEmergency.sessionId)
                      .then(() => {
                        setHomeEmergency({ state: 'idle' });
                        announce('Emergency cancelled.', 'online');
                        speak('Emergency cancelled.', 2, 'dash-emergency-cancelled');
                      })
                      .catch(() => announce('Could not cancel the emergency. Try again from the emergency screen.', 'error'));
                  }}
                  onResolveEmergency={() => {
                    if (!homeEmergency.sessionId) return;
                    api
                      .resolveEmergency(homeEmergency.sessionId)
                      .then(() => {
                        setHomeEmergency({ state: 'idle' });
                        announce('Emergency resolved.', 'online');
                        speak('Emergency resolved.', 2, 'dash-emergency-resolved');
                      })
                      .catch(() => announce('Could not resolve the emergency. Try again from the emergency screen.', 'error'));
                  }}
                  speak={speak as (text: string, priority?: number, dedupeKey?: string) => void}
                />
              </section>
            )}
            {activeTab === 'tracking' && (
              <section role="tabpanel" id="panel-tracking" aria-labelledby="tab-tracking" className="tab-panel">
                {renderTracking()}
              </section>
            )}
            {activeTab === 'routes' && (
              <section role="tabpanel" id="panel-routes" aria-labelledby="tab-routes" className="tab-panel">
                <PlacesTab places={places} onCreated={(place) => setPlaces((prev) => [place, ...(prev ?? [])])} onDeleted={(id) => setPlaces((prev) => (prev ?? []).filter((p) => p.id !== id))} announce={announce} speak={speak} />
              </section>
            )}
            {activeTab === 'journey' && (
              <section role="tabpanel" id="panel-journey" aria-labelledby="tab-journey" className="tab-panel">
                <SafeJourneyTab contacts={contacts} onNeedContacts={() => setActiveTab('sos')} announce={announce} speak={speak} permissionService={permissionService} />
              </section>
            )}
            {activeTab === 'sos' && (
              <section role="tabpanel" id="panel-sos" aria-labelledby="tab-sos" className="tab-panel">
                <SosTab
                  contacts={contacts}
                  assistanceRequests={assistanceRequests}
                  onContactCreated={(contact) =>
                    // Upsert, not append. SosTab calls this for a NEW contact
                    // and also for an UPDATED one (toggling live-location or
                    // management consent passes the whole contact back), and
                    // the call sites even say "replace in list" — but this
                    // appended unconditionally, so flipping a consent toggle
                    // duplicated the contact row instead of updating it. A
                    // blind user toggling a privacy consent for their trusted
                    // contact would hear the row appear twice.
                    setContacts((prev) => {
                      const list = prev ?? [];
                      return list.some((c) => c.id === contact.id)
                        ? list.map((c) => (c.id === contact.id ? contact : c))
                        : [...list, contact];
                    })
                  }
                  onContactDeleted={(id) => setContacts((prev) => (prev ?? []).filter((c) => c.id !== id))}
                  onRequestCreated={(req) => setAssistanceRequests((prev) => [req, ...(prev ?? [])])}
                  onRequestResolved={(req) => setAssistanceRequests((prev) => (prev ?? []).map((r) => (r.id === req.id ? req : r)))}
                  announce={announce}
                  speak={speak}
                />
              </section>
            )}
            {activeTab === 'community' && (
              <section role="tabpanel" id="panel-community" aria-labelledby="tab-community" className="tab-panel">
                <CommunityTab incidents={incidents} onCreated={(incident) => setIncidents((prev) => [incident, ...(prev ?? [])])} announce={announce} speak={speak} />
              </section>
            )}
            {activeTab === 'caregiver' && user.role !== 'BLIND_USER' && (
              <section role="tabpanel" id="panel-caregiver" aria-labelledby="tab-caregiver" className="tab-panel">
                <CaregiverTab announce={announce} />
              </section>
            )}
            {activeTab === 'settings' && (
              <section role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" className="tab-panel">
                <SettingsTab
                  user={user}
                  language={language}
                  themeMode={themeMode}
                  onThemeChange={setThemeMode}
                  voiceRate={voiceRate}
                  onVoiceRateChange={(updater) => {
                    setVoiceRate((prev) => {
                      const next = typeof updater === 'function' ? updater(prev) : updater;
                      speak(getVoiceTestPhrase(voice), 4, 'test-voice-btn', next);
                      return next;
                    });
                  }}
                  voice={voice}
                  voices={voices}
                  onVoiceChange={(v) => {
                    setVoice(v);
                    speak(getVoiceTestPhrase(v), 4, 'voice-change-test', voiceRate);
                  }}
                  onTestVoice={() => speak(getVoiceTestPhrase(voice), 4, 'test-voice-btn', voiceRate)}
                  hapticSettings={hapticSettings}
                  onHapticSettingsChange={setHapticSettings}
                  onTestHaptic={() => fireHapticEvent('hazard-nearby', hapticSettings)}
                  voiceSettings={voiceAssistant.settings}
                  onVoiceSettingsChange={(patch) => {
                    voiceAssistant.setSettings(patch);
                    if ('verbosity' in patch && patch.verbosity !== undefined) {
                      speechManagerRef.current?.setVerbosity(patch.verbosity);
                      const levelName = patch.verbosity === 0 ? 'Essential: only hazards and emergencies will speak.' : patch.verbosity === 2 ? 'Detailed: all narration enabled.' : 'Standard detail level.';
                      speak(`Detail level ${levelName} Emergency warnings always speak.`, 5, 'settings-verbosity');
                    }
                    if ('pushToTalk' in patch) {
                      if (patch.pushToTalk) {
                        speak('Hands-free voice control off. Press the talk button to use your voice.', 5, 'settings-handsfree');
                      } else {
                        speak('Hands-free voice control on. Say Hey Watchora, then your command.', 5, 'settings-handsfree');
                      }
                    }
                    if ('wakePhraseEnabled' in patch) {
                      speak(
                        patch.wakePhraseEnabled
                          ? 'Wake phrase on. Say Hey Watchora before each command.'
                          : 'Wake phrase off. Watchora will respond to every command directly.',
                        5,
                        'settings-wake',
                      );
                    }
                  }}
                  onLogout={onLogout}
                  readingEntries={readingEntries}
                  announce={announce}
                  speak={speak}
                  onDeleteReading={async (id) => {
                    try {
                      await api.deleteReadingEntry(id);
                      setReadingEntries((prev) => (prev ?? []).filter((r) => r.id !== id));
                      announce('Reading entry deleted.', 'online');
                    } catch (error) {
                      announce(error instanceof ApiError ? error.message : 'Could not delete reading entry.', 'error');
                    }
                  }}
                />
              </section>
            )}
            {activeTab === 'admin' && user.role === 'ADMIN' && (
              <section role="tabpanel" id="panel-admin" aria-labelledby="tab-admin" className="tab-panel">
                <AdminTab announce={announce} />
              </section>
            )}
          </main>
        </div>

        {/* The mirror image of the sidebar: visible only below 720px
            (styles.css:1207), and aria-hidden above it so exactly one of the
            two nav surfaces is ever in the accessibility tree. */}
        <nav
          className="bottom-nav panel"
          aria-label="Mobile navigation"
          aria-hidden={!compactNav || undefined}
        >
          <div role="tablist" className="bottom-nav-tablist" aria-label="Dashboard sections">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                id={`tab-mobile-${tab.key}`}
                aria-controls={`panel-${tab.key}`}
                aria-selected={activeTab === tab.key}
                className={`bottom-nav-item ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <tab.icon className="size-5" aria-hidden="true" />
                <strong>{tab.label}</strong>
              </button>
            ))}
          </div>
        </nav>
      </div>
      {showOnboarding ? (
        <PermissionOnboarding
          service={permissionService}
          voice={voice}
          onVoiceChange={(v) => {
            setVoice(v);
          }}
          onVoiceRateChange={(r) => {
            setVoiceRate(r);
          }}
          testVoice={() => {
            const phrase = getVoiceTestPhrase(voice);
            speak(phrase, 4, 'test-voice-btn', voiceRate);
          }}
          speak={speak as (text: string, priority?: number, dedupeKey?: string, rate?: number) => void}
          onComplete={(result: OnboardingResult) => {
            localStorage.setItem(onboardingKey, '1');
            setVoiceRate(result.speechRate);
            const chosenVoice = result.selectedVoice || voice;
            if (result.selectedVoice) setVoice(result.selectedVoice);
            setHapticSettings({
              hapticsEnabled: result.hapticsEnabled,
              toneEnabled: result.toneEnabled,
              intensity: result.intensity,
            });
            setShowOnboarding(false);
            const msg = getStepSpeech('summary', chosenVoice);
            announce(msg || 'Setup complete.', 'online');
            speak(msg || 'Setup complete.', 5, undefined, result.speechRate);
          }}
        />
      ) : null}

      {showPermissions ? (
        <div className="modal-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setShowPermissions(false)}>
          <PermissionCenter service={permissionService} onClose={() => setShowPermissions(false)} />
        </div>
      ) : null}
    </>
  );
}

export default App;
