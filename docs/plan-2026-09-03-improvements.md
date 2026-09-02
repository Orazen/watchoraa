# Watchora Improvement Plan — gstack-style review input (2026-09-03)

## Context

Watchora is a voice-first PWA for blind/low-vision users, live at
watchora.ramagiritharun.in (VPS + Dokploy + Traefik). Hardening complete,
E2E + a11y verified, deterministic deploy pipeline green. Competitors: Be My
Eyes, Seeing AI, Envision, WeWALK, Aira, NaviLens.

## Proposed improvements (next 2 weeks)

### P1. Hands-free walking mode with bone-conduction-friendly cadence
Currently hazard alerts speak only when classification changes; a user
walking fast may outpace them. Proposal: rate-adaptive re-assert cadence
(re-announce persistent hazards every N seconds scaled by walking speed),
with a "quiet" verbosity setting that maps to taps-only.

### P2. Multi-image scene memory
Keep the last 3 analyzed frames server-side per session (in-memory, TTL 5
min) so `tell me more` and follow-up questions can reference what changed
between frames ("did that car move?"). No persistence, no PII beyond the
existing policy.

### P3. Landmark-based deviation detection
Safe Journey deviation currently uses straight-line distance from the
planned route (which the app doesn't actually store — it thresholds against
last known position). Proposal: store the walked polyline (journey locations
already saved) and measure deviation from the recent path, not the last
point, to catch walking-backwards cases.

### P4. Onboarding voice-speed calibration tied to actual TTS output
The onboarding plays a sample; proposal is to record user's chosen rate and
apply instantly to all subsequent speech (may already work post-closure fix).

### P5. Community hazard map heat layer
Plot moderated incidents on the existing caregiver map as a heat layer,
weighted by severity and freshness (90-day half-life).

## Non-goals (unchanged)

Never replace cane/guide dog; never authorize crossings; never identify
people; no native app yet; no PII retention beyond current policy.
