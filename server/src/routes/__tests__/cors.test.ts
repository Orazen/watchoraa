import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// No database is touched: every case here is a CORS preflight, which the cors
// middleware answers before any route or Prisma client is reached. That is the
// point — this file must be runnable in a bare CI job.
process.env.DATABASE_URL ||= 'postgresql://cors@localhost:5432/blindnav';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';

// The configured web origin, whatever the environment says. Hard-coding one
// here is wrong: CI exports CORS_ORIGIN=http://127.0.0.1:4173, so `||=` never
// takes effect and a literal would test a host the server was never told about.
const WEB_ORIGIN = (process.env.CORS_ORIGIN ||= 'https://watchora.ramagiritharun.in')
  .split(',')[0]
  .trim();

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../../app.js');
  app = createApp();
});

afterAll(async () => {
  const { prisma } = await import('../../lib/prisma.js');
  await prisma.$disconnect();
});

/** Preflight a route the way the native app's webview would. */
function preflight(origin: string, path = '/api/auth/login', method = 'POST') {
  return request(app)
    .options(path)
    .set('Origin', origin)
    .set('Access-Control-Request-Method', method);
}

describe('CORS for the native app', () => {
  // The website is same-origin with the API, so it never exercises CORS and
  // never caught this. The Tauri app always does: its webview runs on an asset
  // origin, so every request it makes is cross-origin. Without these the app
  // fails as though the server were down — sign-in does nothing and the mascot
  // has nothing to describe.
  it.each([
    ['macOS and Linux', 'tauri://localhost'],
    ['Windows and Android', 'https://tauri.localhost'],
  ])('allows the %s webview origin', async (_label, origin) => {
    const res = await preflight(origin);
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('allows the configured web origin', async () => {
    const res = await preflight(WEB_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });

  it('allows the native origin on the media routes the mascot depends on', async () => {
    // TTS is the app's PRIMARY speech path. If its preflight is refused the app
    // still looks alive but goes silent, which for a blind user is the worst
    // possible failure: no error, just no voice.
    for (const path of ['/api/tts/audio', '/api/stt/transcribe']) {
      const res = await preflight('tauri://localhost', path, 'GET');
      expect(res.status, `${path} preflight`).toBe(204);
      expect(res.headers['access-control-allow-origin'], `${path} origin header`).toBe('tauri://localhost');
    }
  });

  it('does NOT open CORS to an arbitrary site', async () => {
    // The allowlist is the whole security boundary here. `origin: true` would
    // reflect any origin and hand every visitor's tokens to a phishing page.
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('keeps credentials enabled for allowed origins', async () => {
    // The auth token is sent as a credentialed request; without this header the
    // browser discards the response even when the origin is allowed.
    const res = await preflight('tauri://localhost');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});
