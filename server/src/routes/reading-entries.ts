import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const readingEntriesRouter = Router();
readingEntriesRouter.use(requireAuth);

const createSchema = z.object({
  source: z.string().min(1).max(200),
  extractedText: z.string().min(1).max(20_000),
  language: z.string().max(50).optional(),
});

readingEntriesRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const entries = await prisma.readingEntry.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    response.json({ entries });
  }),
);

readingEntriesRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const entry = await prisma.readingEntry.create({
      data: { ...parsed.data, userId: request.userId! },
    });
    response.status(201).json({ entry });
  }),
);

readingEntriesRouter.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const existing = await prisma.readingEntry.findUnique({ where: { id } });
    if (!existing || existing.userId !== request.userId) {
      response.status(404).json({ error: 'Reading entry not found' });
      return;
    }
    await prisma.readingEntry.delete({ where: { id } });
    response.status(204).send();
  }),
);
