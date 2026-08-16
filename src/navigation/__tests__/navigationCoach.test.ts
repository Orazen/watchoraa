// Navigation coach engine tests: determinism, SPOTTED -> TRACKING -> PASSING
// -> CLEARED chaining, directional language, silence breaker, walking cadence.

import { describe, expect, it } from 'vitest';
import {
  coachStep,
  createCoachState,
  directionPhrase,
  panFromZone,
  zoneOf,
  proximityOf,
  type CoachFrameInput,
  type CoachState,
  type CoachDetection,
} from '../navigationCoach';

function det(className: string, x: number, y: number, width: number, height: number, confidence = 0.9): CoachDetection {
  return { className, confidence, box: { x, y, width, height } };
}

function frame(detections: CoachDetection[], moving = false, now = 1000): CoachFrameInput {
  return { detections, moving, now };
}

describe('zone/proximity mapping', () => {
  it('maps left, center, right thirds', () => {
    expect(zoneOf({ x: 0.05, y: 0.4, width: 0.1, height: 0.2 })).toBe('left');
    expect(zoneOf({ x: 0.45, y: 0.4, width: 0.1, height: 0.2 })).toBe('center');
    expect(zoneOf({ x: 0.85, y: 0.4, width: 0.1, height: 0.2 })).toBe('right');
  });

  it('classifies proximity by area', () => {
    expect(proximityOf({ x: 0.4, y: 0.4, width: 0.4, height: 0.4 })).toBe('immediate'); // 0.16 area
    expect(proximityOf({ x: 0.4, y: 0.4, width: 0.1, height: 0.1 })).toBe('nearby'); // 0.01 area
  });

  it('produces actionable direction phrases', () => {
    expect(directionPhrase('left', 'immediate')).toContain('left');
    expect(directionPhrase('right', 'nearby')).toContain('right');
    expect(directionPhrase('center', 'immediate')).toContain('ahead');
  });

  it('maps zones to stereo pan', () => {
    expect(panFromZone('left')).toBeLessThan(0);
    expect(panFromZone('right')).toBeGreaterThan(0);
    expect(panFromZone('center')).toBe(0);
  });
});

describe('coach state machine', () => {
  it('announces a newly spotted hazard with direction + clock position', () => {
    const state = createCoachState(1000);
    const out = coachStep(state, frame([det('bicycle', 0.05, 0.4, 0.1, 0.2)]));
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe('hazard');
    expect(out[0].text).toMatch(/bicycle/i);
    expect(out[0].text).toContain('left');
    expect(out[0].text).toContain('9');
    expect(out[0].pan).toBeLessThan(0);
  });

  it('tracks the same hazard without re-announcing at same tier', () => {
    const state = createCoachState(1000);
    coachStep(state, frame([det('bicycle', 0.05, 0.4, 0.1, 0.2)], false, 1000));
    const out = coachStep(state, frame([det('bicycle', 0.06, 0.4, 0.11, 0.21)], false, 2000));
    // Still nearby + already announced -> no new hazard announcement.
    expect(out.some((a) => a.kind === 'hazard')).toBe(false);
  });

  it('escalates to an immediate caution when the hazard fills the frame', () => {
    const state = createCoachState(1000);
    coachStep(state, frame([det('bicycle', 0.05, 0.4, 0.1, 0.2)], false, 1000));
    const out = coachStep(state, frame([det('bicycle', 0.3, 0.3, 0.5, 0.5)], false, 2000)); // 0.25 area
    const caution = out.find((a) => a.text.startsWith('Caution.'));
    expect(caution).toBeDefined();
    expect(caution!.text).toContain('Slow down');
    expect(caution!.priority).toBe(3);
  });

  it('clears after the hazard is absent for enough frames and chains the next scan', () => {
    const state = createCoachState(1000);
    coachStep(state, frame([det('bicycle', 0.05, 0.4, 0.1, 0.2)], false, 1000));
    coachStep(state, frame([], false, 2000));
    coachStep(state, frame([], false, 3000));
    const out = coachStep(state, frame([], false, 4000));
    const cleared = out.find((a) => a.kind === 'scan');
    expect(cleared).toBeDefined();
    expect(cleared!.text).toContain('past the bicycle');
    expect(cleared!.text).toContain('Scanning ahead');
  });

  it('breaks silence with a status nudge while moving', () => {
    const state = createCoachState(1000);
    // Nothing detected, moving. walkingUpdateMs=5000, silenceThresholdMs=7000.
    const out = coachStep(state, frame([], true, 1000 + 7_500));
    expect(out.some((a) => a.kind === 'silence-break' || a.kind === 'status')).toBe(true);
  });

  it('stays silent when stationary', () => {
    const state = createCoachState(1000);
    const out = coachStep(state, frame([], false, 1000 + 60_000));
    expect(out).toHaveLength(0);
  });

  it('is deterministic: identical inputs yield identical announcements', () => {
    const a = coachStep(createCoachState(1000), frame([det('car', 0.5, 0.3, 0.4, 0.4)]));
    const b = coachStep(createCoachState(1000), frame([det('car', 0.5, 0.3, 0.4, 0.4)]));
    expect(a).toEqual(b);
  });
});

describe('people awareness (v0.6)', () => {
  it('uses distinct people-aware phrasing for a spotted person', () => {
    const state = createCoachState(1000);
    const out = coachStep(state, frame([det('person', 0.05, 0.4, 0.1, 0.2)]));
    expect(out[0].text).toMatch(/person/i);
    expect(out[0].text).not.toMatch(/^Person spotted/i); // distinct from generic object phrasing
    expect(out[0].text).toContain('approaching');
  });

  it('escalates to a people-aware caution at immediate proximity', () => {
    const state = createCoachState(1000);
    coachStep(state, frame([det('person', 0.05, 0.4, 0.1, 0.2)], false, 1000));
    const out = coachStep(state, frame([det('person', 0.3, 0.3, 0.5, 0.5)], false, 2000));
    const caution = out.find((a) => a.text.startsWith('Caution.'));
    expect(caution).toBeDefined();
    expect(caution!.text).toContain('person is close');
    expect(caution!.text).toContain('give them room');
  });

  it('never identifies or judges a person, only presence and direction', () => {
    const state = createCoachState(1000);
    const out = coachStep(state, frame([det('person', 0.5, 0.4, 0.2, 0.3)]));
    expect(out[0].text).not.toMatch(/danger|threat|suspicious|police|report/i);
  });
});

describe('ground-level trip hazards (v0.6)', () => {
  it('warns "watch your step" for a moderate-size object low in frame', () => {
    const state = createCoachState(1000);
    // y + height = 0.85 -> at/below the ground-level threshold (0.75), small area -> nearby tier
    const out = coachStep(state, frame([det('bench', 0.4, 0.75, 0.15, 0.1)]));
    expect(out[0].text).toContain('Watch your step');
    expect(out[0].text).toContain('ground level');
  });

  it('does not use ground-level phrasing for objects higher in the frame', () => {
    const state = createCoachState(1000);
    const out = coachStep(state, frame([det('bench', 0.4, 0.1, 0.15, 0.1)]));
    expect(out[0].text).not.toContain('Watch your step');
  });

  it('immediate-tier ground objects still get the immediate caution, not the trip phrasing', () => {
    const state = createCoachState(1000);
    coachStep(state, frame([det('bench', 0.4, 0.75, 0.15, 0.1)], false, 1000));
    const out = coachStep(state, frame([det('bench', 0.3, 0.6, 0.5, 0.4)], false, 2000)); // large -> immediate
    const caution = out.find((a) => a.text.startsWith('Caution.'));
    expect(caution).toBeDefined();
  });
});
