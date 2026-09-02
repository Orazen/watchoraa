// Emergency (v0.3): deterministic SOS with a rich payload (coordinates,
// accuracy, battery, heading, maps link), live-location session, trusted-
// contact acknowledgement, and a 5-second cancellation window. No AI in the
// emergency path — every step is deterministic and audited.

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { notifyTrustedContacts } from '../lib/alerts.js';
import { prisma } from '../lib/prisma.js';

export const emergencyRouter = Router();
emergencyRouter.use(requireAuth);

const EMERGENCY_SESSION_TTL_MS = 4 * 60 * 60 * 1000; // active emergency session for 4h

const triggerSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).max(5000).optional(),
  battery: z.number().min(0).max(100).optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(50).optional(),
  journeyId: z.string().optional(),
  emergencyType: z.string().max(50).optional(),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(5000).optional(),
  battery: z.number().min(0).max(100).optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(50).optional(),
});

function mapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

const CANCEL_WINDOW_SECONDS = 10;

/** Lazily expires sessions whose TTL has passed so /active and /inbox never surface stale emergencies. */
async function expireStaleSessions(): Promise<void> {
  await prisma.emergencySession.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
    data: { status: 'EXPIRED' },
  });
}

function serialize(s: any) {
  return {
    id: s.id,
    status: s.status,
    triggeredAt: s.triggeredAt,
    cancelledAt: s.cancelledAt ?? null,
    resolvedAt: s.resolvedAt ?? null,
    expiresAt: s.expiresAt ?? null,
    lat: s.lat ?? null,
    lng: s.lng ?? null,
    accuracy: s.accuracy ?? null,
    battery: s.battery ?? null,
    heading: s.heading ?? null,
    speed: s.speed ?? null,
    mapsUrl: s.mapsUrl ?? null,
    journeyId: s.journeyId ?? null,
    acknowledgements: (s.acknowledgements ?? []).map((a: any) => ({
      id: a.id,
      acknowledgedAt: a.acknowledgedAt,
      note: a.note ?? null,
    })),
  };
}

// ── Trigger SOS ──
emergencyRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = triggerSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const { lat, lng, accuracy, battery, heading, speed, journeyId, emergencyType } = parsed.data;

    const session = await prisma.emergencySession.create({
      data: {
        userId: request.userId!,
        status: 'ACTIVE',
        lat: lat ?? null,
        lng: lng ?? null,
        accuracy: accuracy ?? null,
        battery: battery ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        mapsUrl: lat != null && lng != null ? mapsUrl(lat, lng) : null,
        journeyId: journeyId ?? null,
        expiresAt: new Date(Date.now() + EMERGENCY_SESSION_TTL_MS),
      },
      include: { acknowledgements: true },
    });

    await recordAudit({
      actorId: request.userId,
      action: 'emergency.triggered',
      entityType: 'EmergencySession',
      entityId: session.id,
      metadata: { emergencyType: emergencyType ?? null, hasLocation: lat != null, journeyId: journeyId ?? null },
    });

    // Fire-and-forget: alert trusted contacts over email. Never blocks the
    // 201 response; delivery outcome is recorded in the audit log.
    void notifyTrustedContacts(request.userId!, 'SOS', { journeyId, sessionId: session.id });

    response.status(201).json({ session: serialize(session), cancelWindowSeconds: CANCEL_WINDOW_SECONDS });
  }),
);

// ── Cancel within the countdown window (prevents accidental triggers) ──
emergencyRouter.post(
  '/:id/cancel',
  asyncHandler(async (request, response) => {
    const session = await prisma.emergencySession.findUnique({ where: { id: String(request.params.id) } });
    if (!session || session.userId !== request.userId) {
      response.status(404).json({ error: 'Emergency session not found' });
      return;
    }
    if (session.status !== 'ACTIVE') {
      response.status(409).json({ error: 'Session is no longer active' });
      return;
    }
    // Cancellation allowed within the advertised cancel window.
    if (Date.now() - session.triggeredAt.getTime() > CANCEL_WINDOW_SECONDS * 1000) {
      response.status(409).json({ error: 'Cancellation window has closed' });
      return;
    }
    const cancelled = await prisma.emergencySession.update({
      where: { id: session.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { acknowledgements: true },
    });
    await recordAudit({ actorId: request.userId, action: 'emergency.cancelled', entityType: 'EmergencySession', entityId: session.id });
    response.json({ session: serialize(cancelled) });
  }),
);

// ── Update live location during the session ──
emergencyRouter.post(
  '/:id/location',
  asyncHandler(async (request, response) => {
    const parsed = locationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid location', details: parsed.error.flatten() });
      return;
    }
    const session = await prisma.emergencySession.findUnique({ where: { id: String(request.params.id) } });
    if (!session || session.userId !== request.userId) {
      response.status(404).json({ error: 'Emergency session not found' });
      return;
    }
    if (session.status !== 'ACTIVE') {
      response.status(409).json({ error: 'Session is not active' });
      return;
    }
    const { lat, lng, accuracy, battery, heading, speed } = parsed.data;
    const updated = await prisma.emergencySession.update({
      where: { id: session.id },
      data: {
        lat, lng, accuracy, battery, heading, speed,
        mapsUrl: mapsUrl(lat, lng),
      },
      include: { acknowledgements: true },
    });
    response.json({ session: serialize(updated) });
  }),
);

// ── Active emergency session for the user ──
emergencyRouter.get(
  '/active',
  asyncHandler(async (request, response) => {
    await expireStaleSessions();
    const session = await prisma.emergencySession.findFirst({
      where: { userId: request.userId, status: 'ACTIVE' },
      include: { acknowledgements: true },
      orderBy: { triggeredAt: 'desc' },
    });
    response.json({ session: session ? serialize(session) : null });
  }),
);

// ── Resolve (user is safe) ──
emergencyRouter.post(
  '/:id/resolve',
  asyncHandler(async (request, response) => {
    const session = await prisma.emergencySession.findUnique({ where: { id: String(request.params.id) } });
    if (!session || session.userId !== request.userId) {
      response.status(404).json({ error: 'Emergency session not found' });
      return;
    }
    const resolved = await prisma.emergencySession.update({
      where: { id: session.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
      include: { acknowledgements: true },
    });
    await recordAudit({ actorId: request.userId, action: 'emergency.resolved', entityType: 'EmergencySession', entityId: session.id });
    response.json({ session: serialize(resolved) });
  }),
);

// ── A trusted contact acknowledges the alert ──
emergencyRouter.post(
  '/:id/acknowledge',
  asyncHandler(async (request, response) => {
    const session = await prisma.emergencySession.findUnique({ where: { id: String(request.params.id) } });
    if (!session || session.status !== 'ACTIVE') {
      response.status(404).json({ error: 'Active emergency session not found' });
      return;
    }
    // Only someone the user listed as a trusted contact (or an admin) may
    // acknowledge — otherwise any authenticated user could forge the "someone
    // saw your SOS" signal a blind user relies on.
    const me = await prisma.user.findUnique({ where: { id: request.userId }, select: { email: true, role: true } });
    if (!me) {
      response.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (me.role !== 'ADMIN') {
      const isTrusted = await prisma.trustedContact.findFirst({
        where: { userId: session.userId, email: { equals: me.email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!isTrusted) {
        response.status(403).json({ error: 'Only a trusted contact of this person can acknowledge their alert' });
        return;
      }
    }
    const ack = await prisma.emergencyAcknowledgement.create({
      data: { sessionId: session.id, contactUserId: request.userId },
    });
    await recordAudit({
      actorId: request.userId,
      action: 'emergency.acknowledged',
      entityType: 'EmergencySession',
      entityId: session.id,
    });
    response.status(201).json({ acknowledgement: ack });
  }),
);

// ── Caregiver: view the active emergency sessions for people who trust them ──
emergencyRouter.get(
  '/inbox',
  asyncHandler(async (request, response) => {
    const me = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!me || (me.role !== 'CAREGIVER' && me.role !== 'ADMIN')) {
      response.status(403).json({ error: 'Caregiver access required' });
      return;
    }
    const contacts = await prisma.trustedContact.findMany({ where: { email: { equals: me.email, mode: 'insensitive' } }, select: { userId: true } });
    const userIds = [...new Set(contacts.map((c) => c.userId))];
    await expireStaleSessions();
    const sessions = userIds.length
      ? await prisma.emergencySession.findMany({
          where: { userId: { in: userIds }, status: 'ACTIVE' },
          include: { acknowledgements: true, user: { select: { fullName: true, email: true } } },
          orderBy: { triggeredAt: 'desc' },
        })
      : [];
    response.json({ sessions: sessions.map((s) => ({ ...serialize(s), user: s.user })) });
  }),
);
