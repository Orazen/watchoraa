import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
process.env.TOKEN_ENCRYPTION_SECRET ||= 'test-token-encryption-secret-16+';

let app: Express;
const testEmail = `vitest-aiprovider-${Date.now()}@example.com`;
let token = '';

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp();
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email: testEmail, password: 'supersecret123', fullName: 'AI Provider Test' });
  token = signup.body.token;
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.user.deleteMany({ where: { email: testEmail } });
  await prisma.$disconnect();
});

function authed(method: 'get' | 'put' | 'delete', url: string) {
  return request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

describe('GET /api/ai-provider', () => {
  it('requires auth', async () => {
    const response = await request(app).get('/api/ai-provider');
    expect(response.status).toBe(401);
  });

  it('returns defaults for a user with no settings', async () => {
    const response = await authed('get', '/api/ai-provider');
    expect(response.status).toBe(200);
    expect(response.body.providerSettings).toEqual({
      provider: 'GEMINI',
      model: null,
      baseUrl: null,
      hasKey: false,
      maskedKey: null,
    });
  });
});

describe('PUT /api/ai-provider', () => {
  it('saves an OpenAI-compatible key and never echoes the plaintext', async () => {
    const response = await authed('put', '/api/ai-provider')
      .send({ provider: 'OPENAI_COMPATIBLE', apiKey: 'sk-test-1234567890abcdef', model: 'llama-3.1-8b-instant', baseUrl: 'https://api.groq.com/v1/' });
    expect(response.status).toBe(200);
    expect(response.body.providerSettings.hasKey).toBe(true);
    expect(response.body.providerSettings.maskedKey).toBe('••••cdef');
    expect(JSON.stringify(response.body)).not.toContain('sk-test-1234567890abcdef');
    // Trailing slash is normalized away.
    expect(response.body.providerSettings.baseUrl).toBe('https://api.groq.com/v1');
  });

  it('rejects a disallowed base URL host', async () => {
    const response = await authed('put', '/api/ai-provider')
      .send({ provider: 'OPENAI_COMPATIBLE', baseUrl: 'https://evil.example.com/v1' });
    expect(response.status).toBe(400);
  });

  it('rejects a non-https base URL for a public host', async () => {
    // http:// is only accepted for private/self-hosted hosts, never public ones.
    const response = await authed('put', '/api/ai-provider')
      .send({ provider: 'OPENAI_COMPATIBLE', baseUrl: 'http://api.openai.com/v1' });
    expect(response.status).toBe(400);
  });

  it('accepts a self-hosted local base URL', async () => {
    const response = await authed('put', '/api/ai-provider')
      .send({ provider: 'OPENAI_COMPATIBLE', baseUrl: 'http://localhost:11434/v1' });
    expect(response.status).toBe(200);
    expect(response.body.providerSettings.baseUrl).toBe('http://localhost:11434/v1');
  });

  it('refuses a custom base URL for Gemini', async () => {
    const response = await authed('put', '/api/ai-provider')
      .send({ provider: 'GEMINI', baseUrl: 'https://api.groq.com/v1' });
    expect(response.status).toBe(400);
  });

  it('removes the key and returns the post-removal settings', async () => {
    const del = await authed('delete', '/api/ai-provider/key');
    expect(del.status).toBe(200);
    expect(del.body.ok).toBe(true);
    expect(del.body.providerSettings.hasKey).toBe(false);
    expect(del.body.providerSettings.maskedKey).toBeNull();
    const get = await authed('get', '/api/ai-provider');
    expect(get.body.providerSettings.hasKey).toBe(false);
    expect(get.body.providerSettings.maskedKey).toBeNull();
  });
});

describe('secret-box roundtrip', async () => {
  const { encryptSecret, decryptSecret, maskSecret } = await import('../../lib/secret-box.js');

  it('decrypts what it encrypts', () => {
    const enc = encryptSecret('my-secret-key-abc123');
    expect(decryptSecret(enc)).toBe('my-secret-key-abc123');
  });

  it('produces different ciphertexts per call (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('masks to the last four characters', () => {
    expect(maskSecret('sk-abcdef123456')).toBe('••••3456');
    expect(maskSecret('abc')).toBe('••••');
  });
});
