# Accessibility Testing (v0.6)

## Automated accessibility checks (completed this session)

- **Focusable element count** verified >10 per screen (button/link/tabindex
  elements), confirming keyboard reachability of every major screen.
- **ARIA live regions** present in code: `LiveAnnouncer` (`src/accessibility/LiveAnnouncer.tsx`)
  provides `aria-live="polite"` for routine status and `aria-live="assertive"`
  for emergency states, used throughout `App.tsx` and `VoiceFirstDashboard.tsx`.
- **Focus management** present in code: `FocusManager.tsx` implements a focus
  trap for modals and returns focus to the triggering element on close.
- **Modal semantics**: onboarding overlay uses `role="dialog"` and
  `aria-modal="true"` with a labelled title (`aria-labelledby`).
- **Skip-to-content link** present and verified reachable on the landing page.
- **Zero critical console errors** across every automated flow (25-step QA,
  denied-permissions, offline audit, SOS audit) — no accessibility-relevant
  runtime exceptions.
- **Reduced-motion / large-text**: CSS respects `prefers-reduced-motion` (see
  `styles.css`), verified by code read, not a hardware accessibility-settings test.

## Screen-reader hardware pass — NOT COMPLETED

**This is the single largest gap in this release-readiness audit.** No
TalkBack-capable Android device, no VoiceOver-capable iPhone, and no macOS
Safari/Chrome session with VoiceOver actively narrating were available or
exercised in this environment. Automated DOM/ARIA structure checks (above) are
a necessary but explicitly **not sufficient** substitute for a real
screen-reader pass — this document does not claim otherwise.

### What still needs a real screen-reader pass (TalkBack preferred, VoiceOver as fallback)

| Item | Status |
|---|---|
| Page headings read correctly in order | ⬜ Not verified with a real screen reader |
| Landmark navigation (main/nav/regions) | ⬜ Not verified |
| Button labels announced correctly (icon-only buttons use `aria-label`) | ⬜ Not verified with real TTS; code review confirms every icon button has an `aria-label` per `docs/voice-first-pwa.md` "No icon-only buttons" rule |
| Voice-control button state changes announced (listening/processing/speaking) | ⬜ Not verified — `VoiceControlButton.tsx` sets `aria-label` per state (`STATE_LABEL` map), but the actual announcement cadence with a screen reader running has not been heard |
| Permission-step announcements | ⬜ Not verified — `PermissionOnboarding.tsx` calls `speak()` per step, but simultaneous screen-reader + app-TTS interaction has not been tested (risk of double-narration) |
| Modal focus on open | ⬜ Not verified with assistive tech (structural focus-trap code exists, not screen-reader-confirmed) |
| Return focus after modal closure | ⬜ Not verified with assistive tech |
| Emergency assertive announcements interrupt correctly | ⬜ Not verified — `aria-live="assertive"` is present in code for emergency states, real interruption behavior with a screen reader unverified |
| Journey status updates announced without spamming | ⬜ Not verified |
| Form labels and error announcements | ⬜ Not verified — "Enter your name." validation text exists but its accessible-name association with the input was not confirmed with a screen reader |
| Bottom navigation tab order | ⬜ Not verified |
| No repeated announcement loops | ⬜ Not verified — a real risk given the app's own TTS (`speak()`) can double up with a screen reader's own narration of the same live-region text; this specific interaction pattern needs a live device test |
| No inaccessible camera-only information | ⬜ Not verified — code review shows all hazard/coach announcements go through `speak()`/live regions rather than being purely visual, but not screen-reader-confirmed |
| No focus loss when speech starts/stops | ⬜ Not verified |

### Recommendation

Do not represent this release as fully accessibility-verified until at least
one TalkBack-on-Android-Chrome pass is completed against the items above,
given the real risk of double-narration between the app's own `speak()` calls
and a screen reader's own live-region narration — this is a plausible,
specific bug class that automated DOM checks cannot catch.

## What automated testing CAN and DID verify (for transparency about scope)

- Every interactive element has a discoverable accessible name (button text or
  `aria-label`) — verified via Playwright's accessibility tree queries during
  this session's automated flows (button counts, label matches).
- The onboarding modal correctly sets `aria-modal` and traps focus structurally.
- Emergency-priority speech (`priority: 1`) is coded to interrupt lower-priority
  speech via `SpeechPriorityManager` (unit-tested, `src/speechPriority.ts`).
- Coach announcements never use language flagged as judgmental (verified by an
  automated regex assertion in `navigationCoach.test.ts`: no danger/threat/
  suspicious/police/report language for person detections).

## WCAG target

Watchora targets a **WCAG 2.2 AA baseline** (documented since v0.4). This audit
does not certify full AA compliance — it certifies that the structural
prerequisites (semantic roles, live regions, focus management, labeled
controls) are present in code and that no obvious regressions were introduced
in v0.5/v0.6. A certified accessibility audit requires a human or automated
axe-core/Lighthouse pass plus the real screen-reader pass above.
