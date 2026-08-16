// useNavigationCoach (v0.5): a thin React hook that runs the deterministic
// navigation coach against the live hazard detections at an adaptive cadence,
// and reports announcements for the app to speak + haptic + pan. All decision
// logic lives in the pure navigationCoach engine; this hook only owns timing.

import { useEffect, useRef } from 'react';
import {
  coachStep,
  createCoachState,
  type CoachAnnouncement,
  type CoachFrameInput,
  type CoachState,
  type CoachDetection,
} from './navigationCoach';
import { fpsForMotion, intervalMsForFps, type MotionLevel } from './adaptiveFrameRate';

export type { CoachMode } from './navigationCoach';
export type { CoachAnnouncement };

export interface NavigationCoachInput {
  active: boolean;
  detections: CoachDetection[];
  /** Motion override from accelerometer/step detection; 'stationary' if absent. */
  motion?: MotionLevel;
  onAnnounce: (a: CoachAnnouncement) => void;
}

/**
 * Runs the coach while `active` is true. Detections are sampled at the
 * cadence implied by the current motion level (0.5 FPS stationary, 1.5
 * walking, 2.5 running), matching the adaptive-frame-rate design.
 */
export function useNavigationCoach(input: NavigationCoachInput): void {
  const { active, detections, motion = 'stationary', onAnnounce } = input;
  const stateRef = useRef<CoachState | null>(null);
  const cbRef = useRef(onAnnounce);
  cbRef.current = onAnnounce;

  // Re-arm the state machine when coaching is (re)activated.
  useEffect(() => {
    if (active && !stateRef.current) {
      stateRef.current = createCoachState(Date.now());
    } else if (!active) {
      stateRef.current = null;
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const cadenceMs = intervalMsForFps(fpsForMotion(motion));
    const timer = setInterval(() => {
      const state = stateRef.current;
      if (!state) return;
      const frame: CoachFrameInput = {
        detections,
        moving: motion !== 'stationary',
        now: Date.now(),
      };
      for (const a of coachStep(state, frame)) cbRef.current(a);
    }, cadenceMs);
    return () => clearInterval(timer);
  }, [active, detections, motion]);
}
