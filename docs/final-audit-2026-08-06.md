# Watchora Final Audit — 2026-08-06

Comprehensive audit + test pass over the complete, merged, single-branch
(`main`) project. All checks executed against the live production site
(https://watchora.ramagiritharun.in, Dokploy/Docker Swarm on the VPS) with
headless Chromium, plus full static/test suites. **Result: PASS** with two
findings fixed during the pass.

## 1. Static & dependency audit

| Check | Result |
|---|---|
| `npm audit` (root) | 0 vulnerabilities |
| `npm audit` (server) | 0 vulnerabilities |
| Frontend build (`tsc -b && vite build`) | clean |
| Server build (`tsc -p tsconfig.json`) | clean |
| Frontend tests (`npm test`) | 67/67 (5 files: navigation coach, spatial audio, permission service, command router, negative safety tests) |
| Backend tests (`cd server && vitest run`) | 66/66 (8 files) |

**Finding fixed:** 5 npm advisories (vite high GHSA-fx2h-pf6j-xcff, vitest
critical GHSA-5xrq-8626-4rwp, esbuild/vite-node/@vitest/mocker moderate) —
all dev-toolchain only (never in the production image). Upgraded root to
vite 8.2.1 + vitest 4.1.10, server to vitest 4.1.10. Both suites + builds
verified green after upgrade.

## 2. Live security audit

Headers on every response (verified via curl):

- `Content-Security-Policy`: `default-src 'self'`; script-src with
  `'wasm-unsafe-eval'` (YOLO WASM); `connect-src` includes
  `tiles.openfreemap.org`; `worker-src 'self' blob:`; `media-src 'self' blob:`
  (TTS); `object-src 'none'`; `frame-ancestors 'self'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: geolocation=(self), camera=(self), microphone=(self), notifications=(self), vibrate=(self)` — **added this pass** (helmet v8 removed the option; set directly)

App-level protections verified live:

- **Anti-privilege-escalation:** public signup with `role=ADMIN` → 400
  (signup accepts only BLIND_USER/CAREGIVER; first user becomes admin)
- **Consent-gated location:** caregiver gets `{consent:true, journey, trail}`
  only when both `canSeeLocation` + journey `shareLive` are true; unrelated
  user → `{consent:false, journey:null}` (uniform shape, no leak)
- **Role gates:** blind user → caregiver overview 403, admin stats 403
- **API surface:** empty POST → 400, bad login → 401, no-auth → 401,
  rate limiter active (429 observed during testing)

## 3. Live browser audit — every tab

| Surface | Result |
|---|---|
| Landing (logged out) | hero renders, sign-in dialog has email+password, 0 console errors |
| Dashboard (voice-first) | 4 primary cards |
| Safe Journey | MapLibre canvas + live marker |
| Assist | camera controls render |
| Places | saved place renders |
| SOS | trigger renders |
| Community | incident report renders |
| Settings | Test voice button renders |
| Caregiver | overview lists blind user; Live location map + marker |
| Admin | operations panel renders (heading + content) |
| OpenFreeMap tiles | 4/4 ok, 0 failures |
| Console/page errors | 0 across all surfaces |

## 4. Accessibility audit (headless)

- Landmarks: `main` present, 2 `nav` landmarks
- First Tab lands on `.skip-link` (proper focus entry)
- 0 buttons without accessible names; 0 images without `alt`
- Onboarding/dashboard flows already use ARIA live regions + role=alert
  (verified in prior passes; documented in docs/accessibility-testing.md)

**Outstanding (hardware-dependent, cannot run here):** real screen-reader
pass (TalkBack), real mobile-device smoke test, real performance
measurement. Documented in docs/release-notes-v0.6.md.

## 5. PWA / offline audit

- Manifest valid: name, start_url `/`, display standalone, icons (any +
  maskable)
- **Finding fixed:** manifest + `<meta theme-color>` were still pre-Wispr
  Flow blue (`#0f5bd8` / `#eef3f8`); updated to Wispr Flow ink `#1a1a1a` and
  cream `#ffffeb` so installed-PWA chrome matches the app
- Service worker registered; offline reload boots the app from SW cache
  (2880 chars of app HTML rendered offline)

## 6. Data hygiene

**Finding fixed:** the production database had accumulated 41 test users
(`*-e2e-*`, `audit-*`, `vf-*`, `map-*`, `final-*`, `ocr-*`) because earlier
E2E cleanup scripts targeted the local test DB while signups hit the live
API. All purged (cascade removed related rows); verified 0 test users remain.
Future audit scripts run SQL against the production postgres container via
stdin.

## Summary

- **0 vulnerabilities**, **133/133 tests** (67 frontend + 66 backend), both
  builds clean
- **All live surfaces** verified with 0 console/page/network errors
- **2 findings fixed + deployed:** Permissions-Policy header, Wispr Flow PWA
  theme colors (commit `0d101dc`)
- **Data hygiene:** prod DB cleaned of test users
- Single `main` branch; all three repos (VPS work copy, GitHub, live Dokploy
  dir, local Mac) at `0d101dc`

Remaining work is exclusively hardware-dependent (real screen reader, real
mobile devices, real performance measurement).
