import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const journeysRouter = Router();
journeysRouter.use(requireAuth);

const createSchema = z.object({
  destination: z.string().min(1).max(200),
  mode: z.enum(['NAVIGATION', 'ASSISTANT', 'READING', 'ENVIRONMENT', 'EMERGENCY']),
});

journeysRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const journeys = await prisma.journey.findMany({
      where: { userId: request.userId },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    response.json({ journeys });
  }),
);

journeysRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const journey = await prisma.journey.create({
      data: { ...parsed.data, userId: request.userId! },
    });
    response.status(201).json({ journey });
  }),
);
