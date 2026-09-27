// Unit tests for the Watch companion core.
//
// The failure these guard against is specific and unforgivable: a companion
// that says something false, or that talks over a blind user while they walk.
// Every test below is tied to a real design rule from the module it covers,
// not to an implementation detail.

import { describe, it, expect } from 'vitest';
import {
  readOrientation,
  CompassStabiliser,
  describeHeading,
  compassPointName,
  angleDelta,
  describeTurn,
  orientationSpeech,
  isLookingDown,
  type HeadingReading,
} from '../companion/orientation';
import { buildGuidance, shortGuidance } from '../companion/guidance';
import {
  decideWatchAction,
  sceneKey,
  watchStatusSpeech,
  WATCH_CADENCE_LABELS,
  type WatchDecisionInput,
} from '../companion/watchSession';
import {
  MASCOT_PROFILES,
  mascotTransition,
  modeOf,
  capabilitySpeech,
  type MascotState,
} from '../companion/mascotStates';
import { matchDeterministicCommand } from '../voice/deterministicCommands';
import { HELP_MESSAGE } from '../voice/voiceTypes';

const baseInput = (over: Partial<WatchDecisionInput> = {}): WatchDecisionInput => ({
  state: 'watching',
  cadence: 'steady',
  detections: [],
  hazardActive: false,
  hazardLabel: null,
  orientation: null,
  compassStable: false,
  lookingDown: false,
  batteryLevel: 0.8,
  charging: false,
  hour: 12,
  verbosity: 1,
  now: 1_000_000,
  secondsSinceLastUtterance: 1000,
  lastSceneKey: '',
  lastAnnouncedHeading: null,
  batteryWarned: false,
  quietStartHour: 22,
  quietEndHour: 6,
  ...over,
});

// ═══════════════════════════════════════════════════════════════
// orientation — the honesty rules
// ═══════════════════════════════════════════════════════════════
describe('orientation — never claims a direction it cannot know', () => {
  it('uses the absolute compass heading when the browser provides one', () => {
    const r = readOrientation({ alpha: 90, beta: 10, gamma: 2, absolute: false, webkitCompassHeading: 214 });
    expect(r).not.toBeNull();
    expect(r!.headingDeg).toBe(214);
    expect(r!.absolute).toBe(true);
  });

  // THE HONESTY RULE. `alpha` is rotation relative to the screen, NOT a
  // compass. Reading a north/south name off it produces confident nonsense for
  // a user who is trying to orient themselves in a street.
  it('marks a plain alpha reading as NON-absolute so no compass name is possible', () => {
    const r = readOrientation({ alpha: 90, beta: 0, gamma: 0, absolute: false });
    expect(r!.absolute).toBe(false);
    expect(orientationSpeech(r!, true, false)).toContain('not giving me a compass');
  });

  it('accepts magnetometer-corrected alpha as absolute', () => {
    const r = readOrientation({ alpha: 90, beta: 0, gamma: 0, absolute: true });
    expect(r!.absolute).toBe(true);
  });

  it('returns null when the event carries no rotation at all (desktop browsers)', () => {
    expect(readOrientation({ alpha: null, beta: null, gamma: null, absolute: false })).toBeNull();
  });

  it('rejects an out-of-range webkitCompassHeading rather than trusting it', () => {
    const r = readOrientation({ alpha: 10, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: 900 });
    // Falls through to alpha and is flagged non-absolute.
    expect(r!.absolute).toBe(false);
  });

  it('inverts alpha so a clockwise turn reads as a positive delta', () => {
    const r = readOrientation({ alpha: 90, beta: 0, gamma: 0, absolute: false });
    // alpha 90 == device top 90° counter-clockwise; the clockwise frame is 270.
    expect(r!.headingDeg).toBe(270);
  });
});

describe('CompassStabiliser — a phone compass is noisy, so demand agreement', () => {
  const reading = (h: number): HeadingReading => ({ headingDeg: h, pitchDeg: 0, rollDeg: 0, absolute: true });

  it('refuses a direction until enough samples have arrived', () => {
    const s = new CompassStabiliser();
    s.push(reading(10), 0);
    s.push(reading(11), 100);
    s.push(reading(9), 200);
    expect(s.isStable()).toBe(false);
  });

  // Walking past a bus stop genuinely produces 40-degree swings. A confident
  // average would tell the user they are facing east while facing west.
  it('rejects a jumping compass even with a full window', () => {
    const s = new CompassStabiliser();
    s.push(reading(10), 0);
    s.push(reading(50), 100);
    s.push(reading(95), 200);
    s.push(reading(140), 300);
    expect(s.isStable()).toBe(false);
  });

  it('accepts a steady compass', () => {
    const s = new CompassStabiliser();
    for (const h of [10, 11, 9, 10]) s.push(reading(h), 0);
    expect(s.isStable()).toBe(true);
    expect(s.meanHeading()).toBeCloseTo(10, 0);
  });

  // The classic averaging bug: mean(350, 10) is 180 — the exact opposite.
  it('averages circularly so readings around north do not cancel to south', () => {
    const s = new CompassStabiliser();
    for (const h of [350, 355, 5, 0]) s.push(reading(h), 0);
    const mean = s.meanHeading()!;
    expect(Math.min(mean, 360 - mean)).toBeLessThan(6);
  });

  it('drops samples that fall out of the window', () => {
    const s = new CompassStabiliser(8, 4, 4000);
    for (const h of [10, 11, 9, 10]) s.push(reading(h), 0);
    s.push(reading(300), 5000);
    expect(s.sampleCount).toBe(1);
    expect(s.isStable()).toBe(false);
  });
});

describe('heading and turn wording', () => {
  it('names the eight compass points', () => {
    expect(compassPointName(0)).toBe('north');
    expect(compassPointName(90)).toBe('east');
    expect(compassPointName(225)).toBe('south-west');
    expect(compassPointName(359)).toBe('north');
  });

  it('always hedges the direction it names', () => {
    expect(describeHeading(95)).toContain('roughly');
  });

  it('takes the short way round a turn', () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
  });

  it('reports a left turn as left', () => {
    expect(describeTurn(0, 300)).toContain('left');
    expect(describeTurn(0, 60)).toContain('right');
  });

  it('stays silent for a drift too small to act on', () => {
    expect(describeTurn(0, 12)).toBe('');
  });

  it('rounds a turn to an actionable number', () => {
    expect(describeTurn(0, 47)).toContain('45 degrees');
  });

  it('warns that the phone is aimed at the ground', () => {
    const down = { headingDeg: 0, pitchDeg: 60, rollDeg: 0, absolute: false };
    expect(isLookingDown(down)).toBe(true);
    expect(orientationSpeech(down, false, true)).toContain('angled down');
  });

  it('says plainly when there is no orientation data at all', () => {
    expect(orientationSpeech(null, false, false)).toContain('cannot read the direction');
  });

  it('refuses a direction while the compass is unsettled', () => {
    const r: HeadingReading = { headingDeg: 200, pitchDeg: 0, rollDeg: 0, absolute: true };
    expect(orientationSpeech(r, false, false)).toContain('unsettled');
  });
});

// ═══════════════════════════════════════════════════════════════
// guidance — the sightline contract
// ═══════════════════════════════════════════════════════════════
describe('guidance — sightline rules, computed locally', () => {
  const det = (className: string, bearingClock: number, confidence = 0.8) => ({ className, bearingClock, confidence });

  // An empty frame does NOT mean a safe path. YOLOv8n has no stair, kerb or
  // glass class, and a dark frame or a nearby wall reads as empty — so
  // claiming "the path is clear" is a false statement a user may act on.
  it('never claims an empty frame is a clear path', () => {
    const g = buildGuidance({ detections: [] });
    // The CLAIM is the first sentence, before the disclaimer. Testing the
    // whole string would pass on a false negative: the word "clear" legitimately
    // appears later, inside "I am not saying the path is clear".
    const claim = g.guidance.split('—')[0];
    expect(claim).not.toMatch(/\bclear\b/i);
    expect(claim).not.toMatch(/\bsafe\b/i);
    expect(claim).toContain('Nothing is visible to me');
  });

  it('uses clock-face bearings, the convention blind-navigation users are taught', () => {
    const g = buildGuidance({ detections: [det('person', 2)] });
    expect(g.guidance).toContain("2 o'clock");
  });

  it('announces people first, before static objects', () => {
    const g = buildGuidance({ detections: [det('chair', 12), det('person', 3)] });
    expect(g.guidance).toMatch(/person/i);
    expect(g.guidance.indexOf('person')).toBeLessThan(g.guidance.indexOf('chair'));
  });

  it('counts duplicates instead of enumerating them', () => {
    const g = buildGuidance({ detections: [det('person', 12), det('person', 12), det('person', 1)] });
    expect(g.guidance).toContain('3 people');
  });

  it('always offers a verification step, even when confident', () => {
    // sightlineai: "Suggest verification steps: use cane sweeps, listen…"
    // A monocular camera cannot confirm what a cane or an ear already knows.
    expect(buildGuidance({ detections: [det('car', 12, 0.95)] }).confidence).toMatch(/cane|listen/i);
  });

  it('never leaves the confidence field empty', () => {
    for (const d of [[], [det('person', 1)], [det('car', 6, 0.9)]]) {
      expect(buildGuidance({ detections: d }).confidence.length).toBeGreaterThan(0);
    }
  });

  it('flags proactive risk when the phone is aimed at the ground', () => {
    // sightlineai: identify hazards PROACTIVIVELY, even when not asked.
    const g = buildGuidance({ detections: [], lookingDown: true });
    expect(g.safetyNotes).toContain('aimed low');
  });

  it('adds a feet warning to a hazard when looking down', () => {
    const g = buildGuidance({ detections: [det('car', 12)], lookingDown: true });
    expect(g.safetyNotes).toContain('below the camera');
  });

  it('marks itself uncertain when every detection is weak', () => {
    const g = buildGuidance({ detections: [det('person', 1, 0.36)] });
    expect(g.confidence).toContain('not very certain');
  });

  it('joins the parts into one speakable utterance', () => {
    const g = buildGuidance({ detections: [det('car', 12)], verbosity: 1 });
    expect(g.speech).toContain(g.guidance);
  });

  it('shortGuidance drops the caveat but keeps the safety line', () => {
    const short = shortGuidance({ detections: [det('car', 12)] });
    expect(short).toContain('car');
    expect(short).not.toContain('Sweep your cane');
  });
});

// ═══════════════════════════════════════════════════════════════
// watchSession — cadence, the actual product problem
// ═══════════════════════════════════════════════════════════════
describe('watch session — safety first, never nagging, honest battery', () => {
  const person = { className: 'person', bearingClock: 12, confidence: 0.8 };

  it('does nothing when watch is off', () => {
    expect(decideWatchAction(baseInput({ state: 'off' })).kind).toBe('stop');
  });

  it('does nothing when paused', () => {
    expect(decideWatchAction(baseInput({ state: 'paused' })).kind).toBe('stop');
  });

  // RULE 1. A hazard outranks cadence, quiet hours and the battery warning.
  it('speaks immediately for a hazard even in quiet hours', () => {
    const a = decideWatchAction(
      baseInput({ hazardActive: true, hazardLabel: 'car', hour: 3, batteryLevel: 0.02 }),
    );
    expect(a.kind).toBe('speak');
    expect((a as { text: string }).text).toContain('car');
    expect((a as { priority: number }).priority).toBe(1);
  });

  it('keeps the hazard channel alive after a low-battery degrade to quiet', () => {
    const a = decideWatchAction(
      baseInput({ hazardActive: true, hazardLabel: 'car', batteryLevel: 0.05, cadence: 'quiet' }),
    );
    expect(a.kind).toBe('speak');
  });

  it('degrades to quiet on a low battery and says so once', () => {
    const first = decideWatchAction(baseInput({ batteryLevel: 0.1 }));
    expect(first.kind).toBe('degrade');
    expect((first as { to: string }).to).toBe('quiet');
    const second = decideWatchAction(baseInput({ batteryLevel: 0.1, batteryWarned: true }));
    expect(second.kind).not.toBe('degrade');
  });

  it('does not degrade while charging', () => {
    expect(decideWatchAction(baseInput({ batteryLevel: 0.05, charging: true })).kind).not.toBe('degrade');
  });

  // RULE 2. Standing still in a busy street must be silent.
  it('stays silent when the scene has not changed', () => {
    const a = decideWatchAction(
      baseInput({ detections: [person], lastSceneKey: sceneKey([person]), secondsSinceLastUtterance: 300 }),
    );
    expect(a.kind).toBe('wait');
  });

  it('speaks immediately when the scene genuinely changes', () => {
    const a = decideWatchAction(
      baseInput({ detections: [person], lastSceneKey: sceneKey([{ className: 'car', bearingClock: 12, confidence: 0.8 }]) }),
    );
    expect(a.kind).toBe('speak');
  });

  it('absorbs small detector jitter instead of re-announcing', () => {
    const a = decideWatchAction(
      baseInput({
        detections: [{ className: 'person', bearingClock: 12, confidence: 0.7 }],
        lastSceneKey: sceneKey([{ className: 'person', bearingClock: 1, confidence: 0.9 }]),
      }),
    );
    expect(a.kind).toBe('wait');
  });

  it('honours the cadence interval before speaking', () => {
    const a = decideWatchAction(baseInput({ cadence: 'vigilant', secondsSinceLastUtterance: 3 }));
    expect(a.kind).toBe('wait');
  });

  it('stays silent all night except for hazards', () => {
    expect(decideWatchAction(baseInput({ hour: 2 })).kind).toBe('wait');
    expect(decideWatchAction(baseInput({ hour: 2, hazardActive: true })).kind).toBe('speak');
  });

  it('handles quiet hours that wrap past midnight', () => {
    expect(decideWatchAction(baseInput({ hour: 23, quietStartHour: 22, quietEndHour: 6 })).kind).toBe('wait');
    expect(decideWatchAction(baseInput({ hour: 5, quietStartHour: 22, quietEndHour: 6 })).kind).toBe('wait');
    expect(decideWatchAction(baseInput({ hour: 7, quietStartHour: 22, quietEndHour: 6 })).kind).not.toBe('wait');
  });

  // Turning is correct even with no compass at all, so it is worth saying.
  it('announces a significant turn in vigilant mode', () => {
    const a = decideWatchAction(
      baseInput({
        cadence: 'vigilant',
        orientation: { headingDeg: 100, pitchDeg: 0, rollDeg: 0, absolute: false },
        lastAnnouncedHeading: 0,
      }),
    );
    expect(a.kind).toBe('speak');
    expect((a as { text: string }).text).toContain('turned');
  });

  it('does not announce turns in steady mode', () => {
    const a = decideWatchAction(
      baseInput({
        cadence: 'steady',
        detections: [],
        lastSceneKey: sceneKey([]),
        orientation: { headingDeg: 100, pitchDeg: 0, rollDeg: 0, absolute: false },
        lastAnnouncedHeading: 0,
      }),
    );
    expect(a.kind).toBe('wait');
  });

  it('keeps safety lines but drops the caveat at essential verbosity', () => {
    const a = decideWatchAction(baseInput({ verbosity: 0, detections: [{ className: 'car', bearingClock: 12, confidence: 0.9 }] }));
    expect((a as { text: string }).text).toContain('car');
    expect((a as { text: string }).text).not.toContain('Sweep your cane');
  });

  it('labels every cadence for the screen reader', () => {
    for (const label of Object.values(WATCH_CADENCE_LABELS)) expect(label.length).toBeGreaterThan(3);
  });
});

describe('watchStatusSpeech', () => {
  it('offers a way in when watch is off', () => {
    expect(watchStatusSpeech({ state: 'off', cadence: 'steady', spokenCount: 0, batteryLevel: null, charging: false })).toContain(
      'start watch',
    );
  });

  it('reports the cadence and the update count', () => {
    const s = watchStatusSpeech({ state: 'watching', cadence: 'vigilant', spokenCount: 3, batteryLevel: 0.42, charging: false });
    expect(s).toContain('vigilant');
    expect(s).toContain('3 updates');
    expect(s).toContain('42 percent');
  });
});

// ═══════════════════════════════════════════════════════════════
// mascot — felt, not just seen
// ═══════════════════════════════════════════════════════════════
describe('mascot — every state is felt, not only seen', () => {
  it('gives every state a distinct touch signature except deliberate silence', () => {
    const touches = Object.values(MASCOT_PROFILES)
      .map((p) => JSON.stringify(p.touch))
      .filter((t) => t !== 'null');
    expect(new Set(touches).size).toBe(touches.length);
  });

  it('is silent only when asleep', () => {
    for (const [state, profile] of Object.entries(MASCOT_PROFILES)) {
      if (state === 'asleep') expect(profile.touch).toBeNull();
      else expect(profile.touch).not.toBeNull();
    }
  });

  // The hazard signature must be unlike every other state so it reads through
  // a coat with the phone in a back pocket.
  it('makes the hazard buzz unlike any other state', () => {
    const alert = MASCOT_PROFILES.alert.touch!;
    for (const [state, profile] of Object.entries(MASCOT_PROFILES)) {
      if (state === 'alert') continue;
      expect(JSON.stringify(profile.touch)).not.toBe(JSON.stringify(alert));
    }
  });

  it('gives every state a spoken label for screen readers', () => {
    for (const profile of Object.values(MASCOT_PROFILES)) expect(profile.label.length).toBeGreaterThan(0);
  });

  it('says nothing when the state has not changed', () => {
    const t = mascotTransition('awake', 'awake');
    expect(t.announce).toBe('');
    expect(t.touch).toBeNull();
  });

  it('announces starting and stopping watch', () => {
    expect(mascotTransition('asleep', 'awake').announce).toContain('watching');
    expect(mascotTransition('awake', 'asleep').announce).toContain('off');
  });

  it('feels but does not narrate the transient working states', () => {
    expect(mascotTransition('awake', 'looking').announce).toBe('');
    expect(mascotTransition('looking', 'guiding').announce).toBe('');
  });

  it('does NOT re-announce the mode when the mascot drifts back to awake', () => {
    // The regression: the mascot oscillates awake -> guiding -> awake as it
    // speaks. Without the announcedMode guard, every return to awake repeated
    // "I am watching the path ahead for you" — a nag the cadence rules exist
    // to prevent, spoken to someone who cannot see that nothing changed.
    const awayAndBack = mascotTransition('guiding', 'awake', { announcedMode: 'awake' });
    expect(awayAndBack.announce).toBe('');

    // The first entry into the mode still speaks, and so does leaving it.
    expect(mascotTransition('asleep', 'awake', { announcedMode: 'asleep' }).announce).toContain('watching');
    expect(mascotTransition('guiding', 'asleep', { announcedMode: 'awake' }).announce).toContain('off');
  });

  it('still interrupts on a hazard even when the mode has not changed', () => {
    const t = mascotTransition('guiding', 'alert', { announcedMode: 'awake' });
    expect(t.announce).not.toBe('');
    expect(t.interrupts).toBe(true);
    expect(t.priority).toBe(1);
  });

  it('classifies every mascot state into a mode', () => {
    expect(modeOf('asleep')).toBe('asleep');
    for (const s of ['awake', 'listening', 'looking', 'guiding', 'alert', 'unavailable'] as const) {
      expect(modeOf(s)).toBe('awake');
    }
  });

  it('breaks silence for a hazard at the top priority', () => {
    const t = mascotTransition('guiding', 'alert');
    expect(t.priority).toBe(1);
    expect(t.interrupts).toBe(true);
  });

  // The honesty channel: a missing capability must interrupt, because staying
  // quiet about it leaves the user believing a feature is working.
  it('interrupts to disclose a missing capability', () => {
    const t = mascotTransition('awake', 'unavailable');
    expect(t.interrupts).toBe(true);
    expect(t.announce).not.toBe('');
  });

  it('still discloses a missing capability during quiet hours', () => {
    expect(mascotTransition('awake', 'unavailable', { quietHours: true }).announce).not.toBe('');
  });

  it('keeps quiet hours quiet for ordinary transitions', () => {
    expect(mascotTransition('asleep', 'awake', { quietHours: true }).announce).toBe('');
  });
});

describe('capabilitySpeech — describes this device, not a hoped-for one', () => {
  it('lists what is missing as plainly as what works', () => {
    const s = capabilitySpeech({ camera: true, compass: false, motion: true, haptics: false, network: true });
    expect(s).toContain('cannot name a direction');
    expect(s).toContain('cannot tap your phone');
    expect(s).toContain('can see the path ahead');
  });

  it('says only good news on a fully capable device', () => {
    const s = capabilitySpeech({ camera: true, compass: true, motion: true, haptics: true, network: true });
    expect(s).not.toContain('cannot');
  });
});

// ═══════════════════════════════════════════════════════════════
// voice routing — reachability without touching the screen
// ═══════════════════════════════════════════════════════════════
describe('watch voice commands', () => {
  const match = (s: string) => matchDeterministicCommand(s)?.intent ?? null;

  it('routes the natural phrasings for starting Watch', () => {
    for (const phrase of ['start watch', 'start watching', 'watch for me', 'keep watch', 'turn on watching']) {
      expect(match(phrase)).toBe('start_watch');
    }
  });

  it('routes the natural phrasings for stopping Watch', () => {
    for (const phrase of ['stop watch', 'stop watching', 'turn off watch', 'pause watch']) {
      expect(match(phrase)).toBe('stop_watch');
    }
  });

  // "stop watching" contains "watching", so an on-phrase that matched
  // "watching" would turn Watch ON when the user asked to turn it OFF.
  it('never starts Watch when the user asked to stop it', () => {
    expect(match('stop watching')).not.toBe('start_watch');
  });

  // ORDERING REGRESSION. The pre-existing "which way is" rule maps to
  // start_navigation with a distance query, which answers with a walking
  // distance the app cannot compute. Sitting after it, "which way am I
  // facing" would have been answered with a fabricated distance.
  it('answers which-way-am-I-facing as orientation, not as a distance', () => {
    for (const phrase of ['which way am i facing', 'what direction am i facing', 'am i facing north']) {
      expect(match(phrase)).toBe('where_am_i_facing');
    }
  });

  it('routes Watch status and capability questions', () => {
    expect(match('watch status')).toBe('watch_status');
    expect(match('is watch on')).toBe('watch_status');
    expect(match('what can watch do')).toBe('watch_capabilities');
  });

  it('does not hijack existing safety commands', () => {
    expect(match('emergency')).toBe('emergency');
    expect(match('what is ahead')).toBe('describe_scene');
    expect(match('what is around me')).toBe('describe_surroundings');
    expect(match('help')).toBe('help');
  });

  it('advertises Watch in the help message', () => {
    expect(HELP_MESSAGE).toContain('start watch');
  });
});
