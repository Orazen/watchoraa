# Watchora vs. the field — competitive analysis + roadmap

Research date: 2026-08-06. Sources studied: EyeGuide (sharmaachintya), Visio
(HseyAI + Devpost), CFassist (captain0jay), SightlineAI (rudra496), VisionVoice
(DevCodeHub99). All are hackathon-stage open-source projects, mostly from the
Gemini Live Agent Challenge. This document maps their ideas onto Watchora's
safety-first architecture and records what v0.5 shipped to close the gaps.

## Competitor matrix

| Capability | EyeGuide | Visio | CFassist | SightlineAI | VisionVoice | Watchora v0.5 |
|---|---|---|---|---|---|---|
| Real-time scene narration | ✅ (Gemini Live) | ✅ (bidi stream) | ❌ (on-demand) | ⚠️ (on-demand) | ❌ (on-demand) | ✅ (coach, deterministic + on-demand AI) |
| Proactive hazard warnings | ⚠️ (prompted) | ✅ (SPOTTED→PASSING) | ❌ | ⚠️ | ❌ | ✅ (coach chaining) |
| Obstacle chaining / scan-ahead | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ (CLEARED → scan next) |
| Spatial audio panning | ❌ | ✅ (StereoPanner) | ❌ | ❌ | ❌ | ✅ (directional cue + clock phrases) |
| Adaptive frame rate | ❌ | ✅ (0.5-2.5 FPS) | ❌ | ❌ | ❌ | ✅ (motion → FPS) |
| Silence breaker / walking updates | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Reading mode (OCR) | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ (Tesseract, offline) |
| Shopping mode | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (v0.5) |
| Multi-language | ❌ (future) | ✅ (8) | ✅ (translate) | ✅ | ✅ (8) | ✅ (323 TTS voices incl. all Indian langs) |
| Emergency SOS + GPS share | ❌ (future) | ✅ | ❌ | ❌ | ❌ | ✅ (deterministic, 5s cancel, caregiver inbox) |
| Cancel/confirmation safety | ❌ | ⚠️ (double-tap only) | ❌ | ❌ | ❌ | ✅ (spoken confirm/cancel, deterministic) |
| Safe Journey with escalation | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (prompt-first escalation) |
| Caregiver portal | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Accounts, auth, refresh tokens | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Offline-first PWA | ❌ (future) | ❌ (future) | ❌ | ⚠️ (claims) | ❌ | ✅ (verified: boots + works offline) |
| On-device YOLO + OCR offline | ❌ | ❌ | ❌ | ⚠️ | ❌ | ✅ (verified) |
| No-API-key-in-frontend | ✅ (server) | ✅ (server) | ⚠️ | ✅ (server) | ❌ (BYOK) | ✅ (server-only) |
| AI never decides safety | ⚠️ (LLM-centric) | ⚠️ (LLM-centric) | ⚠️ | ⚠️ | ⚠️ | ✅ (deterministic router first) |
| Community hazard reports | ❌ | ❌ (future) | ❌ | ❌ | ❌ | ✅ (moderated) |
| Audit trail | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Accessibility testing | ⚠️ (claims) | ⚠️ | ❌ | ❌ | ⚠️ | ✅ (WCAG 2.2 AA baseline, ARIA live regions) |

## What the leaders do well (and how Watchora adopted it)

1. **Visio's navigation co-pilot** is the strongest competitor pattern: a
   SPOTTED → TRACKING → PASSING → CLEARED loop per obstacle, directional
   language, clock positions, haptic tiers (3/2/1 pulses), turn-triggered
   re-scan, and never-go-silent cadence. **Watchora v0.5 ships this as a
   deterministic, AI-free engine** (`src/navigation/`), which is strictly safer
   than Visio's LLM-prompt-driven version: identical input → identical output,
   unit-tested, works offline.
2. **Spatial audio** (Visio pans PCM through Web Audio). Watchora uses TTS via
   the speech-priority manager, so it adds a soft stereo-panned directional cue
   tone before each hazard callout plus "at your N o'clock" phrasing. Honest,
   cross-browser, no PCM pipeline needed.
3. **Adaptive frame rate** (Visio 0.5/2/2.5 FPS by accelerometer). Watchora
   v0.5 implements motion → FPS mapping with the same budget logic.
4. **Mode-scoped behaviors** (Visio/EyeGuide modes). Watchora now has
   Navigation / Reading / Exploration / Shopping coaching modes.
5. **Shopping** (EyeGuide). Watchora routes "read this label", "what does this
   cost" deterministically to shopping mode; the AI path is allow-listed and
   server-side only.

## Where Watchora is already ahead (moats to protect)

- **Deterministic safety layer**: emergency/journey/location commands match
  locally before any AI. AI can never trigger, cancel, or clear an emergency.
- **Offline is real**: local YOLO + Tesseract OCR + cached shell boot verified
  end-to-end offline (this v0.5: SW precaches bundle at install, cached-session
  auth, `ignoreVary` cache matching).
- **Full product**: accounts, caregiver portal, moderated community reports,
  audit trail, prompt versioning, 323 free neural TTS voices (all Indian
  languages), refresh-token rotation, permission onboarding.
- **Never-claims honesty**: no always-on background listening, no
  background-camera guarantees, no "theft detection" proof, no dangerous-person
  identification.

## Roadmap to stay unbeatable

### v0.6 — deeper navigation
- Turn-triggered re-scan via gyroscope heading deltas (Visio parity, local).
- People-awareness callouts (approaching people) from YOLO person class.
- Trip-hazard near-ground analysis (bottom 25% edge detection).
- Route memory: remembered walks + known hazards on saved routes.
- Step detection → motion level wiring (accelerometer, user-opted-in).

### v0.7 — multimodal depth
- Bidi streaming narration (Gemini Live-class) as an *optional* premium mode
  when online, always over the deterministic coach for safety output.
- Grounding for products/landmarks (server-side, allow-listed).
- Scene memory: remember objects/places seen in a session.

### v0.8 — scale + safety net
- Emergency relay to local authorities + caregiver escalation tree.
- Community hazard map with severity + fresh/recent weighting.
- Group journeys (blind user + sighted buddy shared trip).
- Offline-first incident queueing with delivery states (already designed).

### Native / hardware
- PWA first; native Android wrapper for guaranteed background journey
  monitoring; bone-conduction headphone guidance and (later) smart-glasses
  integration as opt-in hardware.

## Explicit non-goals (from the startup plan, unchanged)
- Watchora never replaces a cane, guide dog, mobility training, or official
  pedestrian signals; never authorizes a road crossing; never identifies a
  person as dangerous; never guarantees a route is safe; no always-on
  background listening claims.
