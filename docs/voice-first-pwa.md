# Watchora — Voice-First PWA (v0.4)

This is the voice-first upgrade of the Watchora PWA. It adds a guided
permission onboarding, a central voice assistant, a deterministic command
router (with an AI fallback that never touches safety), a voice-first
dashboard, a persistent "Talk to Watchora" button, an accessible emergency
control, and a full Permission Centre. All existing functionality (Safe
Journey, SOS, caregiver, AI, OCR, hazard detection, authentication, audit,
offline) is preserved.

## Voice-command reference

Deterministic commands are matched locally and always work. They never depend
on a network or AI.

### Vision coaching (v0.5-v0.6)
- "Navigation mode" / "Turn on navigation coaching" — proactive hazard
  narration: SPOTTED → TRACKING → PASSING → CLEARED per obstacle, direction +
  clock position, obstacle chaining ("scanning ahead for the next obstacle"),
  silence breaker, walking updates.
- "Reading mode" / "Text mode"
- "Exploration mode" / "Explore mode"
- "Shopping mode" / "Stop coaching" / "Turn off navigation coaching"
- "Read this label" / "What does this cost" / "Check this product" — shopping
- Coaching is deterministic (no AI), works offline, and speaks through the
  priority system with a stereo-panned directional cue tone.
- **People awareness (v0.6)**: person detections get distinct phrasing
  ("Person approaching on your left" / "Caution. A person is close ... step
  right to give them room."). Never identifies, judges, or names a person —
  presence and direction only.
- **Ground-level trip hazards (v0.6)**: an object whose box sits in the lower
  quarter of frame gets an explicit "Watch your step" cue even at moderate
  size, since small low objects (posts, curbs) are easy to miss.
- **Adaptive motion cadence (v0.6)**: once the user has explicitly granted the
  Motion permission, the coach samples faster while walking/running (0.5 FPS
  stationary, 1.5 walking, 2.5 running via device accelerometer). Without that
  permission it stays at the safe, conservative stationary cadence — it never
  claims to sense motion it cannot read.

### Emergency (priority 1, confirmation required)
- "Emergency"
- "Watchora emergency"
- "Send SOS"
- "I need help"
- "Call my trusted contact"
- "Cancel emergency" / "Cancel SOS"
- "Send my current location" / "Share my location"
- "Who acknowledged my SOS?"

### Safe Journey (priority 3 for deviations)
- "Start a safe journey to the railway station" (destination extracted)
- "Start a safe journey"
- "Stop my journey" / "End my journey"
- "Check my journey"
- "I am safe"
- "I am lost"
- "I arrived"

### Assistance
- "Describe what is ahead" / "What is around me?"
- "Read this"
- "Find the door" / "Where is the entrance?"

### Navigation
- "Navigate to home" / "Take me to the railway station"
- "How far is my saved place?"
- "Where am I?"

### Settings / permissions
- "Check my permissions"
- "Speak slower" / "Speak faster"
- "More detail" / "Shorter answer"
- "Turn hazard vibration on" / "Turn hazard vibration off"
- "Voice warnings only"
- "Switch to Italian" / "Switch to English"

### Open a screen
- "Open Home" / "Open Assist" / "Open Safe Journey" / "Open Emergency"
- "Open saved places" / "Open trusted contacts" / "Open Settings"
- "Open Reading" / "Open Community"

### Speech control
- "Repeat that"
- "Stop speaking" (emergency warnings remain active)
- "What can I do?" / "Help"

### Places & community
- "List my saved places"
- "Save this location as home"
- "Report broken pavement" / "Report construction"
- "What hazards are nearby?"

### Confirmation words
- "Confirm" / "Yes" / "OK"
- "Cancel" / "No"

## How commands are routed

1. **Deterministic router (local)** — safety-sensitive commands (emergency,
   journey, location sharing, confirmation) are matched by patterns in
   `src/voice/deterministicCommands.ts`. They never require network or AI.
2. **AI intent parser (backend)** — only for flexible wording NOT matched
   deterministically, and only for an allow-list of non-safety intents
   (`describe_scene`, `read_text`, `start_navigation`, `start_safe_journey`,
   `check_journey`, `change_setting`, `open_tab`, `report_hazard`,
   `list_places`, `save_place`, `help`). The Gemini key stays on the server
   (`POST /api/ai/intent`).
3. **Unknown / low confidence** — the assistant says: "I am not sure what you
   asked. You can say: describe what is ahead, read this, start a safe
   journey, or emergency."

## Confirmation rules (deterministic)

Watchora requires explicit confirmation for: sending/cancelling SOS, ending a
Safe Journey, sharing live location, contacting a trusted person, deleting a
contact, changing privacy settings, enabling continuous camera analysis,
sending an image to cloud AI, and recording incident audio. Confirmation is
always a deterministic UI/API flow ("Say confirm or cancel"), never an
AI-generated confirmation.

## Permission behaviour

- **Browsers cannot auto-grant permissions.** Every sensitive permission
  (camera, microphone, location, notifications, motion) is requested only
  after the user activates "Start Watchora" (or later via Permission Centre).
- Permissions are requested **one at a time**, each with a spoken explanation
  and a "Skip for now" fallback.
- The Permission Centre is reachable from onboarding, the dashboard status
  card, Settings, and the voice command "Check my permissions".
- The app **re-checks the actual browser permission state on every session** —
  the onboarding-complete flag never substitutes for the real state.
- Camera frames stay on the device unless you explicitly request AI analysis.
- The microphone is used only while voice control is active.

## Supported browsers

- Chrome / Edge (full support: speech recognition, TTS, permissions)
- Safari (TTS + permissions; speech recognition support varies)
- Firefox (TTS + permissions; speech recognition limited)
- Keyboard shortcut to talk: `Ctrl/Cmd + Shift + V` (when not typing)

## Browser limitations (documented, not promised)

- Voice wake phrases work only while the PWA is open and active. There is no
  guaranteed background listening.
- Background camera and microphone are not guaranteed.
- Background journey monitoring is limited until the native Android milestone.
- Motion "theft" signals are treated as optional safety triggers, never proof
  of theft.
- Watchora does not replace a cane, guide dog, mobility training, or official
  pedestrian signals. It never authorizes a road crossing, never identifies a
  person as dangerous, and never claims a route is guaranteed safe.

## Offline behaviour

When offline, Watchora announces: "You are offline. Local hazard detection,
saved information, and OCR remain available. Cloud scene descriptions and
remote emergency delivery may be unavailable."

Verified offline (v0.5): the app shell boots from the service-worker cache on a
first-visit user's device, the last-known session is restored (cached user,
token kept), and the dashboard, local YOLO hazard layer, OCR, saved places,
emergency information, permission status, and local voice commands all work.
API calls fail gracefully with the offline banner; nothing crashes.

Still available offline: PWA shell, local YOLO model + navigation coach, OCR,
saved places, active journey local state, emergency information screen,
permission status, local voice commands.

SOS delivery states (never falsely reported): Prepared → Sending → Delivered →
Acknowledged → Failed → Waiting for connection.

## Accessibility

- WCAG 2.2 AA baseline; full VoiceOver/TalkBack-friendly semantics.
- One primary action per onboarding step; 48px+ (56px onboarding, 64px
  emergency) touch targets.
- `aria-live="assertive"` for emergencies, `aria-live="polite"` for routine
  status, `role="alert"` on emergency states.
- Focus moves to page headings after navigation; modals return focus on close;
  focus traps only in genuine confirmations.
- Continuous hazard output is kept separate from screen-reader announcements.
- Reduced-motion respected; system dark mode respected; large-text support.
- No icon-only buttons; every control has a text label.

## Manual QA checklist

1. Open Watchora on a phone → hear the spoken welcome.
2. Activate **Start Watchora**.
3. Complete the audio test (repeat / slower / faster).
4. Enable or skip microphone, camera, location, notifications, motion.
5. Reach the dashboard → confirm status cards, Talk to Watchora, Hold for SOS.
6. Say "Describe what is ahead" → Assist opens in navigation mode.
7. Say "Read this" → Assist opens in reading mode.
8. Say "Start a safe journey to the railway station" → journey screen opens
   with the destination filled.
9. Say "I am safe" / "I am lost" → correct deterministic flow.
10. Say "Emergency" → confirmation flow → SOS screen with cancellation
    countdown.
11. Say "Check my permissions" → Permission Centre opens.
12. Use every screen with keyboard only (Tab, Enter, `Ctrl/Cmd+Shift+V`).
13. Reload offline → verify local capabilities remain.
14. Verify zero console errors at every step.
