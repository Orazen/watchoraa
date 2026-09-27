// Watch mode: the session state machine that decides WHEN Watchora speaks
// while it is watching, as opposed to only when asked.
//
// This is the piece the four reference repos all lack for our users. They
// build agents that answer when spoken to. SightlineAI comes closest by
// "identifying hazards PROACTIVELY", but its proactivity is per-request — it
// still needs a human to trigger each analysis. A blind user walking an
// unfamiliar street cannot afford to interrogate an app every twenty metres,
// and equally cannot tolerate an app that talks over them uninvited. The real
// design problem is cadence, and that is what this file solves.
//
// Three rules govern every decision here, and they are the reason this is a
// pure function rather than a pile of setTimeouts scattered through App.tsx:
//   1. SAFETY FIRST. A hazard interrupts at any cadence and outranks the
//      SpeechPriorityManager's normal queue. Silence is never the safer choice
//      when the local detector has flagged something.
//   2. NO NAGGING. The same scene is never described twice. Dedupe is keyed on
//      the scene's content, not on a timer, so standing still in a busy street
//      is silent and walking into a new street speaks immediately.
//   3. HONEST BATTERY. A phone that dies mid-journey is a safety failure. The
//      cadence degrades on low battery, loudly and once, instead of the app
//      silently pretending to be watching when it has throttled itself.
//
// Everything is pure over `WatchDecisionInput`, so all of the above is
// unit-testable without a camera, a browser or a clock.

import { buildGuidance, type GuidanceInput } from './guidance';
import { describeTurn, isLookingDown, type HeadingReading } from './orientation';
import type { SpeechPriority } from '../speechPriority';

export type WatchCadence = 'quiet' | 'steady' | 'vigilant';
export type WatchState = 'off' | 'starting' | 'watching' | 'alerting' | 'paused';

export const WATCH_CADENCE_LABELS: Record<WatchCadence, string> = {
  quiet: 'Quiet — only speaks for hazards',
  steady: 'Steady — a short update when the scene changes',
  vigilant: 'Vigilant — frequent updates, and tells you when you turn',
};

/** Minimum seconds between proactive (non-hazard) utterances per cadence. */
const CADENCE_INTERVAL_S: Record<WatchCadence, number | null> = {
  quiet: null,
  steady: 45,
  vigilant: 20,
};

/** Only announce turns at least this big, and only in the chattier cadences. */
const TURN_ANNOUNCE_DEG = 45;

export interface WatchDecisionInput {
  state: WatchState;
  cadence: WatchCadence;
  /** Local detections, same shape the hazard layer already produces. */
  detections: GuidanceInput['detections'];
  /** True when the local hazard layer is currently flagging something. */
  hazardActive: boolean;
  /** Short label for the hazard, e.g. "car". */
  hazardLabel?: string | null;
  orientation: HeadingReading | null;
  /** True when the compass window is steady enough to name a direction. */
  compassStable: boolean;
  lookingDown: boolean;
  batteryLevel: number | null;
  charging: boolean;
  /** Local hour 0-23, for quiet hours. */
  hour: number;
  verbosity: 0 | 1 | 2;
  /** Engine clock, ms. Injected so tests are deterministic. */
  now: number;
  /** Seconds since the last proactive utterance. Infinity before the first. */
  secondsSinceLastUtterance: number;
  /** Content key of the last described scene; '' before the first. */
  lastSceneKey: string;
  /** Heading at the last announcement, null when never announced. */
  lastAnnouncedHeading: number | null;
  /** Set once the battery warning has been spoken, so it is only ever said once. */
  batteryWarned: boolean;
  /** Hour 0-23 during which Watchora stays silent unless there is a hazard. */
  quietStartHour: number;
  quietEndHour: number;
}

export type WatchAction =
  | { kind: 'speak'; text: string; priority: SpeechPriority; dedupeKey: string; reason: string }
  | { kind: 'wait' }
  | { kind: 'degrade'; to: WatchCadence; text: string; priority: SpeechPriority; dedupeKey: string; reason: string }
  | { kind: 'stop'; reason: string };

/** Quiet hours span midnight, e.g. 22 → 6. */
function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

/**
 * Content key for the current scene. Two frames with the same classes in the
 * same rough arrangement are "the same scene" and must not be re-announced —
 * this is the mechanism behind the no-nagging rule.
 */
export function sceneKey(detections: WatchDecisionInput['detections']): string {
  if (detections.length === 0) return 'empty';
  return detections
    .filter((d) => d.confidence >= 0.35)
    .map((d) => `${d.className}@${Math.round(d.bearingClock / 3)}`)
    .sort()
    .join('|');
}

/** Hazard classes whose movement is itself worth re-announcing. */
const MOVEMENT_MATTERS = new Set(['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'person', 'dog', 'cat']);

/** Most-confident bearing per class — the same reduction sceneKey applies. */
function currentClasses(detections: WatchDecisionInput['detections']) {
  const byClass = new Map<string, { bearing: number; confidence: number }>();
  for (const d of detections) {
    if (d.confidence < 0.35) continue;
    const existing = byClass.get(d.className);
    if (!existing || d.confidence > existing.confidence) {
      byClass.set(d.className, { bearing: d.bearingClock, confidence: d.confidence });
    }
  }
  return byClass;
}

/** Reconstructs the previous frame's class→bearing map from its stored key. */
function previousClasses(lastSceneKey: string) {
  const map = new Map<string, number>();
  if (!lastSceneKey || lastSceneKey === 'empty') return map;
  for (const part of lastSceneKey.split('|')) {
    const at = part.lastIndexOf('@');
    if (at <= 0) continue;
    map.set(part.slice(0, at), Number(part.slice(at + 1)) * 3);
  }
  return map;
}

/**
 * Whether the scene has changed enough to be worth speaking again.
 *
 * The first version compared bucketed `class@clockBucket` strings for overlap,
 * and that nagged badly: with ONE object in frame, any clock-position drift
 * crossed a bucket boundary, scored 0 similarity, and re-announced — so a
 * person walking past from 2 o'clock to 3 o'clock made Watchora describe the
 * same person over and over. "Same objects" is what "same scene" means to a
 * user; the clock position is carried by the turn announcer instead.
 *
 * Hazard-like objects are the deliberate exception. A car that was 6 o'clock
 * and is now 10 o'clock really has changed, and saying so is the whole product.
 */
function isSceneChanged(
  detections: WatchDecisionInput['detections'],
  lastSceneKey: string,
): boolean {
  const current = currentClasses(detections);
  const previous = previousClasses(lastSceneKey);
  if (previous.size === 0) return current.size > 0;

  for (const [name, entry] of current) {
    const before = previous.get(name);
    if (before == null) return true; // something new entered the frame
    if (MOVEMENT_MATTERS.has(name)) {
      const moved = Math.abs(((entry.bearing - before + 540) % 360) - 180);
      // 4 o'clock of movement is roughly a 120-degree swing — a genuinely
      // different situation, not detector noise.
      if (moved >= 120) return true;
    }
  }

  // Objects leaving the frame only count when the frame empties out entirely.
  // A person stepping out of shot while a wall remains is not a new scene.
  return current.size === 0 && previous.size > 0;
}

/**
 * Decides what Watch mode should do next. Pure: no timers, no I/O, no React.
 * The caller runs it on an interval and acts on the result.
 */
export function decideWatchAction(input: WatchDecisionInput): WatchAction {
  if (input.state === 'off' || input.state === 'paused') {
    return { kind: 'stop', reason: `watch is ${input.state}` };
  }

  // ── RULE 1: hazards outrank everything — including the battery warning.
  // This check MUST stay above the degrade check. A phone at 3% that has just
  // seen a car used to announce "your battery is low" and swallow the hazard,
  // which inverts the entire priority model of this module: the user is told
  // about their battery at the exact moment they need to be told about the car.
  if (input.hazardActive) {
    const label = input.hazardLabel ? `a ${input.hazardLabel}` : 'something';
    return {
      kind: 'speak',
      text: `Caution — ${label} ahead. Slow down and check with your cane.`,
      priority: 1,
      dedupeKey: `watch-hazard-${input.hazardLabel ?? 'unknown'}`,
      reason: 'local hazard layer is active',
    };
  }

  // ── RULE 3: battery. Degrade loudly, once, and keep the hazard channel. ──
  const lowBattery = input.batteryLevel != null && input.batteryLevel < 0.15 && !input.charging;
  if (lowBattery && !input.batteryWarned && input.cadence !== 'quiet') {
    return {
      kind: 'degrade',
      to: 'quiet',
      text: 'Your phone battery is low, so I am switching Watch to quiet mode. I will still warn you about hazards.',
      priority: 4,
      dedupeKey: 'watch-battery-low',
      reason: 'battery below 15% and not charging',
    };
  }

  // ── Quiet hours: silent unless something is wrong. ──
  if (inQuietHours(input.hour, input.quietStartHour, input.quietEndHour)) {
    return { kind: 'wait' };
  }

  const interval = CADENCE_INTERVAL_S[input.cadence];
  const dueForScene = interval == null || input.secondsSinceLastUtterance >= interval;

  // ── A turn is worth saying even if the scene has not changed. ──
  if (
    input.cadence === 'vigilant' &&
    input.orientation &&
    input.lastAnnouncedHeading != null
  ) {
    const turn = describeTurn(input.lastAnnouncedHeading, input.orientation.headingDeg);
    const turnMagnitude = Math.abs(
      ((input.orientation.headingDeg - input.lastAnnouncedHeading + 540) % 360) - 180,
    );
    if (turn && turnMagnitude >= TURN_ANNOUNCE_DEG) {
      return {
        kind: 'speak',
        text: turn,
        priority: 4,
        dedupeKey: `watch-turn-${Math.round(turnMagnitude / 15)}`,
        reason: 'user turned significantly while walking',
      };
    }
  }

  if (!dueForScene) return { kind: 'wait' };

  // ── RULE 2: only speak when the scene actually changed. ──
  const current = sceneKey(input.detections);
  if (input.lastSceneKey && !isSceneChanged(input.detections, input.lastSceneKey)) {
    return { kind: 'wait' };
  }

  const guidance = buildGuidance({
    detections: input.detections,
    lookingDown: input.lookingDown,
    verbosity: input.verbosity,
  });

  // Essential (0) drops the confidence caveat to keep urgent updates short —
  // but the hazard and safety sentences are never dropped at any verbosity.
  const text = input.verbosity === 0
    ? [guidance.guidance, guidance.safetyNotes].filter(Boolean).join(' ')
    : guidance.speech;

  if (!text.trim()) return { kind: 'wait' };

  return {
    kind: 'speak',
    text,
    priority: input.cadence === 'vigilant' ? 4 : 6,
    dedupeKey: `watch-scene-${current.slice(0, 60)}`,
    reason: 'scene changed and the cadence interval elapsed',
  };
}

/** True when the given orientation reading should count as "looking down". */
export function shouldWarnLookDown(reading: HeadingReading | null): boolean {
  return isLookingDown(reading);
}

/** Spoken status for "what is Watch doing", used by the watch_status intent. */
export function watchStatusSpeech(input: {
  state: WatchState;
  cadence: WatchCadence;
  spokenCount: number;
  batteryLevel: number | null;
  charging: boolean;
}): string {
  if (input.state === 'off') {
    return 'Watch mode is off. Say start watch and I will keep an eye on the path ahead for you.';
  }
  const parts = [`Watch mode is on, in ${input.cadence} mode.`];
  if (input.spokenCount > 0) {
    parts.push(`I have given you ${input.spokenCount} update${input.spokenCount === 1 ? '' : 's'} so far.`);
  }
  if (input.batteryLevel != null) {
    const pct = Math.round(input.batteryLevel * 100);
    parts.push(`Your phone battery is ${pct} percent${input.charging ? ' and charging' : ''}.`);
  }
  return parts.join(' ');
}
