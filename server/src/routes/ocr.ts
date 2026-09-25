// Server-side AI-powered OCR ("read the text"): a blind user points the camera
// at a sign, label, letter or screen and this route extracts ALL visible text
// from the frame through the same AI provider chain as routes/ai.ts (user BYO
// key first, then the server-wide AI_* key). The extracted text comes back for
// the client to speak. When no real AI provider is configured the route
// answers 503 — honesty over fake demo text a blind user would trust.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../env.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { AiProviderError, buildProvider, resolveAiConfig, serverAiFallbackFromEnv, type ServerAiFallback } from '../services/ai/ai-provider.js';
import type { VisionMessage } from '../services/ai/types.js';

const isTestRun = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

// Camera frames only: ai.ts allows 6MB for full scene analysis, but a text
// read needs far less detail — 4MB decoded keeps the base64 body comfortably
// inside the 10mb JSON body limit on slow mobile uplinks.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB decoded
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

// Extraction contract: the model answers with the visible text itself, plain.
// When the frame contains no readable text it replies with exactly this
// marker, which the route maps to text: "" — so the client's no-text check is
// a plain empty string, never a model-authored phrase.
const NO_TEXT_MARKER = '[NO_TEXT_FOUND]';

const OCR_SYSTEM_PROMPT = `You are the text reader for Watchora, an assistive app for blind and low-vision people. Extract ALL visible text from the image exactly as written, preserving the original reading order from top to bottom. Keep the reply plain: no commentary, no markdown, no descriptions of pictures, logos or other non-text content. Separate distinct blocks of text with line breaks. If there is no readable text at all, reply with exactly ${NO_TEXT_MARKER} and nothing else.`;

/** One message for the OCR call: role plus plain-text content. */
export type OcrMessage = VisionMessage;

export interface OcrResult {
  text: string;
  /** Which config tier answered — mirrors config.source in routes/ai.ts. Demo never reaches here (gated to 503). */
  source: 'user' | 'server';
}

/**
 * Reads text out of one decoded camera frame. Receives the full OCR message
 * list (system prompt first) plus the decoded frame; returns the extracted
 * text and the config tier that served the request.
 */
export type OcrProvider = (
  userId: string,
  messages: OcrMessage[],
  image: { base64: string; mimeType: string },
  signal: AbortSignal,
) => Promise<OcrResult>;

// Server-wide AI fallback (same shape as routes/ai.ts): AI_API_KEY for any
// provider first, legacy GEMINI_API_KEY second — used whenever the requesting
// user has no key of their own.
const serverFallback: ServerAiFallback = serverAiFallbackFromEnv(env);

/** Per-user provider resolution, mirroring routes/ai.ts (pref → server fallback → demo). */
async function resolveConfigForUser(userId: string) {
  try {
    const pref = await prisma.aiProviderPref.findUnique({ where: { userId } });
    return resolveAiConfig(pref, serverFallback);
  } catch {
    return serverFallback ? { source: 'server' as const, ...serverFallback } : { source: 'demo' as const };
  }
}

/** Production OCR call: same provider chain as ai.ts, plain-text vision completion. */
export const aiOcrProvider: OcrProvider = async (userId, messages, image, signal) => {
  const config = await resolveConfigForUser(userId);
  if (config.source === 'demo') {
    // Defensive: the route gates demo mode to a 503 before ever calling.
    throw new AiProviderError('AI text reading is not configured', 'unsupported');
  }
  const provider = buildProvider(config);
  const text = await provider.completeVision(messages, image, signal);
  return { text, source: config.source };
};

function decodeImage(imageDataUrl: string): { base64: string; mimeType: string } {
  const match = DATA_URL_PATTERN.exec(imageDataUrl);
  if (!match) {
    throw new AiProviderError('Image must be a base64 data URL with mime type image/jpeg, image/png or image/webp', 'unsupported');
  }

  const [, mimeType, base64] = match;
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw new AiProviderError('Unsupported image type', 'unsupported');
  }

  const decodedBytes = Math.floor((base64.length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) {
    throw new AiProviderError('Image is too large. Maximum decoded size is 4MB.', 'unsupported');
  }

  return { base64, mimeType };
}

/** Maps the no-text sentinel (with or around whitespace) to the empty string. */
function normalizeExtraction(raw: string): string {
  const text = raw.trim();
  return text === NO_TEXT_MARKER ? '' : text;
}

const ocrSchema = z.object({
  imageDataUrl: z.string().min(1).max(9_000_000), // raw body cap mirrors ai.ts; decoded size is checked in decodeImage
  language: z.string().max(12).optional(), // BCP-47 hint; validity checked below, malformed values are ignored
});

export interface OcrRouterOptions {
  /** Vision call; defaults to the ai.ts provider chain. Tests inject a fake for hermeticity. */
  provider?: OcrProvider;
  /** True when the resolved provider is the demo one; tests inject a constant. */
  isDemo?: (userId: string) => boolean | Promise<boolean>;
}

export function makeOcrRouter(options: OcrRouterOptions = {}): Router {
  const readText = options.provider ?? aiOcrProvider;
  const isDemo =
    options.isDemo ?? (async (userId: string) => (await resolveConfigForUser(userId)).source === 'demo');

  const router = Router();
  const ocrLimiter = rateLimit({
    windowMs: 60_000,
    max: isTestRun ? 10_000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    // Per-user bucket: requireAuth has already run when the limiter fires.
    keyGenerator: (request) => request.userId ?? request.ip ?? 'unknown',
    message: { error: 'Too many text reading requests. Please wait a moment and try again.' },
  });

  router.post(
    '/read',
    requireAuth,
    ocrLimiter,
    asyncHandler(async (request, response) => {
      const parsed = ocrSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
        return;
      }

      let image: { base64: string; mimeType: string };
      try {
        image = decodeImage(parsed.data.imageDataUrl);
      } catch (error) {
        if (error instanceof AiProviderError) {
          response.status(400).json({ error: error.message });
          return;
        }
        throw error;
      }

      if (await isDemo(request.userId!)) {
        response
          .status(503)
          .json({ error: 'AI text reading needs an AI key. Ask your caregiver to configure one in Settings.' });
        return;
      }

      // The language hint is folded into the user message so every provider
      // speaks the same wire format; malformed values were already dropped.
      const language = parsed.data.language;
      const validLanguage = language && /^[a-zA-Z]{2}(-[a-zA-Z]{2,4})?$/.test(language) ? language : undefined;
      const messages: OcrMessage[] = [
        { role: 'system', text: OCR_SYSTEM_PROMPT },
        {
          role: 'user',
          text: validLanguage ? `Extract the visible text. The text is likely in "${validLanguage}".` : 'Extract the visible text.',
        },
      ];

      const controller = new AbortController();
      const onClientDisconnect = () => controller.abort();
      request.on('close', onClientDisconnect);

      try {
        // 200 { text, source }: `text` is the extracted visible text (plain,
        // reading order preserved); `text: ""` means the frame held no
        // readable text (the [NO_TEXT_FOUND] sentinel is mapped to "" here).
        // `source` mirrors config.source in routes/ai.ts.
        const result = await readText(request.userId!, messages, image, controller.signal);
        response.json({ text: normalizeExtraction(result.text), source: result.source });
      } catch (error) {
        // The provider boundary is fully server-controlled: anything it throws
        // is an upstream failure and must surface as one generic 502 — never a
        // 500 with internals a blind user would hear read aloud.
        request.log?.warn?.({ err: error instanceof Error ? error.message : String(error) }, 'OCR provider failed');
        response
          .status(502)
          .json({ error: 'Text reading is not available right now. Please try again or use the offline scanner.' });
      } finally {
        request.off('close', onClientDisconnect);
      }
    }),
  );

  return router;
}

export const ocrRouter = makeOcrRouter();
