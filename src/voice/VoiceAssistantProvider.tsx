// Central voice assistant provider (v0.5). One coordinated service for all
// voice input: mic lifecycle, speech recognition, push-to-talk, hands-free
// wake-phrase listening, command routing, confirmation, and error recovery.
// All voice output still goes through the existing speech-priority system.
//
// Hands-free is the DEFAULT control mode (blind users cannot be expected to
// find and tap a mic button): the app listens continuously, ignores everything
// until it hears a wake phrase ("Hey Watchora"), and then routes the command
// that follows. Push-to-talk remains as a fallback for when hands-free is
// disabled, permission is denied, or the browser does not support the API.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CommandRouter, LOW_CONFIDENCE_MESSAGE } from './commandRouter';
import { matchDeterministicCommand } from './deterministicCommands';
import { matchFeelingPhrase } from './companion';
import { EMERGENCY_PRIORITY_INTENTS } from './voiceTypes';
import { ConfirmationManager } from './confirmationManager';
import { DEFAULT_VOICE_SETTINGS, isHandsFree, HANDS_FREE_ONBOARDING, MIC_PERMISSION_REQUEST, MIC_UNAVAILABLE_MESSAGE, STT_UNAVAILABLE_MESSAGE, type VoiceIntent, type VoiceSettings } from './voiceTypes';
import { api as apiClient } from '../api';
import { loadVoiceSettings, saveVoiceSettings } from './voiceSettingsStorage';
import { decideHandsFreeAction } from './handsFreeSession';
import { setRecentCommandContext } from './aiIntentParser';

export type VoiceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'permission-needed'
  | 'offline'
  | 'error'
  | 'unsupported';

export interface VoiceAssistantApi {
  state: VoiceState;
  transcript: string;
  lastIntent: VoiceIntent | null;
  supported: boolean;
  micPermission: boolean;
  settings: VoiceSettings;
  setSettings: (s: Partial<VoiceSettings>) => void;
  startListening: () => void;
  stopListening: () => void;
  toggleListening: () => void;
  speak: (text: string) => void;
  routeText: (text: string) => Promise<VoiceIntent>;
  handleTranscript: (text: string) => Promise<void>;
  confirmation: ConfirmationManager;
  /** True when hands-free listening is active or paused (i.e. the mode is on). */
  handsFree: boolean;
  /** True when a wake phrase has been heard and a command is expected next. */
  wakeArmed: boolean;
}

const Ctx = createContext<VoiceAssistantApi | null>(null);

export function useVoiceAssistant(): VoiceAssistantApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVoiceAssistant must be used inside VoiceAssistantProvider');
  return v;
}

export type VoiceAssistantProps = {
  children: ReactNode;
  onCommand: (intent: VoiceIntent) => void;
  /** Fired when the user starts talking (barge-in): stops any in-progress speech. */
  onBargeIn?: () => void;
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
  getVoiceSettings?: () => VoiceSettings;
  /** Optional AI intent parser (Gemini) for flexible wording. */
  aiParser?: CommandRouter['aiParser'];
  offline?: boolean;
  /** Bridge whose onSpeechChange the provider subscribes to, so recognition
   * pauses while Watchora itself is speaking (the mic would otherwise hear
   * its own voice and could loop). Optional for tests. */
  bridge?: { current: { onSpeechChange: ((speaking: boolean) => void) | null } };
};

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getRecognitionCtor(): (new () => RecognitionLike) | undefined {
  const w = window as Window & { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

/** How long to keep waiting for the command after a bare wake phrase. */
const WAKE_COMMAND_TIMEOUT_MS = 12_000;
/** Delay before restarting recognition after it ends (Chrome drops the
 * connection periodically; a short pause avoids a hot error loop). */
const RESTART_DELAY_MS = 700;
/** Delay after TTS finishes before listening resumes (let echo fade). */
const RESUME_AFTER_SPEECH_MS = 450;
/** If onstart has not fired this long after rec.start(), the recognizer is a
 *  dud (API present but the WebView has no mic entitlement — it silently
 *  never starts). Without this watchdog the orb would claim "Listening"
 *  forever while nothing hears anything. */
const START_WATCHDOG_MS = 4_000;
/** Consecutive dead starts before voice gives up honestly instead of retrying
 *  in a silent loop. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Tap-to-dictate fallback (server transcription): recording limits. */
const DICTATION_MAX_MS = 20_000;
/** Recordings smaller than this are treated as "nothing was heard". */
const MIN_DICTATION_BYTES = 1_200;
/** MediaRecorder mime candidates, best first. */
const RECORDER_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return RECORDER_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export function VoiceAssistantProvider({ children, onCommand, speak: speakProp, getVoiceSettings, aiParser, offline, onBargeIn, bridge }: VoiceAssistantProps) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastIntent, setLastIntent] = useState<VoiceIntent | null>(null);
  const [settings, setSettingsState] = useState<VoiceSettings>(() => getVoiceSettings?.() ?? loadVoiceSettings(DEFAULT_VOICE_SETTINGS));
  const [micPermission, setMicPermission] = useState<boolean>(() => (typeof navigator !== 'undefined' ? true : false));
  const [wakeArmed, setWakeArmed] = useState(false);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const routerRef = useRef<CommandRouter | null>(null);
  const confirmRef = useRef<ConfirmationManager | null>(null);
  const speakRef = useRef(speakProp);
  const onCommandRef = useRef(onCommand);
  const onBargeInRef = useRef(onBargeIn);
  // activeRef: true while a recognition instance is actually live.
  const activeRef = useRef(false);
  // handsFreeOnRef: the hands-free session is enabled (may be paused for
  // speech or by the user; distinct from "a recognition instance is live").
  const handsFreeOnRef = useRef(false);
  const pausedByUserRef = useRef(false);
  const speechActiveRef = useRef(false);
  const wakeArmedRef = useRef(false);
  const welcomedRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopIntentionalRef = useRef(false);
  const permissionDeniedRef = useRef(false);
  // Dead-mic detection: some embedded browsers expose the SpeechRecognition
  // API but never actually start it (no mic entitlement). Track consecutive
  // dead starts; after a few, stop retrying and tell the user honestly.
  const consecutiveFailuresRef = useRef(0);
  const micUnavailableRef = useRef(false);
  const unavailableAnnouncedRef = useRef(false);
  const startWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Some recognizers fire onend immediately after start() with no onstart and
  // no error — the watchdog never gets its 4s because onend clears it. Saw
  // whether onstart actually ran before trusting an onend as a clean stop.
  const recognizerStartedRef = useRef(false);
  const appliedLangRef = useRef<string | null>(null);
  const appliedWakeRef = useRef<boolean | null>(null);
  // Tap-to-dictate (server STT fallback): MediaRecorder session state.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const dictationStreamRef = useRef<MediaStream | null>(null);
  const dictationChunksRef = useRef<Blob[]>([]);
  const dictationActiveRef = useRef(false);
  const dictationMimeRef = useRef('audio/webm');
  const dictationStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sttUnavailableAnnouncedRef = useRef(false);
  // Language hint lives in a ref so the dictation callbacks (captured once by
  // memoized callers) always send the current setting.
  const languageHintRef = useRef(settings.language);
  // Indirection so dictation (defined before handleTranscript) reaches the
  // latest transcript handler — same pattern as speakRef.
  const routeTranscriptRef = useRef<((text: string) => Promise<void>) | null>(null);

  speakRef.current = speakProp;
  onCommandRef.current = onCommand;
  onBargeInRef.current = onBargeIn;
  languageHintRef.current = settings.language;

  if (!routerRef.current) routerRef.current = new CommandRouter({ aiParser, offline: offline ?? false });
  if (!confirmRef.current) confirmRef.current = new ConfirmationManager();

  const router = routerRef.current;
  const confirmation = confirmRef.current;
  const supported = useMemo(() => typeof getRecognitionCtor() === 'function', []);

  const handsFree = isHandsFree(settings);

  useEffect(() => {
    router.setOffline(offline ?? false);
  }, [offline, router]);

  useEffect(() => {
    router.setAiParser(aiParser ?? null);
  }, [aiParser, router]);

  // Keep handsFreeOnRef in sync with the setting, and (re)start/stop the
  // session when the mode flips. Also restart recognition when the wake
  // phrase or language setting changes, so the live session always reflects
  // the user's current choice.
  useEffect(() => {
    handsFreeOnRef.current = handsFree;
    const langChanged = appliedLangRef.current != null && appliedLangRef.current !== settings.language;
    const wakeChanged = appliedWakeRef.current != null && appliedWakeRef.current !== settings.wakePhraseEnabled;
    if (langChanged || wakeChanged) {
      appliedLangRef.current = null;
      appliedWakeRef.current = null;
      stopRecognition();
    }
    if (!handsFree) {
      pausedByUserRef.current = false;
      wakeArmedRef.current = false;
      setWakeArmed(false);
      // Full reset: re-enabling hands-free later gets a fresh attempt even
      // after the mic was declared unavailable.
      micUnavailableRef.current = false;
      consecutiveFailuresRef.current = 0;
      stopRecognition();
    } else if (supported && !permissionDeniedRef.current && !micUnavailableRef.current) {
      resumeHandsFree();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree, supported, settings.language, settings.wakePhraseEnabled]);

  // Subscribe to speech lifecycle so recognition pauses while TTS plays.
  useEffect(() => {
    if (!bridge) return;
    bridge.current.onSpeechChange = (speaking: boolean) => {
      speechActiveRef.current = speaking;
      if (dictationActiveRef.current) {
        // Tap-to-dictate owns the mic right now: no hands-free pause/resume
        // churn, or a speech-end would restart recognition over the recording.
        return;
      }
      if (speaking) {
        // The mic would hear Watchora's own voice. Stop listening now;
        // it resumes after speech ends (RESUME_AFTER_SPEECH_MS).
        clearRestartTimer();
        clearResumeTimer();
        stopRecognition();
        if (handsFreeOnRef.current) {
          // Keep the session "on" but visually paused during speech.
          setState('speaking');
        }
      } else {
        if (handsFreeOnRef.current && !pausedByUserRef.current) {
          resumeTimerRef.current = setTimeout(() => {
            resumeTimerRef.current = null;
            resumeHandsFree();
          }, RESUME_AFTER_SPEECH_MS);
        } else if (handsFreeOnRef.current) {
          // The pause paths ('paused' on user tap, 'unsupported' after the
          // mic give-up) set their state before this announcement started,
          // and the announcement's own onstart flipped it to 'speaking'.
          // Restore the honest terminal state here or the orb would stay on
          // "Speaking" forever, with nothing actually playing.
          setState(micUnavailableRef.current ? 'unsupported' : 'paused');
        }
      }
    };
    return () => {
      bridge.current.onSpeechChange = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      recognitionRef.current?.abort();
      clearRestartTimer();
      clearResumeTimer();
      clearStartWatchdog();
      // Dictation teardown: null the transcript handler first so a late
      // onstop can't fire a command after the app is gone.
      routeTranscriptRef.current = null;
      clearDictationTimer();
      dictationActiveRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      dictationStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function clearRestartTimer() {
    if (restartTimerRef.current != null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }

  function clearResumeTimer() {
    if (resumeTimerRef.current != null) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }

  function clearStartWatchdog() {
    if (startWatchdogRef.current != null) {
      clearTimeout(startWatchdogRef.current);
      startWatchdogRef.current = null;
    }
  }

  /** Arms the dead-start watchdog right after rec.start() succeeded without
   *  throwing. Fires only if onstart never arrived. */
  function armStartWatchdog() {
    clearStartWatchdog();
    startWatchdogRef.current = setTimeout(() => {
      startWatchdogRef.current = null;
      if (activeRef.current) handleDeadStart();
    }, START_WATCHDOG_MS);
  }

  /** A real session started: the watchdog is no longer needed. Failures only
   *  reset when actual results arrive — some embedded recognizers start fine
   *  and still can't hear anything (backend network error right after start). */
  function markRecognizerAlive() {
    clearStartWatchdog();
  }

  /** Persistent mic failure: stop every retry path and say so out loud.
   *  Typing (TypeToJarvis) still works — the state steers the user there. */
  function declareMicUnavailable() {
    micUnavailableRef.current = true;
    pausedByUserRef.current = true;
    activeRef.current = false;
    recognitionRef.current = null;
    clearStartWatchdog();
    setState('unsupported');
    if (!unavailableAnnouncedRef.current) {
      unavailableAnnouncedRef.current = true;
      // Priority 6 (description level): a command answer (priority 5) must
      // always preempt or queue ahead of this notice — answers beat notices.
      speakRef.current(MIC_UNAVAILABLE_MESSAGE, 6, 'mic-unavailable');
    }
  }

  function clearDictationTimer() {
    if (dictationStopTimerRef.current != null) {
      clearTimeout(dictationStopTimerRef.current);
      dictationStopTimerRef.current = null;
    }
  }

  function releaseDictationStream() {
    dictationStreamRef.current?.getTracks().forEach((track) => track.stop());
    dictationStreamRef.current = null;
  }

  /** Tear the recording session down without sending anything (error path). */
  function cancelDictation() {
    clearDictationTimer();
    dictationActiveRef.current = false;
    dictationChunksRef.current = [];
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    releaseDictationStream();
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* already dead */ }
    }
    setState('idle');
  }

  /** Tap-to-dictate: record with MediaRecorder, send the clip to the server's
   *  /api/stt/transcribe endpoint (whisper), and route the transcript through
   *  the same command brain as typed text. This is the input path that
   *  actually works in embedded browsers whose SpeechRecognition backend
   *  never connects. */
  async function startDictation() {
    if (dictationActiveRef.current) return;
    const mime = pickRecorderMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      if (!unavailableAnnouncedRef.current) {
        unavailableAnnouncedRef.current = true;
        speakRef.current(MIC_UNAVAILABLE_MESSAGE, 6, 'mic-unavailable');
      }
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      permissionDeniedRef.current = true;
      setMicPermission(false);
      setState('permission-needed');
      speakRef.current(MIC_PERMISSION_REQUEST, 5, 'mic-permission-request');
      return;
    }
    dictationStreamRef.current = stream;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      releaseDictationStream();
      setState('unsupported');
      return;
    }
    mediaRecorderRef.current = recorder;
    dictationMimeRef.current = mime;
    dictationChunksRef.current = [];
    dictationActiveRef.current = true;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) dictationChunksRef.current.push(event.data);
    };
    recorder.onstop = () => { void finishDictation(); };
    recorder.onerror = () => { cancelDictation(); };
    try {
      recorder.start();
    } catch {
      dictationActiveRef.current = false;
      mediaRecorderRef.current = null;
      releaseDictationStream();
      setState('error');
      return;
    }
    // The mic must not hear Watchora's own voice: stop any speech now, and
    // nothing new is spoken until the clip has been sent.
    onBargeInRef.current?.();
    setState('listening');
    if ('vibrate' in navigator) navigator.vibrate([30, 40, 30]);
    dictationStopTimerRef.current = setTimeout(() => {
      dictationStopTimerRef.current = null;
      if (dictationActiveRef.current) stopDictation();
    }, DICTATION_MAX_MS);
  }

  /** User tapped again (or the 20s cap hit): stop recording and send. */
  function stopDictation() {
    clearDictationTimer();
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      dictationActiveRef.current = false;
      mediaRecorderRef.current = null;
      releaseDictationStream();
      setState('idle');
      return;
    }
    recorder.stop(); // onstop → finishDictation
  }

  async function finishDictation() {
    clearDictationTimer();
    mediaRecorderRef.current = null;
    releaseDictationStream();
    if (!dictationActiveRef.current) return; // error path already cleaned up
    dictationActiveRef.current = false;
    const blob = new Blob(dictationChunksRef.current, { type: dictationMimeRef.current });
    dictationChunksRef.current = [];
    if (blob.size < MIN_DICTATION_BYTES) {
      setState('idle');
      speakRef.current("I didn't hear anything. Tap the orb and speak again, or type your command.", 5, 'dictation-empty');
      return;
    }
    setState('processing');
    try {
      const result = await apiClient.sttTranscribe(blob, languageHintRef.current);
      const text = result.transcript.trim();
      if (!text) {
        setState('idle');
        speakRef.current("I didn't catch that. Tap the orb and speak again, or type your command.", 5, 'dictation-empty');
        return;
      }
      setTranscript(text);
      await routeTranscriptRef.current?.(text);
    } catch {
      // Server transcription unavailable (unconfigured or upstream error):
      // say it once per session, then fall back to honest idle.
      setState('idle');
      if (!sttUnavailableAnnouncedRef.current) {
        sttUnavailableAnnouncedRef.current = true;
        speakRef.current(STT_UNAVAILABLE_MESSAGE, 6, 'stt-unavailable');
      } else {
        speakRef.current('Voice transcription failed. Please try again, or type your command.', 5, 'dictation-failed');
      }
    }
  }

  /** onstart never fired (or start threw): one dead attempt. Give hands-free a
   *  couple of retries (transient Chrome flakiness) before declaring the mic
   *  unavailable; push-to-talk just reports the error. */
  function handleDeadStart() {
    activeRef.current = false;
    recognitionRef.current = null;
    consecutiveFailuresRef.current += 1;
    if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
      declareMicUnavailable();
      return;
    }
    if (handsFreeOnRef.current && !pausedByUserRef.current && !stopIntentionalRef.current) {
      scheduleRestart();
    } else if (!handsFreeOnRef.current) {
      setState('error');
    }
  }

  const setSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      saveVoiceSettings(next);
      return next;
    });
  }, []);

  /** A general-knowledge answer from the AI intent endpoint ("what is the
   *  capital of France") arrives as intent 'general_question' with the spoken
   *  answer in parameters.answer. Returns the trimmed answer, capped for TTS,
   *  or null when the intent isn't one or no usable text came back. */
  function generalAnswerText(intent: VoiceIntent): string | null {
    if (intent.intent !== 'general_question') return null;
    const raw = intent.parameters.answer;
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text ? text.slice(0, 500) : null;
  }

  /** Routes a final transcript through the router and executes it. */
  const runCommand = useCallback(
    async (text: string) => {
      setState('processing');
      // Emotional companion: opt-in feeling phrases are matched locally
      // (deterministic, never sent to AI) and answered before the command
      // router sees them — "I'm scared" must never be treated as an unknown
      // command. Safety commands still win: if the transcript ALSO matches a
      // deterministic safety intent, the router path takes precedence below.
      const feeling = matchFeelingPhrase(text);
      const deterministicSafety = matchDeterministicCommand(text);
      const isSafetyCommand = deterministicSafety && EMERGENCY_PRIORITY_INTENTS.includes(deterministicSafety.intent);
      if (feeling && !isSafetyCommand) {
        speakRef.current(feeling.text, feeling.priority);
        setLastIntent({ intent: 'help', parameters: { companion: 'feeling' }, confidence: 1, requiresConfirmation: false, deterministic: true });
        setState('idle');
        return;
      }
      const intent = await router.route(text);
      setLastIntent(intent);
      if (confirmation.handleConfirmIntent(intent)) {
        setState('idle');
        return;
      }
      if (intent.intent === 'unknown') {
        speakRef.current(LOW_CONFIDENCE_MESSAGE, 5);
        setState('idle');
        return;
      }
      // General questions get a real spoken answer from the same single AI
      // round-trip that parses commands — never the canned help message.
      const answer = generalAnswerText(intent);
      if (answer) {
        speakRef.current(answer, 5);
        setState('idle');
        return;
      }

      // Compound commands ("open settings and save this place as home"): the
      // server returned a validated list; `commands` holds the remaining
      // entries after the primary. Execute in spoken order. If a later entry
      // is confirmation-gated, run it (its own confirmation flow starts) and
      // drop the rest — never auto-run actions after a pending confirmation.
      const rest = intent.commands ?? [];
      if (rest.length > 0) {
        for (const sub of rest) {
          if (sub.intent === 'unknown') continue;
          onCommandRef.current(sub);
          if (sub.requiresConfirmation) break;
        }
      }

      // Ephemeral recent-command context so pronoun follow-ups ("take me
      // there again") resolve against what just happened. Kept short.
      const paramSummary = intent.parameters.destination
        ? `navigating to "${intent.parameters.destination}"`
        : Object.keys(intent.parameters).length > 0
          ? `${intent.intent} ${JSON.stringify(intent.parameters).slice(0, 120)}`
          : intent.intent;
      setRecentCommandContext(paramSummary);

      onCommandRef.current(intent);
      setState('idle');
    },
    [router, confirmation],
  );

  const stopRecognition = useCallback(() => {
    clearRestartTimer();
    clearStartWatchdog();
    if (activeRef.current || recognitionRef.current) {
      activeRef.current = false;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    if (handsFreeOnRef.current) {
      // User pressed the button to pause hands-free mode entirely.
      pausedByUserRef.current = true;
      wakeArmedRef.current = false;
      setWakeArmed(false);
      stopRecognition();
      setState('paused');
      return;
    }
    stopRecognition();
    setState('idle');
  }, [stopRecognition]);

  const startHandsFree = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setState('unsupported');
      return;
    }
    if (activeRef.current) return; // already listening
    if (permissionDeniedRef.current) {
      setState('permission-needed');
      return;
    }
    if (micUnavailableRef.current) {
      setState('unsupported');
      return;
    }
    // Barge-in: if the user is talking while TTS plays, stop the speech.
    if (speechActiveRef.current) onBargeInRef.current?.();
    activeRef.current = true;
    stopIntentionalRef.current = false;
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = settings.language === 'en' ? 'en-US' : settings.language === 'it' ? 'it-IT' : settings.language;
    appliedLangRef.current = settings.language;
    appliedWakeRef.current = settings.wakePhraseEnabled;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => {
      recognizerStartedRef.current = true;
      markRecognizerAlive();
      setState('listening');
      if (handsFreeOnRef.current && !welcomedRef.current) {
        welcomedRef.current = true;
        speakRef.current(HANDS_FREE_ONBOARDING, 5, 'hands-free-onboarding');
      }
    };
    rec.onresult = (event) => {
      if (speechActiveRef.current) return; // our own TTS, ignore
      let t = '';
      let isFinal = false;
      for (let i = 0; i < event.results.length; i++) {
        t += event.results[i][0].transcript;
        if ((event.results[i] as { isFinal?: boolean }).isFinal) isFinal = true;
      }
      t = t.trim();
      consecutiveFailuresRef.current = 0; // results prove the mic truly works
      if (!t) return;
      setTranscript(t);
      if (!isFinal) {
        // Interim result: if the user has spoken while TTS was (just) going,
        // treat it as a barge-in. Otherwise wait for the final result.
        if (speechActiveRef.current) onBargeInRef.current?.();
        return;
      }
      // Barge-in: the user talked over speech that was still playing.
      if (speechActiveRef.current) onBargeInRef.current?.();

      const decision = decideHandsFreeAction({
        transcript: t,
        wakePhraseEnabled: settings.wakePhraseEnabled,
        wakeArmed: wakeArmedRef.current,
      });
      wakeArmedRef.current = decision.wakeArmed;
      setWakeArmed(decision.wakeArmed);

      if (decision.command) {
        void runCommand(decision.command);
        return;
      }
      if (decision.promptForCommand) {
        // "Hey Watchora" alone: prompt for the command.
        setState('listening');
        if ('vibrate' in navigator) navigator.vibrate([30, 40, 30]);
        speakRef.current('Yes?', 4, 'wake-yes');
        // Time out the armed state so we don't wait forever.
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          restartTimerRef.current = null;
          if (wakeArmedRef.current) {
            wakeArmedRef.current = false;
            setWakeArmed(false);
          }
        }, WAKE_COMMAND_TIMEOUT_MS);
      }
      // No command and no prompt: the utterance was ignored (privacy).
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        permissionDeniedRef.current = true;
        setMicPermission(false);
        activeRef.current = false;
        recognitionRef.current = null;
        setState('permission-needed');
        speakRef.current(MIC_PERMISSION_REQUEST, 5, 'mic-permission-request');
        return;
      }
      if (event.error === 'audio-capture') {
        // No working microphone / audio capture device. Same honest outcome
        // as a dead start: stop retrying, tell the user, keep typing working.
        declareMicUnavailable();
        return;
      }
      if (event.error === 'network') {
        // Chrome's speech backend is unreachable (embedded browsers often hit
        // this forever even when the page loads fine). It is NOT a dead mic —
        // onstart fires and audio flows — but it never recovers by itself, so
        // count it toward the same honest give-up.
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          declareMicUnavailable();
          return;
        }
        setState('offline');
      } else if (event.error === 'no-speech') {
        consecutiveFailuresRef.current = 0; // mic works, room was just quiet
        setState('idle');
      } else if (event.error === 'aborted') {
        // Restart below handles it.
      } else {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          declareMicUnavailable();
          return;
        }
        setState('error');
      }
      activeRef.current = false;
      recognitionRef.current = null;
      // Hands-free keeps going through transient errors.
      if (handsFreeOnRef.current && !permissionDeniedRef.current && !stopIntentionalRef.current && !micUnavailableRef.current) {
        scheduleRestart();
      }
    };
    rec.onend = () => {
      clearStartWatchdog();
      if (!recognizerStartedRef.current && !stopIntentionalRef.current) {
        // onend without onstart: the recognizer is a silent dud, not a
        // finished session. Count it like any other dead start.
        handleDeadStart();
        return;
      }
      recognizerStartedRef.current = false;
      recognitionRef.current = null;
      activeRef.current = false;
      if (handsFreeOnRef.current && !stopIntentionalRef.current && !permissionDeniedRef.current && !micUnavailableRef.current) {
        // Chrome ends sessions periodically; silently restart.
        scheduleRestart();
      } else if (!handsFreeOnRef.current && !activeRef.current) {
        setState('idle');
      }
    };
    try {
      recognizerStartedRef.current = false;
      rec.start();
      armStartWatchdog();
    } catch {
      // Some browsers block mic start without a user gesture — or the
      // recognizer is a silent dud. Count it; honest give-up after a few.
      handleDeadStart();
    }
  }, [settings.language, settings.wakePhraseEnabled, runCommand, stopRecognition]);

  function scheduleRestart() {
    clearRestartTimer();
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      if (!activeRef.current && !dictationActiveRef.current && handsFreeOnRef.current && !pausedByUserRef.current && !speechActiveRef.current && !permissionDeniedRef.current && !micUnavailableRef.current) {
        startHandsFree();
      }
    }, RESTART_DELAY_MS);
  }

  function resumeHandsFree() {
    if (dictationActiveRef.current) return;
    pausedByUserRef.current = false;
    if (!handsFreeOnRef.current) return;
    if (speechActiveRef.current) return;
    startHandsFree();
  }

  // One-time fallback: if the browser refused the first auto-start (usually
  // because the page needs a user gesture for mic access), arm hands-free on
  // the very next interaction anywhere. No button needed — any tap works.
  useEffect(() => {
    if (!supported || !handsFree || permissionDeniedRef.current) return;
    const tryStart = () => {
      if (activeRef.current || dictationActiveRef.current || !handsFreeOnRef.current) return;
      startHandsFree();
    };
    // Only install if recognition is not already running shortly after mount.
    const firstCheck = setTimeout(() => {
      if (!activeRef.current) {
        window.addEventListener('pointerdown', tryStart, { once: true });
        window.addEventListener('keydown', tryStart, { once: true });
      }
    }, 1500);
    return () => {
      clearTimeout(firstCheck);
      window.removeEventListener('pointerdown', tryStart);
      window.removeEventListener('keydown', tryStart);
    };
  }, [supported, handsFree, startHandsFree]);

  const startListening = useCallback(() => {
    if (dictationActiveRef.current) {
      stopDictation(); // second tap sends the recording
      return;
    }
    if (!supported || micUnavailableRef.current) {
      // SpeechRecognition is a dud here (or already gave up honestly after
      // its retries): fall back to tap-to-dictate, the path that actually
      // works everywhere. Crucially, micUnavailableRef stays SET — clearing
      // it here used to restart the dead recognizer loop on every tap.
      void startDictation();
      return;
    }
    if (handsFreeOnRef.current) {
      // Resume the hands-free session. A tap is also a signal the user wants
      // voice control back, so clear earlier failures — the mic may have come
      // back (plugged in, permission granted in browser settings).
      permissionDeniedRef.current = false;
      consecutiveFailuresRef.current = 0;
      pausedByUserRef.current = false;
      // No optimistic state here: onstart flips the orb to listening, and the
      // watchdog flips it to unsupported if the recognizer never starts.
      startHandsFree();
      return;
    }
    // Push-to-talk one-shot.
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setState('unsupported');
      return;
    }
    if (activeRef.current) {
      stopListening();
      return;
    }
    onBargeInRef.current?.();
    activeRef.current = true;
    stopIntentionalRef.current = false;
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = settings.language === 'en' ? 'en-US' : settings.language === 'it' ? 'it-IT' : settings.language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => {
      recognizerStartedRef.current = true;
      markRecognizerAlive();
      setState('listening');
    };
    rec.onresult = (event) => {
      consecutiveFailuresRef.current = 0; // results prove the mic truly works
      let t = '';
      for (let i = 0; i < event.results.length; i++) {
        t += event.results[i][0].transcript;
      }
      setTranscript(t.trim());
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setMicPermission(false);
        setState('permission-needed');
      } else if (event.error === 'audio-capture') {
        declareMicUnavailable();
      } else if (event.error === 'network') {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          declareMicUnavailable();
        } else {
          setState('offline');
        }
      } else if (event.error === 'no-speech') {
        setState('idle');
      } else {
        setState('error');
      }
      activeRef.current = false;
      recognitionRef.current = null;
    };
    rec.onend = () => {
      clearStartWatchdog();
      if (!recognizerStartedRef.current && !stopIntentionalRef.current) {
        handleDeadStart();
        return;
      }
      recognizerStartedRef.current = false;
      activeRef.current = false;
      recognitionRef.current = null;
      if (!handsFreeOnRef.current) setState('idle');
    };
    try {
      recognizerStartedRef.current = false;
      rec.start();
      armStartWatchdog();
    } catch {
      handleDeadStart();
    }
  }, [supported, settings.language, startHandsFree, stopListening]);

  const toggleListening = useCallback(() => {
    if (handsFreeOnRef.current) {
      if (activeRef.current || state === 'speaking') {
        stopListening();
      } else {
        startListening();
      }
      return;
    }
    if (activeRef.current) stopListening();
    else startListening();
  }, [handsFreeOnRef, activeRef, state, stopListening, startListening]);

  const routeText = useCallback(
    async (text: string): Promise<VoiceIntent> => {
      setState('processing');
      const intent = await router.route(text);
      setLastIntent(intent);
      if (confirmation.handleConfirmIntent(intent)) {
        setState('idle');
        return intent;
      }
      return intent;
    },
    [router, confirmation],
  );

  const handleTranscript = useCallback(
    async (text: string) => {
      const intent = await routeText(text);
      if (intent.intent === 'unknown') {
        speakRef.current(LOW_CONFIDENCE_MESSAGE, 5);
        setState('idle');
        return;
      }
      const answer = generalAnswerText(intent);
      if (answer) {
        speakRef.current(answer, 5);
        setState('idle');
        return;
      }
      onCommandRef.current(intent);
      setState('idle');
    },
    [routeText],
  );

  // Latest transcript handler for the dictation fallback (assigned every
  // render, like speakRef) — dictation only holds the ref.
  routeTranscriptRef.current = handleTranscript;

  // Auto-start hands-free on mount if it is the default mode. Deliberately
  // runs after children effects so App.tsx has registered the voice bridge.
  useEffect(() => {
    if (handsFree && supported && !permissionDeniedRef.current) {
      const t = setTimeout(() => {
        resumeHandsFree();
      }, 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api: VoiceAssistantApi = {
    state,
    transcript,
    lastIntent,
    supported,
    micPermission,
    settings,
    setSettings,
    startListening,
    stopListening,
    toggleListening,
    speak: (text: string) => speakRef.current(text, 5),
    routeText,
    handleTranscript,
    confirmation,
    handsFree,
    wakeArmed,
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
