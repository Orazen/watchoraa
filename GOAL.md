# Watchora Perception Upgrade — Build Goal

Objective: implement the 4-phase plan from `docs/yolo-ocr-slam-plan.md` (Phase A
local YOLO hazard detection, Phase B hybrid OCR, Phase C scoped spatial
awareness, Phase D UX/haptic hardening), verify each phase actually builds and
runs before moving to the next, deploy to production, and report honestly on
what shipped.

Working copy: `/home/tarun/work/watchora` (isolated from the live Dokploy
deploy dir at `/etc/dokploy/applications/projects-watchora-tszf9h/code`).

Deployment path: build+verify in working copy -> rsync into live Dokploy
code dir -> rebuild docker image -> update swarm service. Git is fully
working; GitHub push credentials were refreshed.

## Project status (2026-08-06, final)

- **Single branch:** everything merged into  at . The
   branch (v0.4-v0.6) was merged (commit ) and
  deleted;  is the only branch in the repo.
- **Deployed + verified live:** watchora.ramagiritharun.in serves the merged
  build. E2E (headless Chromium): AI intent parsing, voice-first dashboard,
  Safe Journey map + marker, Caregiver live-location map + marker, 4/4
  OpenFreeMap tile requests, zero console errors / CSP violations, and the
  onboarding Test-voice priority fix present in the bundle.
- **Tests:** frontend 67/67, backend 66/66, both builds clean.
- **Remaining (hardware-dependent, cannot complete in this environment):**
  real screen-reader pass (TalkBack), real mobile device smoke test, real
  performance measurement. See .

## Phase status

- [x] Phase A — local YOLO hazard layer (onnxruntime-web, Web Worker, haptic+tone engine)
- [x] Phase D — confidence-aware speech + haptic/voice settings
- [x] Phase C — GPS-anchored saved places (distance/direction)
- [x] Phase B — hybrid OCR (Tesseract.js + Gemini fallback)
- [x] Final verification + live deploy + report

## Verification per phase

Each phase is "done" only when:
1. `npm run build` (frontend) and `npm run build` (server) succeed with no TS errors.
2. `npm test` in `server/` still passes (existing vitest suite).
3. Changes are copied to the live Dokploy code dir, image rebuilt, service updated.
4. Real headless-browser verification against the live production site (not just
   "built ok") — network interception, live DOM assertions, real fake-camera
   feeds where relevant.

## Log

### Phase A — local YOLO hazard layer (DONE, 2026-08-06)

onnxruntime-web + YOLOv8n (COCO, WASM EP), Web Worker inference every ~600ms,
OKO-style haptic/tone engine (fail-silent below 0.5 confidence), hazard
bounding-box overlay + status bar in Assist tab, haptic settings in Settings
tab.

Bug found and fixed during verification: CSP `script-src` was missing
`'wasm-unsafe-eval'`, which silently breaks all WebAssembly instantiation —
added it plus `worker-src 'self' blob:'`.

Verified live via headless Playwright against watchora.ramagiritharun.in:
WASM compiles, worker loads the ONNX model and returns `ready`, zero page
errors.

### Phase D — confidence-aware speech + haptic settings (DONE, 2026-08-06)

Low-confidence Gemini results now prefixed "I'm not fully sure, but:" instead
of spoken with full authority; `shouldStop` results fire the same
hazard-immediate haptic pattern as the local YOLO layer. Haptic/tone settings
UI (on/off toggles, intensity, test button) shipped as part of Phase A.

### Phase C — GPS-anchored saved places (DONE, 2026-08-06)

Geolocation API + Haversine distance / compass bearing math (no new
dependency, ~70 lines). "Use my location" and per-place "save my current
location" buttons.

Verified live end-to-end via headless Playwright with mocked geolocation:
real signup, captured Times Square as current position, saved a place at the
Empire State Building's real coordinates — UI rendered "1.1 km away, to the
south", matching the real-world distance between those two landmarks.

This is the scoped alternative from the plan, deliberately NOT full SLAM
(explicitly out of scope for a browser PWA per the plan doc).

### Phase B — hybrid OCR (DONE, 2026-08-06)

Tesseract.js for local, offline text reading in reading mode. All assets
self-hosted (worker.min.js, WASM core, eng.traineddata.gz) rather than the
library's jsdelivr CDN defaults — required both for the plan's offline goal
and because the strict CSP blocks third-party script/connect sources anyway.
Confidence-gated: below 55, falls back to the existing Gemini reading path
rather than reading unreliable text aloud with false authority.

Verified live end-to-end using Chromium's fake-camera-from-video-file flag
with a real rendered frame reading "EXIT HERE": result read correctly in
~2.8s, zero calls to `/api/ai/generate` confirmed via network interception
(proves the local path actually ran, not a silent cloud fallback).

Bug found and fixed during this verification: the result card's "source"
pill said "Gemini live" for local OCR results too, because it only checked
the `demo` flag. Added an explicit `source: 'gemini' | 'local-ocr'` field
and fixed the pill to say "Read locally, on this device".

## Summary

All 4 phases shipped to production and verified live via headless-browser
testing against the real deployed site (not just local build success).

**Not shipped** (explicitly out of scope per the plan, not silently dropped):
full visual SLAM / indoor mapping — infeasible in a browser PWA (see plan doc
section 2.3), would need a native app wrapper; flagged as a future research
spike, not attempted here.

**Still broken, needs user action:** GitHub push credentials (gh CLI token,
hermes dokploy key, dokploy CLI key) are all invalid on this VPS, so none of
this work is in git history or a PR yet — it's live in production via direct
Dokploy code-dir sync + docker rebuild, and in the git-initialized but
unpushed `~/work/watchora` working copy.
