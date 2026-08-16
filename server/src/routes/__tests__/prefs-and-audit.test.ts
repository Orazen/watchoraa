import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

let app: Express;
const suffix = Date.now();
const userEmail = `prefs-${suffix}@example.com`;
const otherEmail = `prefs-other-${suffix}@example.com`;
let userToken = '';
let otherToken = '';

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp();

  const { prisma } = await import('../../lib/prisma.js');
  const user = await prisma.user.create({
    data: { email: userEmail, passwordHash: 'x', fullName: 'Prefs Tester', role: 'BLIND_USER' },
  });
  const other = await prisma.user.create({
    data: { email: otherEmail, passwordHash: 'x', fullName: 'Other Tester', role: 'BLIND_USER' },
  });
  const { signToken } = await import('../../lib/auth.js');
  userToken = signToken({ sub: user.id, email: user.email });
  otherToken = signToken({ sub: other.id, email: other.email });
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  const users = await prisma.user.findMany({ where: { email: { in: [userEmail, otherEmail] } } });
  const ids = users.map((u) => u.id);
  await prisma.readingEntry.deleteMany({ where: { userId: { in: ids } } });
  await prisma.consentGrant.deleteMany({ where: { userId: { in: ids } } });
  await prisma.journey.deleteMany({ where: { userId: { in: ids } } });
  await prisma.accessibilityPrefs.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { in: [userEmail, otherEmail] } } });
  await prisma.$disconnect();
});

describe('GET /api/preferences', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await request(app).get('/api/preferences');
    expect(response.status).toBe(401);
  });

  it('creates and returns defaults on first read', async () => {
    const response = await request(app).get('/api/preferences').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(200);
    expect(response.body.preferences.speechRate).toBe(1);
    expect(response.body.preferences.lowConnectivityMode).toBe(true);
  });
});

describe('PUT /api/preferences', () => {
  it('persists a roundtrip and is scoped to the user', async () => {
    const put = await request(app)
      .put('/api/preferences')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ speechRate: 1.4, vibrationEnabled: false, instructionDetail: 3 });
    expect(put.status).toBe(200);
    expect(put.body.preferences.speechRate).toBe(1.4);
    expect(put.body.preferences.vibrationEnabled).toBe(false);

    const other = await request(app).get('/api/preferences').set('Authorization', `Bearer ${otherToken}`);
    expect(other.body.preferences.speechRate).toBe(1);
  });

  it('rejects an empty update', async () => {
    const response = await request(app).put('/api/preferences').set('Authorization', `Bearer ${userToken}`).send({});
    expect(response.status).toBe(400);
  });
});

describe('POST /api/reading-entries', () => {
  it('creates, lists (scoped), and deletes', async () => {
    const created = await request(app)
      .post('/api/reading-entries')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ source: 'camera', extractedText: 'EXIT — stairs ahead', language: 'en' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/reading-entries').set('Authorization', `Bearer ${userToken}`);
    expect(list.status).toBe(200);
    expect(list.body.entries.some((e: { extractedText: string }) => e.extractedText === 'EXIT — stairs ahead')).toBe(true);

    const otherList = await request(app).get('/api/reading-entries').set('Authorization', `Bearer ${otherToken}`);
    expect(otherList.body.entries.length).toBe(0);

    const del = await request(app).delete(`/api/reading-entries/${created.body.entry.id}`).set('Authorization', `Bearer ${otherToken}`);
    expect(del.status).toBe(404); // ownership enforced

    const delOwner = await request(app).delete(`/api/reading-entries/${created.body.entry.id}`).set('Authorization', `Bearer ${userToken}`);
    expect(delOwner.status).toBe(204);
  });
});

describe('POST /api/consents', () => {
  it('grants and lists only active grants for the user', async () => {
    const grant = await request(app)
      .post('/api/consents')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ scope: 'LOCATION_SHARING', metadata: { source: 'test' } });
    expect(grant.status).toBe(201);

    const list = await request(app).get('/api/consents').set('Authorization', `Bearer ${userToken}`);
    expect(list.body.consents.some((c: { scope: string }) => c.scope === 'LOCATION_SHARING')).toBe(true);

    const revoke = await request(app).delete(`/api/consents/${grant.body.consent.id}`).set('Authorization', `Bearer ${userToken}`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.consent.revokedAt).toBeTruthy();

    const after = await request(app).get('/api/consents').set('Authorization', `Bearer ${userToken}`);
    expect(after.body.consents.some((c: { id: string }) => c.id === grant.body.consent.id)).toBe(false);
  });
});

describe('POST /api/journeys', () => {
  it('creates and lists journeys scoped to the user', async () => {
    const created = await request(app)
      .post('/api/journeys')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ destination: 'Home', mode: 'NAVIGATION' });
    expect(created.status).toBe(201);

    const list = await request(app).get('/api/journeys').set('Authorization', `Bearer ${userToken}`);
    expect(list.body.journeys.some((j: { destination: string }) => j.destination === 'Home')).toBe(true);

    const otherList = await request(app).get('/api/journeys').set('Authorization', `Bearer ${otherToken}`);
    expect(otherList.body.journeys.length).toBe(0);
  });
});

describe('GET /api/audit-logs', () => {
  it('rejects non-admins', async () => {
    const response = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });

  it('is readable by an admin and lists auth events', async () => {
    // Promote the first tester to ADMIN just for this check, then restore.
    const { prisma } = await import('../../lib/prisma.js');
    const adminUser = await prisma.user.findUnique({ where: { email: userEmail } });
    await prisma.user.update({ where: { id: adminUser!.id }, data: { role: 'ADMIN' } });
    const adminToken = (await import('../../lib/auth.js')).signToken({ sub: adminUser!.id, email: adminUser!.email });

    const response = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.logs)).toBe(true);

    await prisma.user.update({ where: { id: adminUser!.id }, data: { role: 'BLIND_USER' } });
  });
});
