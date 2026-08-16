# BlindNav Implementation Roadmap

## Phase 0: Foundation

- Create the React + TypeScript + Vite frontend shell.
- Add routing, layout, and accessibility primitives.
- Add a backend service skeleton with validation, auth boundaries, and health checks.
- Define shared types for users, roles, preferences, prompts, incidents, and assistance requests.
- Introduce environment-based secret management.

## Phase 1: Core Product Shell

- Build onboarding and sign-in.
- Build the blind-user dashboard.
- Add accessibility preferences and language selection.
- Add voice settings and speech-rate controls.
- Add local persistence for user preferences.
- Add permission education for camera, microphone, and location.

## Phase 2: Assistive Modes

- Navigation mode with destination search, saved places, route instructions, repeat, pause, and stop.
- Environment awareness mode with camera capture and short hazard-first descriptions.
- Reading mode with OCR, upload support, read-all, paragraph reading, and text saving.
- Assistant mode with dedicated prompts per use case.
- Emergency mode with confirmation, temporary sharing, and fallback messaging.

## Phase 3: Safety and Trust

- Add uncertainty messaging and safety disclaimers.
- Add report-incorrect-response flows.
- Add privacy controls, retention controls, and deletion/export flows.
- Add consent history and audit logs.
- Add trusted-contact permission scopes and expiry.

## Phase 4: Backend and Data

- Implement user, role, and permission tables.
- Implement preferences, saved places, history, contacts, incidents, and support tables.
- Implement AI-provider abstraction and prompt versioning.
- Implement notification workflows and audit logging.
- Add rate limits, redaction, and request tracing.

## Phase 5: Caregiver and Admin

- Build trusted-contact portal.
- Build admin overview and health dashboards.
- Add user management, AI configuration, prompt management, incidents, support, and CMS controls.
- Add analytics and PWA install telemetry.

## Phase 6: PWA and Offline

- Add manifest and service worker.
- Cache shell, help, settings, and safe offline instructions.
- Announce network state changes.
- Store only the minimum safe offline data.
- Add update notifications and recovery paths.

## Phase 7: Testing and Hardening

- Add unit tests, integration tests, and end-to-end tests.
- Add accessibility tests and keyboard-only walkthroughs.
- Add AI failure and timeout tests.
- Add permission-denial and offline tests.
- Add role and privilege tests.
- Add performance and low-end device checks.

## Milestone Order

1. React + TypeScript + Vite frontend shell.
2. Backend skeleton with auth and DB.
3. Blind-user dashboard and onboarding.
4. Navigation, reading, assistant, and emergency flows.
5. Caregiver and admin portals.
6. PWA, offline support, and data controls.
7. Testing, hardening, and release preparation.

## Highest-Priority Next Build Slice

The first production foundation should be the frontend migration to React + TypeScript + Vite, paired with a backend contract and typed API boundary. That unlocks reusable accessible components, role-based routes, settings persistence, and the server-side AI proxy needed for safety and privacy.