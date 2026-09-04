// Depth safety hook (Eyeris-inspired): consumes zonal closeness from
// depth.worker.ts and raises SPOKEN+haptic alerts for close surfaces that
// YOLO cannot classify — walls, poles, overhangs, furniture edges.
//
// Honesty rules (fail-silent philosophy): relative depth has no meters, so
// alerts say "very close" or "close" per side, re-assert at most every 15s
// per side, and only fire when the closeness exceeds a high threshold for
// 2 consecutive frames (K-confirmation, mirrors deviation logic).

import { useCallback, useEffect, useRef, useState } from 'react';
import { fireHapticEvent, type HapticSettings } from './haptics';

export type DepthZone = 'left' | 'center' | 'right';

export interface DepthAlert {
  zone: DepthZone | 'ground';
  /** 'very-close' (≥0.92) or 'close' (≥0.8). */
  level: 'very-close' | 'close';
}

const CLOSE_THRESHOLD = 0.8;
const VERY_CLOSE_THRESHOLD = 0.92;
const K_CONFIRM_FRAMES = 2;
const REASSERT_MS = 15_000;

export function useDepthSafety(
  active: boolean,
  onAlert: (alert: DepthAlert) => void,
  hapticSettings: HapticSettings,
) {
  const [status, setStatus] = useState<'idle' | 'warming-up' | 'running' | 'error'>('idle');
  const workerRef = useRef<Worker | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRef = useRef(false);
  const requestIdRef = useRef(0);
  const strikeRef = useRef<Record<string, number>>({});
  const lastAlertAtRef = useRef<Record<string, number>>({});
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;
  const hapticsRef = useRef(hapticSettings);
  hapticsRef.current = hapticSettings;

  useEffect(() => {
    if (!active) {
      setStatus('idle');
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      setStatus('error');
      return;
    }
    workerRef.current = worker;
    setStatus('warming-up');

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        setStatus('running');
        return;
      }
      if (msg.type === 'depth') {
        pendingRef.current = false;
        evaluate(msg.frame);
      }
      if (msg.type === 'error') {
        pendingRef.current = false;
        setStatus('error');
      }
    };

    worker.onerror = () => setStatus('error');
    worker.postMessage({ type: 'warmup' });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      worker.terminate();
      workerRef.current = null;
      strikeRef.current = {};
      lastAlertAtRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** Captures the current video frame and posts it to the worker. Returns
   *  false when the worker is busy, warming up, or the video has no pixels.
   *  App calls this on its own cadence (every ~4s) while the camera runs. */
  const submitFrame = useCallback(
    (video: HTMLVideoElement | null): boolean => {
      if (!workerRef.current || pendingRef.current || status === 'warming-up' || status === 'error') return false;
      if (!video || video.videoWidth === 0) return false;
      void createImageBitmap(video)
        .then((bitmap) => {
          pendingRef.current = true;
          requestIdRef.current += 1;
          workerRef.current?.postMessage({ type: 'frame', bitmap, requestId: requestIdRef.current });
        })
        .catch(() => {
          // Frame capture raced a resize/close: skip this tick.
        });
      return true;
    },
    [status],
  );

  function evaluate(frame: { closeness: Record<DepthZone, number>; closenessGround: number }) {
    const now = Date.now();
    const candidates: DepthAlert[] = [];
    (Object.keys(frame.closeness) as DepthZone[]).forEach((zone) => {
      const v = frame.closeness[zone];
      if (v >= VERY_CLOSE_THRESHOLD) candidates.push({ zone, level: 'very-close' });
      else if (v >= CLOSE_THRESHOLD) candidates.push({ zone, level: 'close' });
    });
    if (frame.closenessGround >= VERY_CLOSE_THRESHOLD) candidates.push({ zone: 'ground', level: 'very-close' });

    // K-confirmation + per-key cooldown.
    const nextStrikes: Record<string, number> = {};
    for (const c of candidates) {
      const key = `${c.zone}:${c.level}`;
      nextStrikes[key] = (strikeRef.current[key] ?? 0) + 1;
      if (nextStrikes[key] < K_CONFIRM_FRAMES) continue;
      const last = lastAlertAtRef.current[key] ?? 0;
      if (now - last < REASSERT_MS) continue;
      lastAlertAtRef.current[key] = now;
      fireHapticEvent(c.level === 'very-close' ? 'hazard-immediate' : 'hazard-nearby', hapticsRef.current);
      onAlertRef.current(c);
    }
    strikeRef.current = nextStrikes;
  }

  return { status, submitFrame };
}

export function depthAlertSpeech(alert: DepthAlert): string {
  const zoneText =
    alert.zone === 'left' ? 'on your left' : alert.zone === 'right' ? 'on your right' : alert.zone === 'ground' ? 'at ground level ahead' : 'directly ahead';
  return alert.level === 'very-close'
    ? `Something is very close ${zoneText}. Stop and check with your cane.`
    : `Something is close ${zoneText}.`;
}
