// Adaptive frame-rate control (v0.5). Token/battery budget: when the user is
// stationary we sample the camera rarely; while walking or running we sample
// faster so the navigation coach stays responsive. Mirrors the approach used
// by real-time vision companions, implemented deterministically on-device.

export type MotionLevel = 'stationary' | 'walking' | 'running';

export type CoachMode = 'navigation' | 'reading' | 'exploration' | 'shopping' | 'off';

/** Map motion level to a target detection FPS for navigation coaching. */
export function fpsForMotion(motion: MotionLevel): number {
  if (motion === 'running') return 2.5;
  if (motion === 'walking') return 1.5;
  return 0.5;
}

/** Interval in ms for the target FPS (clamped so we never spin at 0). */
export function intervalMsForFps(fps: number): number {
  const safe = Math.max(0.1, Math.min(10, fps));
  return Math.round(1000 / safe);
}

/**
 * Classify motion from accelerometer magnitude deltas (m/s^2 style units).
 * `delta` is the magnitude of the acceleration change since the last sample.
 * Thresholds are deliberately coarse — coaching is a guidance layer, not a
 * pedometer.
 */
export function motionFromAccelDelta(delta: number): MotionLevel {
  if (delta > 2.5) return 'running';
  if (delta > 0.8) return 'walking';
  return 'stationary';
}

/** Simple magnitude of a 3-axis delta vector. */
export function accelDelta(ax: number, ay: number, az: number, px: number, py: number, pz: number): number {
  const dx = ax - px;
  const dy = ay - py;
  const dz = az - pz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
