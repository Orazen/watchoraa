import type { Detection } from './yolo.worker';

/**
 * Temporal detection smoothing for assistive announcements.
 *
 * A lower per-frame confidence threshold (0.30) buys recall for small/distant
 * objects but admits flicker and one-off false positives. The standard assistive
 * pattern (researched against Ultralytics sources and assistive-YOLO papers,
 * 2026-09) is to gate *announcements*, not detections: a class is only acted on
 * after it has been seen in N consecutive frames, tracks survive brief misses,
 * and each track has a cooldown so the same object isn't repeated every cycle.
 */

export type TrackedDetection = Detection & {
  /** Stable id for this track within the tracker's lifetime. */
  trackId: number;
  /** How many consecutive/total frames this track has been confirmed in. */
  hits: number;
  /** True the first frame this track passes the confirmation gate. */
  isNewlyConfirmed: boolean;
};

type Track = {
  trackId: number;
  className: string;
  box: Detection['box'];
  confidence: number;
  hits: number;
  misses: number;
  /** Age in update() cycles since the last announcement-triggering event. */
  cyclesSinceAnnounced: number;
  /** Whether this track has already fired its "newly confirmed" event. */
  announced: boolean;
  lastSeenAt: number;
};

const DEFAULT_OPTIONS = {
  /** Confirmations required before a track is announced (3–5 frames is the norm). */
  confirmHits: 3,
  /** Tracks survive this many missed frames before being dropped (2–3 is the norm). */
  maxMisses: 3,
  /** IoU above which two boxes of the same class are the same object. */
  matchIou: 0.3,
  /** Centroid distance (normalized) fallback match when IoU is low (boxes jitter). */
  matchCentroid: 0.12,
  /** Cycles before the same track may re-announce. */
  reannounceAfterCycles: 15,
  /** Forget tracks not seen for this long (ms) — e.g. camera paused. */
  trackTimeoutMs: 4000,
};

export type DetectionTrackerOptions = Partial<typeof DEFAULT_OPTIONS>;

export class DetectionTracker {
  private tracks: Track[] = [];
  private nextTrackId = 1;
  private readonly options: typeof DEFAULT_OPTIONS;

  constructor(options: DetectionTrackerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  reset() {
    this.tracks = [];
  }

  private iou(a: Detection['box'], b: Detection['box']): number {
    const ax2 = a.x + a.width;
    const ay2 = a.y + a.height;
    const bx2 = b.x + b.width;
    const by2 = b.y + b.height;
    const interW = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
    const interH = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
    const interArea = interW * interH;
    const unionArea = a.width * a.height + b.width * b.height - interArea;
    return unionArea <= 0 ? 0 : interArea / unionArea;
  }

  private matches(track: Track, det: Detection): boolean {
    if (track.className !== det.className) return false;
    if (this.iou(track.box, det.box) >= this.options.matchIou) return true;
    // Small/distant boxes barely overlap frame-to-frame even when it's the same
    // object; centroid proximity is the fallback match.
    const dx = track.box.x + track.box.width / 2 - (det.box.x + det.box.width / 2);
    const dy = track.box.y + track.box.height / 2 - (det.box.y + det.box.height / 2);
    return Math.hypot(dx, dy) <= this.options.matchCentroid;
  }

  /**
   * Feed one frame's raw detections. Returns the smoothed view: tracks that
   * passed the confirmation gate, with `isNewlyConfirmed` set exactly once per
   * track (and again after a cooldown-driven re-announce).
   */
  update(detections: Detection[], now = Date.now()): TrackedDetection[] {
    const used = new Set<number>();
    for (const track of this.tracks) {
      let best: Detection | null = null;
      let bestIdx = -1;
      for (let i = 0; i < detections.length; i++) {
        if (used.has(i)) continue;
        if (!this.matches(track, detections[i])) continue;
        if (!best || detections[i].confidence > best.confidence) {
          best = detections[i];
          bestIdx = i;
        }
      }
      if (best && bestIdx >= 0) {
        used.add(bestIdx);
        track.box = best.box;
        track.confidence = best.confidence;
        track.hits += 1;
        track.misses = 0;
        track.lastSeenAt = now;
      } else {
        track.misses += 1;
      }
      track.cyclesSinceAnnounced += 1;
    }

    // New detections spawn candidate tracks (hits start at 1).
    for (let i = 0; i < detections.length; i++) {
      if (used.has(i)) continue;
      const det = detections[i];
      this.tracks.push({
        trackId: this.nextTrackId++,
        className: det.className,
        box: det.box,
        confidence: det.confidence,
        hits: 1,
        misses: 0,
        cyclesSinceAnnounced: 0,
        announced: false,
        lastSeenAt: now,
      });
    }

    this.tracks = this.tracks.filter(
      (t) => t.misses <= this.options.maxMisses && now - t.lastSeenAt <= this.options.trackTimeoutMs,
    );

    const confirmed = this.tracks
      .filter((t) => t.hits >= this.options.confirmHits)
      .map((t): TrackedDetection => {
        // First confirmation fires the moment hits cross the gate (announced
        // still false); repeats only after the cooldown via reannounce.
        const reannounce = t.announced && t.cyclesSinceAnnounced >= this.options.reannounceAfterCycles;
        const isNewlyConfirmed = !t.announced || reannounce;
        if (isNewlyConfirmed) {
          t.announced = true;
          t.cyclesSinceAnnounced = 0;
        }
        return {
          trackId: t.trackId,
          className: t.className,
          confidence: t.confidence,
          box: t.box,
          bearingClock: bearingClockFromCenterX(t.box.x + t.box.width / 2),
          hits: t.hits,
          isNewlyConfirmed,
        };
      });

    return confirmed.sort((a, b) => b.confidence - a.confidence);
  }

  /** Current confirmed tracks without any announcement bookkeeping side effects. */
  snapshot(): TrackedDetection[] {
    return this.tracks
      .filter((t) => t.hits >= this.options.confirmHits)
      .map((t): TrackedDetection => ({
        trackId: t.trackId,
        className: t.className,
        confidence: t.confidence,
        box: t.box,
        bearingClock: bearingClockFromCenterX(t.box.x + t.box.width / 2),
        hits: t.hits,
        isNewlyConfirmed: false,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }
}

export function bearingClockFromCenterX(centerXNormalized: number): number {
  // 0.0 = far left = 9 o'clock, 0.5 = straight ahead = 12, 1.0 = far right = 3 o'clock.
  const clamped = Math.min(1, Math.max(0, centerXNormalized));
  const clock = 9 + clamped * 6;
  const wrapped = clock > 12 ? clock - 12 : clock;
  return Math.round(wrapped) || 12;
}
