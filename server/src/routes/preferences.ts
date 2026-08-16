import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const preferencesRouter = Router();
preferencesRouter.use(requireAuth);

const DEFAULT_PREFS = {
  speechRate: 1,
  voiceName: null,
  instructionDetail: 2,
  vibrationEnabled: true,
  audioEnabled: true,
  reducedMotion: false,
  textScale: 1,
  lowConnectivityMode: true,
  imageRetentionHours: 0,
};

const updateSchema = z
  .object({
    speechRate: z.number().min(0.5).max(2).optional(),
    voiceName: z.string().max(200).nullable().optional(),
    instructionDetail: z.number().int().min(0).max(5).optional(),
    vibrationEnabled: z.boolean().optional(),
    audioEnabled: z.boolean().optional(),
    reducedMotion: z.boolean().optional(),
    textScale: z.number().min(0.8).max(2).optional(),
    lowConnectivityMode: z.boolean().optional(),
    imageRetentionHours: z.number().int().min(0).max(24 * 7).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one preference is required' });

function serialize(prefs: {
  id: string;
  speechRate: number;
  voiceName: string | null;
  instructionDetail: number;
  vibrationEnabled: boolean;
  audioEnabled: boolean;
  reducedMotion: boolean;
  textScale: number;
  lowConnectivityMode: boolean;
  imageRetentionHours: number;
}) {
  return {
    id: prefs.id,
    speechRate: prefs.speechRate,
    voiceName: prefs.voiceName,
    instructionDetail: prefs.instructionDetail,
    vibrationEnabled: prefs.vibrationEnabled,
    audioEnabled: prefs.audioEnabled,
    reducedMotion: prefs.reducedMotion,
    textScale: prefs.textScale,
    lowConnectivityMode: prefs.lowConnectivityMode,
    imageRetentionHours: prefs.imageRetentionHours,
  };
}

preferencesRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const existing = await prisma.accessibilityPrefs.findUnique({ where: { userId: request.userId! } });
    if (existing) {
      response.json({ preferences: serialize(existing) });
      return;
    }
    const created = await prisma.accessibilityPrefs.create({ data: { userId: request.userId!, ...DEFAULT_PREFS } });
    response.json({ preferences: serialize(created) });
  }),
);

preferencesRouter.put(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const updated = await prisma.accessibilityPrefs.upsert({
      where: { userId: request.userId! },
      create: { userId: request.userId!, ...DEFAULT_PREFS, ...parsed.data },
      update: parsed.data,
    });
    response.json({ preferences: serialize(updated) });
  }),
);
