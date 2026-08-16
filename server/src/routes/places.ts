import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const placesRouter = Router();
placesRouter.use(requireAuth);

const createSchema = z.object({
  label: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
  address: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

placesRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const places = await prisma.savedPlace.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
    });
    response.json({ places });
  }),
);

placesRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const place = await prisma.savedPlace.create({
      data: { ...parsed.data, userId: request.userId! },
    });
    response.status(201).json({ place });
  }),
);

placesRouter.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const existing = await prisma.savedPlace.findUnique({ where: { id } });
    if (!existing || existing.userId !== request.userId) {
      response.status(404).json({ error: 'Place not found' });
      return;
    }

    await prisma.savedPlace.delete({ where: { id } });
    response.status(204).send();
  }),
);
