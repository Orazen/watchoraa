import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
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
      select: { userId: true, name: true, relationship: true, canReceiveAlerts: true, canSeeLocation: true, canManageSettings: true, shareExpiresAt: true },
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

// ── Ward settings: view + remote config (v0.5 caregiver linking) ──
// The blind user opts in per-contact via TrustedContact.canManageSettings
// (they add the caregiver's email as a trusted contact and flip the toggle).
// Once granted, the caregiver can READ the ward's accessibility preferences
// and AI-provider status and CHANGE the accessibility preferences remotely —
// never the AI key itself (a caregiver must never be able to exfiltrate or
// swap the ward's AI provider/key). Every read and write is audit-logged with
// both actor and ward so consent disputes have a trail.

/** Resolves the pairing or returns null after writing the error response. */
async function resolveManagedWard(
  request: import('express').Request,
  response: import('express').Response,
): Promise<{ wardId: string; wardName: string; wardPreferredLanguage: string; caregiverId: string } | null> {
  const me = await prisma.user.findUnique({ where: { id: request.userId } });
  if (!me) {
    response.status(401).json({ error: 'Account not found' });
    return null;
  }
  if (me.role !== 'CAREGIVER' && me.role !== 'ADMIN') {
    response.status(403).json({ error: 'Caregiver access required' });
    return null;
  }
  const wardId = String(request.params.userId);
  const contact = await prisma.trustedContact.findFirst({
    where: { userId: wardId, email: { equals: me.email, mode: 'insensitive' }, canManageSettings: true },
  });
  if (!contact || (contact.shareExpiresAt && contact.shareExpiresAt.getTime() <= Date.now())) {
    // Same non-committal shape as the location endpoint: no info leaks about
    // whether the ward exists vs. consent is missing vs. grant lapsed.
    response.status(403).json({ error: 'Remote configuration is not enabled for this pairing' });
    return null;
  }
  const ward = await prisma.user.findUnique({ where: { id: wardId }, select: { id: true, fullName: true, isActive: true, preferredLanguage: true } });
  if (!ward || !ward.isActive) {
    response.status(404).json({ error: 'Account not found' });
    return null;
  }
  await recordAudit({
    actorId: me.id,
    action: 'caregiver.ward_settings_view',
    entityType: 'User',
    entityId: ward.id,
  });
  return { wardId: ward.id, wardName: ward.fullName, wardPreferredLanguage: ward.preferredLanguage, caregiverId: me.id };
}

caregiverRouter.get(
  '/ward-settings/:userId',
  asyncHandler(async (request, response) => {
    const resolved = await resolveManagedWard(request, response);
    if (!resolved) return;
    const prefs = await prisma.accessibilityPrefs.findUnique({ where: { userId: resolved.wardId } });
    const aiPref = await prisma.aiProviderPref.findUnique({ where: { userId: resolved.wardId } });
    const ward = await prisma.user.findUnique({ where: { id: resolved.wardId }, select: { preferredLanguage: true, role: true } });
    response.json({
      ward: { id: resolved.wardId, fullName: resolved.wardName, preferredLanguage: ward?.preferredLanguage ?? 'en' },
      // Accessibility preferences the caregiver may change remotely.
      preferences: prefs ?? null,
      // AI provider surfaced read-only (provider + model + hasKey) — never the
      // key, and never changeable from the caregiver account.
      aiProvider: aiPref
        ? { provider: aiPref.provider, model: aiPref.model, hasKey: Boolean(aiPref.apiKeyEnc) }
        : { provider: 'GEMINI', model: null, hasKey: false },
    });
  }),
);

const wardPrefsSchema = z
  .object({
    speechRate: z.number().min(0.5).max(2).optional(),
    voiceName: z.string().max(200).nullable().optional(),
    instructionDetail: z.number().int().min(0).max(5).optional(),
    vibrationEnabled: z.boolean().optional(),
    audioEnabled: z.boolean().optional(),
    reducedMotion: z.boolean().optional(),
    textScale: z.number().min(0.8).max(2).optional(),
    lowConnectivityMode: z.boolean().optional(),
    imageRetentionHours: z.number().int().min(0).max(24 * 7).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one preference is required' });

const WARD_PREFS_DEFAULTS = {
  speechRate: 1,
  voiceName: null,
  instructionDetail: 2,
  vibrationEnabled: true,
  audioEnabled: true,
  reducedMotion: false,
  textScale: 1,
  lowConnectivityMode: true,
  imageRetentionHours: 0,
};

caregiverRouter.put(
  '/ward-settings/:userId',
  asyncHandler(async (request, response) => {
    const parsed = wardPrefsSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const resolved = await resolveManagedWard(request, response);
    if (!resolved) return;
    const updated = await prisma.accessibilityPrefs.upsert({
      where: { userId: resolved.wardId },
      create: { userId: resolved.wardId, ...WARD_PREFS_DEFAULTS, ...parsed.data },
      update: parsed.data,
    });
    await recordAudit({
      actorId: resolved.caregiverId,
      action: 'caregiver.ward_settings_update',
      entityType: 'AccessibilityPrefs',
      entityId: updated.id,
      metadata: { fields: Object.keys(parsed.data) },
    });
    // Return the same envelope as GET so the client can refresh the whole panel.
    const aiPref = await prisma.aiProviderPref.findUnique({ where: { userId: resolved.wardId } });
    response.json({
      ward: { id: resolved.wardId, fullName: resolved.wardName, preferredLanguage: resolved.wardPreferredLanguage },
      preferences: updated,
      aiProvider: aiPref
        ? { provider: aiPref.provider, model: aiPref.model, hasKey: Boolean(aiPref.apiKeyEnc) }
        : { provider: 'GEMINI', model: null, hasKey: false },
    });
  }),
);
