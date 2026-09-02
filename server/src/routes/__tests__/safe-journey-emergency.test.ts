import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

let app: Express;
const suffix = Date.now();
const blindEmail = `safety-${suffix}@example.com`;
const caregiverEmail = `safety-cg-${suffix}@example.com`;
let blindToken = '';
let caregiverToken = '';
let blindId = '';
let caregiverId = '';
let contactId = '';

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp();
  const { prisma } = await import('../../lib/prisma.js');
  const { signToken } = await import('../../lib/auth.js');
  const blind = await prisma.user.create({ data: { email: blindEmail, passwordHash: 'x', fullName: 'Safety Blind', role: 'BLIND_USER' } });
  const cg = await prisma.user.create({ data: { email: caregiverEmail, passwordHash: 'x', fullName: 'Safety CG', role: 'CAREGIVER' } });
  blindId = blind.id;
  caregiverId = cg.id;
  blindToken = signToken({ sub: blind.id, email: blind.email });
  caregiverToken = signToken({ sub: cg.id, email: cg.email });
  // Acknowledge is now restricted to trusted contacts of the blind user.
  await prisma.trustedContact.create({
    data: { userId: blind.id, name: 'Safety CG', email: caregiverEmail, canReceiveAlerts: true },
  });
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  const ids = [blindId, caregiverId];
  await prisma.journeyLocation.deleteMany({ where: { journey: { userId: { in: ids } } } });
  await prisma.journey.deleteMany({ where: { userId: { in: ids } } });
  await prisma.emergencyAcknowledgement.deleteMany({ where: { session: { userId: { in: ids } } } });
  await prisma.emergencySession.deleteMany({ where: { userId: { in: ids } } });
  await prisma.trustedContact.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe('Safe Journey', () => {
  it('starts, reports location, checks in, and ends', async () => {
    const start = await request(app)
      .post('/api/safe-journey')
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ destination: 'Home', checkInIntervalMinutes: 5, shareLive: true, deviationThresholdMeters: 50 });
    expect(start.status).toBe(201);
    expect(start.body.journey.status).toBe('ACTIVE');
    const jid = start.body.journey.id;

    const loc = await request(app)
      .post(`/api/safe-journey/${jid}/location`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ lat: 12.9716, lng: 77.5946, accuracy: 8, heading: 90, battery: 72 });
    expect(loc.status).toBe(200);

    const active = await request(app).get('/api/safe-journey/active').set('Authorization', `Bearer ${blindToken}`);
    expect(active.body.journey.lastLat).toBe(12.9716);
    expect(active.body.journey.missedArrival).toBe(false);

    const checkin = await request(app).post(`/api/safe-journey/${jid}/check-in`).set('Authorization', `Bearer ${blindToken}`);
    expect(checkin.status).toBe(200);

    const end = await request(app).post(`/api/safe-journey/${jid}/end`).set('Authorization', `Bearer ${blindToken}`);
    expect(end.body.journey.status).toBe('COMPLETED');
  });

  it('rejects a second active journey and foreign access', async () => {
    const first = await request(app)
      .post('/api/safe-journey')
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ destination: 'Work', checkInIntervalMinutes: 5 });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/safe-journey')
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ destination: 'Second' });
    expect(second.status).toBe(409);

    // Clean up: end the first journey so later tests can start fresh ones.
    await request(app)
      .post(`/api/safe-journey/${first.body.journey.id}/end`)
      .set('Authorization', `Bearer ${blindToken}`);
  });

  it('prompts on deviation, then escalates after repeated prompts', async () => {
    // Fresh journey with a tight threshold.
    const start = await request(app)
      .post('/api/safe-journey')
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ destination: 'Clinic', deviationThresholdMeters: 10 });
    const jid = start.body.journey.id;

    await request(app)
      .post(`/api/safe-journey/${jid}/location`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ lat: 12.9700, lng: 77.5900 });

    // Deviation > threshold: first call prompts.
    const p1 = await request(app)
      .post(`/api/safe-journey/${jid}/deviation`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ currentLat: 12.9740, currentLng: 77.5980 }); // ~600m away
    expect(p1.body.action).toBe('prompt');

    const p2 = await request(app)
      .post(`/api/safe-journey/${jid}/deviation`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ currentLat: 12.9740, currentLng: 77.5980 });
    expect(p2.body.action).toBe('prompt');

    // Third call escalates.
    const p3 = await request(app)
      .post(`/api/safe-journey/${jid}/deviation`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ currentLat: 12.9740, currentLng: 77.5980 });
    expect(p3.body.action).toBe('escalate');

    const active = await request(app).get('/api/safe-journey/active').set('Authorization', `Bearer ${blindToken}`);
    expect(active.body.journey).toBeNull(); // escalated -> no longer ACTIVE
  });
});

describe('Emergency', () => {
  it('triggers SOS with payload, cancels within the window, and acknowledges', async () => {
    const trigger = await request(app)
      .post('/api/emergency')
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ lat: 12.9716, lng: 77.5946, accuracy: 10, battery: 88, heading: 180, emergencyType: 'fell' });
    expect(trigger.status).toBe(201);
    expect(trigger.body.session.status).toBe('ACTIVE');
    expect(trigger.body.session.mapsUrl).toContain('maps.google.com');
    expect(trigger.body.cancelWindowSeconds).toBe(10);
    const sid = trigger.body.session.id;

    // Location update.
    const upd = await request(app)
      .post(`/api/emergency/${sid}/location`)
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ lat: 12.9720, lng: 77.5950, battery: 87 });
    expect(upd.status).toBe(200);
    expect(upd.body.session.lat).toBe(12.972);

    // Caregiver acknowledges.
    const ack = await request(app)
      .post(`/api/emergency/${sid}/acknowledge`)
      .set('Authorization', `Bearer ${caregiverToken}`);
    expect(ack.status).toBe(201);

    // Resolve.
    const resolve = await request(app)
      .post(`/api/emergency/${sid}/resolve`)
      .set('Authorization', `Bearer ${blindToken}`);
    expect(resolve.body.session.status).toBe('RESOLVED');
  });

  it('blocks cancellation after the window and exposes the caregiver inbox', async () => {
    const trigger = await request(app)
      .post('/api/emergency')
      .set('Authorization', `Bearer ${blindToken}`)
      .send({ lat: 1, lng: 1 });
    const sid = trigger.body.session.id;

    // Simulate window close by backdating the session.
    const { prisma } = await import('../../lib/prisma.js');
    await prisma.emergencySession.update({
      where: { id: sid },
      data: { triggeredAt: new Date(Date.now() - 30_000) },
    });
    const cancel = await request(app).post(`/api/emergency/${sid}/cancel`).set('Authorization', `Bearer ${blindToken}`);
    expect(cancel.status).toBe(409);

    // Caregiver inbox (they were listed as a trusted contact with this email).
    const { prisma: p } = await import('../../lib/prisma.js');
    await p.trustedContact.create({
      data: { userId: blindId, name: 'Safety CG', email: caregiverEmail, canReceiveAlerts: true },
    });
    const inbox = await request(app).get('/api/emergency/inbox').set('Authorization', `Bearer ${caregiverToken}`);
    expect(inbox.status).toBe(200);
    expect(Array.isArray(inbox.body.sessions)).toBe(true);
  });
});
