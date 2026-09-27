// The Watchora mascot — a companion that is FELT, not just seen.
//
// This is the single biggest idea we took from the four reference repos, and it
// is a correction to them rather than a copy.
//
// github.com/isair/jarvis has the best mascot of the four: a canvas-rendered
// animated amber wireframe face with discrete states and tray icons for
// idle/listening (src/desktop_app/face_widget.py, desktop_assets/icon_idle_*,
// icon_listening_*). github.com/astrokjoseph/Jarvis has an orb with the same
// idea. Both are excellent — for sighted users. Both communicate state through
// MOTION and COLOUR on a screen, which is precisely the channel our users do
// not have. A mascot that only a sighted person can read is not a companion; it
// is decoration.
//
// So Watchora's mascot keeps the state model from those projects and changes
// the primary channel. Every state has THREE redundant expressions, in the
// order a blind user actually reaches them:
//   1. TOUCH  — a distinct vibration signature. A phone in a pocket is a
//      wearable; this is the one sense that is always available, always on,
//      and never blocked by a screen being off or a screen reader running.
//   2. VOICE  — a spoken label, so a screen-reader user and a deafblind user
//      with haptics off are both served.
//   3. MOTION/COLOUR — the canvas orb, for low-vision users and for the
//      sighted caregiver standing next to them. Deliberately last, and
//      explicitly never the only channel (WCAG 1.4.1 use-of-colour, and the
//      same rule the existing WatchoraOrb already documents).
//
// The touch signatures also follow the OKO principle already used in haptics.ts:
// binary before nuance. `alert` is fast, hard and different *in kind* from
// every other state, so it is recognisable through a coat, in a pocket, with
// the phone facing away — no training and no vision required.
//
// The `unavailable` state is the honesty channel. When the device has no
// compass, or the camera was refused, the mascot says so instead of going
// quiet and letting the user assume it is still working.

import type { OrbState } from '../components/orbRenderer';
import type { SpeechPriority } from '../speechPriority';

export type MascotState =
  | 'asleep' // Watch off. Silence is the resting state.
  | 'awake' // Watch on, nothing to report yet.
  | 'listening' // Microphone open, waiting for the user.
  | 'looking' // Actively analysing the scene in front of the user.
  | 'guiding' // Speaking guidance right now.
  | 'alert' // Hazard. Interrupts everything.
  | 'unavailable'; // A capability this device does not have. Never faked.

export type TouchPattern = {
  /** navigator.vibrate() pattern. Short gaps between pulses are what make a
   *  signature recognisable — a long buzz is just a long buzz. */
  vibrate: number | number[];
  /** Optional earcon. `null` for states that should be felt only — a sound on
   *  every state would make the companion unbearable in a café. */
  tone: { freqs: number[]; ms: number; type: 'sine' | 'square' | 'triangle' } | null;
};

export interface MascotProfile {
  /** Screen-reader / status-line label. Short; the user hears this often. */
  label: string;
  /** Spoken when the mascot ENTERS this state. */
  announce: string;
  /** Touch signature. `null` = deliberately silent (asleep only). */
  touch: TouchPattern | null;
  /** Canvas expression for low-vision users and the sighted caregiver. */
  orb: OrbState;
  /**
   * True for states that must interrupt whatever Watchora is saying. Only
   * `alert` and `unavailable` qualify: an unavailable capability is a false
   * impression the user needs corrected immediately, not a nicety.
   */
  interrupts: boolean;
}

const SILENT: TouchPattern | null = null;

export const MASCOT_PROFILES: Record<MascotState, MascotProfile> = {
  asleep: {
    label: 'Asleep',
    announce: 'Watch mode is off. Say start watch and I will keep an eye on the path ahead.',
    touch: SILENT,
    orb: 'idle',
    interrupts: false,
  },
  awake: {
    label: 'Watching',
    announce: 'I am watching the path ahead for you. I will speak only when something changes or something is in the way.',
    // One long soft pulse: "on", and distinct from the two-tap of listening.
    touch: { vibrate: [0, 120], tone: { freqs: [520], ms: 160, type: 'sine' } },
    orb: 'idle',
    interrupts: false,
  },
  listening: {
    label: 'Listening',
    announce: 'I am listening.',
    // Two quick light taps.
    touch: { vibrate: [0, 35, 90, 35], tone: null },
    orb: 'listening',
    interrupts: false,
  },
  looking: {
    label: 'Looking',
    announce: '',
    // Three evenly spaced taps — a distinct rhythm, and unlike every other
    // state so a user can tell "I am working on it" from "I am speaking".
    touch: { vibrate: [0, 30, 80, 30, 80, 30], tone: null },
    orb: 'processing',
    interrupts: false,
  },
  guiding: {
    label: 'Guiding',
    announce: '',
    // A single soft pulse, repeated at the rhythm of speech.
    touch: { vibrate: [0, 60], tone: { freqs: [620], ms: 120, type: 'triangle' } },
    orb: 'speaking',
    interrupts: false,
  },
  alert: {
    label: 'Hazard',
    announce: 'Caution.',
    // Fast, hard, long. Nothing else in the vocabulary comes close, so this
    // reads through a coat with the phone in a back pocket.
    touch: { vibrate: [0, 220, 50, 220, 50, 220], tone: { freqs: [880, 660, 440], ms: 300, type: 'square' } },
    orb: 'hazard',
    interrupts: true,
  },
  unavailable: {
    label: 'Unavailable',
    // The honesty channel. We would rather interrupt to say "I cannot do
    // this" than stay quiet and be assumed to be working.
    announce: 'Heads up — part of what I was about to do is not available on this device. I will tell you exactly what is missing.',
    // Two slow taps, clearly unlike the fast alert rhythm.
    touch: { vibrate: [0, 90, 260, 90], tone: { freqs: [500, 380], ms: 320, type: 'sine' } },
    orb: 'error',
    interrupts: true,
  },
};

export interface MascotTransition {
  state: MascotState;
  /** Text to speak, or '' when the transition is silent. */
  announce: string;
  touch: TouchPattern | null;
  interrupts: boolean;
  priority: SpeechPriority;
}

/**
 * Works out what the mascot should do when it moves from one state to another.
 *
 * Two rules:
 *   - Staying in the same state says nothing. A mascot that repeats "I am
 *     listening" every second is worse than no mascot.
 *   - States that only ever fire once (asleep → awake, anything → alert,
 *     anything → unavailable) are announced. Transient working states
 *     (looking, guiding) are felt but not narrated, so the companion is
 *     present without being a commentator.
 */
/** The two modes: asleep (Watch off) and awake (Watch on). Every other state
 * is a transient expression of being awake. */
export type MascotMode = 'asleep' | 'awake';

export function modeOf(state: MascotState): MascotMode {
  return state === 'asleep' ? 'asleep' : 'awake';
}

export function mascotTransition(
  from: MascotState | null,
  to: MascotState,
  options: { quietHours?: boolean; announcedMode?: MascotMode } = {},
): MascotTransition {
  const profile = MASCOT_PROFILES[to];
  const changed = from !== to;
  const quiet = options.quietHours === true;

  if (!changed) {
    return { state: to, announce: '', touch: null, interrupts: false, priority: 6 };
  }

  // A hazard or an honesty correction always breaks silence, even at night.
  // The two MODE states speak too: a user who cannot see the screen must be
  // told when watching started and, just as importantly, when it stopped —
  // silence on stop leaves them believing they are still being watched.
  //
  // But a MODE announcement is owed only when the MODE actually changed. The
  // mascot drifts awake -> guiding -> awake as it speaks, and without this
  // guard every return to awake repeated "I am watching the path ahead for
  // you" — the nagging the cadence rules exist to prevent, and unbearable to
  // someone who cannot see that nothing has changed. `announcedMode` is the
  // mode last announced; when it is omitted the transition speaks, which
  // preserves the old behaviour for callers that do not track it.
  const mode = modeOf(to);
  const announcedMode = options.announcedMode;
  const modeChanged = announcedMode === undefined || announcedMode !== mode;
  const mustSpeak = profile.interrupts || modeChanged;
  const announce = mustSpeak && !(quiet && !profile.interrupts) ? profile.announce : '';

  return {
    state: to,
    announce,
    touch: profile.touch,
    interrupts: profile.interrupts,
    // hazard = 1 (top), unavailable = 3, start/stop = 4, ambient = 6
    priority: to === 'alert' ? 1 : profile.interrupts ? 3 : to === 'awake' ? 4 : 6,
  };
}

/**
 * Explains, in one spoken sentence, exactly which capabilities the current
 * device actually has. Used when the user asks "what can you do" inside Watch
 * mode, and when Watch starts on a device missing something.
 *
 * Every clause is a FACT about this device, checked at runtime — never an
 * assumption that the hardware is capable.
 */
export function capabilitySpeech(caps: {
  camera: boolean;
  compass: boolean;
  motion: boolean;
  haptics: boolean;
  network: boolean;
}): string {
  const have: string[] = [];
  const missing: string[] = [];

  if (caps.camera) have.push('I can see the path ahead'); else missing.push('I cannot see — the camera is off');
  if (caps.compass) have.push('I can tell which way you are facing'); else missing.push('I cannot name a direction — no compass on this device');
  if (caps.motion) have.push('I can tell when you turn'); else missing.push('I cannot sense turning');
  if (caps.haptics) have.push('I can tap your phone to get your attention'); else missing.push('I cannot tap your phone, so I will only speak');
  if (caps.network) have.push('I can reach the AI service for detailed descriptions'); else missing.push('I am offline, so I will use local detection only');

  const parts: string[] = [];
  if (have.length) parts.push(`${have.join('. ')}.`);
  if (missing.length) parts.push(`${missing.join('. ')}.`);
  return parts.join(' ');
}
