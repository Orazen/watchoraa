import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { synthesize } from '../services/tts/edge-tts.js';
import { getAllVoices, localeFromVoice } from '../services/tts/voices.js';

export const ttsRouter = Router();
ttsRouter.use(requireAuth);

const ttsRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many speech requests. Please wait a moment.' },
});

const MAX_TEXT = 5000;

const audioSchema = z.object({
  text: z.string().min(1).max(MAX_TEXT),
  voice: z.string().min(3).max(120).default('en-US-JennyNeural'),
  rate: z.coerce.number().min(0.5).max(2).default(1),
});

ttsRouter.get(
  '/voices',
  asyncHandler(async (_request, response) => {
    const voices = await getAllVoices();
    response.json({ voices, count: voices.length });
  }),
);

// Streams an MP3 of the spoken text. Falls back to a clear error so the
// frontend can switch to the browser's built-in speech synthesis.
ttsRouter.get(
  '/audio',
  ttsRateLimiter,
  asyncHandler(async (request, response) => {
    const parsed = audioSchema.safeParse({ ...request.query, rate: request.query.rate ? Number(request.query.rate) : 1 });
    if (!parsed.success) {
      response.status(400).json({ error: 'text (max 5000 chars) and a valid voice are required' });
      return;
    }
    const { text, voice, rate } = parsed.data;

    try {
      const audio = await synthesize(text, { voice, rate });
      if (audio.length === 0) throw new Error('empty audio');
      recordAudit({
        actorId: request.userId,
        action: 'tts.synthesized',
        entityType: 'Tts',
        metadata: { voice, locale: localeFromVoice(voice), chars: text.length },
      });
      response.setHeader('Content-Type', 'audio/mpeg');
      response.setHeader('Content-Length', String(audio.length));
      response.setHeader('Cache-Control', 'no-store');
      response.end(audio);
    } catch (error) {
      // Network-dependent free service: fail clearly so the client falls back.
      response.status(502).json({ error: 'Speech service unavailable right now. Using the on-device voice instead.' });
    }
  }),
);
