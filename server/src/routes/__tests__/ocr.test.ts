import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { OcrMessage, OcrProvider } from '../ocr.js';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

let app: Express;
const suffix = Date.now();
const userEmail = `ocr-${suffix}@example.com`;
let userToken = '';
let userId = '';

let providerCalls = 0;
let lastMessages: OcrMessage[] | undefined;
const fakeProvider: OcrProvider = async (_userId, messages) => {
  providerCalls += 1;
  lastMessages = messages;
  return { text: 'EXIT\nReception Desk\nStairs ahead', source: 'user' };
};
const failingProvider: OcrProvider = async () => {
  throw new Error('upstream exploded');
};

// 1KB pseudo-frame: a valid PNG data URL envelope (routes only decode the
// envelope; the fake provider never looks at the bytes).
const pngFrame = `data:image/png;base64,${Buffer.alloc(1024, 7).toString('base64')}`;
const NO_TEXT = '[NO_TEXT_FOUND]';

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  const { makeOcrRouter } = await import('../ocr.js');
  const { apiRouter } = await import('../index.js');
  apiRouter.use('/ocr-test', makeOcrRouter({ provider: fakeProvider, isDemo: () => false }));
  apiRouter.use('/ocr-demo', makeOcrRouter({ provider: fakeProvider, isDemo: () => true }));
  apiRouter.use('/ocr-fail', makeOcrRouter({ provider: failingProvider, isDemo: () => false }));
  apiRouter.use(
    '/ocr-empty',
    makeOcrRouter({ provider: async () => ({ text: ` ${NO_TEXT}\n`, source: 'server' }), isDemo: () => false }),
  );
  app = createApp();
  const { prisma } = await import('../../lib/prisma.js');
  const { signToken } = await import('../../lib/auth.js');
  const user = await prisma.user.create({ data: { email: userEmail, passwordHash: 'x', fullName: 'OCR User', role: 'BLIND_USER' } });
  userId = user.id;
  userToken = signToken({ sub: user.id, email: user.email });
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe('POST /api/ocr-test/read', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/ocr-test/read').send({ imageDataUrl: pngFrame });
    expect(res.status).toBe(401);
  });

  it('rejects a missing imageDataUrl', async () => {
    const res = await request(app)
      .post('/api/ocr-test/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ language: 'en' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-data-URL image', async () => {
    const res = await request(app)
      .post('/api/ocr-test/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageDataUrl: 'https://example.com/frame.png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/data URL/i);
  });

  it('rejects frames larger than the decoded limit', async () => {
    const oversized = `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`;
    const res = await request(app)
      .post('/api/ocr-test/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageDataUrl: oversized });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too large/i);
  });

  it('answers 503 with a spoken-style message when only the demo provider is available', async () => {
    const res = await request(app)
      .post('/api/ocr-demo/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageDataUrl: pngFrame });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/AI key/i);
    expect(providerCalls).toBe(0);
  });

  it('extracts text with the OCR prompt and reports the source', async () => {
    const res = await request(app)
      .post('/api/ocr-test/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageDataUrl: pngFrame, language: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('EXIT\nReception Desk\nStairs ahead');
    expect(res.body.source).toBe('user');
    expect(providerCalls).toBe(1);
    expect(lastMessages?.[0]?.role).toBe('system');
    expect(lastMessages?.[0]?.text).toMatch(/extract/i);
    expect(lastMessages?.[0]?.text).toMatch(/visible text/i);
    expect(lastMessages?.[1]?.text).toContain('"en"');
  });

  it('ignores malformed language hints instead of failing', async () => {
    const res = await request(app)
      .post('/api/ocr-test/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageDataUrl: pngFrame, language: 'klingon!!' });
    expect(res.status).toBe(200);
    expect(lastMessages?.[1]?.text).not.toContain('klingon');
  });

  it('maps a no-text extraction to the empty-string contract', async () => {
    const res = await request(app)
      .post('/api/ocr-empty/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageDataUrl: pngFrame });
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('');
  });

  it('reports provider failure as 502 with a generic message', async () => {
    const res = await request(app)
      .post('/api/ocr-fail/read')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ imageDataUrl: pngFrame });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/not available right now/i);
    expect(res.body.error).not.toMatch(/upstream/);
  });
});
