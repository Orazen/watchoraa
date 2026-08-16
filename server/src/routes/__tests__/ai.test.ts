import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
delete process.env.GEMINI_API_KEY;

let app: Express;
let token = '';
const testEmail = `ai-${Date.now()}@example.com`;

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp();

  // /api/ai/generate is account-gated (roadmap: RBAC first) — create a test user.
  const { prisma } = await import('../../lib/prisma.js');
  const { signToken } = await import('../../lib/auth.js');
  const user = await prisma.user.create({
    data: { email: testEmail, passwordHash: 'x', fullName: 'AI Tester', role: 'BLIND_USER' },
  });
  token = signToken({ sub: user.id, email: user.email });
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.aIRequestLog.deleteMany({ where: { userId: (await prisma.user.findUnique({ where: { email: testEmail } }))?.id } });
  await prisma.user.deleteMany({ where: { email: testEmail } });
  await prisma.$disconnect();
});

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

const authed = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

describe('POST /api/ai/generate', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await request(app).post('/api/ai/generate').send({ mode: 'navigation', prompt: 'What is ahead?' });
    expect(response.status).toBe(401);
  });

  it('rejects an empty prompt', async () => {
    const response = await authed(request(app).post('/api/ai/generate')).send({ mode: 'navigation', prompt: '' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid mode', async () => {
    const response = await authed(request(app).post('/api/ai/generate')).send({ mode: 'bogus', prompt: 'hi' });
    expect(response.status).toBe(400);
  });

  it('returns a safe unsupported response for emergency mode', async () => {
    const response = await authed(request(app).post('/api/ai/generate')).send({ mode: 'emergency', prompt: 'help' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/SOS/);
  });

  it('rejects a malformed image data URL', async () => {
    const response = await authed(request(app).post('/api/ai/generate')).send({ mode: 'navigation', prompt: 'hi', imageDataUrl: 'not-a-data-url' });
    expect(response.status).toBe(400);
  });

  it('returns a demo response with demo:true when no API key is configured', async () => {
    const response = await authed(request(app).post('/api/ai/generate')).send({ mode: 'navigation', prompt: 'What is ahead?' });
    expect(response.status).toBe(200);
    expect(response.body.demo).toBe(true);
    expect(typeof response.body.summary).toBe('string');
    expect(Array.isArray(response.body.warnings)).toBe(true);
  });

  it('accepts a valid small image payload in demo mode', async () => {
    const response = await authed(request(app).post('/api/ai/generate')).send({ mode: 'reading', prompt: 'read this', imageDataUrl: TINY_JPEG });
    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('reading');
  });

  it('never echoes the image payload back in the response', async () => {
    const response = await authed(request(app).post('/api/ai/generate')).send({ mode: 'reading', prompt: 'read this', imageDataUrl: TINY_JPEG });
    expect(JSON.stringify(response.body)).not.toContain('/9j/4AAQSkZJRg');
  });
});

describe('POST /api/ai/intent', () => {
  it('requires auth', async () => {
    const response = await request(app).post('/api/ai/intent').send({ transcript: 'describe what is ahead' });
    expect(response.status).toBe(401);
  });

  it('rejects an empty transcript', async () => {
    const response = await authed(request(app).post('/api/ai/intent')).send({ transcript: '' });
    expect(response.status).toBe(400);
  });

  it('returns unknown when no AI key is configured (deterministic router handles safety)', async () => {
    // GEMINI_API_KEY is deleted in this test file, so the endpoint must
    // gracefully return "unknown" and never fail or expose a key.
    const response = await authed(request(app).post('/api/ai/intent')).send({ transcript: 'please tell me what you can see' });
    expect(response.status).toBe(200);
    expect(response.body.intent).toBe('unknown');
  });

  it('never allows safety-critical intents from the AI path', async () => {
    // Even if the model tried, the allow-list must reject emergency/cancel.
    const response = await authed(request(app).post('/api/ai/intent')).send({ transcript: 'emergency' });
    // Without a key it returns unknown; with a key the allow-list still blocks
    // safety-critical intents. Either way the AI path never returns "emergency".
    expect(response.status).toBe(200);
    expect(response.body.intent).not.toBe('emergency');
  });

  it('includes shopping in the safe allow-list but never cancel/safety intents', async () => {
    // The shopping intent is in SAFE_AI_INTENTS; emergency-class intents are not.
    const { SAFE_AI_INTENTS } = await import('../../routes/ai') as unknown as { SAFE_AI_INTENTS: string[] };
    expect(SAFE_AI_INTENTS).toContain('shopping');
    expect(SAFE_AI_INTENTS).not.toContain('emergency');
    expect(SAFE_AI_INTENTS).not.toContain('cancel_emergency');
    expect(SAFE_AI_INTENTS).not.toContain('send_location');
  });
});
