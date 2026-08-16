# Watchora MVP — 2026-08-06 (v0.2.0)

Watchora is a browser-based assistive app that turns a phone camera into a spoken
second pair of eyes for blind and low-vision users. This is the **MVP release**:
every core loop works end to end, is deployed at https://watchora.ramagiritharun.in,
and is verified with automated tests (43/43 server tests) plus live headless-browser
checks against the production site.

## The four core loops

1. **Assist — camera-to-voice AI.** Point the camera, pick a mode (navigation,
   environment, reading, assistant), get a spoken description from Gemini with
   structured safety output (summary / details / warnings / confidence /
   shouldStop). Server-side proxying only — the Gemini key never reaches the
   frontend. Without a key, responses are honestly labeled as demo, never faked.
2. **Local hazard layer (YOLO).** Real-time object detection runs **on-device**
   (onnxruntime-web + YOLOv8n in a Web Worker), independent of the cloud. OKO-style
   haptic/tone alerts: intensity = confidence, tempo = urgency, **silence when
   uncertain**. Sub-second, offline-capable, camera frames never leave the device.
3. **Reading — hybrid OCR.** Local Tesseract.js reads signs/labels/documents in
   seconds, fully self-hosted and offline. Confidence-gated: below threshold it
   falls back to the Gemini reading path instead of reading garbled text aloud.
4. **Spatial awareness — GPS-anchored places.** Saved places carry real
   coordinates; the app speaks live distance and compass direction from where you
   are. (Deliberately scoped to GPS rather than full SLAM — see docs/yolo-ocr-slam-plan.md.)

## Accounts, safety, and trust

- **Real accounts**: email/password with bcrypt, JWT + refresh rotation, password
  reset, first signup bootstraps an admin. No seeded data anywhere.
- **SOS**: a deterministic request log, explicitly separate from AI scene analysis.
  Trusted contacts + caregiver portal let a caregiver see open SOS and journeys of
  the people who listed them.
- **Community hazard reports** shared across signed-in users, with admin moderation.
- **Safety posture**: rate limits, image size caps, in-memory-only image handling,
  audit trail on sensitive actions, strict CSP, prompt versioning, confidence-aware
  speech ("I'm not fully sure, but…"), fail-silent haptics, and a landing page that
  explains the safety model.
- **Offline**: the service worker caches the app shell plus all ML assets, so after
  first load, hazard detection and reading keep working with no network.

## Front door

The landing page is the logged-out index route, themed to match the dashboard
(same design system: Fraunces + IBM Plex Sans, panel/pill/button classes). First
signup runs a **voice-first onboarding**: camera permission education, voice speed
calibration, and hazard-alert feedback test.

## Run it locally

```bash
# backend
cd server && npm install && npx prisma migrate dev && npm run dev
# frontend (second terminal)
npm install && npm run dev
```

Production deploy is a single Docker image (Express serves the built SPA + API);
Dokploy builds and updates the swarm service from the repo.

## Verified

- `cd server && npm test` → 43/43 pass (auth, refresh rotation, AI provider,
  prompts, caregiver RBAC, moderation, audit, prefs, routes).
- Frontend + server `npm run build` green.
- Live checks: landing at `/`, signup → onboarding → dashboard, YOLO worker loads
  and detects, OCR reads real rendered text offline (zero cloud calls confirmed),
  GPS distance/direction matches real-world geometry, all dashboard tabs render
  with zero console errors.

## Known MVP boundaries (honest)

- Password-reset emails are dev tokens until an SMTP provider is configured (the
  reset flow itself works; the mail transport is stubbed).
- Camera/mic require a secure origin — HTTPS (deployed) or localhost (dev).
- COCO YOLO does not detect stairs/curbs out of the box (documented gap).
- Full indoor SLAM is out of scope for a PWA; GPS + relative positioning is the
  MVP spatial layer.
