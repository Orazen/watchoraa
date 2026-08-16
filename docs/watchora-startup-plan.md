# Watchora — Startup Master Plan

Prepared: 2026-08-06
Status: **v0.3 Safety Foundation** (current sprint)
Source: consolidated audit brief + research of 6 reference projects + the live
codebase at `/Users/ramagiritharun/Desktop/watchora`.

---

## 1. The startup definition

**Watchora is an AI-powered mobility and safety platform for blind and
low-vision people** — combining outdoor walking navigation, indoor wayfinding,
real-time obstacle awareness, reading/scene understanding, safe-journey
monitoring, emergency assistance, trusted-contact/caregiver tools, and
accessibility infrastructure for buildings and public venues.

> Positioning: *Watchora helps blind and low-vision people understand their
> surroundings, navigate unfamiliar spaces, and get assistance when something
> goes wrong — using private, multimodal, confidence-aware technology.*

Not "a camera that describes things" (apps already do that). The opportunity is
connecting **perception + navigation + safety + venue infrastructure** into one
system. The WHO estimates ≥2.2B people have near/distance-vision impairment and
>2.5B need assistive products — the need is structural, not niche.

**Design hierarchy (never inverted):**

```
White cane / guide dog
+ official signals & accessibility infrastructure
+ deterministic Watchora safety rules
+ local perception models (detection/segmentation/depth/tracking)
+ accessible map & venue data
+ optional contextual AI (Gemini or local)
```

AI is a **cautious secondary assistant**, never the authority on safety.

---

## 2. Reference research — what to take, what to avoid

### NAVI — Indoor-Navigation-for-visually-impaired (NgWY02)
**Take:** visual waypoint localization. Record routes as DINOv2 768-dim
embeddings + compass heading + reference image; live camera embeddings matched
to stored waypoints (cosine > threshold); auto-recovery when lost; separate
user vs venue-admin experiences; voice-first interface with wake word.
**Avoid:** Stable Diffusion inpainting in the real-time loop (too slow/
unpredictable for safety-critical decisions); treat claimed 95% accuracy as
unvalidated; single similarity threshold as the only signal.

### BlindAssist (manthanabc)
**Take:** semantic segmentation → **Walkable Space Engine**. Estimate whether
left/centre/right is traversable, build a near-field occupancy grid, find the
widest free corridor, track it across frames, output only `Stop / Slight left /
Slight right / Continue / Path uncertain`. A simple 4-button interface, server
TTS, vibration.
**Avoid:** letting a general AI response ever say "safe to cross" — the
deterministic policy layer must block it even if a model generates it.

### AccessibleMap (grothauser)
**Take:** accessibility routing is a **map-data problem**, not a vision problem.
Route edges need: sidewalk present, tactile paving, audible signal, crossing
type, kerb, stair count, lift, construction, surface quality, lighting,
entrance accessibility, door type, platform edge, indoor/outdoor, reliability +
last-verified. (Repo itself is stale; README even has unresolved merge markers.)

### VisionNav (mystichronicle)
**Take:** sensor-fusion principle — GNSS + compass + IMU + visual localization +
step estimation + QR/NFC/BLE anchors + barometer floor changes. No single
sensor is always correct. (SLAM is a placeholder in the repo — concept, not
proven code.)

### ARIADNE — blind_navigation (wink-wink-wink555) ★ most complete
**Take:** dedicated **tactile-paving detection** (trained YOLO); flexible
AI-provider layer (cloud ↔ local Ollama); **multi-agent intent router**
(RouterAgent → MapAgent/SettingsAgent/Message/Chat); natural-language settings;
family messaging; real-time location sharing; user + family dual modes; email
verification + password recovery. This is the closest reference to a full
product and validates the multi-agent voice-assistant pattern.

### Blind-Friendly-v2 (marttp) + Medium writeup
**Take:** on-device Gemma 3n for **latency-tolerant tasks only** (summaries,
follow-ups, document interpretation, async incident notes).
**Avoid:** 30–40s on-device latency is far too slow for the obstacle-warning
loop. Real-time loop must stay lightweight: camera → detector/segmenter/depth →
deterministic risk engine → haptic/short speech.

---

## 3. Product system (5 connected products)

| Product | Audience | Core |
|---|---|---|
| **Watchora Companion** | blind/low-vision user | Assist, outdoor nav, indoor nav, reading, object finder, Safe Journey, SOS, public transport, offline packs |
| **Watchora Circle** | trusted contacts + caregivers | SOS alerts, ack, consented live journeys, missed-arrival alerts, temporary live location, audio/video assistance sessions, escalation order |
| **Watchora Venue** | hospitals/universities/stations/airports | floor plans, accessible route graphs, visual routes, venue packs, closures, accessibility analytics (B2B) |
| **Watchora Map** | community + institutions | accessible entrances, crossings, tactile paths, construction, broken lifts, pavement hazards, bus stops, platforms, toilets, safe pickup points |
| **Watchora Safety Cloud** | backend | SOS delivery, live-location sessions, journey monitoring, contact ack, escalation, audit, push/SMS/email, abuse prevention |

---

## 4. Core architecture

```
WATCHORA WEB (React/TS)        → landing, account, caregiver portal, admin, venue portal
WATCHORA MOBILE (native later) → camera pipeline, sensors, SOS, offline models
WATCHORA API (Node/TS, Prisma) → auth, users, contacts, journeys, emergencies,
                                  venues, route graphs, reports, moderation, audit
WATCHORA SAFETY ENGINE         → deterministic rules, escalation, speech priority, audit trail
WATCHORA AI LAYER              → scene descriptions, OCR fallback, optional assistance,
                                  prompt/version registry, safety-output validator
```

**Perception — three loops (the key architectural decision):**

1. **Fast path (<300ms):** camera → detector + segmentation + relative depth +
   optical flow + tracking → risk engine → haptic / ≤6-word speech.
   `risk = hazard severity × path intersection × relative closeness × closing
   speed × detection persistence × model confidence × user speed`
2. **Context path (1–5s):** "What's around me?", reading, questions.
3. **Deep path (async):** venue localization across embeddings, document
   interpretation, incident summaries, moderation.

---

## 5. Hazard taxonomy (beyond COCO)

- **Ground:** kerb, drop-off, pothole, uneven pavement, open drain, steps up/
  down, escalator entrance, platform edge, wet floor, loose cable, low barrier,
  scooter lying across path.
- **Mid-level:** chair, bollard, bicycle, trolley, open door, vehicle door,
  construction barrier, queue barrier, dog, luggage.
- **Head-height:** tree branch, signboard, scaffolding, open cabinet, hanging
  decoration, projecting shelf, low beam.
- **Moving:** vehicle/bicycle/scooter approaching, person crossing, running
  child, dog crossing, closing automatic door.
- **Landmarks:** door, lift, staircase, reception, ticket counter, bus-stop
  pole, pedestrian button, crosswalk, tactile paving, traffic signal, platform
  sign, room number, building number.

Watchora needs **custom datasets** (kerb/drop-off/head-height/tactile-paving)
in later phases; COCO alone is insufficient.

---

## 6. Navigation modes

Outdoor route (accessibility-weighted graph, clock-based concise output) ·
Final approach (last ~30m: entrance, door orientation, building number, steps,
ramp, intercom) · Indoor venue (route graph + visual waypoints + heading +
step estimates + QR/NFC/BLE) · Explore (spatial mental map: "Reception at
1 o'clock, lifts at 10 o'clock") · Reverse route (breadcrumb + landmarks) ·
Public transport (bus-number OCR, stop countdown, exit-side reminder, platform
OCR).

---

## 7. Emergency & personal safety (P0 — current sprint)

**SOS activation (redundant triggers):** hold button, voice phrase, wearable,
headphone pattern, lock-screen (native). **Web reality:** voice activation only
works while the page is active + mic is running — documented, not promised.

**SOS sequence (no Gemini dependency):** announce → 5s cancellation countdown →
send trusted contacts (coordinates, maps link, timestamp, battery, accuracy,
movement direction) → live location session → one-tap call shortcut → optional
consented audio note → update notifications → **contact acknowledgement**.

**Escalation ladder:** Contact 1 → Contact 2 → caregiver group → call shortcut.
Never auto-dial emergency services without legal/platform/false-trigger review.

**Safe Journey:** destination, ETA, trusted contact, check-in interval, live
share toggle. Triggers: unexpected stop, route deviation, GPS loss, missed
arrival, "I'm lost". **Prompt first, then escalate:** "You have moved about 80
metres off your route. Are you safe?" — repeated unanswered prompts escalate.

**Unexpected device movement (not "robbery detection"):** sudden acceleration,
camera covered, headset disconnect, no response. "Unexpected phone movement
detected. Say 'I'm safe' within ten seconds." → unanswered = last location +
safety session + notify contact.

**Prohibited:** emotion detection, criminal-intent detection, "safe to cross"
authorization, exact distance claims from monocular camera, promise of
continuous background operation in a web page.

---

## 8. Voice & haptic experience

**Speech priority (implemented this sprint):**
1. Emergency warning
2. Immediate collision/drop-off warning
3. Route correction
4. User-requested answer
5. Navigation instruction
6. General scene description
7. Background status

A higher-priority message **interrupts** lower-priority speech.

**Haptic vocabulary:** 1 short pulse = continue; repeating left = move left;
repeating right = move right; rapid bilateral = stop; long = recalculate;
distinct emergency pattern = SOS active. Customizable/disable-able.

**Audio safety:** bone-conduction/one-ear support, ducking (not masking) ambient
sound, adjustable verbosity, quiet mode, repeat-last, speech-rate control.

---

## 9. Accessibility requirements

WCAG 2.2 AA baseline · full VoiceOver/TalkBack · one primary action per screen ·
48×48px touch targets · no icon-only buttons · no drag-only interactions ·
adjustable speech speed · repeat/pause/interrupt · speech history · haptic-only
mode · one-ear guidance · high contrast + dark mode · reduced motion · 200–400%
text · **no timeout during emergency workflows** · confirmation before
destructive actions · voice feedback after every important button. The
**European Accessibility Act** (applied 2025-06-28) makes this a compliance +
enterprise-sales advantage.

---

## 10. PWA vs native

**PWA now:** landing, accounts, camera demo, OCR, scene description, caregiver
portal, venue portal, community reports, early testing.
**Android native next** (Kotlin/Compose): background location, motion sensing,
Bluetooth wearables, lock-screen SOS, persistent journey service, offline maps,
on-device ML, reliable TTS, Wear OS, foreground service.
**iOS after Android validated.** Shared API contracts + model formats; don't
force hardware-specific features into a shared codebase.

---

## 11. Privacy & security

Camera stays local unless requested · no continuous raw-video upload · emergency
media explicit opt-in + auto-expiry · public reports use approximate coords ·
precise location only to authorized contacts · caregiver access expires · user
can revoke instantly · every sensitive view audited · **short-lived access
tokens + rotating refresh tokens (done: HTTP-only cookie migration is next)** ·
device session list · remote revocation · step-up verification for caregiver
changes · abuse prevention (no permanent tracking, audible tracking start,
secret revoke, contacts can't add themselves, caregiver can't activate camera,
blocked-contact hiding) · blur faces/plates in community uploads · separate
precise-emergency vs approximate-public coordinates.

---

## 12. Business model

**Free tier:** scene description, OCR, basic warnings, saved places, limited
Safe Journey, 1 contact, community hazards.
**Watchora Plus (~€5–10/mo):** unlimited journeys, multiple contacts, offline
map regions, entrance finding, public transport, object finder, premium voices,
wearables.
**Watchora Venue (B2B):** mapping/setup fee + annual platform fee + per-building
tier + maintenance + accessibility analytics + API.
**SDK/API:** accessible indoor routes, venue packs, hazard intelligence,
screen-reader-ready map components.
**Grants/partnerships:** blind associations, O&M instructors, universities,
transport operators, municipalities, disability innovation funds, EU
accessibility programmes.

---

## 13. Competitive moat

Not image-description quality. The moat is: **accessibility route data**
(verified crossings/tactile paths/entrances), **venue infrastructure** (orgs
publish their own packs), **personalization** (instruction style, speed,
preferences, known places, confirmed landmarks), **safety network** (contacts,
journeys, ack, escalation), **field-validation dataset** (false warnings, missed
hazards, low-light failures), and **trust** (transparent confidence, local
processing, published limitations).

---

## 14. Validation programme

Permanent advisory group (blind cane users, guide-dog users, low vision, older,
deafblind, O&M specialists, caregivers, accessibility researchers, emergency
responders, privacy experts). Test environments: home, office, hospital,
university, station, bus stop, shopping centre, crowded pavement, rain, night,
glare, low battery, no internet, covered camera, cane + bone-conduction.
Metrics: hazard recall, false-warning rate, time-to-warning, comprehension,
wrong-turn rate, arrival success, relocalization, battery, SOS delivery success,
ack time, screen-reader task completion, mental workload, trust calibration,
unnecessary-message count. **No "safe navigation" marketing until independent
field testing supports it.**

---

## 15. Development roadmap

- **v0.3 Safety Foundation (NOW):** README/docs update ✓, **Safe Journey** ✓,
  **live SOS location + contact ack** ✓, **speech-priority manager** ✓,
  permission centre, route-deviation check-ins, offline emergency screen,
  VoiceOver/TalkBack audit, consent controls, PostGIS foundation.
- **v0.4 Perception:** semantic free-space segmentation, relative depth, object
  tracking, optical flow, corridor-intersection risk, head-height alerts,
  stairs/kerb dataset, tactile-paving model, low-light detection, multimodal
  haptics.
- **v0.5 Native Android:** Kotlin/Compose app, foreground journey service,
  background location, offline maps, BLE trigger, Wear OS, local inference,
  lock-screen SOS, secure local storage, device-movement safety check.
- **v0.6 Venue:** admin portal, floor-plan ingestion, node/edge editor, route
  recorder, visual waypoints, QR/NFC anchors, multi-floor, offline packs.
- **v0.7 Mobility:** accessibility route prefs, entrance finding, public
  transport, reverse route, nearby exploration, object finder, community
  verification scores, hazard expiry.
- **v0.8 Pilots:** one university + one hospital + one station + one blind
  association; collect failures before expanding.
- **v1.0 Commercial:** independent accessibility audit, security review,
  privacy impact assessment, real blind-user trials, emergency-delivery
  reliability testing, clear terms, venue maintenance + support process.

---

## 16. This sprint (v0.3 slice) — what was implemented

See `docs/watchora-audit-2026-08-06.md` for the running audit. This sprint:

1. **Safe Journey** (schema + routes): start/stop journey with destination,
   ETA, trusted contact, check-in interval; live location updates; route-
   deviation check; missed-arrival job; prompt-first-then-escalate flow;
   trusted-contact acknowledgement.
2. **Emergency payload**: SOS now carries coordinates, accuracy, timestamp,
   battery, movement direction; live-location session; acknowledgement + audit.
3. **Speech-priority manager** (frontend): priority queue with interruption,
   deduplication, cooldown, verbosity control, haptic equivalents, speech
   history.
4. **README + safety documentation** refreshed to the v0.3 reality.
