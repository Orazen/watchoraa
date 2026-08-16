/// <reference lib="webworker" />
// Web Worker: runs YOLOv8n ONNX inference on camera frames off the main thread.
// Model: public/models/yolov8n.onnx (stock Ultralytics COCO checkpoint, 80 classes).
// Runtime: onnxruntime-web, WASM execution provider (WebGPU EP is not yet reliable
// across Safari/Firefox; WASM+SIMD gives predictable behavior everywhere — see
// docs/yolo-ocr-slam-plan.md #2.1 for the tradeoff discussion).
import * as ort from 'onnxruntime-web';
import { COCO_CLASSES } from './coco-classes';

ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1; // single-thread WASM avoids cross-origin-isolation requirements

const MODEL_URL = '/models/yolov8n.onnx';
const INPUT_SIZE = 640;
const SCORE_THRESHOLD = 0.45;
const IOU_THRESHOLD = 0.45;

export type Detection = {
  className: string;
  confidence: number;
  // Normalized [0,1] box in the *original* frame's coordinate space.
  box: { x: number; y: number; width: number; height: number };
  // Rough clock-position bearing (1-12) based on horizontal box center, for the
  // haptic/audio layer — "chair at 2 o'clock" style guidance.
  bearingClock: number;
};

let session: ort.InferenceSession | null = null;
let loading: Promise<ort.InferenceSession> | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (session) return session;
  if (!loading) {
    loading = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
  }
  session = await loading;
  return session;
}

function letterbox(bitmap: ImageBitmap, size: number) {
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const newWidth = Math.round(bitmap.width * scale);
  const newHeight = Math.round(bitmap.height * scale);
  const padX = Math.floor((size - newWidth) / 2);
  const padY = Math.floor((size - newHeight) / 2);

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(114,114,114)'; // standard YOLO letterbox pad color
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, padX, padY, newWidth, newHeight);

  const imageData = ctx.getImageData(0, 0, size, size);
  return { imageData, scale, padX, padY };
}

function imageDataToCHWTensor(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const chw = new Float32Array(3 * width * height);
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    const offset = i * 4;
    chw[i] = data[offset] / 255; // R
    chw[plane + i] = data[offset + 1] / 255; // G
    chw[2 * plane + i] = data[offset + 2] / 255; // B
  }
  return chw;
}

function iou(a: Detection['box'], b: Detection['box']): number {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const interX1 = Math.max(a.x, b.x);
  const interY1 = Math.max(a.y, b.y);
  const interX2 = Math.min(ax2, bx2);
  const interY2 = Math.min(ay2, by2);
  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;
  const unionArea = a.width * a.height + b.width * b.height - interArea;
  return unionArea <= 0 ? 0 : interArea / unionArea;
}

function nonMaxSuppression(detections: Detection[]): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const kept: Detection[] = [];
  for (const candidate of sorted) {
    const overlapsKept = kept.some((k) => k.className === candidate.className && iou(k.box, candidate.box) > IOU_THRESHOLD);
    if (!overlapsKept) kept.push(candidate);
  }
  return kept;
}

function bearingClockFromCenterX(centerXNormalized: number): number {
  // 0.0 = far left = 9 o'clock, 0.5 = straight ahead = 12, 1.0 = far right = 3 o'clock.
  const clamped = Math.min(1, Math.max(0, centerXNormalized));
  const clock = 9 + clamped * 6; // maps [0,1] -> [9,15]
  const wrapped = clock > 12 ? clock - 12 : clock;
  return Math.round(wrapped) || 12;
}

async function runInference(bitmap: ImageBitmap): Promise<Detection[]> {
  const activeSession = await getSession();
  const { imageData, scale, padX, padY } = letterbox(bitmap, INPUT_SIZE);
  const inputTensorData = imageDataToCHWTensor(imageData);
  const inputTensor = new ort.Tensor('float32', inputTensorData, [1, 3, INPUT_SIZE, INPUT_SIZE]);

  const inputName = activeSession.inputNames[0];
  const feeds: Record<string, ort.Tensor> = { [inputName]: inputTensor };
  const outputMap = await activeSession.run(feeds);
  const outputName = activeSession.outputNames[0];
  const output = outputMap[outputName];

  // YOLOv8/11 export shape: [1, 84, 8400] — 4 box coords + 80 class scores, per anchor.
  const dims = output.dims;
  const numAttrs = dims[1]; // 84
  const numAnchors = dims[2]; // 8400
  const numClasses = numAttrs - 4;
  const data = output.data as Float32Array;

  const detections: Detection[] = [];
  for (let anchor = 0; anchor < numAnchors; anchor++) {
    let bestClass = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numAnchors + anchor];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestScore < SCORE_THRESHOLD || bestClass < 0) continue;

    const cx = data[0 * numAnchors + anchor];
    const cy = data[1 * numAnchors + anchor];
    const w = data[2 * numAnchors + anchor];
    const h = data[3 * numAnchors + anchor];

    // Undo letterbox -> normalized [0,1] coords in the original frame.
    const boxCenterX = (cx - padX) / scale;
    const boxCenterY = (cy - padY) / scale;
    const boxWidth = w / scale;
    const boxHeight = h / scale;

    const x = (boxCenterX - boxWidth / 2) / bitmap.width;
    const y = (boxCenterY - boxHeight / 2) / bitmap.height;
    const width = boxWidth / bitmap.width;
    const height = boxHeight / bitmap.height;

    const className = COCO_CLASSES[bestClass] ?? `class_${bestClass}`;
    detections.push({
      className,
      confidence: bestScore,
      box: { x, y, width, height },
      bearingClock: bearingClockFromCenterX(x + width / 2),
    });
  }

  return nonMaxSuppression(detections);
}

type WorkerRequest =
  | { type: 'detect'; requestId: number; bitmap: ImageBitmap }
  | { type: 'warmup' };

type WorkerResponse =
  | { type: 'detections'; requestId: number; detections: Detection[]; inferenceMs: number }
  | { type: 'error'; requestId: number | null; message: string }
  | { type: 'ready' };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === 'warmup') {
      await getSession();
      (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage({ type: 'ready' });
      return;
    }

    if (message.type === 'detect') {
      const start = performance.now();
      const detections = await runInference(message.bitmap);
      message.bitmap.close();
      const inferenceMs = performance.now() - start;
      (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage({
        type: 'detections',
        requestId: message.requestId,
        detections,
        inferenceMs,
      });
    }
  } catch (error) {
    const requestId = message.type === 'detect' ? message.requestId : null;
    (self as unknown as { postMessage: (m: WorkerResponse) => void }).postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : 'Unknown YOLO worker error',
    });
  }
};
