import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

let app: Express;
const suffix = Date.now();
const blindEmail = `blind-${suffix}@example.com`;
const caregiverEmail = `cg-${suffix}@example.com`;
const adminEmail = `admin-${suffix}@example.com`;
let blindToken = '';
let blindRefresh = '';
let caregiverToken = '';
let adminToken = '';
let blindId = '';
let caregiverId = '';
let adminId = '';

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp();
  const { prisma } = await import('../../lib/prisma.js');
  const { signToken } = await import('../../lib/auth.js');

  const blind = await prisma.user.create({ data: { email: blindEmail, passwordHash: 'x', fullName: 'Blind User', role: 'BLIND_USER' } });
  const cg = await prisma.user.create({ data: { email: caregiverEmail, passwordHash: 'x', fullName: 'Caregiver User', role: 'CAREGIVER' } });
  const admin = await prisma.user.create({ data: { email: adminEmail, passwordHash: 'x', fullName: 'Admin User', role: 'ADMIN' } });
  blindId = blind.id;
  caregiverId = cg.id;
  adminId = admin.id;
  blindToken = signToken({ sub: blind.id, email: blind.email });
  caregiverToken = signToken({ sub: cg.id, email: cg.email });
  adminToken = signToken({ sub: admin.id, email: admin.email });
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  const ids = [blindId, caregiverId, adminId];
  await prisma.trustedContact.deleteMany({ where: { userId: { in: ids } } });
  await prisma.assistanceRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.journey.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } });
  await prisma.promptVersion.deleteMany({ where: {} });
  await prisma.incidentReport.deleteMany({ where: { reporterId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('POST /api/auth/refresh (rotation)', () => {
  it('returns a new access + refresh token pair', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    const { issueRefreshToken } = await import('../../lib/auth.js');
    const issued = await issueRefreshToken(blindId, blindEmail);
    blindRefresh = issued.token;

    const response = await request(app).post('/api/auth/refresh').send({ refreshToken: issued.token });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.refreshToken).toBeTypeOf('string');
    expect(response.body.refreshToken).not.toBe(issued.token);

    // Old token is revoked; a second use fails.
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: issued.token });
    expect(replay.status).toBe(401);
    blindRefresh = response.body.refreshToken;
  });

  it('rejects a garbage refresh token', async () => {
    const response = await request(app).post('/api/auth/refresh').send({ refreshToken: 'nope' });
    expect(response.status).toBe(401);
  });
});

describe('password reset flow', () => {
  it('issues a dev token and consumes it to set a new password', async () => {
    // The raw token is returned ONLY under the explicit dev flag — without it,
    // the response must never contain the token (account-takeover guard).
    process.env.EXPOSE_DEV_RESET_TOKEN = 'true';
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: blindEmail });
    expect(forgot.status).toBe(200);
    expect(forgot.body.devToken).toBeTypeOf('string');
    delete process.env.EXPOSE_DEV_RESET_TOKEN;

    const hidden = await request(app).post('/api/auth/forgot-password').send({ email: blindEmail });
    expect(hidden.status).toBe(200);
    expect(hidden.body.devToken).toBeUndefined();

    const bad = await request(app).post('/api/auth/reset-password').send({ token: 'wrong', password: 'newpassword123' });
    expect(bad.status).toBe(400);

    const reset = await request(app).post('/api/auth/reset-password').send({ token: forgot.body.devToken, password: 'newpassword123' });
    expect(reset.status).toBe(200);
    expect(reset.body.token).toBeTypeOf('string');

    // Token is single-use.
    const reuse = await request(app).post('/api/auth/reset-password').send({ token: forgot.body.devToken, password: 'another123' });
    expect(reuse.status).toBe(400);
  });
});

describe('GET /api/caregiver/overview', () => {
  it('blocks blind users', async () => {
    const response = await request(app).get('/api/caregiver/overview').set('Authorization', `Bearer ${blindToken}`);
    expect(response.status).toBe(403);
  });

  it('shows a caregiver the blind user who listed them as a trusted contact', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    const cgUser = await prisma.user.findUnique({ where: { id: caregiverId } });
    await prisma.trustedContact.create({
      data: { userId: blindId, name: cgUser!.fullName, email: caregiverEmail, canReceiveAlerts: true },
    });
    await prisma.assistanceRequest.create({
      data: { userId: blindId, message: 'I need help', status: 'SENT', sentAt: new Date(), locationShare: true },
    });

    const response = await request(app).get('/api/caregiver/overview').set('Authorization', `Bearer ${caregiverToken}`);
    expect(response.status).toBe(200);
    expect(response.body.blindUsers.length).toBe(1);
    expect(response.body.blindUsers[0].email).toBe(blindEmail);
    expect(response.body.openAssistance.some((r: { message: string }) => r.message === 'I need help')).toBe(true);
  });
});

describe('admin prompt versioning', () => {
  it('creates + activates a prompt version and rejects non-admins', async () => {
    const denied = await request(app).get('/api/admin/prompts').set('Authorization', `Bearer ${blindToken}`);
    expect(denied.status).toBe(403);

    const created = await request(app)
      .post('/api/admin/prompts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'NAVIGATION', prompt: 'Custom navigation safety prompt v1' });
    expect(created.status).toBe(201);
    expect(created.body.prompt.version).toBe(1);

    const activated = await request(app)
      .post(`/api/admin/prompts/${created.body.prompt.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activated.status).toBe(200);
    expect(activated.body.prompt.isActive).toBe(true);

    const list = await request(app).get('/api/admin/prompts').set('Authorization', `Bearer ${adminToken}`);
    expect(list.body.prompts.some((p: { id: string; isActive: boolean }) => p.id === created.body.prompt.id && p.isActive)).toBe(true);
  });
});

describe('community moderation', () => {
  it('hides REMOVED incidents from the public feed and lets the reporter self-delete', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    const incident = await prisma.incidentReport.create({
      data: { reporterId: blindId, category: 'Wet floor', description: 'Spill near entrance', severity: 'MEDIUM' },
    });

    const publicFeed = await request(app).get('/api/incidents').set('Authorization', `Bearer ${blindToken}`);
    expect(publicFeed.body.incidents.some((i: { id: string }) => i.id === incident.id)).toBe(true);

    // Admin marks it REVIEWED, then REMOVED.
    await request(app)
      .patch(`/api/admin/incidents/${incident.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REVIEWED' });
    const removed = await request(app)
      .patch(`/api/admin/incidents/${incident.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REMOVED' });
    expect(removed.status).toBe(200);

    const after = await request(app).get('/api/incidents').set('Authorization', `Bearer ${blindToken}`);
    expect(after.body.incidents.some((i: { id: string }) => i.id === incident.id)).toBe(false);

    // Reporter can self-delete their own (fresh) report.
    const own = await prisma.incidentReport.create({
      data: { reporterId: blindId, category: 'Broken rail', description: 'Handrail loose', severity: 'HIGH' },
    });
    const selfDelete = await request(app).delete(`/api/incidents/${own.id}`).set('Authorization', `Bearer ${blindToken}`);
    expect(selfDelete.status).toBe(204);
  });
});

describe('PATCH /api/contacts/:id (location consent toggle)', () => {
  it('lets a blind user grant and revoke live location visibility per contact', async () => {
    const { prisma } = await import('../../lib/prisma.js');
    const contact = await prisma.trustedContact.create({
      data: { userId: blindId, name: 'Toggle User', email: caregiverEmail, canReceiveAlerts: true, canSeeLocation: false },
    });

    const on = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ canSeeLocation: true });
    expect(on.status).toBe(200);
    expect(on.body.contact.canSeeLocation).toBe(true);

    const off = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ canSeeLocation: false });
    expect(off.status).toBe(200);
    expect(off.body.contact.canSeeLocation).toBe(false);

    const forbidden = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .set('Authorization', `Bearer ${caregiverToken}`)
      .send({ canSeeLocation: true });
    expect(forbidden.status).toBe(404);

    await prisma.trustedContact.delete({ where: { id: contact.id } });
  });
});

describe("GET /api/caregiver/location/:userId (consent-gated map)", () => {
  it("returns consent:false when the caregiver is not a location-sharing contact", async () => {
    const response = await request(app)
      .get(`/api/caregiver/location/${blindId}`)
      .set("Authorization", `Bearer ${caregiverToken}`);
    expect(response.status).toBe(200);
    expect(response.body.journey).toBeNull();
    expect(response.body.consent).toBe(false);
  });

  it("returns consent:true + null journey when consent exists but no active sharing journey", async () => {
    const { prisma } = await import("../../lib/prisma.js");
    await prisma.trustedContact.create({
      data: { userId: blindId, name: "Caregiver User", email: caregiverEmail, canReceiveAlerts: true, canSeeLocation: true },
    });

    const response = await request(app)
      .get(`/api/caregiver/location/${blindId}`)
      .set("Authorization", `Bearer ${caregiverToken}`);
    expect(response.status).toBe(200);
    expect(response.body.journey).toBeNull();
    expect(response.body.consent).toBe(true);
  });

  it("returns journey + trail only when BOTH consent flags are true", async () => {
    const { prisma } = await import("../../lib/prisma.js");
    const journey = await prisma.journey.create({
      data: {
        userId: blindId,
        destination: "Map Test Home",
        mode: "NAVIGATION",
        status: "ACTIVE",
        shareLive: true,
        lastLat: 12.9716,
        lastLng: 77.5946,
        lastLocationAt: new Date(),
      },
    });
    await prisma.journeyLocation.create({
      data: { journeyId: journey.id, lat: 12.9715, lng: 77.5944, recordedAt: new Date() },
    });
    await prisma.journeyLocation.create({
      data: { journeyId: journey.id, lat: 12.9716, lng: 77.5946, recordedAt: new Date() },
    });

    const response = await request(app)
      .get(`/api/caregiver/location/${blindId}`)
      .set("Authorization", `Bearer ${caregiverToken}`);
    expect(response.status).toBe(200);
    expect(response.body.consent).toBe(true);
    expect(response.body.journey.destination).toBe("Map Test Home");
    expect(response.body.journey.lastLat).toBe(12.9716);
    expect(response.body.trail.length).toBeGreaterThanOrEqual(2);
    expect(response.body.trail[0]).toHaveProperty("lat");

    await prisma.journey.delete({ where: { id: journey.id } });
  });

  it("blocks a blind user from reading a caregiver-location response", async () => {
    const response = await request(app)
      .get(`/api/caregiver/location/${blindId}`)
      .set("Authorization", `Bearer ${blindToken}`);
    expect(response.status).toBe(403);
  });
});
