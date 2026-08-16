# Release Notes — v0.6 (Release-Readiness Audit)

**Branch:** `voice-first-pwa`
**Status:** Feature-complete, release-readiness audit performed. See
"Recommendation" at the end before merging.

## Summary of v0.4 → v0.6

### v0.4 — Voice-First PWA foundation
- Guided permission onboarding (audio test → mic → camera → location →
  notifications → motion, each with a skip fallback)
- Central voice assistant (single coordinated service: mic lifecycle, speech
  recognition, push-to-talk, confirmation, error recovery)
- Deterministic command router — safety commands match locally before any AI
  is consulted
- Voice-first accessible dashboard with persistent "Talk to Watchora" button
- Permission Centre (full status + re-request, reachable from onboarding,
  dashboard, Settings, voice command)
- Emergency hold-to-activate control

### v0.5 — Navigation Coach + offline hardening
- Deterministic Navigation Coach: SPOTTED → TRACKING → PASSING → CLEARED
  obstacle lifecycle, directional language + clock positions, obstacle
  chaining, silence breaker, adaptive frame rate (0.5/1.5/2.5 FPS by motion)
- Shopping mode (deterministic command routing + allow-listed AI fallback)
- Barge-in (talking stops current speech immediately)
- Offline-first hardening: service worker precaches the full bundle + lazy
  chunks at install (previously only the shell HTML was cached), fixed a
  `Vary: Origin` cache-matching bug, added a cached-user session fallback so
  offline reload no longer logs users out

### v0.6 — People awareness, ground-level hazards, motion cadence
- People awareness: distinct, neutral phrasing for `person` detections
  ("Person approaching...", never judgmental language) — verified by an
  automated regex test asserting absence of danger/threat/suspicious/
  police/report language
- Ground-level trip-hazard language ("Watch your step...") for objects in the
  lower 25% of frame
- Opt-in motion cadence: accelerometer-derived motion level only activates
  after the user explicitly grants the Motion permission; defaults to the
  conservative stationary cadence otherwise

### Release-readiness audit (this pass, 2026-08-06)
- Ran and documented the full 25-step manual QA flow (automated via
  Playwright against a production build) — 25/25 steps completed
- Denied-permission path testing — 10/10 checks pass, no unusable loops
- Offline audit — 13/13 checks pass (first-visit-online, reload-offline,
  network-returns scenarios)
- SOS hold-to-activate audit — 5/5 checks pass (countdown, cancel-on-release,
  full-hold activation)
- Voice command ground-truth matrix produced (`docs/voice-command-reference.md`)
  with negative tests for phrases that must not accidentally trigger
  emergency — one honest limitation documented (substring matching on
  "emergency" — safe-fail-mode by design, still requires confirmation)
- Navigation Coach safety audit — 24 existing unit tests re-verified, plus
  new negative-test coverage
- Security/privacy review — zero npm vulnerabilities (frontend + backend), no
  API keys/tokens in the bundle or logs, camera frames only sent on explicit
  user action, SOS payload correctly scoped to authorized trusted contacts,
  logout clears all local session state
- 24 release screenshots captured (12 mobile + 12 desktop) covering every
  required screen state
- **7 new automated tests added** (negative-test suite for voice command
  safety) — total test count: see below

## Architecture changes this pass
None from this audit. Note: the working tree contains in-progress, uncommitted
work from a concurrent session (a Caregiver live-location `MapView` feature
using `maplibre-gl`) that this audit does not own, review, or commit — see
`docs/audit-2026-08-06.md` "Build environment note" for how the local build
was kept unblocked without disturbing that work.

## Database / API changes this pass
None.

## Test totals

- Frontend: **67/67** passing (5 test files: navigation coach 17, spatial
  audio 7, permission service 8, command router 28, negative safety tests 7
  — the 7 negative tests are new this audit). Earlier session documents cited
  "121/121"; that figure conflated a root-level `vitest run` invocation which
  picks up both frontend AND backend test files at once. This is the
  corrected, isolated frontend-only count.
- Backend: **65/65** passing (8 test files). Includes 4 tests added by a
  concurrent session's work on this branch (Caregiver live-location feature),
  not part of this audit's own changes.
- Build: clean (`tsc -b && vite build`)
- Server typecheck: clean

## Manual QA result
25/25 steps completed. See `docs/manual-qa-v0.6.md` for the full record,
including 2 steps marked hardware-required (real speech recognition with a
live microphone, audible TTS confirmation) that could not be completed in this
headless environment.

## Accessibility result
Automated structural checks pass (ARIA roles, live regions, focus management,
labeled controls, keyboard reachability). **A real screen-reader hardware pass
(TalkBack/VoiceOver) was not completed** — this is the largest open item
before this branch should be considered fully accessibility-verified. See
`docs/accessibility-testing.md`.

## Browser support
Desktop Chrome and keyboard-only navigation tested this session. Android
Chrome, Android installed-PWA mode, iPhone Safari, iPhone Home-Screen PWA, and
Samsung Internet all require real hardware not available in this environment
— see `docs/browser-support.md` for the honest capability matrix and
documented fallback behavior for every gap.

## Screenshots
`docs/screenshots/v0.6/mobile/` and `docs/screenshots/v0.6/desktop/` — 12 each,
covering landing, Start Watchora, permission onboarding, dashboard, voice
assistant state, Navigation Coach active, Safe Journey, emergency countdown,
emergency active, Permission Centre, Settings, and offline state.

## Security/privacy audit result
- 0 npm vulnerabilities (frontend `npm audit --production`, backend
  `npm audit --production`)
- No API keys, tokens, or camera frames found in the built frontend bundle or
  console logs
- Camera frames only sent to the cloud AI on explicit "Capture & analyze"
  button click (verified by code read — no automatic/interval/mount-time call)
- SOS/emergency payloads scoped via `prisma.trustedContact` queries filtered
  by the requesting user (server-side authorization, existing tests in
  `safe-journey-emergency.test.ts`)
- Logout clears token, refresh token, and cached user profile
  (`clearSession()`, `src/api.ts`)
- `.env` is gitignored; no secrets found in git history for `.env` files
- Service worker never intercepts `/api/*` requests (explicit origin check in
  `public/sw.js`), so it cannot accidentally cache private API responses

## Known limitations (honestly stated)
- No offline write-queue: mutating API calls (SOS, journey actions, save
  place) made while offline are not automatically retried when connectivity
  returns — the user sees the failure and must retry manually. See
  `docs/offline-behaviour.md`.
- No "connection restored" announcement when coming back online.
- Deterministic router's "emergency" substring match will also match phrases
  like "emergency contact" or "emergency exit" — documented safe-fail-mode
  trade-off, always requires spoken confirmation before acting.
- No real screen-reader hardware pass completed.
- No real mobile device testing (Android/iOS) completed.
- No performance measurements on real mobile hardware (see
  `docs/audit-2026-08-06.md` performance section — not claimed without
  real-hardware measurement).

## Rollback considerations
This branch has not touched `main`. If merged and a regression is found
post-merge:
- The Navigation Coach, people-awareness, and ground-level hazard logic are
  entirely additive and gated behind explicit coach-mode activation
  (`coachMode !== 'off'`) — disabling coach mode via the UI immediately stops
  all new v0.5/v0.6 announcement behavior without a deploy.
- The offline-first SW changes (v0.5) are backward compatible: a `CACHE_NAME`
  bump (`watchora-shell-v3`) means old cached content is automatically
  evicted on the next SW activation, so a rollback deploy will self-heal
  within one SW update cycle.
- No destructive database migrations were introduced in v0.4-v0.6 (only the
  existing v0.3 `safe_journey_and_emergency` migration, already on `main`'s
  lineage per the migration history).
- If a rollback is needed, reverting the `voice-first-pwa` merge commit is
  sufficient; no data backfill or migration-down step is required.

## Native Android follow-up work (deferred, not started this session per instructions)
- Native Android wrapper for guaranteed background journey monitoring and
  background camera/location access (PWA background execution is not
  guaranteed on any browser — documented limitation, not a bug)
- Bidirectional premium streaming (Gemini Live-class continuous narration) as
  an optional layer over the deterministic safety core
- Turn-triggered route re-scanning via gyroscope heading deltas
- People-awareness extended to per-person tracking across frames (currently
  per-detection, not per-individual)
- Route memory (remembered walks + known hazards)
- Community hazard map with severity weighting
- Group journeys
- Offline write-queue with retry policy for mutating API calls

## Recommendation

**Status: MERGED into `main` on 2026-08-06 (commit `dea157a`).** The
`voice-first-pwa` branch was subsequently deleted; `main` is now the only
branch. Feature-complete through v0.6 plus the Caregiver live-location map
(MapLibre + OpenFreeMap, consent-gated).

Post-merge verification (all green):
- Frontend `npm test` — 67/67 passing
- Backend `cd server && npm test` — 66/66 passing (8 test files, includes
  the location-consent tests from main)
- Frontend + server builds and typechecks clean
- Live E2E on watchora.ramagiritharun.in (headless Chromium): AI intent
  parsing (`start_safe_journey`), voice-first dashboard renders, Safe Journey
  map + marker, Caregiver live-location map + marker, 4/4 OpenFreeMap tile
  requests OK, zero console errors / CSP violations.

Remaining outstanding (hardware-dependent, cannot be completed in this
environment):
1. Real screen-reader hardware pass (TalkBack on Android Chrome minimum) —
   see `docs/accessibility-testing.md`
2. Real mobile device smoke test (Android Chrome + one iOS Safari session) —
   see `docs/browser-support.md`
3. Real-hardware performance measurement

Everything achievable via automated testing has been done and passes
cleanly.
