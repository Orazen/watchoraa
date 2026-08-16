import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';

export const assistanceRouter = Router();
assistanceRouter.use(requireAuth);

const createSchema = z.object({
  message: z.string().min(1).max(2000),
  contactId: z.string().optional(),
  locationShare: z.boolean().default(false),
});

assistanceRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const requests = await prisma.assistanceRequest.findMany({
      where: { userId: request.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    response.json({ requests });
  }),
);

assistanceRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const assistanceRequest = await prisma.assistanceRequest.create({
      data: { ...parsed.data, userId: request.userId!, status: 'SENT', sentAt: new Date() },
    });
    await recordAudit({
      actorId: request.userId,
      action: 'assistance.request_created',
      entityType: 'AssistanceRequest',
      entityId: assistanceRequest.id,
      metadata: { contactId: assistanceRequest.contactId ?? null, locationShare: assistanceRequest.locationShare },
    });
    response.status(201).json({ request: assistanceRequest });
  }),
);

assistanceRouter.patch(
  '/:id/resolve',
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const existing = await prisma.assistanceRequest.findUnique({ where: { id } });
    if (!existing || existing.userId !== request.userId) {
      response.status(404).json({ error: 'Request not found' });
      return;
    }

    const updated = await prisma.assistanceRequest.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await recordAudit({
      actorId: request.userId,
      action: 'assistance.request_resolved',
      entityType: 'AssistanceRequest',
      entityId: id,
    });
    response.json({ request: updated });
  }),
);
