// Phase B (hybrid OCR): local Tesseract.js first pass for fast/offline text reading,
// with confidence-gated fallback to the existing Gemini reading-mode path for
// complex or low-confidence cases. See docs/yolo-ocr-slam-plan.md #2.2.
//
// Tesseract.js manages its own internal Web Worker (via `workerPath`), so this
// module is a thin, self-hosted-asset wrapper rather than a second custom worker.
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js';

export type OcrResult = {
  text: string;
  confidence: number; // Tesseract's mean confidence, 0-100
};

// Below this confidence, the extracted text is unreliable enough that callers
// should treat it as "no usable local reading" and fall back to Gemini rather
// than reading garbled text aloud with false authority.
export const OCR_FALLBACK_CONFIDENCE_THRESHOLD = 55;

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/tesseract-core-simd-lstm.wasm.js',
      langPath: '/tesseract/',
      gzip: true,
      cacheMethod: 'none',
      logger: () => {},
    });
  }
  return workerPromise;
}

export async function warmUpOcr(): Promise<void> {
  await getWorker();
}

export async function recognizeText(imageDataUrl: string): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageDataUrl);
  return { text: data.text.trim(), confidence: data.confidence };
}
