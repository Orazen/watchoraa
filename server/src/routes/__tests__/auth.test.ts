import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.DATABASE_URL ||= 'postgresql://suhasitarani@localhost:5432/blindnav';
process.env.CORS_ORIGIN ||= 'http://127.0.0.1:4173';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

let app: Express;
const testEmail = `vitest-${Date.now()}@example.com`;

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp();
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.user.deleteMany({ where: { email: testEmail } });
  await prisma.$disconnect();
});

describe('POST /api/auth/signup', () => {
  it('rejects a short password', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ email: testEmail, password: 'short', fullName: 'Test' });
    expect(response.status).toBe(400);
  });

  it('creates a user and returns a token', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ email: testEmail, password: 'supersecret123', fullName: 'Test User' });
    expect(response.status).toBe(201);
    expect(response.body.token).toBeTypeOf('string');
    expect(response.body.user.email).toBe(testEmail);
    expect(response.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email', async () => {
    const response = await request(app)
      .post('/api/auth/signup')
      .send({ email: testEmail, password: 'supersecret123', fullName: 'Test User' });
    expect(response.status).toBe(409);
  });
});

describe('POST /api/auth/login', () => {
  it('rejects a wrong password', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: testEmail, password: 'wrongpassword' });
    expect(response.status).toBe(401);
  });

  it('logs in with correct credentials', async () => {
    const response = await request(app).post('/api/auth/login').send({ email: testEmail, password: 'supersecret123' });
    expect(response.status).toBe(200);
    expect(response.body.token).toBeTypeOf('string');
  });
});

describe('protected routes', () => {
  it('rejects requests without a token', async () => {
    const response = await request(app).get('/api/contacts');
    expect(response.status).toBe(401);
  });

  it('rejects requests with a malformed token', async () => {
    const response = await request(app).get('/api/contacts').set('Authorization', 'Bearer not-a-real-token');
    expect(response.status).toBe(401);
  });

  it('accepts requests with a valid token', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: testEmail, password: 'supersecret123' });
    const response = await request(app).get('/api/contacts').set('Authorization', `Bearer ${login.body.token}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.contacts)).toBe(true);
  });

  it('rejects a valid token for a deactivated account', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: testEmail, password: 'supersecret123' });
    const token = login.body.token as string;

    const { prisma } = await import('../../lib/prisma.js');
    await prisma.user.update({ where: { email: testEmail }, data: { isActive: false } });

    const response = await request(app).get('/api/contacts').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);

    // restore so subsequent test runs / afterAll cleanup aren't affected
    await prisma.user.update({ where: { email: testEmail }, data: { isActive: true } });
  });
});
