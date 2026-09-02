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
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
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

    const { lat, lng, ...rest } = parsed.data;
    const incident = await prisma.incidentReport.create({
      data: {
        ...rest,
        lat: lat != null && lng != null ? lat : null,
        lng: lat != null && lng != null ? lng : null,
        reporterId: request.userId!,
      },
    });
    response.status(201).json({
      incident: { ...incident, lat: undefined, lng: undefined },
    });
  }),
);

// Spoken "what's reported near me?" for blind users: returns the closest
// fresh reports with distance (meters, haversine) and age (days) computed
// server-side. Raw coordinates are NEVER serialized in the response — a
// small user base would let a heat circle deanonymize a reporter. Radius
// is capped and result count is capped so the spoken answer stays short.
incidentsRouter.get(
  '/near',
  asyncHandler(async (request, response) => {
    const lat = Number(request.query.lat);
    const lng = Number(request.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      response.status(400).json({ error: 'lat and lng query parameters are required' });
      return;
    }
    const radius = Math.min(Math.max(Number(request.query.radius) || 500, 100), 2000);

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const rows = await prisma.incidentReport.findMany({
      where: {
        status: { not: 'REMOVED' },
        createdAt: { gte: since },
        lat: { not: null },
        lng: { not: null },
      },
      select: { id: true, category: true, description: true, severity: true, lat: true, lng: true, createdAt: true },
      take: 400,
      orderBy: { createdAt: 'desc' },
    });

    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const distance = (aLat: number, aLng: number) =>
      Math.round(
        2 * R * Math.asin(Math.min(1, Math.sqrt(
          Math.sin(toRad(aLat - lat) / 2) ** 2 +
          Math.cos(toRad(lat)) * Math.cos(toRad(aLat)) * Math.sin(toRad(aLng - lng) / 2) ** 2,
        ))),
      );

    const near = rows
      .map((row) => {
        const d = distance(row.lat as number, row.lng as number);
        const ageDays = Math.max(0, Math.floor((Date.now() - row.createdAt.getTime()) / 86_400_000));
        return {
          id: row.id,
          category: row.category,
          description: row.description.slice(0, 200),
          severity: row.severity,
          distanceMeters: d,
          ageDays,
        };
      })
      .filter((r) => r.distanceMeters <= radius)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 3);

    response.json({ reports: near, radiusMeters: radius });
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
