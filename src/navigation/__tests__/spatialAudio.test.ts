// Spatial audio + adaptive frame-rate tests.

import { describe, expect, it } from 'vitest';
import { panFromText } from '../spatialAudio';
import { accelDelta, fpsForMotion, intervalMsForFps, motionFromAccelDelta } from '../adaptiveFrameRate';

describe('spatial audio pan parsing', () => {
  it('pans left/right by direction words', () => {
    expect(panFromText('bicycle on your left')).toBeLessThan(0);
    expect(panFromText('car on your right')).toBeGreaterThan(0);
    expect(panFromText('path is clear ahead')).toBe(0);
  });

  it('maps clock positions around the circle', () => {
    expect(panFromText('at your 3 o\'clock')).toBeGreaterThan(0);
    expect(panFromText('at your 9 o\'clock')).toBeLessThan(0);
    expect(panFromText('at your 12 o\'clock')).toBeCloseTo(0, 5);
    expect(panFromText('at your 2 o\'clock')).toBeGreaterThan(0);
    expect(panFromText('at your 10 o\'clock')).toBeLessThan(0);
    expect(panFromText('at your 6 o\'clock')).toBeCloseTo(0, 5);
  });

  it('clamps extreme values', () => {
    const v = panFromText('at your 1 o\'clock');
    expect(v).toBeGreaterThanOrEqual(-1);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('adaptive frame rate', () => {
  it('scales fps with motion', () => {
    expect(fpsForMotion('stationary')).toBe(0.5);
    expect(fpsForMotion('walking')).toBe(1.5);
    expect(fpsForMotion('running')).toBe(2.5);
  });

  it('converts fps to sane intervals', () => {
    expect(intervalMsForFps(2.5)).toBe(400);
    expect(intervalMsForFps(0.5)).toBe(2000);
  });

  it('classifies motion from accelerometer deltas', () => {
    expect(motionFromAccelDelta(0.1)).toBe('stationary');
    expect(motionFromAccelDelta(1.5)).toBe('walking');
    expect(motionFromAccelDelta(4)).toBe('running');
  });

  it('computes 3-axis delta magnitude', () => {
    expect(accelDelta(1, 0, 0, 0, 0, 0)).toBeCloseTo(1, 5);
    expect(accelDelta(0, 3, 4, 0, 0, 0)).toBeCloseTo(5, 5);
  });
});
