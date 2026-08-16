# Watchora Audit — 2026-08-06

Scope: full code review of the watchora repo (`/Users/ramagiritharun/Desktop/watchora`)
against its own roadmap (`docs/blindnav-roadmap.md`), the prior audit
(`docs/blindnav-audit.md`), and production-readiness for an assistive/safety app.

## Third pass (2026-08-06) — high-quality neural voices for blind users

**Problem:** the app only used the browser's built-in `speechSynthesis` with a
3-language toggle. On most Android/Chrome devices those voices are robotic —
unacceptable for a voice-first app for blind people.

**Fix (researched + integrated):** free, no-key **Microsoft Edge neural TTS**
(edge-tts) — 400+ neural voices across ~140 locales including every major
Indian language, the same voices Edge's Read Aloud uses. Direct integration, no
third-party TTS dependency:

- `server/src/services/tts/edge-tts.ts` — WebSocket client for the free Edge
  endpoint. Implements the `Sec-MS-GEC` signed token exactly like the
  maintained python `edge-tts` (rany2/edge-tts, MIT): SHA-256 of the 5-min
  Windows-FILETIME window + trusted client token. Includes clock-skew
  correction from the server `Date` header (403 → adjust → retry), sentence-
  bounded chunking for long text, SSML rate/pitch/volume control.
- `server/src/services/tts/voices.ts` — curated catalog (32 languages, every
  major Indian language, male+female per language) merged with the live
  300+ voice list (cached 1h, offline fallback).
- `server/src/routes/tts.ts` — `GET /api/tts/voices` (auth) + `GET /api/tts/audio`
  (auth, rate-limited 30/min) returning `audio/mpeg`. Fails with a clear 502
  so the client falls back to the on-device voice.
- Frontend: `speak()` now plays the neural audio via `<audio>` (object URL,
  cancellation-safe with a speak-sequence guard) and **falls back to the
  browser voice** when the service is down. Settings has a real **voice picker
  grouped by language** (e.g. हिन्दी, தமிழ், తెలుగు, বাংলা, ગુજરાતી, मराठी,
  اردو, English IN/UK/US/AU, Vietnamese, Spanish…), voice + speed persisted to
  `AccessibilityPrefs.voiceName`/`speechRate`.
- Tests: `src/services/tts/__tests__/tts.test.ts` — GEC determinism/window
  change, chunking, Indian-language catalog coverage, locale parsing.
  **51/51 tests pass.**

**Verified live** (fresh DB, real browser): voices endpoint returns 323 voices
across 138 language groups; Hindi/Tamil present; selecting a Hindi voice and
pressing "Test voice" produced a valid 48kbps MP3 (200 audio/mpeg, zero
console errors); preference persisted (`voiceName: hi-IN-SwaraNeural`); direct
synthesis of mixed English+Devanagari text returned a valid MPEG ADTS file.

**Notes:** the endpoint is Microsoft's free consumer service (same as Edge
Read Aloud) — no key, no quota, but not an official paid SLA. The client-side
fallback to `speechSynthesis` covers outages. `ws` is the only new runtime
dependency.


## What exists and works (verified)

- React + TS + Vite frontend, Express + Prisma + Postgres backend, PWA shell.
- Real auth (bcrypt cost 12, JWT 30d, `requireAuth`/`optionalAuth`/`requireAdmin`).
- Server-side Gemini proxy with strict JSON contract, prompt safety rules
  (no "definitely safe" claims, no road-crossing instruction, no exact distance),
  demo fallback that is honestly labeled, image size/mime limits, rate limits,
  in-memory image handling (never persisted), AI request logging with redaction.
- CRUD for contacts/places/incidents/assistance, admin (users/incidents/
  assistance/ai-stats), CSP + helmet + trust-proxy + rate limits.
- Single-domain Docker deploy (Express serves the built SPA).
- **26/26 tests pass; frontend build + server build + typecheck all green.**

## Gaps found (severity-ranked)

### 1. Six schema models are dead — zero API routes (roadmap Phase 2/3/4)
`AccessibilityPrefs`, `AuditLog`, `PromptVersion`, `ConsentGrant`, `Journey`,
`ReadingEntry` are defined in `prisma/schema.prisma` but **no route reads or
writes any of them** (verified by grep: 0 references in `server/src`).
Consequences:
- Preferences are lost on every reload (frontend keeps voice rate / language /
  theme in React state only — no localStorage, no API).
- Reading history, journeys, consent grants, and audit logs are never recorded.
- Prompt versioning (a planned safety feature) is unimplemented.

### 2. SOS does not notify anyone (core promise unfulfilled)
`POST /api/assistance` writes a row with `status: SENT` but there is no email /
SMS / push to the trusted contact, and there is **no caregiver portal** — the
`CAREGIVER` role exists at signup but has no UI or API surface. The UI copy says
"records an emergency request for your trusted contacts to see" — contacts
cannot actually see it.

### 3. AI endpoint is unauthenticated
`/api/ai/generate` uses `optionalAuth` — any client (no account) can burn the
Gemini quota; only the 20/min-per-IP rate limit applies. The app is account-
first, so gating AI behind auth is the roadmap direction (`blindnav-audit.md`:
"Introduce account and role-based access control" first).

### 4. `requireAdmin` has an unhandled-rejection bug
`requireAdmin` reuses `requireAuth`'s `next`-based flow, passing an **async**
callback. `requireAuth` calls `next()` inside `.then()` without chaining the
returned promise, so a DB rejection inside the admin check becomes an unhandled
promise rejection (can crash a Node process under Express 4).

### 5. No first-admin bootstrap
`make-admin.ts` requires exec into the container. A fresh Dokploy deploy has no
admin until someone does that manually.

### 6. No audit trail on sensitive actions
The `AuditLog` model exists but nothing writes it. Login, signup, role changes,
account deactivation, incident deletion, and SOS events are unrecorded — a
safety/compliance gap for an app handling camera data and emergency requests.

### 7. No password reset / token rotation
Known limitation in the README, unchanged. 30-day JWTs with no refresh path.

### 8. Repo hygiene
`.claude-flow/` harness state (agent stats/policy JSON) is committed to git and
dirty. Should be gitignored and untracked.

### 9. Test coverage is narrow
Only `ai` + `auth` are tested. Contacts/places/incidents/assistance/admin
authorization, ownership checks, and the new routes need tests (roadmap Phase 7).

## Fixes implemented this pass (committed)

| # | Fix | Files |
|---|---|---|
| 1 | Gitignore + untrack `.claude-flow/` | `.gitignore`, `git rm --cached` |
| 2 | `GET/PUT /api/preferences` (AccessibilityPrefs) + frontend persistence of voice rate / language / theme | `server/src/routes/preferences.ts`, `server/src/routes/index.ts`, `src/App.tsx` |
| 3 | `GET/POST/DELETE /api/reading-entries` + "Save to history" on reading results + history list in Settings | `server/src/routes/reading-entries.ts`, `src/App.tsx` |
| 4 | `GET/POST/DELETE /api/consents` (ConsentGrant) + record `LOCATION_SHARING` consent on SOS | `server/src/routes/consents.ts`, `src/App.tsx` |
| 5 | `GET/POST /api/journeys` + record a journey on successful navigation analysis | `server/src/routes/journeys.ts`, `src/App.tsx` |
| 6 | `lib/audit.ts` writer + admin `GET /api/audit-logs` + audit entries on signup/login/role-change/deactivate/incident-delete/SOS create+resolve | `server/src/lib/audit.ts`, `server/src/routes/audit.ts`, `auth.ts`, `admin.ts`, `assistance.ts`, `incidents.ts` |
| 7 | Fix `requireAdmin` unhandled-rejection bug (own token+role check) | `server/src/lib/auth.ts` |
| 8 | First signup becomes ADMIN when the user table is empty (fresh-install bootstrap) | `server/src/routes/auth.ts` |
| 9 | Tests for preferences, reading-entries, consents, journeys, audit visibility, admin authz | `server/src/routes/__tests__/` |

## Second pass (2026-08-06) — refresh/reset, AI gating, caregiver portal, prompts, moderation

| # | Fix | Files |
|---|---|---|
| 10 | **JWT refresh-token rotation**: `PasswordReset` + `RefreshToken` models; signup/login issue `refreshToken`; `POST /api/auth/refresh` rotates (old token revoked, replay → 401); `POST /api/auth/logout` revokes; password change revokes all sessions. `requireAuth` now type-checks access vs refresh tokens. jti nonce prevents same-second hash collisions. | `schema.prisma`, `lib/auth.ts`, `routes/auth.ts`, migration `auth_refresh_and_reset` |
| 11 | **Password reset flow**: `POST /api/auth/forgot-password` (anti-enumeration; dev token returned when no SMTP) + `POST /api/auth/reset-password` (single-use, expires 1h, bcrypt, revokes sessions) + frontend Forgot/Reset UI. | `routes/auth.ts`, `src/App.tsx` |
| 12 | **AI endpoint account-gated**: `/api/ai/generate` now requires auth (roadmap RBAC first). | `routes/ai.ts`, tests updated |
| 13 | **Prompt versioning**: admin `GET/POST /api/admin/prompts` + `POST /:id/activate`; `/api/ai/generate` uses the active prompt per mode (falls back to built-in); version recorded in AI request logs + UI (Admin → Prompts). | `routes/admin.ts`, `routes/ai.ts`, `src/App.tsx` |
| 14 | **Caregiver portal**: `GET /api/caregiver/overview` — a CAREGIVER sees the users who listed them as a trusted contact (by email), their open SOS, recent journeys, saved places; read-only. Frontend Caregiver tab. | `routes/caregiver.ts`, `routes/index.ts`, `src/App.tsx` |
| 15 | **Community moderation**: public feed hides `REMOVED`; reporter can delete their own report; admin `PATCH /api/admin/incidents/:id/status` (OPEN/REVIEWED/REMOVED). | `routes/incidents.ts`, `routes/admin.ts`, `src/App.tsx` |
| 16 | Frontend session handling: `setSession` stores access+refresh; `request()` auto-refreshes once on 401; logout revokes server-side. | `src/api.ts`, `src/App.tsx` |

**Verification (second pass):** 43/43 tests (new: refresh rotation + replay rejection, reset single-use, caregiver overview + role gating, prompt create/activate + admin-only, incident moderation + self-delete, AI auth-gated), server + frontend typecheck/build green, live smoke on a fresh scratch DB: first-signup admin bootstrap, refresh replay → 401, reset invalidates old password, caregiver overview lists the trusted user + open SOS, AI 401 without token / 200 with, prompt activate → 200, incident created + moderated.

## Fourth pass (2026-08-06) — Safe Journey + deterministic emergency + speech priority (v0.3)

Implemented the startup plan's P0 slice (Epic 1: Safety Journey + emergency
redesign + speech-priority manager). Full plan in
`docs/watchora-startup-plan.md`.

**Safe Journey** (deterministic, no AI):
- Prisma: `Journey` extended (status/ETA/trusted contact/check-in interval/
  deviation threshold/last position/prompt count/escalation) + `JourneyLocation`
  breadcrumbs.
- `POST /api/safe-journey` (start with destination/ETA/contact/interval/share),
  `GET /active`, `POST /:id/location` (breadcrumbs + live position),
  `POST /:id/deviation` (haversine vs threshold — **prompt first, escalate
  after 2 unanswered prompts**), `POST /:id/check-in`, `POST /:id/lost`,
  `POST /:id/end`, `GET /history`, `POST /:id/acknowledge`.
- Frontend Safe Journey tab: start form, live monitoring with geolocation
  watch + 60s missed-arrival/check-in check, "I'm safe" / "I'm lost" / End
  buttons, spoken prompts ("You have moved about N metres off your route. Are
  you safe?").

**Emergency redesign** (deterministic, no AI):
- Prisma: `EmergencySession` (payload + 4h TTL) + `EmergencyAcknowledgement`.
- `POST /api/emergency` (coordinates/accuracy/battery/heading/maps link +
  5s cancel window), `POST /:id/cancel` (window enforced), `POST /:id/location`
  (live updates), `GET /active`, `POST /:id/resolve`,
  `POST /:id/acknowledge` (trusted contact), `GET /inbox` (caregiver sees
  active sessions for people who trust them).
- Everything audited; escalation ladder ready for provider wiring (SMTP/SMS/push).

**Speech-priority manager** (frontend):
- `src/speechPriority.ts` — priority queue (1 emergency > 2 danger > 3 route
  correction > 4 user answer > 5 navigation > 6 description > 7 background),
  interruption, dedupe with cooldown, verbosity gate.
- Wired into the app: `speak(text, priority, dedupeKey)`; hazard-immediate =
  2, SOS sent = 1, deviation/missed-arrival/check-in = 3, escalation = 1.

**Docs:** `docs/watchora-startup-plan.md` (full master plan: research of 6
reference projects, product system, architecture, hazard taxonomy, roadmap
v0.3→v1.0) + README rewritten to the v0.3 reality (stale claims removed).

**Verified:** 56/56 tests (5 new: journey lifecycle, deviation prompt→escalate,
emergency trigger/cancel-window/inbox/ack/location/resolve, ownership), server
+ frontend typecheck/build green, live API smoke (start→location→deviation
prompt→prompt→escalate, emergency trigger→caregiver inbox→ack→location→
resolve), live browser test (Safe Journey tab: start "Railway Station" →
"Journey in progress" + monitor buttons, zero console errors).

## Remaining (needs a decision / provider keys — NOT done)

- **SOS actually notifies contacts** — the caregiver portal now surfaces open
  SOS, but delivery still needs an email/SMS/push provider (SMTP keys, Twilio,
  FCM). The forgot-password flow has the same dev-token-until-SMTP shape.
- **Refresh-token cleanup job** — rotated/expired `RefreshToken` rows accumulate;
  a periodic purge is a small follow-up.
- **Prompt versioning: draft-only vs active** — admins can create + activate;
  no delete/diff UI yet.
- **Location sharing with real coordinates** — `locationShare` flag exists;
  wiring device GPS into SOS payloads (and `SavedPlace` lat/lng from the new
  `geo.ts`) is a follow-up.
- **Testing** — frontend has no automated tests yet (roadmap Phase 7).

## Verification

- `cd server && npm test` — all tests pass (26 existing + new).
- `npm run build` + `cd server && npm run build` + `npx tsc --noEmit` — green.
- Live smoke: booted server against local Postgres, signup (first user →
  ADMIN), PUT/GET preferences roundtrip, created reading entry + journey +
  consent + SOS (audit rows written), admin audit-logs lists them, non-admin
  gets 403.
