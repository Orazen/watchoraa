// useWatchMode: the React binding for Watch mode.
//
// Everything that decides *what* to say lives in the pure modules
// (watchSession / orientation / guidance / mascotStates). This hook owns only
// the impure parts — event listeners, a timer, React state, and calling the
// app's speech + haptic functions. That split is deliberate: the product rules
// are unit-tested without a browser, and this file has no product logic to test.
//
// It is also deliberately conservative about permissions. deviceorientation
// needs a user gesture and a secure context on most browsers, and the Battery
// Status API does not exist on iOS Safari at all. Neither is ever requested
// silently: Watch starts either way, and a device that cannot provide a
// capability says so through the mascot's `unavailable` state rather than
// failing or pretending.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpeechPriority } from '../speechPriority';
import { fireTouchPattern, type HapticSettings } from '../haptics';
import type { Detection } from '../yolo.worker';
import { decideWatchAction, sceneKey, watchStatusSpeech, type WatchCadence, type WatchState } from './watchSession';
import { CompassStabiliser, isLookingDown, readOrientation, orientationSpeech, type HeadingReading } from './orientation';
import { MASCOT_PROFILES, mascotTransition, modeOf, type MascotState } from './mascotStates';

/** How often the pure decision function is evaluated. Cheap; no I/O. */
const TICK_MS = 1500;
/** How often the battery level is re-read. The API fires its own events, but
 *  not all browsers implement them, so this is the floor. */
const BATTERY_POLL_MS = 60_000;

export interface WatchHazard {
  active: boolean;
  label: string | null;
}

export interface UseWatchModeOptions {
  speak: (text: string, priority?: SpeechPriority, dedupeKey?: string) => void;
  hapticSettings: HapticSettings;
  /** Current local detections, or null when the camera layer is not running. */
  getDetections: () => Array<Pick<Detection, 'className' | 'confidence' | 'bearingClock'>> | null;
  getHazard: () => WatchHazard;
  verbosity: 0 | 1 | 2;
  /**
   * Getters, not snapshots, for the two facts that change on a timer. The
   * decision loop runs on its own interval and the parent is not guaranteed to
   * re-render while it runs, so a boolean captured at render time would go
   * stale and the mascot would keep showing "watching" while the user was
   * mid-sentence, or show "speaking" long after it had stopped.
   */
  getListening: () => boolean;
  getSpeaking: () => boolean;
  quietStartHour: number;
  quietEndHour: number;
}

export interface WatchModeApi {
  state: WatchState;
  cadence: WatchCadence;
  mascot: MascotState;
  /** The last thing Watch said, for the screen's transcript. */
  lastSpoken: string;
  spokenCount: number;
  batteryLevel: number | null;
  charging: boolean;
  /** Latest orientation sample, or null when unavailable. */
  orientation: HeadingReading | null;
  lookingDown: boolean;
  /** True only when a compass is present and its readings agree. */
  compassStable: boolean;
  /** Capabilities this device actually has, checked at runtime. */
  capabilities: { camera: boolean; compass: boolean; motion: boolean; haptics: boolean; network: boolean };
  start: () => void;
  stop: () => void;
  toggle: () => void;
  setCadence: (c: WatchCadence) => void;
  /** Immediate on-demand description, bypassing cadence entirely. */
  sayNow: () => void;
  statusSpeech: () => string;
  orientationSpeechNow: () => void;
}

export function useWatchMode(options: UseWatchModeOptions): WatchModeApi {
  const [state, setState] = useState<WatchState>('off');
  const [cadence, setCadenceState] = useState<WatchCadence>('steady');
  const [lastSpoken, setLastSpoken] = useState('');
  const [spokenCount, setSpokenCount] = useState(0);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  const [orientation, setOrientation] = useState<HeadingReading | null>(null);

  // Options change every render; refs keep the timer callback reading current
  // values without being torn down and restarted on every parent render.
  const optsRef = useRef(options);
  optsRef.current = options;

  const mascotRef = useRef<MascotState>('asleep');
  // Mirrored into React state on purpose: the mascot changes on a timer tick
  // that often coincides with no other state change, so a ref alone would let
  // the screen keep showing a stale face indefinitely.
  const [mascot, setMascotState] = useState<MascotState>('asleep');
  const cadenceRef = useRef(cadence);
  cadenceRef.current = cadence;
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastUtteranceRef = useRef(0);
  const lastSceneKeyRef = useRef('');
  const lastHeadingRef = useRef<number | null>(null);
  const batteryWarnedRef = useRef(false);
  const spokenCountRef = useRef(0);
  const stabiliserRef = useRef(new CompassStabiliser());
  const hasOrientationRef = useRef(false);
  // Which mode the mascot is in, independent of its transient expression.
  // Tracked separately so an awake <-> guiding flip cannot re-announce
  // "I am watching the path ahead" every time it comes back round.
  const announcedModeRef = useRef<'asleep' | 'awake'>('asleep');
  // Hysteresis for the transient states, so a speech flag that flickers for a
  // single 1.5s tick does not buzz the phone twice.
  const pendingMascotRef = useRef<{ state: MascotState; seen: number } | null>(null);

  // ── Battery ──
  useEffect(() => {
    let battery: { level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (t: string, f: () => void) => void }>;
    };
    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then((b) => {
          if (cancelled) return;
          battery = b;
          setBatteryLevel(b.level);
          setCharging(b.charging);
          b.addEventListener('levelchange', () => setBatteryLevel(b.level));
          b.addEventListener('chargingchange', () => setCharging(b.charging));
        })
        .catch(() => {
          /* Not available (notably iOS Safari). Watch still works; the screen
             simply omits the battery figure rather than inventing one. */
        });
    }
    const poll = setInterval(() => {
      if (battery) {
        setBatteryLevel(battery.level);
        setCharging(battery.charging);
      }
    }, BATTERY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, []);

  // ── Orientation ──
  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    const handler = (event: DeviceOrientationEvent) => {
      const reading = readOrientation(event as unknown as Parameters<typeof readOrientation>[0]);
      if (!reading) return;
      hasOrientationRef.current = true;
      stabiliserRef.current.push(reading, Date.now());
      setOrientation(reading);
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, []);

  // ── The mascot: one place decides state changes, and every change is felt ──
  const setMascot = useCallback((next: MascotState) => {
    if (mascotRef.current === next) return;
    const transition = mascotTransition(mascotRef.current, next, {
      quietHours: isQuietHour(optsRef.current.quietStartHour, optsRef.current.quietEndHour),
      announcedMode: announcedModeRef.current,
    });
    mascotRef.current = next;
    announcedModeRef.current = modeOf(next);
    setMascotState(next);
    if (transition.touch) fireTouchPattern(transition.touch, optsRef.current.hapticSettings);
    if (transition.announce) {
      optsRef.current.speak(transition.announce, transition.priority as SpeechPriority, `mascot-${transition.state}`);
    }
  }, []);

  // ── The decision loop ──
  useEffect(() => {
    if (state !== 'watching' && state !== 'alerting') return;
    const tick = () => {
      const o = optsRef.current;
      const hazard = o.getHazard();
      const detections = o.getDetections() ?? [];
      const now = Date.now();
      const reading = orientation;
      const lookingDown = isLookingDown(reading);

      // The mascot reflects what the machine is actually doing right now.
      // `alert` is immediate — a hazard must never wait for hysteresis. The
      // ambient states (guiding/listening/awake) must hold steady for two
      // consecutive ticks before they are believed: the speech-active flag
      // flickers as the queue drains, and without this the phone buzzed every
      // 1.5s, which for a user relying on touch is noise, not information.
      const desired: MascotState = hazard.active
        ? 'alert'
        : o.getSpeaking()
          ? 'guiding'
          : o.getListening()
            ? 'listening'
            : 'awake';
      if (desired === mascotRef.current) {
        pendingMascotRef.current = null;
      } else if (desired === 'alert') {
        pendingMascotRef.current = null;
        setMascot('alert');
      } else {
        const pending = pendingMascotRef.current;
        if (pending && pending.state === desired) {
          pending.seen += 1;
        } else {
          pendingMascotRef.current = { state: desired, seen: 1 };
        }
        if ((pendingMascotRef.current?.seen ?? 0) >= 2) {
          pendingMascotRef.current = null;
          setMascot(desired);
        }
      }

      const action = decideWatchAction({
        state: 'watching',
        cadence: cadenceRef.current,
        detections,
        hazardActive: hazard.active,
        hazardLabel: hazard.label,
        orientation: reading,
        compassStable: stabiliserRef.current.isStable(),
        lookingDown,
        batteryLevel,
        charging,
        hour: new Date().getHours(),
        verbosity: o.verbosity,
        now,
        secondsSinceLastUtterance: (now - lastUtteranceRef.current) / 1000,
        lastSceneKey: lastSceneKeyRef.current,
        lastAnnouncedHeading: lastHeadingRef.current,
        batteryWarned: batteryWarnedRef.current,
        quietStartHour: o.quietStartHour,
        quietEndHour: o.quietEndHour,
      });

      if (action.kind === 'degrade') {
        batteryWarnedRef.current = true;
        cadenceRef.current = action.to;
        setCadenceState(action.to);
        o.speak(action.text, action.priority as SpeechPriority, action.dedupeKey);
        setLastSpoken(action.text);
        spokenCountRef.current += 1;
        setSpokenCount(spokenCountRef.current);
        lastUtteranceRef.current = now;
        return;
      }

      if (action.kind !== 'speak') return;

      o.speak(action.text, action.priority as SpeechPriority, action.dedupeKey);
      setLastSpoken(action.text);
      lastUtteranceRef.current = now;
      lastSceneKeyRef.current = sceneKey(detections);
      if (reading) lastHeadingRef.current = reading.headingDeg;
      spokenCountRef.current += 1;
      setSpokenCount(spokenCountRef.current);
    };
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [state, orientation, batteryLevel, charging, setMascot]);

  // cadenceRef mirrors cadence so the tick effect above does not have to list
  // cadence as a dependency and restart the interval on every cadence change.

  const start = useCallback(() => {
    lastUtteranceRef.current = Date.now();
    lastSceneKeyRef.current = '';
    lastHeadingRef.current = null;
    batteryWarnedRef.current = false;
    spokenCountRef.current = 0;
    setSpokenCount(0);
    setState('watching');
  }, []);

  const stop = useCallback(() => {
    setState('off');
    setMascot('asleep');
  }, [setMascot]);

  const toggle = useCallback(() => {
    if (state === 'off') start();
    else stop();
  }, [state, start, stop]);

  const setCadence = useCallback((c: WatchCadence) => {
    cadenceRef.current = c;
    setCadenceState(c);
  }, []);

  const sayNow = useCallback(() => {
    const o = optsRef.current;
    const detections = o.getDetections() ?? [];
    const reading = orientation;
    // On-demand means on-demand: the cadence interval and the scene-change rule
    // are both bypassed, because the user asked and silence would read as a
    // failure. The confirmation caveat is kept — a blind user has no other way
    // to know the answer came from a shaky single frame.
    const action = decideWatchAction({
      state: 'watching',
      cadence: 'vigilant',
      detections,
      hazardActive: o.getHazard().active,
      hazardLabel: o.getHazard().label,
      orientation: reading,
      compassStable: stabiliserRef.current.isStable(),
      lookingDown: isLookingDown(reading),
      batteryLevel,
      charging,
      hour: new Date().getHours(),
      verbosity: o.verbosity,
      now: Date.now(),
      secondsSinceLastUtterance: 9999,
      lastSceneKey: '',
      lastAnnouncedHeading: null,
      batteryWarned: true,
      quietStartHour: o.quietStartHour,
      quietEndHour: o.quietEndHour,
    });
    const text = action.kind === 'speak' ? action.text : 'I could not get a clear look just now. Try pointing the camera at the path ahead.';
    o.speak(text, 5, 'watch-say-now');
    setLastSpoken(text);
    spokenCountRef.current += 1;
    setSpokenCount(spokenCountRef.current);
  }, [orientation, batteryLevel, charging]);

  const statusSpeech = useCallback(
    () =>
      watchStatusSpeech({
        state: stateRef.current,
        cadence: cadenceRef.current,
        spokenCount: spokenCountRef.current,
        batteryLevel,
        charging,
      }),
    [batteryLevel, charging],
  );

  const orientationSpeechNow = useCallback(() => {
    const text = orientationSpeech(orientation, stabiliserRef.current.isStable(), isLookingDown(orientation));
    optsRef.current.speak(text, 5, 'watch-orientation');
  }, [orientation]);

  const capabilities = useMemo(
    () => ({
      camera: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
      compass: hasOrientationRef.current && !!orientation?.absolute,
      motion: hasOrientationRef.current,
      haptics: typeof navigator !== 'undefined' && 'vibrate' in navigator,
      network: typeof navigator !== 'undefined' ? navigator.onLine : false,
    }),
    [orientation],
  );

  return {
    state,
    cadence,
    mascot: mascot,
    lastSpoken,
    spokenCount,
    batteryLevel,
    charging,
    orientation,
    lookingDown: isLookingDown(orientation),
    compassStable: stabiliserRef.current.isStable(),
    capabilities,
    start,
    stop,
    toggle,
    setCadence,
    sayNow,
    statusSpeech,
    orientationSpeechNow,
  };
}

function isQuietHour(start: number, end: number): boolean {
  const hour = new Date().getHours();
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export { MASCOT_PROFILES };
