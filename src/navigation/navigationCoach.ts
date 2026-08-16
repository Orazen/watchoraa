// Watchora Navigation Coach types (v0.5 proactive vision coaching).
// The coach turns raw YOLO detections + motion into deterministic, spoken
// navigation guidance: SPOTTED -> TRACKING -> PASSING -> CLEARED per hazard,
// with directional language, proximity tiers, obstacle chaining, a silence
// breaker, and per-mode cadence. Safety output never depends on AI.

export type CoachMode = 'navigation' | 'reading' | 'exploration' | 'shopping' | 'off';

export type SpatialZone = 'left' | 'center' | 'right';

/** Coarse distance tier derived from box area (same thresholds as the hazard layer). */
export type ProximityTier = 'immediate' | 'nearby' | 'clear';

export type HazardPhase = 'spotted' | 'tracking' | 'passing' | 'cleared';

export interface TrackedHazard {
  id: string;
  className: string;
  zone: SpatialZone;
  tier: ProximityTier;
  phase: HazardPhase;
  firstSeenAt: number;
  lastSeenAt: number;
  /** How many consecutive frames this hazard has been absent (for CLEARED). */
  absentFrames: number;
  /** True once we have spoken the SPOTTED announcement for this hazard. */
  announced: boolean;
  /** True for 'person' detections — gets distinct people-aware phrasing. */
  isPerson: boolean;
  /** True when the box sits low enough in frame to be a ground-level trip risk. */
  isGroundLevel: boolean;
}

export interface CoachDetection {
  className: string;
  confidence: number;
  box: { x: number; y: number; width: number; height: number };
}

export interface CoachAnnouncement {
  text: string;
  /** Speech priority (1 emergency .. 7 background). Coaching uses 3-5. */
  priority: number;
  /** Stereo pan -1 (left) .. 1 (right). 0 = center. */
  pan: number;
  dedupeKey: string;
  /** Haptic tier, if any ('hazard-immediate' | 'hazard-nearby' | 'clear'). */
  haptic?: 'hazard-immediate' | 'hazard-nearby' | 'clear';
  kind: 'hazard' | 'status' | 'scan' | 'silence-break';
}

export interface CoachOptions {
  /** Cooldown (ms) before the same hazard id is re-announced. */
  reannounceCooldownMs?: number;
  /** Frames a hazard must be absent before it is considered CLEARED. */
  clearedAfterAbsentFrames?: number;
  /** Cadence (ms) for status updates in navigation mode while moving. */
  walkingUpdateMs?: number;
  /** Silence threshold (ms) before a status nudge in navigation mode. */
  silenceThresholdMs?: number;
}

export const COACH_DEFAULTS: Required<CoachOptions> = {
  reannounceCooldownMs: 20_000,
  clearedAfterAbsentFrames: 3,
  walkingUpdateMs: 5_000,
  silenceThresholdMs: 7_000,
};

// Zone thresholds: center third vs. left/right thirds of the frame width.
const CENTER_THIRD = 1 / 3;
const EDGE_THIRD = 2 / 3;
const IMMEDIATE_AREA_THRESHOLD = 0.12;
const MIN_ACT_CONFIDENCE = 0.5;

export function zoneOf(box: { x: number; y: number; width: number; height: number }): SpatialZone {
  const cx = box.x + box.width / 2;
  if (cx < CENTER_THIRD) return 'left';
  if (cx > EDGE_THIRD) return 'right';
  return 'center';
}

export function proximityOf(box: { x: number; y: number; width: number; height: number }): ProximityTier {
  const area = box.width * box.height;
  return area >= IMMEDIATE_AREA_THRESHOLD ? 'immediate' : 'nearby';
}

// A box whose bottom edge sits in the lower quarter of the frame is treated as
// a ground-level trip risk (posts, curbs, low objects) — these get an
// explicit "watch your step" cue even at moderate size, since a small object
// close to the ground is disproportionately dangerous for a cane-free step.
const GROUND_LEVEL_Y_THRESHOLD = 0.75;

export function isGroundLevelBox(box: { x: number; y: number; width: number; height: number }): boolean {
  return box.y + box.height >= GROUND_LEVEL_Y_THRESHOLD;
}

/**
 * Human-readable direction phrase for a zone, honoring the camera-to-user
 * perspective (what is on the LEFT of the camera frame is on the user's LEFT).
 */
export function directionPhrase(zone: SpatialZone, tier: ProximityTier): string {
  if (tier === 'immediate') {
    if (zone === 'left') return 'immediately on your left';
    if (zone === 'right') return 'immediately on your right';
    return 'directly ahead of you';
  }
  if (zone === 'left') return 'on your left';
  if (zone === 'right') return 'on your right';
  return 'ahead of you';
}

/** Clock-position phrasing for spatial audio panning (2..10 o'clock). */
export function clockPosition(zone: SpatialZone, tier: ProximityTier): number {
  if (zone === 'left') return tier === 'immediate' ? 8 : 9;
  if (zone === 'right') return tier === 'immediate' ? 4 : 3;
  return 12;
}

export function panFromZone(zone: SpatialZone): number {
  if (zone === 'left') return -0.8;
  if (zone === 'right') return 0.8;
  return 0;
}

export interface CoachFrameInput {
  detections: CoachDetection[];
  /** True when the user is moving (from accelerometer/step detection). */
  moving: boolean;
  now: number;
}

export interface CoachState {
  tracked: TrackedHazard[];
  lastStatusAt: number;
  lastAnnouncementAt: number;
}

export function createCoachState(now: number): CoachState {
  return { tracked: [], lastStatusAt: now, lastAnnouncementAt: now };
}

function hazardId(className: string, zone: SpatialZone): string {
  return `${className}::${zone}`;
}

function zoneOrder(z: SpatialZone): number {
  if (z === 'left') return 0;
  if (z === 'center') return 1;
  return 2;
}

function matchExisting(tracked: TrackedHazard[], className: string, zone: SpatialZone): TrackedHazard | null {
  // Prefer same class + same zone, then same class in an adjacent zone
  // (hazard drifting across the frame while being tracked).
  const same = tracked.find((h) => h.className === className && h.zone === zone && h.phase !== 'cleared');
  if (same) return same;
  const adj = tracked.find(
    (h) => h.className === className && h.phase !== 'cleared' && Math.abs(zoneOrder(zone) - zoneOrder(h.zone)) <= 1,
  );
  return adj ?? null;
}

/**
 * Pure coaching step. Consumes one frame of detections plus motion, updates
 * the tracked-hazard state machine, and returns spoken announcements.
 *
 * Deterministic by construction: identical input yields identical output.
 */
export function coachStep(state: CoachState, input: CoachFrameInput, opts: CoachOptions = {}): CoachAnnouncement[] {
  const o: Required<CoachOptions> = { ...COACH_DEFAULTS, ...opts };
  const announcements: CoachAnnouncement[] = [];
  const now = input.now;

  // 1. Match this frame's hazards to tracked state.
  const seen = new Set<string>();
  for (const d of input.detections) {
    if (d.confidence < MIN_ACT_CONFIDENCE) continue;
    const zone = zoneOf(d.box);
    const tier = proximityOf(d.box);
    const groundLevel = isGroundLevelBox(d.box);
    const id = hazardId(d.className, zone);
    seen.add(id);
    const existing = matchExisting(state.tracked, d.className, zone);
    if (existing) {
      // Same hazard persists: update zone/tier, bump phase.
      existing.lastSeenAt = now;
      existing.absentFrames = 0;
      existing.isGroundLevel = groundLevel;
      if (existing.zone !== zone) existing.zone = zone;
      if (existing.tier !== tier) existing.tier = tier;
      if (existing.phase === 'spotted' || existing.phase === 'tracking') {
        // PASSING when it was center and now moved to an edge, or vice-versa.
        if (existing.zone !== 'center' && zone === 'center') existing.phase = 'tracking';
        else if (existing.zone === 'center' && zone !== 'center') existing.phase = 'passing';
        else existing.phase = 'tracking';
      }
    } else {
      state.tracked.push({
        id,
        className: d.className,
        zone,
        tier,
        phase: 'spotted',
        firstSeenAt: now,
        lastSeenAt: now,
        absentFrames: 0,
        announced: false,
        isPerson: d.className === 'person',
        isGroundLevel: groundLevel,
      });
    }
  }

  // 2. Age tracked hazards: mark absent frames; clear stale ones.
  for (const h of state.tracked) {
    if (!seen.has(h.id) && h.phase !== 'cleared') {
      h.absentFrames += 1;
      if (h.absentFrames >= o.clearedAfterAbsentFrames) {
        h.phase = 'cleared';
        announcements.push({
          text: `You are past the ${h.className}${h.zone === 'center' ? '' : ` on your ${h.zone === 'left' ? 'left' : 'right'}`}. Scanning ahead for the next obstacle.`,
          priority: 5,
          pan: panFromZone(h.zone),
          dedupeKey: `cleared:${h.id}`,
          haptic: 'clear',
          kind: 'scan',
        });
      }
    }
  }

  // 3. Announce new/updated hazards (SPOTTED/TRACKING/PASSING/immediate).
  for (const h of state.tracked) {
    if (h.phase === 'cleared') continue;
    const isNew = !h.announced;
    const isImmediate = h.tier === 'immediate' && h.phase !== 'spotted';
    if (isNew || isImmediate) {
      if (isNew) h.announced = true;
      const dir = directionPhrase(h.zone, h.tier);
      const clock = clockPosition(h.zone, h.tier);
      let text: string;
      if (h.isPerson) {
        // People-awareness: distinct phrasing from object hazards — describes
        // presence and movement direction, never identifies or judges intent.
        if (h.tier === 'immediate') {
          text = `Caution. A person is close, ${dir}, at your ${clock} o'clock. ${h.zone === 'left' ? 'Step right' : h.zone === 'right' ? 'Step left' : 'Slow down'} to give them room.`;
        } else if (h.phase === 'spotted') {
          text = `Person approaching ${dir}, at your ${clock} o'clock.`;
        } else {
          text = `Person ${dir}, at your ${clock} o'clock.`;
        }
      } else if (h.isGroundLevel && h.tier !== 'immediate') {
        // Ground-level trip risk: explicit "watch your step" even at moderate
        // size, since small low objects (posts, curbs) are easy to miss.
        text = `Watch your step. ${cap(h.className)} at ground level ${dir}, at your ${clock} o'clock.`;
      } else if (h.tier === 'immediate') {
        text = `Caution. ${cap(h.className)} ${dir}, at your ${clock} o'clock. ${h.zone === 'left' ? 'Step right' : h.zone === 'right' ? 'Step left' : 'Slow down'} to avoid it.`;
      } else if (h.phase === 'spotted') {
        text = `${cap(h.className)} spotted ${dir}, at your ${clock} o'clock.`;
      } else {
        text = `${cap(h.className)} ${dir}, at your ${clock} o'clock.`;
      }
      announcements.push({
        text,
        priority: h.tier === 'immediate' ? 3 : 4,
        pan: panFromZone(h.zone),
        dedupeKey: `hazard:${h.id}:${h.tier}`,
        haptic: h.tier === 'immediate' ? 'hazard-immediate' : 'hazard-nearby',
        kind: 'hazard',
      });
      state.lastAnnouncementAt = now;
    }
  }

  // 4. Walking updates + silence breaker (navigation mode only by design; the
  //    hook gates cadence by mode — this engine is mode-agnostic).
  if (input.moving) {
    const silenceMs = now - state.lastStatusAt;
    if (silenceMs >= o.walkingUpdateMs) {
      const active = state.tracked.filter((h) => h.phase !== 'cleared');
      if (active.length === 0) {
        announcements.push({
          text: 'Path is clear ahead. Continuing. Scan ahead for the next obstacle.',
          priority: 5,
          pan: 0,
          dedupeKey: `walking:${Math.floor(now / o.walkingUpdateMs)}`,
          kind: 'status',
        });
      }
      state.lastStatusAt = now;
    } else if (silenceMs >= o.silenceThresholdMs) {
      announcements.push({
        text: 'Still clear. Walking normally. Next hazard, if any, will be announced.',
        priority: 5,
        pan: 0,
        dedupeKey: `silence-break:${Math.floor(now / o.silenceThresholdMs)}`,
        kind: 'silence-break',
      });
      state.lastStatusAt = now;
    }
  } else {
    state.lastStatusAt = now;
  }

  return announcements;
}

function cap(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
