// Server-side speech-to-text fallback for the voice dictation path. Some
// embedded browsers expose SpeechRecognition but its cloud backend is
// unreachable; the client then records with MediaRecorder and POSTs the raw
// audio here, where it is forwarded to an OpenAI-compatible transcription
// endpoint (Groq Whisper by default). Optional feature: when STT_API_KEY is
// unset the route answers 503 and the client keeps its typed-input path.
import { Router, raw as rawBodyParser } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../env.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { safeFetch } from '../lib/safe-url.js';

const isTestRun = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

// Voice commands are short; 15MB covers ~30s of high-bitrate audio with
// headroom. Under ~500 bytes is silence or a dropped recorder buffer.
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MIN_AUDIO_BYTES = 512;

const ALLOWED_AUDIO_MIME = new Set([
  'audio/webm',
  'video/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/flac',
  'audio/opus',
]);

const EXTENSION_FOR_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/opus': 'opus',
};

const DEFAULT_STT_BASE_URL = 'https://api.groq.com/openai/v1';
const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo';

export interface SttResult {
  transcript: string;
  language?: string;
}

export type SttProvider = (audio: Buffer, mimeType: string, language?: string) => Promise<SttResult>;

/** Provider-side failure with a meaningful HTTP status; details never reach clients. */
export class SttProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SttProviderError';
  }
}

/** Resolves the configured provider base URL to its /audio/transcriptions endpoint. */
function transcriptionEndpoint(): URL {
  const url = new URL(env.STT_BASE_URL || DEFAULT_STT_BASE_URL);
  url.pathname = [url.pathname.replace(/\/+$/, ''), 'audio', 'transcriptions'].join('/');
  return url;
}

/** Forwards the raw recording to an OpenAI-compatible transcription endpoint. */
export const openaiCompatibleTranscriber: SttProvider = async (audio, mimeType, language) => {
  if (!env.STT_API_KEY) throw new SttProviderError(503, 'STT is not configured');
  const form = new FormData();
  const ext = EXTENSION_FOR_MIME[mimeType] ?? 'webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `recording.${ext}`);
  form.append('model', env.STT_MODEL || DEFAULT_STT_MODEL);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (language) form.append('language', language);

  let res: Response;
  try {
    res = await safeFetch(transcriptionEndpoint().toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STT_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'TimeoutError' || (error as { code?: string }).code === 'ABORT_ERR') {
      throw new SttProviderError(504, 'STT provider timed out');
    }
    throw new SttProviderError(502, 'STT provider unreachable');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new SttProviderError(502, `STT provider responded ${res.status}: ${detail.slice(0, 200)}`);
  }

  const body = (await res.json().catch(() => null)) as { text?: string } | null;
  return { transcript: (body?.text ?? '').trim() };
};

export interface SttRouterOptions {
  provider?: SttProvider;
  isConfigured?: () => boolean;
}

export function makeSttRouter(options: SttRouterOptions = {}): Router {
  const provider = options.provider ?? openaiCompatibleTranscriber;
  const isConfigured = options.isConfigured ?? (() => Boolean(env.STT_API_KEY));

  const router = Router();
  const sttLimiter = rateLimit({
    windowMs: 60_000,
    max: isTestRun ? 10_000 : 12,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many voice requests. Please wait a moment and try again.' },
  });

  router.post(
    '/transcribe',
    requireAuth,
    sttLimiter,
    // Binary body upload: no multer dependency. express.json above only parses
    // application/json, so audio bodies arrive here untouched.
    rawBodyParser({ type: ['audio/*', 'video/webm'], limit: MAX_AUDIO_BYTES }),
    asyncHandler(async (request, response) => {
      if (!isConfigured()) {
        response.status(503).json({ error: 'Voice transcription is not configured on this server.' });
        return;
      }
      const mimeType = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_AUDIO_MIME.has(mimeType)) {
        response.status(415).json({ error: 'Unsupported audio format. Use webm, mp4, ogg, mp3, wav, aac or flac.' });
        return;
      }
      const audio = request.body;
      if (!Buffer.isBuffer(audio) || audio.length < MIN_AUDIO_BYTES) {
        response.status(400).json({ error: 'Recording is empty or too short.' });
        return;
      }
      const languageParam = typeof request.query.language === 'string' ? request.query.language : '';
      const language = /^[a-zA-Z]{2}(-[a-zA-Z]{2,4})?$/.test(languageParam) ? languageParam : undefined;

      try {
        const result = await provider(audio, mimeType, language);
        response.json({ transcript: result.transcript, language: result.language });
      } catch (error) {
        // The provider boundary is fully server-controlled: anything it throws
        // is an upstream failure and must surface as one generic 502 — never a
        // 500 with internals a blind user would hear read aloud.
        request.log?.warn?.({ err: error instanceof Error ? error.message : String(error) }, 'STT provider failed');
        response
          .status(error instanceof SttProviderError && error.status >= 500 ? error.status : 502)
          .json({ error: 'Voice transcription is not available right now. Please try again or type your command.' });
      }
    }),
  );

  return router;
}

export const sttRouter = makeSttRouter();
