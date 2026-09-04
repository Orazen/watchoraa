// Depth safety worker (Eyeris-inspired): runs Depth Anything V2 Small
// (quantized ONNX) via onnxruntime-web and reduces the per-pixel depth map
// to ZONAL PROXIMITY — how close the nearest thing is on the left / center /
// right, and in the ground-level band. Depth sees what COCO YOLO cannot:
// walls, poles, overhangs, furniture edges, parked cars of any class.
//
// Honesty: Depth Anything outputs RELATIVE depth (higher = closer), not
// meters. Alerts say "close" / "very close", never a distance in meters.

import * as ort from 'onnxruntime-web';
import { zonalCloseness, type DepthZone } from './depthZones';

const MODEL_URL = '/models/depth-anything-v2-small-q.onnx';
const INPUT_SIZE = 518; // Depth Anything V2 input resolution
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export interface DepthFrame {
  /** Normalized closeness 0..1 (1 = nearest surface) per zone. */
  closeness: Record<DepthZone, number>;
  /** Closeness in the lower-center band (ground-level obstacles). */
  closenessGround: number;
  inferenceMs: number;
}

export type WorkerRequest = { type: 'warmup' } | { type: 'frame'; bitmap: ImageBitmap; requestId: number };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'depth'; requestId: number; frame: DepthFrame }
  | { type: 'error'; requestId: number | null; message: string };

let session: ort.InferenceSession | null = null;
let loading: Promise<ort.InferenceSession> | null = null;
let inputNames: readonly string[] = ['pixel_values'];

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (!loading) {
    loading = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }).then((s) => {
      if (s.inputNames.length > 0) inputNames = s.inputNames;
      return s;
    });
  }
  session = await loading;
  return session;
}

/** Preprocess: center-crop to 518², ImageNet normalize, NCHW float32. */
function bitmapToTensor(bitmap: ImageBitmap): ort.Tensor {
  const size = INPUT_SIZE;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  // Cover-crop the shorter side (Depth Anything expects square input).
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  const data = ctx.getImageData(0, 0, size, size).data;

  const float = new Float32Array(1 * 3 * size * size);
  const area = size * size;
  for (let i = 0; i < area; i++) {
    float[i] = (data[i * 4] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    float[area + i] = (data[i * 4 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    float[area * 2 + i] = (data[i * 4 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return new ort.Tensor('float32', float, [1, 3, size, size]);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'warmup') {
      await getSession();
      self.postMessage({ type: 'ready' } as WorkerResponse);
      return;
    }
    if (message.type === 'frame') {
      const start = performance.now();
      let frame: DepthFrame;
      try {
        const input = bitmapToTensor(message.bitmap);
        const outputs = await (await getSession()).run({ [inputNames[0]]: input });
        // Output: [1, H, W] relative depth (higher = closer). Normalize 0..1.
        const out = outputs[Object.keys(outputs)[0]];
        const dims = out.dims as number[];
        const data = out.data as Float32Array;
        const mapH = dims[dims.length - 2];
        const mapW = dims[dims.length - 1];
        let min = Infinity;
        let max = -Infinity;
        for (let i = 0; i < data.length; i++) {
          if (data[i] < min) min = data[i];
          if (data[i] > max) max = data[i];
        }
        const range = max - min || 1;
        const normalized = new Float32Array(mapH * mapW);
        // Higher raw value = closer in Depth Anything output, so closeness
        // keeps the same orientation: close surfaces score near 1.
        for (let i = 0; i < data.length; i++) {
          normalized[i] = (data[i] - min) / range;
        }
        frame = { ...zonalCloseness(normalized, mapW, mapH), inferenceMs: Math.round(performance.now() - start) };
      } finally {
        message.bitmap.close();
      }
      self.postMessage({ type: 'depth', requestId: message.requestId, frame } as WorkerResponse);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.type === 'frame' ? message.requestId : null,
      message: error instanceof Error ? error.message : 'Unknown depth worker error',
    } as WorkerResponse);
  }
};
