import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';

export const incidentsRouter = Router();
incidentsRouter.use(requireAuth);

const createSchema = z.object({
  category: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
});

incidentsRouter.get(
  '/',
  asyncHandler(async (_request, response) => {
    // Moderated feed: REMOVED reports are hidden from the public community list.
    // Reporters are NOT identified: a blind user's name must not be attached
    // to every location-ish hazard report visible to all signed-in users.
    const incidents = await prisma.incidentReport.findMany({
      where: { status: { not: 'REMOVED' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    response.json({ incidents });
  }),
);

incidentsRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const incident = await prisma.incidentReport.create({
      data: { ...parsed.data, reporterId: request.userId! },
    });
    response.status(201).json({ incident });
  }),
);

// A reporter may delete their own report (removes it from the community feed).
incidentsRouter.delete(
  '/:id',
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const existing = await prisma.incidentReport.findUnique({ where: { id } });
    if (!existing || existing.reporterId !== request.userId) {
      response.status(404).json({ error: 'Report not found' });
      return;
    }
    await prisma.incidentReport.update({ where: { id }, data: { status: 'REMOVED' } });
    await recordAudit({
      actorId: request.userId,
      action: 'incident.self_removed',
      entityType: 'IncidentReport',
      entityId: id,
    });
    response.status(204).send();
  }),
);
