import { useCallback, useEffect, useRef, useState } from 'react';
import type { Detection } from './yolo.worker';
import { HAZARD_CLASSES, LANDMARK_CLASSES } from './coco-classes';
import { fireHapticEvent, type HapticSettings } from './haptics';
import { DetectionTracker } from './detectionTracker';

// How often we sample a frame for local detection. Not every frame — battery/thermal
// budget matters (see docs/yolo-ocr-slam-plan.md "Explicit Non-Goals / Risks").
const DETECTION_INTERVAL_MS = 600;
// A box covering more than this fraction of the frame area is treated as "immediate" —
// i.e. close enough that it's the dominant thing in view, not just visible somewhere.
const IMMEDIATE_AREA_THRESHOLD = 0.12;
// Minimum per-frame confidence to consider for haptic classification. The worker
// already floors raw detections at 0.30 (recall-first); this haptic layer still
// wants the higher-precision band, and the tracker requires 3 consecutive hits
// on top — so flicker can't buzz the user's wrist.
const MIN_ACT_CONFIDENCE = 0.5;

export type HazardState = {
  detections: Detection[];
  topHazard: Detection | null;
  status: 'idle' | 'warming-up' | 'running' | 'degraded' | 'error';
  fps: number;
  lastInferenceMs: number | null;
  errorMessage: string | null;
};

type WorkerResponse =
  | { type: 'detections'; requestId: number; detections: Detection[]; inferenceMs: number }
  | { type: 'error'; requestId: number | null; message: string }
  | { type: 'ready' };

function classifyEvent(detections: Detection[]): { event: Parameters<typeof fireHapticEvent>[0]; top: Detection | null } {
  const actionable = detections.filter((d) => d.confidence >= MIN_ACT_CONFIDENCE);
  if (actionable.length === 0) return { event: 'clear', top: null };

  const hazards = actionable.filter((d) => HAZARD_CLASSES.has(d.className));
  if (hazards.length > 0) {
    const dominant = hazards.reduce((best, d) => (d.box.width * d.box.height > best.box.width * best.box.height ? d : best));
    const area = dominant.box.width * dominant.box.height;
    return { event: area >= IMMEDIATE_AREA_THRESHOLD ? 'hazard-immediate' : 'hazard-nearby', top: dominant };
  }

  const landmarks = actionable.filter((d) => LANDMARK_CLASSES.has(d.className));
  if (landmarks.length > 0) return { event: 'landmark', top: landmarks[0] };

  return { event: 'clear', top: null };
}

export function useHazardDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
  hapticSettings: HapticSettings,
  onConfirmedDetections?: (detections: Detection[]) => void,
) {
  const [state, setState] = useState<HazardState>({
    detections: [],
    topHazard: null,
    status: 'idle',
    fps: 0,
    lastInferenceMs: null,
    errorMessage: null,
  });

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pendingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventRef = useRef<Parameters<typeof fireHapticEvent>[0] | null>(null);
  const frameTimestampsRef = useRef<number[]>([]);
  const hapticSettingsRef = useRef(hapticSettings);
  hapticSettingsRef.current = hapticSettings;
  const trackerRef = useRef<DetectionTracker | null>(null);
  const onConfirmedRef = useRef(onConfirmedDetections);
  onConfirmedRef.current = onConfirmedDetections;

  const tick = useCallback(() => {
    const video = videoRef.current;
    const worker = workerRef.current;
    if (!video || !worker || pendingRef.current || video.readyState < 2 || !video.videoWidth) return;

    pendingRef.current = true;
    const requestId = ++requestIdRef.current;

    createImageBitmap(video)
      .then((bitmap) => {
        worker.postMessage({ type: 'detect', requestId, bitmap }, [bitmap]);
      })
      .catch(() => {
        pendingRef.current = false;
      });
  }, [videoRef]);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      trackerRef.current = null;
      setState((s) => ({ ...s, status: 'idle', detections: [], topHazard: null }));
      return;
    }

    setState((s) => ({ ...s, status: 'warming-up', errorMessage: null }));
    trackerRef.current = new DetectionTracker();

    const worker = new Worker(new URL('./yolo.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;

      if (message.type === 'ready') {
        setState((s) => ({ ...s, status: 'running' }));
        intervalRef.current = setInterval(tick, DETECTION_INTERVAL_MS);
        return;
      }

      if (message.type === 'error') {
        pendingRef.current = false;
        // Stop the frame pump: the worker's model/session is broken, so
        // posting more frames would only pile up errors (and leaked bitmaps).
        // Surface the failure; the user can reload to re-initialize.
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setState((s) => ({ ...s, status: 'error', errorMessage: message.message }));
        return;
      }

      pendingRef.current = false;
      const now = performance.now();
      frameTimestampsRef.current.push(now);
      frameTimestampsRef.current = frameTimestampsRef.current.filter((t) => now - t < 3000);
      const fps = frameTimestampsRef.current.length / 3;

      // Temporal smoothing: detections must persist 3 consecutive frames
      // (~1.8s at our 600ms cadence) before the app treats them as real.
      const tracker = trackerRef.current;
      const smoothed = tracker ? tracker.update(message.detections, Date.now()) : message.detections;

      const { event: hazardEvent, top } = classifyEvent(smoothed);

      // Fail-silent-on-uncertainty: only fire a haptic/tone event when the classified
      // event actually changed, so we don't buzz continuously while a hazard stays
      // in view — one clear signal per state transition, not a nag.
      if (hazardEvent !== lastEventRef.current) {
        fireHapticEvent(hazardEvent, hapticSettingsRef.current);
        lastEventRef.current = hazardEvent;
      }

      // Environment layer callback: only when something new crossed the
      // confirmation gate (or a cooled-down track re-fired), so consumers can
      // refresh their spoken summary without being spammed every cycle. The
      // full confirmed set is passed (not just the newly-confirmed subset) so
      // the consumer can summarize the whole scene in one utterance.
      if (onConfirmedRef.current && smoothed.some((d) => d.isNewlyConfirmed)) {
        onConfirmedRef.current(smoothed);
      }

      setState({
        detections: smoothed,
        topHazard: top,
        status: message.inferenceMs > 900 ? 'degraded' : 'running',
        fps: Math.round(fps * 10) / 10,
        lastInferenceMs: Math.round(message.inferenceMs),
        errorMessage: null,
      });
    };

    worker.postMessage({ type: 'warmup' });

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      worker.terminate();
      workerRef.current = null;
      lastEventRef.current = null;
      frameTimestampsRef.current = [];
      trackerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tick]);

  return state;
}
