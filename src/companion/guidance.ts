// Sightline-style guidance built locally, with no cloud call.
//
// Directly adapted from github.com/rudra496/sightlineai (MIT), whose
// `app/prompts.py` is the most carefully written accessibility prompt in the
// four repos we studied. Its rules, kept verbatim in spirit because every one
// of them is load-bearing for a blind user:
//
//   - "Use spatial directions using clock-face orientation (e.g. 'obstacle at
//     2 o'clock')"  — Watchora's YOLO worker already emits `bearingClock`, so
//     this is free, and it is the spatial convention blind-navigation users are
//     actually taught.
//   - "Identify hazards PROACTIVELY — mention potential risks even if not
//     explicitly described."
//   - "Suggest verification steps: use cane sweeps, listen for audio cues,
//     feel for tactile markers."  — the single most useful sentence in that
//     prompt, and one no competitor of ours says: a camera cannot confirm what
//     a cane or an ear already knows better.
//   - "Handle uncertainty honestly. NEVER fabricate or guess details."
//   - "Prioritize safety over speed. Suggest stopping when uncertain."
//
// SightlineAI gets those by spending a Gemini/Qwen round-trip per frame. We get
// them from a pure function over the detections the local YOLOv8n worker has
// ALREADY produced for the hazard layer — zero network, zero latency, works
// offline, and testable. That is the whole point of the edge/cloud split
// sightlineai's architecture section describes.
//
// The output shape deliberately mirrors sightlineai's three-field JSON
// (guidance_text / safety_notes / confidence_notes) so the same contract could
// be filled by the cloud model later without touching the speech layer.

import type { Detection } from '../yolo.worker';

export type GuidanceInput = {
  detections: Array<Pick<Detection, 'className' | 'confidence' | 'bearingClock'>>;
  /**
   * True when the phone is angled at the ground. A forward-facing camera cannot
   * see kerbs, steps or a dog lead, so the one thing we know about that region
   * of space has to come from the sensor instead of the detector.
   */
  lookingDown?: boolean;
  /** Set when the caller knows the compass is steady — enables cardinal wording. */
  headingDeg?: number | null;
  verbosity?: 0 | 1 | 2;
};

export interface Guidance {
  /** 1-2 action-oriented sentences. What to do next. */
  guidance: string;
  /** Concrete hazard warnings, or '' when nothing risky was detected. */
  safetyNotes: string;
  /**
   * Always present. States how sure the system is and names a verification
   * step the user can take themselves. This field is never allowed to be
   * empty — an unhedged answer from a monocular camera is a false claim.
   */
  confidence: string;
  /** Convenience for the speech layer: the whole thing as one utterance. */
  speech: string;
}

/** Classes worth interrupting for, in announcement order. */
const HAZARD_LIKE = new Set([
  'car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train', 'boat', 'skateboard',
  'fire hydrant', 'traffic light', 'stop sign', 'person', 'dog', 'cat',
]);

/** Landmark classes that orient rather than threaten. */
const LANDMARK_LIKE = new Set([
  'door', 'bench', 'potted plant', 'stairs', 'traffic light', 'stop sign',
  'parking meter', 'bench', 'fire hydrant', 'refrigerator', 'sink', 'toilet',
]);

/** Maps a bearing to the phrase a blind-navigation user is taught. */
function clockPhrase(bearing: number): string {
  if (!Number.isFinite(bearing)) return 'near you';
  const b = Math.round(bearing);
  if (b >= 1 && b <= 12) return `at ${b} o'clock`;
  return 'near you';
}

function plural(count: number, word: string): string {
  if (count === 1) return word;
  // "3 persons" and "2 sheeps" are the kind of wrong English that makes a
  // screen-reader user stop trusting the voice entirely. The COCO vocabulary
  // has a handful of irregulars; environment.ts already handles them for the
  // one-shot description and this is the same list.
  const irregular: Record<string, string> = {
    person: 'people',
    man: 'men',
    woman: 'women',
    child: 'children',
    mouse: 'mice',
    sheep: 'sheep',
    knife: 'knives',
    bus: 'buses',
  };
  return irregular[word] ?? `${word}s`;
}

/** Reduces the frame to at most three classes, hazards first, counts capped. */
function summarise(detections: GuidanceInput['detections'], limit: number) {
  const usable = detections.filter((d) => d.confidence >= 0.35);
  const byClass = new Map<string, { count: number; best: number; bearing: number }>();
  for (const d of usable) {
    const entry = byClass.get(d.className);
    if (entry) {
      entry.count += 1;
      if (d.confidence > entry.best) {
        entry.best = d.confidence;
        entry.bearing = d.bearingClock;
      }
    } else {
      byClass.set(d.className, { count: 1, best: d.confidence, bearing: d.bearingClock });
    }
  }
  return [...byClass.entries()]
    .sort((a, b) => {
      const ah = HAZARD_LIKE.has(a[0]) ? 0 : LANDMARK_LIKE.has(a[0]) ? 1 : 2;
      const bh = HAZARD_LIKE.has(b[0]) ? 0 : LANDMARK_LIKE.has(b[0]) ? 1 : 2;
      if (ah !== bh) return ah - bh;
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return b[1].best - a[1].best;
    })
    .slice(0, limit)
    .map(([name, v]) => ({ name, ...v }));
}

const VERIFY_STEPS = [
  'Sweep your cane to confirm before you step forward.',
  'Listen for traffic and for changes in the air before moving.',
  'Use your usual route markers if this spot is not one you know.',
];

/**
 * Builds the spoken guidance. Deterministic and pure: same detections in, same
 * words out, which is what makes the spoken layer unit-testable and lets the
 * speech priority manager dedupe identical repeats.
 */
export function buildGuidance(input: GuidanceInput): Guidance {
  const verbosity = input.verbosity ?? 1;
  const summary = summarise(input.detections, verbosity === 0 ? 2 : 3);

  // ── Guidance: what to do next ──
  let guidance: string;
  if (summary.length === 0) {
    // "The path looks clear" is a FALSE claim and a dangerous one. An empty
    // frame means the detector found nothing it was trained to name, not that
    // the path is safe: COCO has no stair, kerb, step or glass class at all
    // (documented in docs/yolo-ocr-slam-plan.md #2.1), and a dark frame, a
    // coat, or a wall two metres off looks exactly like an empty frame to
    // YOLO. SightlineAI's rule — "NEVER fabricate... if information is
    // ambiguous, say so" — and the rule VisionCompanion enforces in code
    // (its lang_guard.py bans the words "safe", "clear" and "go" outright for
    // this reason) both land on the same conclusion. Say what is true.
    guidance = 'Nothing is visible to me right now — I am not saying the path is clear, only that I have nothing to describe.';
  } else {
    const first = summary[0];
    const lead =
      first.count > 1
        ? `${first.count} ${plural(first.count, first.name)} ${clockPhrase(first.bearing)}`
        : `A ${first.name} ${clockPhrase(first.bearing)}`;
    if (summary.length === 1) {
      guidance = `Ahead: ${lead}.`;
    } else {
      const rest = summary
        .slice(1)
        .map((s) => (s.count > 1 ? `${s.count} ${plural(s.count, s.name)}` : `a ${s.name}`))
        .join(', ');
      guidance = `Ahead: ${lead}, and ${rest}.`;
    }
  }

  // The look-down sensor covers the one region the camera cannot see. This is
  // the honest, non-fabricated way to mention it: we say the phone is angled
  // down, not that we detected a kerb.
  if (input.lookingDown) {
    guidance += ' Your phone is angled at the ground, so check your feet for kerbs and steps.';
  }

  // ── Safety notes: proactive, hazard-first ──
  const hazards = summary.filter((s) => HAZARD_LIKE.has(s.name));
  let safetyNotes = '';
  if (hazards.length > 0) {
    const h = hazards[0];
    safetyNotes = `${h.count > 1 ? `${h.count} ${plural(h.count, h.name)}` : `A ${h.name}`} ${clockPhrase(h.bearing)}. Slow down and keep to one side.`;
    if (input.lookingDown) {
      safetyNotes += ' Something at your feet may be below the camera.';
    }
  } else if (input.lookingDown) {
    // Proactive: the user did not ask about hazards, but aiming the phone at
    // the ground during an unfamiliar walk is itself the risk signal.
    safetyNotes = 'Nothing risky is in view, but your phone is aimed low — foot-level hazards are the ones most likely to be missed.';
  }

  // ── Confidence: never empty, always names a self-check ──
  const weak = input.detections.every((d) => d.confidence < 0.5);
  const confidence = weak
    ? 'I am not very certain about this — lighting or distance may be affecting me. '
      + VERIFY_STEPS[1]
    : `${VERIFY_STEPS[input.detections.length > 2 ? 0 : 1]}`;

  const speech = [guidance, safetyNotes, confidence].filter(Boolean).join(' ');

  return { guidance, safetyNotes, confidence, speech };
}

/** The one-line answer for "what's ahead", used when the user wants less. */
export function shortGuidance(input: GuidanceInput): string {
  const full = buildGuidance({ ...input, verbosity: 0 });
  return full.guidance;
}
