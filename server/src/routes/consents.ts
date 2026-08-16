import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const consentsRouter = Router();
consentsRouter.use(requireAuth);

const grantSchema = z.object({
  scope: z.enum(['LOCATION_SHARING', 'TRUSTED_CONTACTS', 'EMERGENCY_ALERTS', 'ACTIVITY_HISTORY', 'READING_HISTORY']),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

consentsRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const grants = await prisma.consentGrant.findMany({
      where: { userId: request.userId, revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
    response.json({ consents: grants });
  }),
);

consentsRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = grantSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const grant = await prisma.consentGrant.create({
      data: { ...parsed.data, metadata: parsed.data.metadata as Prisma.InputJsonValue | undefined, userId: request.userId! },
    });
    response.status(201).json({ consent: grant });
  }),
);

consentsRouter.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const existing = await prisma.consentGrant.findUnique({ where: { id } });
    if (!existing || existing.userId !== request.userId) {
      response.status(404).json({ error: 'Consent grant not found' });
      return;
    }
    // Revoke (soft) so there's a record of the grant history.
    const revoked = await prisma.consentGrant.update({ where: { id }, data: { revokedAt: new Date() } });
    response.json({ consent: revoked });
  }),
);
