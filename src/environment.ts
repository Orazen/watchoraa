// Deterministic spoken environment approximator ("what's around me").
//
// Research basis (2026-09): Seeing AI / Envision scene summaries, Wayfindr's
// ITU-T F.921 audio guidance standard, and the ASSETS/CHI accessibility
// literature all converge on the same rules for blind users:
//   - A one-sentence auto summary (≤ ~25 words), with a longer on-demand level.
//   - People and moving objects are announced before static periphery.
//   - Second person, present tense, front-first spatial wording ("in front of
//     you", "to your left"), clock positions for diagonals — never "I see".
//   - Group by class + zone, counts capped (then "several") — enumeration is
//     unusable when 12 objects are visible.
//   - Uncertainty is hedged ("appears to be"); distances are never estimated
//     from a monocular camera; empty slots are dropped silently.
//
// Everything here is a pure function of local sensor output so it can be unit
// tested and so the spoken layer works with zero cloud dependency.

import type { Detection } from './yolo.worker';

export type PlaceContext = {
  road?: string;
  city?: string;
  suburb?: string;
  name?: string;
  addresstype?: string;
};

export type EnvironmentInput = {
  detections: Array<Pick<Detection, 'className' | 'confidence' | 'bearingClock'>>;
  place?: PlaceContext | null;
};

// Classes that imply an enclosed space when they dominate the frame.
const INDOOR_CLASSES = new Set([
  'chair', 'couch', 'bed', 'dining table', 'tv', 'laptop', 'keyboard', 'mouse',
  'remote', 'cell phone', 'refrigerator', 'microwave', 'oven', 'toaster', 'sink',
  'toilet', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl',
]);

// Classes that imply a street/outdoor scene when they dominate the frame.
const OUTDOOR_CLASSES = new Set([
  'car', 'bus', 'truck', 'bicycle', 'motorcycle', 'traffic light', 'fire hydrant',
  'stop sign', 'parking meter', 'bench', 'train', 'boat',
]);

// Announcement priority: people first, then moving vehicles/animals (they can
// reach the user), then static hazards, then landmarks/periphery.
const CLASS_PRIORITY: string[] = [
  'person', 'dog', 'cat', 'bicycle', 'motorcycle', 'car', 'bus', 'truck', 'train',
  'skateboard', 'suitcase', 'chair', 'couch', 'dining table', 'bed', 'bench',
  'traffic light', 'stop sign', 'fire hydrant', 'potted plant', 'tv', 'clock',
  'refrigerator', 'sink', 'toilet', 'oven',
];
const CLASS_PRIORITY_INDEX = new Map(CLASS_PRIORITY.map((c, i) => [c, i]));

const IRREGULAR_PLURALS: Record<string, string> = {
  person: 'people',
  mouse: 'mice',
};

function classPriority(className: string): number {
  const i = CLASS_PRIORITY_INDEX.get(className);
  return i === undefined ? CLASS_PRIORITY.length : i;
}

function isMovingOrHazardous(className: string): boolean {
  return (
    className === 'person' ||
    className === 'dog' ||
    className === 'cat' ||
    OUTDOOR_CLASSES.has(className) ||
    className === 'skateboard' ||
    className === 'suitcase'
  );
}

/** Object classes whose presence suggests indoors vs outdoors. */
export function inferSettingFromObjects(detections: EnvironmentInput['detections']): 'indoors' | 'outdoors' | null {
  let indoorScore = 0;
  let outdoorScore = 0;
  for (const d of detections) {
    if (INDOOR_CLASSES.has(d.className)) indoorScore += 1;
    if (OUTDOOR_CLASSES.has(d.className)) outdoorScore += 1;
  }
  if (indoorScore === outdoorScore) return null;
  return indoorScore > outdoorScore ? 'indoors' : 'outdoors';
}

/** Front-first spatial phrase for a clock bearing (9–3 range from the worker). */
function zonePhrase(bearingClock: number): string {
  switch (bearingClock) {
    case 12:
      return 'in front of you';
    case 9:
      return 'to your left';
    case 3:
      return 'to your right';
    case 10:
    case 11:
      return `at ${bearingClock} o'clock, slightly left`;
    default:
      return `at ${bearingClock} o'clock, slightly right`;
  }
}

function countWord(n: number): string {
  return ['', 'one', 'two', 'three', 'four'][n] ?? 'several';
}

function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'an' : 'a';
}

type ObjectGroup = {
  className: string;
  count: number;
  bestConfidence: number;
  bearingClock: number;
};

/**
 * Groups detections into (class, zone) buckets — a person to the left and a
 * person ahead are separate groups — capped at `maxGroups`, prioritized
 * people/moving first. Counts above 4 collapse to "several".
 */
export function groupDetections(detections: EnvironmentInput['detections'], maxGroups = 4): ObjectGroup[] {
  const buckets = new Map<string, ObjectGroup & { _entries: Array<{ conf: number; clock: number }> }>();
  for (const d of detections) {
    const key = `${d.className}|${d.bearingClock}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      existing.bestConfidence = Math.max(existing.bestConfidence, d.confidence);
      existing._entries.push({ conf: d.confidence, clock: d.bearingClock });
    } else {
      buckets.set(key, {
        className: d.className,
        count: 1,
        bestConfidence: d.confidence,
        bearingClock: d.bearingClock,
        _entries: [{ conf: d.confidence, clock: d.bearingClock }],
      });
    }
  }
  const groups = [...buckets.values()].map(({ _entries, ...g }) => {
    void _entries;
    return g;
  });
  groups.sort((a, b) => {
    const aMoving = isMovingOrHazardous(a.className) ? 0 : 1;
    const bMoving = isMovingOrHazardous(b.className) ? 0 : 1;
    if (aMoving !== bMoving) return aMoving - bMoving;
    const p = classPriority(a.className) - classPriority(b.className);
    if (p !== 0) return p;
    return b.bestConfidence - a.bestConfidence;
  });
  return groups.slice(0, maxGroups);
}

/** "a person in front of you", "two people to your left", "several chairs at 10 o'clock, slightly left". */
function groupPhrase(group: ObjectGroup): string {
  const uncertain = group.bestConfidence < 0.7;
  const noun = group.className;
  let head: string;
  if (group.count >= 5) {
    head = `several ${IRREGULAR_PLURALS[noun] ?? `${noun}s`}`;
  } else if (group.count > 1) {
    head = `${countWord(group.count)} ${IRREGULAR_PLURALS[noun] ?? `${noun}s`}`;
  } else {
    head = `${article(noun)} ${noun}`;
  }
  return `${uncertain ? 'what appears to be ' : ''}${head} ${zonePhrase(group.bearingClock)}`;
}

function joinNatural(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

/** Setting sentence from geocode place context, hedged — never claims "inside". */
function settingSentence(place: PlaceContext): string | null {
  const type = place.addresstype ?? '';
  if (type === 'road' || type === 'pedestrian' || type === 'footway') {
    return place.road ? `You seem to be outdoors on ${place.road}` : 'You seem to be outdoors on a street';
  }
  if (place.name) {
    const poi = type && type !== 'building' && type !== 'house' && type !== 'residence';
    return poi ? `You seem to be near ${place.name}` : `You seem to be near a building${place.road ? ` on ${place.road}` : ''}`;
  }
  if (place.road) return `You seem to be outdoors near ${place.road}`;
  if (place.city || place.suburb) return `You seem to be around ${place.suburb ?? place.city}`;
  return null;
}

const MAX_SUMMARY_WORDS = 25;

/**
 * Level 0: one auto-spoken sentence, ≤ ~25 words. People/moving objects come
 * first; the setting is prepended when known; periphery is included only while
 * the word budget allows.
 */
export function summarizeEnvironment(input: EnvironmentInput): string {
  const groups = groupDetections(input.detections);
  const setting = input.place ? settingSentence(input.place) : null;
  const objectPhrases = groups.map(groupPhrase);

  if (setting) {
    if (objectPhrases.length > 0) {
      const lead = `${setting}, with ${joinNatural(objectPhrases)}`;
      if (countWords(lead) <= MAX_SUMMARY_WORDS) return `${lead}.`;
      // Over budget: the setting plus the single most important group only.
      return `${setting}, with ${objectPhrases[0]}.`;
    }
    return `${setting}, and nothing clearly recognizable right now.`;
  }

  if (objectPhrases.length > 0) {
    const lead = `Around you: ${joinNatural(objectPhrases)}`;
    if (countWords(lead) <= MAX_SUMMARY_WORDS) return `${lead}.`;
    return `Around you: ${objectPhrases[0]}.`;
  }
  return 'No clearly recognizable objects around you right now.';
}

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Level 1: on-demand detail, ≤5 sentences, slot order Setting → People →
 * moving hazards → Periphery → (lighting has no sensor — dropped). Returns
 * sentences; caller joins with spaces.
 */
export function describeEnvironment(input: EnvironmentInput): string[] {
  const sentences: string[] = [];
  const groups = groupDetections(input.detections, 6);

  const setting = input.place ? settingSentence(input.place) : null;
  const indoor = inferSettingFromObjects(input.detections);
  if (setting) {
    sentences.push(`${setting}.`);
  } else if (indoor) {
    sentences.push(`It looks like you're ${indoor}.`);
  }

  const moving = groups.filter((g) => isMovingOrHazardous(g.className));
  const periphery = groups.filter((g) => !isMovingOrHazardous(g.className));

  if (moving.length > 0) {
    sentences.push(`${capitalize(joinNatural(moving.map(groupPhrase)))}.`);
  }
  if (periphery.length > 0) {
    sentences.push(`Also around: ${joinNatural(periphery.map(groupPhrase))}.`);
  }
  if (sentences.length === 0) {
    sentences.push('No clearly recognizable objects around you right now.');
  }
  return sentences.slice(0, 5);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Compact deterministic sensor context injected into cloud vision prompts, so
 * the AI answer is grounded in what the on-device model actually measured
 * instead of hallucinating beyond it. Empty when there is nothing to ground.
 */
export function detectionGroundingPrompt(detections: EnvironmentInput['detections']): string {
  if (detections.length === 0) return '';
  const parts = groupDetections(detections, 6).map((g) => {
    const conf = g.bestConfidence >= 0.7 ? 'high' : 'low';
    const zone = zonePhrase(g.bearingClock);
    const noun = g.count > 1 ? `${g.count} ${IRREGULAR_PLURALS[g.className] ?? `${g.className}s`}` : `${article(g.className)} ${g.className}`;
    return `${noun} ${zone} (${conf} confidence)`;
  });
  return `On-device object detection (measured, may contain errors): ${parts.join('; ')}.`;
}
