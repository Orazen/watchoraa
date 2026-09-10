import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { SttProvider } from '../stt.js';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
delete process.env.STT_API_KEY;

let app: Express;
const suffix = Date.now();
const userEmail = `stt-${suffix}@example.com`;
let userToken = '';
let userId = '';

let providerCalls = 0;
let lastLanguage: string | undefined;
const fakeProvider: SttProvider = async (_audio, _mimeType, language) => {
  providerCalls += 1;
  lastLanguage = language;
  return { transcript: 'what time is it', language: 'en' };
};
const failingProvider: SttProvider = async () => {
  throw new Error('upstream exploded');
};

// 1KB of pseudo-audio: above the 512-byte silence floor.
const fakeAudio = Buffer.alloc(1024, 7);

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  const { makeSttRouter } = await import('../stt.js');
  const { apiRouter } = await import('../index.js');
  apiRouter.use('/stt-test', makeSttRouter({ provider: fakeProvider, isConfigured: () => true }));
  apiRouter.use('/stt-off', makeSttRouter({ provider: fakeProvider, isConfigured: () => false }));
  apiRouter.use('/stt-fail', makeSttRouter({ provider: failingProvider, isConfigured: () => true }));
  app = createApp();
  const { prisma } = await import('../../lib/prisma.js');
  const { signToken } = await import('../../lib/auth.js');
  const user = await prisma.user.create({ data: { email: userEmail, passwordHash: 'x', fullName: 'STT User', role: 'BLIND_USER' } });
  userId = user.id;
  userToken = signToken({ sub: user.id, email: user.email });
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.auditLog.deleteMany({ where: { actorId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('POST /api/stt-test/transcribe', () => {
  it('requires auth', async () => {
    const res = await request(app)
      .post('/api/stt-test/transcribe')
      .set('Content-Type', 'audio/webm')
      .send(fakeAudio);
    expect(res.status).toBe(401);
  });

  it('reports an unconfigured server as 503 before touching the provider', async () => {
    const res = await request(app)
      .post('/api/stt-off/transcribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'audio/webm')
      .send(fakeAudio);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
    expect(providerCalls).toBe(0);
  });

  it('rejects non-audio content types', async () => {
    const res = await request(app)
      .post('/api/stt-test/transcribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'application/json')
      .send({ trick: true });
    expect(res.status).toBe(415);
  });

  it('rejects empty or too-short recordings', async () => {
    const res = await request(app)
      .post('/api/stt-test/transcribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'audio/webm')
      .send(Buffer.alloc(10));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty or too short/i);
  });

  it('transcribes a recording and forwards the language hint', async () => {
    const res = await request(app)
      .post('/api/stt-test/transcribe?language=en')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'audio/webm;codecs=opus')
      .send(fakeAudio);
    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe('what time is it');
    expect(providerCalls).toBe(1);
    expect(lastLanguage).toBe('en');
  });

  it('ignores malformed language hints instead of failing', async () => {
    const res = await request(app)
      .post('/api/stt-test/transcribe?language=klingon!!')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'audio/mp4')
      .send(fakeAudio);
    expect(res.status).toBe(200);
    expect(lastLanguage).toBeUndefined();
  });

  it('reports provider failure as 502 with a generic message', async () => {
    const res = await request(app)
      .post('/api/stt-fail/transcribe')
      .set('Authorization', `Bearer ${userToken}`)
      .set('Content-Type', 'audio/webm')
      .send(fakeAudio);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/not available right now/i);
    expect(res.body.error).not.toMatch(/upstream/);
  });
});
