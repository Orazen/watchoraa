// Orientation sensing for Watch mode — the sensing channel that turns a phone
// into something that can actually *watch* for you.
//
// Why this exists. SightlineAI (github.com/rudra496/sightlineai) is the closest
// open analogue: ESP32 smart glasses, a camera on the user's face, guidance
// delivered by voice. We cannot ship glasses from a browser, but a phone has
// the same two channels that matter — a camera (already wired to the local YOLO
// worker) and a body compass. `deviceorientation` gives us the second one for
// free, and nobody in the Watchora codebase was reading it.
//
// What the user gains that a camera alone cannot provide:
//   - *Turn* awareness. "You have turned about ninety degrees to your left" is
//     computable from rotation alone and is one of the most disorienting
//     moments for a blind pedestrian. It needs NO compass to be correct.
//   - *Look-down* awareness. beta past ~45° means the phone is angled at the
//     ground, which is exactly where kerbs, steps, a dog lead and obstacles at
//     foot level live. A forward-facing camera misses all of them.
//   - *Cardinal* awareness, when — and only when — the device reports a real
//     magnetometer heading.
//
// HONESTY RULES (the most important part of this file, learned from
// sightlineai's prompt.py: "NEVER fabricate or guess details about the scene.
// If information is ambiguous, say so explicitly"):
//   1. `alpha` is NOT a compass heading. It is the device's rotation relative
//      to the screen. Only `webkitCompassHeading` (or `alpha` with
//      `absolute === true`, i.e. magnetometer-corrected) may be named as a
//      cardinal direction. Everything else is reported as a relative turn.
//   2. Handheld phone compasses are genuinely bad. Readings jump by tens of
//      degrees near cars, buildings and steel. Heading is therefore only
//      reported once a run of samples agrees within HEADING_TOLERANCE_DEG —
//      otherwise we say the direction is uncertain instead of guessing.
//   3. Every function here is pure over its inputs so all of the above is
//      unit-testable without a phone.

/** A single orientation sample, normalised across browser quirks. */
export interface HeadingReading {
  /** Degrees clockwise from the frame's reference. Only compass-meaningful when `absolute`. */
  headingDeg: number;
  /** Front-to-back tilt. +90 = device flat face-up, -90 = face-down, 0 = upright. */
  pitchDeg: number;
  /** Left-to-right tilt. */
  rollDeg: number;
  /**
   * True only when the heading came from a real compass (webkitCompassHeading,
   * or alpha with absolute === true). False means "we can measure turning, but
   * not which way is north" and callers MUST NOT name a cardinal direction.
   */
  absolute: boolean;
}

const COMPASS_TOLERANCE_DEG = 8;
/** Samples required before a heading is trusted at all. */
const COMPASS_MIN_SAMPLES = 4;
/** Window a sample is kept in. Old magnetometer readings are worse than none. */
const COMPASS_WINDOW_MS = 4000;

/** Pitch past which the phone is aimed at the ground rather than ahead. */
export const LOOK_DOWN_PITCH_DEG = 45;

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Shortest signed rotation from a to b, in (-180, 180]. Positive = clockwise. */
export function angleDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

/**
 * Normalises a DeviceOrientationEvent into a HeadingReading.
 *
 * Prefers the absolute compass heading when the browser provides one. Falls
 * back to `alpha` as a RELATIVE frame only — and marks it non-absolute, which
 * is what stops the rest of the app from confidently telling a blind user they
 * are facing north when the device has no magnetometer at all.
 *
 * Returns null when the event carries no usable rotation, which happens on
 * desktop browsers and on any device that has declined the permission.
 */
export function readOrientation(event: {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute: boolean;
  webkitCompassHeading?: number | null;
}): HeadingReading | null {
  const compass = finiteOrNull(event.webkitCompassHeading ?? null);
  if (compass != null && compass >= 0 && compass < 360) {
    return {
      headingDeg: compass,
      pitchDeg: finiteOrNull(event.beta) ?? 0,
      rollDeg: finiteOrNull(event.gamma) ?? 0,
      absolute: true,
    };
  }

  const alpha = finiteOrNull(event.alpha);
  if (alpha == null) return null;

  // `alpha` is device-top-up rotation about the screen axis; 0 means the top of
  // the phone points to the top of the world, so a clockwise turn DECREASES
  // alpha. Inverting gives a heading in the same clockwise-from-reference
  // convention as the compass path, so downstream code has one convention.
  return {
    headingDeg: wrap360(360 - alpha),
    pitchDeg: finiteOrNull(event.beta) ?? 0,
    rollDeg: finiteOrNull(event.gamma) ?? 0,
    // `absolute === true` means the browser magnetometer-corrected the reading.
    // It is the only case where a non-webkit reading can be called a direction.
    absolute: event.absolute === true,
  };
}

interface Sample {
  headingDeg: number;
  at: number;
}

/**
 * Rolling window of recent samples that decides whether the compass is steady
 * enough to name a direction. A phone walking past a bus stop produces
 * readings that jump 40° in a second; averaging alone would produce a confident
 * wrong answer, so we require the whole window to agree before trusting it.
 */
export class CompassStabiliser {
  private samples: Sample[] = [];

  constructor(
    private readonly toleranceDeg: number = COMPASS_TOLERANCE_DEG,
    private readonly minSamples: number = COMPASS_MIN_SAMPLES,
    private readonly windowMs: number = COMPASS_WINDOW_MS,
  ) {}

  push(reading: HeadingReading, now: number): void {
    this.samples.push({ headingDeg: reading.headingDeg, at: now });
    this.samples = this.samples.filter((s) => now - s.at <= this.windowMs);
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  /**
   * True when enough recent samples exist and they all agree. Note this only
   * makes sense for absolute readings — a non-compass `alpha` is stable but
   * meaningless as a direction, which is why callers gate on `absolute` first.
   */
  isStable(): boolean {
    if (this.samples.length < this.minSamples) return false;
    const angles = this.samples.map((s) => s.headingDeg);
    return Math.max(...angles) - Math.min(...angles) <= this.toleranceDeg;
  }

  /** Circular mean of the window. Returns null when the window is empty. */
  meanHeading(): number | null {
    if (this.samples.length === 0) return null;
    // Averaging 350° and 10° with a plain sum gives 180° — the exact opposite
    // direction. Sin/cos averaging is the only correct way to average angles.
    const sin = this.samples.reduce((acc, s) => acc + Math.sin((s.headingDeg * Math.PI) / 180), 0);
    const cos = this.samples.reduce((acc, s) => acc + Math.cos((s.headingDeg * Math.PI) / 180), 0);
    if (Math.abs(sin) < 1e-9 && Math.abs(cos) < 1e-9) return null;
    return wrap360((Math.atan2(sin, cos) * 180) / Math.PI);
  }

  reset(): void {
    this.samples = [];
  }
}

const COMPASS_POINTS: ReadonlyArray<{ max: number; name: string }> = [
  { max: 22.5, name: 'north' },
  { max: 67.5, name: 'north-east' },
  { max: 112.5, name: 'east' },
  { max: 157.5, name: 'south-east' },
  { max: 202.5, name: 'south' },
  { max: 247.5, name: 'south-west' },
  { max: 292.5, name: 'west' },
  { max: 337.5, name: 'north-west' },
  { max: 360.1, name: 'north' },
];

export function compassPointName(headingDeg: number): string {
  const h = wrap360(headingDeg);
  return COMPASS_POINTS.find((p) => h < p.max)?.name ?? 'north';
}

/** Rounds to the nearest 10° and names the cardinal direction, hedging. */
export function describeHeading(headingDeg: number): string {
  const rounded = Math.round(headingDeg / 10) * 10 % 360;
  return `roughly ${compassPointName(rounded)}`;
}

/**
 * Spoken orientation status. Deliberately returns a *sentence the user can act
 * on* rather than raw numbers — a blind user has no use for "heading 214".
 * When there is no compass, it says so instead of inventing a direction.
 */
export function orientationSpeech(
  reading: HeadingReading | null,
  stable: boolean,
  lookedDown: boolean,
): string {
  if (!reading) {
    return 'I cannot read the direction this device is facing. Turn guidance still works, so I can tell you when you turn.';
  }

  const parts: string[] = [];
  if (reading.absolute && stable) {
    parts.push(`You are facing ${describeHeading(reading.headingDeg)}.`);
  } else if (reading.absolute) {
    parts.push('The compass is unsettled here, so I cannot give you a reliable direction yet.');
  } else {
    parts.push('This device is not giving me a compass, so I cannot name a direction.');
  }

  if (lookedDown) {
    parts.push('Your phone is angled down at the ground — watch for kerbs, steps and obstacles at your feet.');
  } else if (Math.abs(reading.pitchDeg) < 15) {
    parts.push('Your phone is held level, looking ahead.');
  }

  return parts.join(' ');
}

/**
 * Announce a turn. Turning is the one orientation fact that is correct even
 * without a compass, so this is the highest-value thing the Watch can say
 * while a user walks. Rounds to the nearest 15° because users cannot act on
 * "37 degrees" and the reading itself is not that precise.
 */
export function describeTurn(fromDeg: number, toDeg: number): string {
  const delta = angleDelta(fromDeg, toDeg);
  const magnitude = Math.abs(delta);
  if (magnitude < 20) return '';
  const rounded = Math.round(magnitude / 15) * 15;
  if (rounded === 0) return '';
  const side = delta > 0 ? 'right' : 'left';
  return `You have turned about ${rounded} degrees to your ${side}.`;
}

/** True when the phone is aimed at the ground rather than ahead. */
export function isLookingDown(reading: HeadingReading | null): boolean {
  return reading != null && reading.pitchDeg > LOOK_DOWN_PITCH_DEG;
}
