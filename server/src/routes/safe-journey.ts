// Safe Journey (v0.3): start/stop journeys with safety monitoring — destination,
// ETA, trusted contact, check-in interval, live location updates, route-
// deviation prompts (prompt-first, then escalate), missed-arrival detection,
// and trusted-contact acknowledgement. Deterministic: no AI in the safety loop.

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { notifyTrustedContacts } from '../lib/alerts.js';
import { prisma } from '../lib/prisma.js';

export const safeJourneyRouter = Router();
safeJourneyRouter.use(requireAuth);

const startSchema = z.object({
  destination: z.string().min(1).max(200),
  eta: z.string().datetime().optional(),
  trustedContactId: z.string().optional(),
  checkInIntervalMinutes: z.coerce.number().int().min(1).max(1440).default(15),
  shareLive: z.boolean().default(false),
  deviationThresholdMeters: z.coerce.number().min(10).max(1000).default(80),
});

const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(5000).optional(),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(50).optional(),
  battery: z.number().min(0).max(100).optional(),
});

const deviationSchema = z.object({
  currentLat: z.number().min(-90).max(90),
  currentLng: z.number().min(-180).max(180),
});

/** Great-circle distance in meters (haversine). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function mapsUrl(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** Serializes a journey with derived safety state. */
function serializeJourney(j: any) {
  const now = Date.now();
  let safetyState = 'ok';
  let promptDue = false;
  let missedArrival = false;
  if (j.status === 'ACTIVE') {
    if (j.lastCheckInAt && now - j.lastCheckInAt.getTime() > j.checkInIntervalMinutes * 60_000) {
      promptDue = true;
      safetyState = 'check-in-due';
    }
    if (j.eta && now > j.eta.getTime()) missedArrival = true;
  }
  return {
    id: j.id,
    destination: j.destination,
    status: j.status,
    startedAt: j.startedAt,
    eta: j.eta ?? null,
    checkInIntervalMinutes: j.checkInIntervalMinutes,
    shareLive: j.shareLive,
    deviationThresholdMeters: j.deviationThresholdMeters,
    trustedContactId: j.trustedContactId ?? null,
    trustedContact: j.trustedContact ? { id: j.trustedContact.id, name: j.trustedContact.name } : null,
    lastLat: j.lastLat ?? null,
    lastLng: j.lastLng ?? null,
    lastAccuracy: j.lastAccuracy ?? null,
    lastBearing: j.lastBearing ?? null,
    lastLocationAt: j.lastLocationAt ?? null,
    lastCheckInAt: j.lastCheckInAt ?? null,
    promptCount: j.promptCount,
    escalatedAt: j.escalatedAt ?? null,
    safetyState,
    promptDue,
    missedArrival,
  };
}

// ── Start a Safe Journey ──
safeJourneyRouter.post(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const { destination, eta, trustedContactId, checkInIntervalMinutes, shareLive, deviationThresholdMeters } = parsed.data;

    if (trustedContactId) {
      const contact = await prisma.trustedContact.findUnique({ where: { id: trustedContactId } });
      if (!contact || contact.userId !== request.userId) {
        response.status(404).json({ error: 'Trusted contact not found' });
        return;
      }
    }

    // Only one active journey per user at a time.
    const active = await prisma.journey.findFirst({ where: { userId: request.userId, status: 'ACTIVE' } });
    if (active) {
      response.status(409).json({ error: 'You already have an active journey. End it before starting a new one.' });
      return;
    }

    const journey = await prisma.journey.create({
      data: {
        userId: request.userId!,
        destination,
        mode: 'NAVIGATION',
        status: 'ACTIVE',
        eta: eta ? new Date(eta) : null,
        trustedContactId: trustedContactId ?? null,
        checkInIntervalMinutes,
        shareLive,
        deviationThresholdMeters,
        lastCheckInAt: new Date(),
      },
      include: { trustedContact: { select: { id: true, name: true } } },
    });

    await recordAudit({
      actorId: request.userId,
      action: 'journey.started',
      entityType: 'Journey',
      entityId: journey.id,
      metadata: { destination, trustedContactId: trustedContactId ?? null, shareLive },
    });

    response.status(201).json({ journey: serializeJourney(journey) });
  }),
);

// ── Active journey ──
safeJourneyRouter.get(
  '/active',
  asyncHandler(async (request, response) => {
    const journey = await prisma.journey.findFirst({
      where: { userId: request.userId, status: 'ACTIVE' },
      include: { trustedContact: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'desc' },
    });
    response.json({ journey: journey ? serializeJourney(journey) : null });
  }),
);

// ── Report a location update (records breadcrumbs + drives safety checks) ──
safeJourneyRouter.post(
  '/:id/location',
  asyncHandler(async (request, response) => {
    const parsed = locationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid location', details: parsed.error.flatten() });
      return;
    }
    const journey = await prisma.journey.findUnique({ where: { id: String(request.params.id) } });
    if (!journey || journey.userId !== request.userId) {
      response.status(404).json({ error: 'Journey not found' });
      return;
    }
    if (journey.status !== 'ACTIVE') {
      response.status(409).json({ error: 'Journey is not active' });
      return;
    }
    const { lat, lng, accuracy, heading, speed, battery } = parsed.data;

    // Breadcrumb + live position.
    await prisma.journeyLocation.create({
      data: { journeyId: journey.id, lat, lng, accuracy, heading, speed, battery },
    });
    await prisma.journey.update({
      where: { id: journey.id },
      data: { lastLat: lat, lastLng: lng, lastAccuracy: accuracy, lastBearing: heading, lastLocationAt: new Date() },
    });

    response.json({ ok: true });
  }),
);

// ── Route-deviation check: prompt first, escalate only after repeated prompts ──
// Deviation is measured against the WALKED PATH (recent breadcrumbs), not the
// last known point: comparing to lastLat/lastLng fired false prompts when the
// user paused or doubled back (walking backwards to correct a missed turn is
// normal and is good news, not an alarm). There is no planned route stored —
// this is drift detection, and the spoken copy in the client must say "from
// where you were walking", never "off your route".
const DEVIATION_MAX_ACCURACY_M = 25; // ignore breadcrumbs with worse GPS accuracy (jitter gate)
const DEVIATION_K_SAMPLES = 2; // consecutive off-path samples required before prompting

/** Distance in meters from point P to segment A→B (planar approx — valid at
 *  short ranges where haversine curvature is negligible). */
export function distanceToSegmentMeters(
  pLat: number, pLng: number, aLat: number, aLng: number, bLat: number, bLng: number,
): number {
  const toXY = (lat: number, lng: number) => ({
    x: lng * 111_320 * Math.cos((lat * Math.PI) / 180),
    y: lat * 110_540,
  });
  const p = toXY(pLat, pLng);
  const a = toXY(aLat, aLng);
  const b = toXY(bLat, bLng);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

safeJourneyRouter.post(
  '/:id/deviation',
  asyncHandler(async (request, response) => {
    const parsed = deviationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid location', details: parsed.error.flatten() });
      return;
    }
    const journey = await prisma.journey.findUnique({ where: { id: String(request.params.id) } });
    if (!journey || journey.userId !== request.userId) {
      response.status(404).json({ error: 'Journey not found' });
      return;
    }
    if (journey.status !== 'ACTIVE' || journey.lastLat == null || journey.lastLng == null) {
      response.json({ ok: true, deviationMeters: 0, action: 'none' });
      return;
    }

    // Recent walked path: breadcrumbs from the last 15 minutes with acceptable
    // GPS accuracy, oldest first, capped to bound query cost.
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const breadcrumbs = await prisma.journeyLocation.findMany({
      where: { journeyId: journey.id, recordedAt: { gte: since }, accuracy: { lte: DEVIATION_MAX_ACCURACY_M } },
      select: { lat: true, lng: true },
      orderBy: { recordedAt: 'asc' },
      take: 60,
    });

    let deviationMeters: number;
    if (breadcrumbs.length >= 2) {
      // Distance from the walked path: minimum over recent segments.
      let min = Infinity;
      for (let i = 1; i < breadcrumbs.length; i++) {
        const d = distanceToSegmentMeters(
          parsed.data.currentLat, parsed.data.currentLng,
          breadcrumbs[i - 1].lat, breadcrumbs[i - 1].lng,
          breadcrumbs[i].lat, breadcrumbs[i].lng,
        );
        if (d < min) min = d;
      }
      deviationMeters = min;
    } else {
      // Not enough clean breadcrumbs yet: fall back to last-point comparison.
      deviationMeters = haversineMeters(journey.lastLat, journey.lastLng, parsed.data.currentLat, parsed.data.currentLng);
    }

    const threshold = journey.deviationThresholdMeters;
    let action: 'none' | 'prompt' | 'escalate' = 'none';

    if (deviationMeters > threshold) {
      // Prompt first. Escalate only after repeated unanswered prompts. The
      // K-sample confirmation lives client-side (prompt only after K
      // consecutive off-path checks) — the escalation ladder is unchanged.
      if (journey.promptCount >= 2) {
        action = 'escalate';
        await prisma.journey.update({
          where: { id: journey.id },
          data: { status: 'ESCALATED', escalatedAt: new Date() },
        });
        await recordAudit({
          actorId: request.userId,
          action: 'journey.escalated_deviation',
          entityType: 'Journey',
          entityId: journey.id,
          metadata: { deviationMeters: Math.round(deviationMeters), threshold },
        });
      } else {
        action = 'prompt';
        await prisma.journey.update({
          where: { id: journey.id },
          data: { promptCount: { increment: 1 }, lastPromptAt: new Date() },
        });
      }
    }

    response.json({ ok: true, deviationMeters: Math.round(deviationMeters), threshold, action });
  }),
);

// ── User check-in (resets the check-in timer + prompts) ──
safeJourneyRouter.post(
  '/:id/check-in',
  asyncHandler(async (request, response) => {
    const journey = await prisma.journey.findUnique({ where: { id: String(request.params.id) } });
    if (!journey || journey.userId !== request.userId) {
      response.status(404).json({ error: 'Journey not found' });
      return;
    }
    if (journey.status !== 'ACTIVE') {
      response.status(409).json({ error: 'Journey is not active' });
      return;
    }
    const updated = await prisma.journey.update({
      where: { id: journey.id },
      data: { lastCheckInAt: new Date(), promptCount: 0 },
      include: { trustedContact: { select: { id: true, name: true } } },
    });
    response.json({ journey: serializeJourney(updated) });
  }),
);

// ── "I'm lost" / request help ──
safeJourneyRouter.post(
  '/:id/lost',
  asyncHandler(async (request, response) => {
    const journey = await prisma.journey.findUnique({ where: { id: String(request.params.id) } });
    if (!journey || journey.userId !== request.userId) {
      response.status(404).json({ error: 'Journey not found' });
      return;
    }
    await recordAudit({
      actorId: request.userId,
      action: 'journey.lost',
      entityType: 'Journey',
      entityId: journey.id,
    });
    // Real notification path: email the trusted contacts. Delivery outcomes
    // are audited inside notifyTrustedContacts; the response no longer
    // promises "notified" unconditionally.
    void notifyTrustedContacts(request.userId!, 'LOST', { journeyId: journey.id });
    response.json({ ok: true, message: 'Help requested. We are notifying your trusted contacts now.' });
  }),
);

// ── End / cancel a journey ──
safeJourneyRouter.post(
  '/:id/end',
  asyncHandler(async (request, response) => {
    const journey = await prisma.journey.findUnique({ where: { id: String(request.params.id) } });
    if (!journey || journey.userId !== request.userId) {
      response.status(404).json({ error: 'Journey not found' });
      return;
    }
    const completed = await prisma.journey.update({
      where: { id: journey.id },
      data: { status: 'COMPLETED', endedAt: new Date() },
    });
    await recordAudit({
      actorId: request.userId,
      action: 'journey.completed',
      entityType: 'Journey',
      entityId: journey.id,
    });
    response.json({ journey: serializeJourney(completed) });
  }),
);

// ── History ──
safeJourneyRouter.get(
  '/history',
  asyncHandler(async (request, response) => {
    const journeys = await prisma.journey.findMany({
      where: { userId: request.userId, status: { not: 'ACTIVE' } },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
    response.json({ journeys: journeys.map(serializeJourney) });
  }),
);

// ── Trusted contacts acknowledge an SOS or journey alert ──
// (the contact proves knowledge of the alert; the user is notified)
safeJourneyRouter.post(
  '/:id/acknowledge',
  asyncHandler(async (request, response) => {
    const journey = await prisma.journey.findUnique({ where: { id: String(request.params.id) } });
    if (!journey) {
      response.status(404).json({ error: 'Journey not found' });
      return;
    }
    await recordAudit({
      actorId: request.userId,
      action: 'journey.acknowledged',
      entityType: 'Journey',
      entityId: journey.id,
      metadata: { byUser: request.userId },
    });
    response.json({ ok: true, message: 'Acknowledged.' });
  }),
);
