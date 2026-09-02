import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

// Caregiver portal (roadmap Phase 5): a CAREGIVER sees the blind users who
// listed them as a trusted contact (matched by email), plus those users' SOS
// requests and recent journeys. Read-only by design — caregivers must not
// mutate a blind user's data.
export const caregiverRouter = Router();
caregiverRouter.use(requireAuth);

const overviewSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

caregiverRouter.get(
  '/overview',
  asyncHandler(async (request, response) => {
    const me = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!me) {
      response.status(401).json({ error: 'Account not found' });
      return;
    }
    if (me.role !== 'CAREGIVER' && me.role !== 'ADMIN') {
      response.status(403).json({ error: 'Caregiver access required' });
      return;
    }

    const parsed = overviewSchema.safeParse(request.query);
    const limit = parsed.success ? parsed.data.limit : 20;

    // Blind users who listed this caregiver's email as a trusted contact.
    // Case-insensitive match so 'Care@x.com' vs 'care@x.com' never breaks the link.
    const contacts = await prisma.trustedContact.findMany({
      where: { email: { equals: me.email, mode: 'insensitive' } },
      select: { userId: true, name: true, relationship: true, canReceiveAlerts: true, canSeeLocation: true, shareExpiresAt: true },
    });
    const now = Date.now();
    const activeContacts = contacts.filter((c) => !c.shareExpiresAt || c.shareExpiresAt.getTime() > now);
    const blindUserIds = [...new Set(activeContacts.map((c) => c.userId))];

    const blindUsers = blindUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: blindUserIds } },
          select: { id: true, email: true, fullName: true, preferredLanguage: true, role: true },
        })
      : [];

    const [assistanceRequests, journeys, places] = await Promise.all([
      blindUserIds.length
        ? prisma.assistanceRequest.findMany({
            where: { userId: { in: blindUserIds }, status: { not: 'RESOLVED' } },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: { user: { select: { fullName: true, email: true } } },
          })
        : Promise.resolve([]),
      blindUserIds.length
        ? prisma.journey.findMany({
            where: { userId: { in: blindUserIds } },
            orderBy: { startedAt: 'desc' },
            take: limit,
            include: { user: { select: { fullName: true } } },
          })
        : Promise.resolve([]),
      blindUserIds.length
        ? prisma.savedPlace.findMany({
            where: { userId: { in: blindUserIds } },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: { user: { select: { fullName: true } } },
          })
        : Promise.resolve([]),
    ]);

    response.json({
      caregiver: { id: me.id, email: me.email, fullName: me.fullName },
      contacts,
      blindUsers,
      openAssistance: assistanceRequests,
      recentJourneys: journeys,
      savedPlaces: places,
    });
  }),
);

// ── Live location for the map view ──
// Deliberately narrow and consent-gated: a caregiver only ever sees a
// location point when BOTH sides agree to it for THIS specific pairing —
// the blind user's TrustedContact record for this caregiver has
// canSeeLocation=true, AND the active journey itself has shareLive=true
// (set explicitly when the journey was started, per-journey, not a
// standing grant). Neither flag alone is sufficient. No active journey
// or missing consent returns { journey: null }, never an error that would
// let a caregiver distinguish "no consent" from "no journey" by response
// shape/timing — see docs/watchora-audit-2026-08-06.md for prior consent
// gaps this project has already had to close.
caregiverRouter.get(
  '/location/:userId',
  asyncHandler(async (request, response) => {
    const me = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!me) {
      response.status(401).json({ error: 'Account not found' });
      return;
    }
    if (me.role !== 'CAREGIVER' && me.role !== 'ADMIN') {
      response.status(403).json({ error: 'Caregiver access required' });
      return;
    }

    const targetUserId = String(request.params.userId);

    const contact = await prisma.trustedContact.findFirst({
      where: { userId: targetUserId, email: { equals: me.email, mode: 'insensitive' }, canSeeLocation: true },
    });
    if (!contact) {
      // Not listed as a location-sharing contact for this user — say so
      // plainly rather than pretending there's simply no active journey.
      response.json({ journey: null, consent: false });
      return;
    }
    // A time-boxed sharing grant that has lapsed is treated as no consent.
    if (contact.shareExpiresAt && contact.shareExpiresAt.getTime() <= Date.now()) {
      response.json({ journey: null, consent: false });
      return;
    }

    const journey = await prisma.journey.findFirst({
      where: { userId: targetUserId, status: 'ACTIVE', shareLive: true },
      orderBy: { startedAt: 'desc' },
    });

    if (!journey) {
      response.json({ journey: null, consent: true });
      return;
    }

    // Recent breadcrumb trail (last 2 hours, capped) for the route line —
    // enough to show progress without unboundedly growing the response.
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const trail = await prisma.journeyLocation.findMany({
      where: { journeyId: journey.id, recordedAt: { gte: since } },
      orderBy: { recordedAt: 'asc' },
      take: 300,
      select: { lat: true, lng: true, recordedAt: true },
    });

    response.json({
      consent: true,
      journey: {
        id: journey.id,
        destination: journey.destination,
        status: journey.status,
        startedAt: journey.startedAt,
        eta: journey.eta,
        lastLat: journey.lastLat,
        lastLng: journey.lastLng,
        lastBearing: journey.lastBearing,
        lastLocationAt: journey.lastLocationAt,
      },
      trail,
    });
  }),
);
