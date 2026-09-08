import { describe, expect, it } from 'vitest';
import type { Detection } from '../yolo.worker';
import { DetectionTracker, bearingClockFromCenterX } from '../detectionTracker';

function det(className: string, overrides: Partial<Detection> = {}): Detection {
  return {
    className,
    confidence: 0.8,
    box: { x: 0.45, y: 0.4, width: 0.1, height: 0.2 },
    bearingClock: 12,
    ...overrides,
  };
}

describe('bearingClockFromCenterX', () => {
  it('maps left edge to 9, center to 12, right edge to 3', () => {
    expect(bearingClockFromCenterX(0)).toBe(9);
    expect(bearingClockFromCenterX(0.5)).toBe(12);
    expect(bearingClockFromCenterX(1)).toBe(3);
  });

  it('maps the far right of the wrap window back past 12', () => {
    // 0.9 → 9 + 5.4 = 14.4 → wraps to 2.4 → rounds to 2 o'clock.
    expect(bearingClockFromCenterX(0.9)).toBe(2);
  });
});

describe('DetectionTracker', () => {
  it('does not confirm a class seen in fewer frames than confirmHits', () => {
    const tracker = new DetectionTracker({ confirmHits: 3 });
    let out = tracker.update([det('person')]);
    expect(out).toHaveLength(0);
    out = tracker.update([det('person')]);
    expect(out).toHaveLength(0);
    out = tracker.update([det('person')]);
    expect(out).toHaveLength(1);
    expect(out[0].className).toBe('person');
  });

  it('flags isNewlyConfirmed exactly once per track', () => {
    const tracker = new DetectionTracker({ confirmHits: 3 });
    tracker.update([det('person')]);
    tracker.update([det('person')]);
    const confirmed = tracker.update([det('person')]);
    expect(confirmed[0].isNewlyConfirmed).toBe(true);
    const again = tracker.update([det('person')]);
    expect(again[0].isNewlyConfirmed).toBe(false);
  });

  it('keeps a track alive through brief misses and drops it after maxMisses', () => {
    const tracker = new DetectionTracker({ confirmHits: 3, maxMisses: 2 });
    tracker.update([det('car')]);
    tracker.update([det('car')]);
    // Miss one frame.
    expect(tracker.update([]).filter((d) => d.className === 'car')).toHaveLength(0);
    // Seen again — confirms because hits accumulate.
    let out = tracker.update([det('car')]);
    expect(out.filter((d) => d.className === 'car')).toHaveLength(1);
    // Three consecutive misses kill the track.
    tracker.update([]);
    tracker.update([]);
    out = tracker.update([]);
    expect(out.filter((d) => d.className === 'car')).toHaveLength(0);
  });

  it('matches the same object across small frame-to-frame drift via centroid', () => {
    const tracker = new DetectionTracker({ confirmHits: 2 });
    tracker.update([det('person', { box: { x: 0.40, y: 0.4, width: 0.1, height: 0.2 } })]);
    const out = tracker.update([det('person', { box: { x: 0.44, y: 0.42, width: 0.1, height: 0.2 } })]);
    expect(out).toHaveLength(1);
    expect(out[0].hits).toBe(2);
  });

  it('never matches detections of different classes to one track', () => {
    const tracker = new DetectionTracker({ confirmHits: 2 });
    tracker.update([det('person')]);
    const out = tracker.update([det('dog', { box: { x: 0.45, y: 0.4, width: 0.1, height: 0.2 } })]);
    // Two separate candidate tracks, neither confirmed.
    expect(out).toHaveLength(0);
  });

  it('re-announces after the cooldown, and only then', () => {
    const tracker = new DetectionTracker({ confirmHits: 2, reannounceAfterCycles: 3 });
    tracker.update([det('person')]);
    const first = tracker.update([det('person')]);
    expect(first[0].isNewlyConfirmed).toBe(true);
    expect(tracker.update([det('person')])[0].isNewlyConfirmed).toBe(false);
    expect(tracker.update([det('person')])[0].isNewlyConfirmed).toBe(false);
    expect(tracker.update([det('person')])[0].isNewlyConfirmed).toBe(true);
  });

  it('snapshot returns confirmed tracks without side effects', () => {
    const tracker = new DetectionTracker({ confirmHits: 3 });
    tracker.update([det('chair', { confidence: 0.6 })]);
    tracker.update([det('chair', { confidence: 0.9 })]);
    tracker.update([det('chair')]);
    const snap = tracker.snapshot();
    expect(snap).toHaveLength(1);
    // The track carries the most recent matched detection's confidence.
    expect(snap[0].confidence).toBe(0.8);
    expect(snap[0].hits).toBe(3);
    expect(snap[0].isNewlyConfirmed).toBe(false);
  });
});
