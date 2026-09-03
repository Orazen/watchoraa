import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { PlaceInfo } from '../geocode.js';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

let app: Express;
const suffix = Date.now();
const userEmail = `geocode-${suffix}@example.com`;
let userToken = '';
let userId = '';

let providerCalls = 0;
const fakeProvider = async (lat: number, lng: number): Promise<PlaceInfo> => {
  providerCalls += 1;
  if (lat === 0 && lng === 0) throw new Error('upstream down');
  return { display: 'Church Road, Bangalore, India', road: 'Church Road', city: 'Bengaluru', suburb: 'Central' };
};

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  const { makeGeocodeRouter } = await import('../geocode.js');
  const { apiRouter } = await import('../index.js');
  apiRouter.use('/geocode-test', makeGeocodeRouter(fakeProvider));
  app = createApp();
  const { prisma } = await import('../../lib/prisma.js');
  const { signToken } = await import('../../lib/auth.js');
  const user = await prisma.user.create({ data: { email: userEmail, passwordHash: 'x', fullName: 'Geo User', role: 'BLIND_USER' } });
  userId = user.id;
  userToken = signToken({ sub: user.id, email: user.email });
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.auditLog.deleteMany({ where: { actorId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('GET /api/geocode-test/reverse', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/geocode-test/reverse?lat=12.97&lng=77.59');
    expect(res.status).toBe(401);
  });

  it('rejects missing/invalid coordinates', async () => {
    const none = await request(app).get('/api/geocode-test/reverse').set('Authorization', `Bearer ${userToken}`);
    expect(none.status).toBe(400);
    const bad = await request(app).get('/api/geocode-test/reverse?lat=999&lng=0').set('Authorization', `Bearer ${userToken}`);
    expect(bad.status).toBe(400);
  });

  it('looks up once then serves the ~11m-grid cache without re-calling the provider', async () => {
    const first = await request(app).get('/api/geocode-test/reverse?lat=12.9716&lng=77.5946').set('Authorization', `Bearer ${userToken}`);
    expect(first.status).toBe(200);
    expect(first.body.road).toBe('Church Road');
    expect(first.body.cached).toBe(false);

    // Slightly different fix inside the same ~11m cell → cached
    const second = await request(app).get('/api/geocode-test/reverse?lat=12.97164&lng=77.59461').set('Authorization', `Bearer ${userToken}`);
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(providerCalls).toBe(1);
  });

  it('reports upstream failure as 502 without caching', async () => {
    const res = await request(app).get('/api/geocode-test/reverse?lat=0&lng=0').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(502);
  });
});
