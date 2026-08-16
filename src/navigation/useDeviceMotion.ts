// useDeviceMotion (v0.6): opt-in accelerometer-derived motion level for the
// navigation coach's adaptive frame rate. Only activates after the user has
// granted the 'motion' permission (via PermissionOnboarding/PermissionCenter)
// — never requests permission itself, and defaults to 'stationary' (safest,
// lowest-cadence) whenever motion data is unavailable or denied. This keeps
// the "no false always-on claims" rule: the coach openly falls back to a
// slower, still-correct cadence rather than pretending to sense motion it
// cannot see.

import { useEffect, useRef, useState } from 'react';
import { accelDelta, motionFromAccelDelta, type MotionLevel } from './adaptiveFrameRate';

export function useDeviceMotion(enabled: boolean): MotionLevel {
  const [motion, setMotion] = useState<MotionLevel>('stationary');
  const prevRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      setMotion('stationary');
      return;
    }

    function handleMotion(event: DeviceMotionEvent) {
      const acc = event.accelerationIncludingGravity ?? event.acceleration;
      if (!acc || acc.x == null || acc.y == null || acc.z == null) return;
      const now = Date.now();
      // Sample at ~5Hz — plenty for a coarse motion classification, avoids
      // pinning the main thread on every DeviceMotion tick (often 60Hz).
      if (now - lastUpdateRef.current < 200) return;
      lastUpdateRef.current = now;
      const prev = prevRef.current;
      if (prev) {
        const delta = accelDelta(acc.x, acc.y, acc.z, prev.x, prev.y, prev.z);
        setMotion(motionFromAccelDelta(delta));
      }
      prevRef.current = { x: acc.x, y: acc.y, z: acc.z };
    }

    window.addEventListener('devicemotion', handleMotion);
    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      prevRef.current = null;
      setMotion('stationary');
    };
  }, [enabled]);

  return motion;
}
