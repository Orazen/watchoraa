import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { apiRouter } from './routes/index.js';
import { corsOrigins } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, '../public-web');

export function createApp() {
  const app = express();

  // Deployed behind exactly one reverse proxy (Traefik/Dokploy). Without this,
  // express-rate-limit and req.ip see the proxy's address for every request,
  // collapsing per-client rate limits into one shared global bucket.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // 'wasm-unsafe-eval' is required for WebAssembly.instantiate — the local
          // YOLO hazard-detection worker (onnxruntime-web, Phase A) runs entirely
          // client-side via WASM and is silently blocked without this directive.
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          // OpenFreeMap serves the map style JSON, sprite/glyph assets, and
          // vector tiles for the Safe Journey / Caregiver live-location map
          // (MapLibre GL JS). Free, no API key, MIT-licensed — same
          // zero-paid-key approach already used for onnxruntime-web/Tesseract.
          connectSrc: ["'self'", 'https://tiles.openfreemap.org'],
          // Web Workers load their JS bundle as a same-origin blob/module URL.
          workerSrc: ["'self'", 'blob:'],
          // Neural TTS audio (server/src/routes/tts.ts) is played from a
          // blob: object URL created from the fetched MP3 — defaultSrc alone
          // does not cover <audio>/<video> loads, so without an explicit
          // mediaSrc the browser silently blocks playback with a CSP error
          // and Settings > Test voice (and every spoken response) fails.
          mediaSrc: ["'self'", 'blob:'],
        },
      },
    }),
  );
  // Only this origin may use the powerful browser APIs the app needs —
  // camera (Assist), microphone (voice assistant / speech input),
  // geolocation (Safe Journey / maps), notifications (SOS alerts),
  // vibration (haptic warnings). Helmet v8 removed the permissionsPolicy
  // option (recommends setting Permissions-Policy at the proxy), so set the
  // header directly.
  app.use((_request, response, next) => {
    response.setHeader(
      'Permissions-Policy',
      "geolocation=(self), camera=(self), microphone=(self), notifications=(self), vibrate=(self)",
    );
    next();
  });
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(pinoHttp());

  app.get('/healthz', (_request, response) => response.json({ ok: true }));
  app.get('/api/healthz', (_request, response) => response.json({ ok: true }));
  app.use('/api', apiRouter);

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (request, response, next) => {
      if (request.path.startsWith('/api')) {
        next();
        return;
      }
      response.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal server error';
    response.status(500).json({ error: message });
  });

  return app;
}
