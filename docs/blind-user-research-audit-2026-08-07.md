# Blind-user research audit — 2026-08-07

Research-driven accessibility pass: web research on how blind users actually
use screen readers, then a live axe + custom audit of every tab, then fixes
implemented, deployed, and re-verified in production.

## Research consulted

- **Microsoft Research CHI'21, "Smartphone Usage by Expert Blind Users"**
  (Jain, Diwakar, Manohar — TalkBack log study of 8 expert blind users in
  India, 209 days of data). Key findings applied:
  - Expert users navigate with **directional gestures** (swipe next/prev
    item) and rely on **predictable spatial layouts** and the **heading
    rotor** to jump around. "I find browsing on phone very unpredictable.
    You have to swipe many times. In app it's very predictable and more
    importantly, you know where buttons are." (P7)
  - **Unlabeled buttons** are the single most cited app-level barrier
    ("I label all buttons which are unlabeled... I will play a song, press
    a button and then label it" — P2).
  - Users want **fully voice-based UIs** ("Everything should be completely
    voice-based... that will be super fast. That can help in achieving time
    equality with a sighted user" — P4). Watchora's hands-free wake-phrase
    mode (previous commit) directly targets this.
  - **Camera apps give too little feedback**; P5 praised Samsung camera for
    announcing "one person in focus, two person in focus at the upper or
    middle part of the screen". Watchora's hazard layer + navigation coach
    already announce detections with clock-position directionality.
- **W3C WCAG2Mobile (Guidance on Applying WCAG 2.2 to Mobile)**: SC 2.4.6
  Headings and Labels, 2.4.11 Focus Not Obscured, 2.5.8 Target Size, 4.1.3
  Status Messages, 2.4.1 Bypass Blocks.
- **W3C Mobile Accessibility overview** and screen-reader design guides
  (label → value → traits → hints, reading order = focus order, group
  related elements, rotors).

## Audit method

- Installed `@axe-core/playwright`, wrote `scripts/a11y-audit.mjs`
  (committed as a regression tool).
- Ran axe on every tab of the LIVE production app (Home, Assist, Places,
  Safe Journey, SOS, Community, Settings) at mobile viewport, plus custom
  checks: unlabeled buttons, heading order, touch targets < 24px, live
  regions, landmarks.
- Caregiver tab audited separately with a CAREGIVER-role test account
  (signup API supports the role).
- All test users created were deleted from the production DB afterwards.

## Findings (before)

| Tab | axe violations |
|-----|----------------|
| Home | heading-order (h3 after h1, no h2); region (.bottom-nav) |
| Assist | region (.bottom-nav) |
| Places | page-has-heading-one; region |
| Safe Journey | page-has-heading-one; region |
| Emergency | page-has-heading-one; region |
| Community | page-has-heading-one; region |
| Settings | color-contrast (.settings-hint, serious); page-has-heading-one; region |
| Caregiver | (not yet audited) |

Root causes:

1. **No consistent heading hierarchy.** The topbar tab label was an `<h2>`
   and most tabs had no `<h1>` at all; Home had an h1 + h3 skip. A blind
   user using the heading rotor cannot tell which screen they're on and
   the outline is broken. (SC 2.4.6, rotor navigation from the CHI study.)
2. **`.bottom-nav` lost its landmark.** `role="tablist"` on the `<nav>`
   element overrode the implicit navigation landmark, so on mobile (the
   primary form factor) the nav content was outside any landmark. (SC
   1.3.1/4.1.2 + landmarks guidance.)
3. **`.settings-hint` contrast failure** (serious): opacity 0.75 on muted
   gray text on cream background failed 4.5:1. (SC 1.4.3.)

## Fixes (implemented + deployed)

1. **Single h1 per screen.** The topbar now renders `<h1>{activeLabel}</h1>`
   for every tab. In-tab page titles demoted to h2 (dashboard "Home",
   Assist "Camera-to-voice assistance"); section titles stay h2/h3. Every
   screen now has exactly one h1 so the heading rotor always announces the
   current screen, and outlines are strictly h1→h2→h3.
2. **Nav landmarks preserved.** Sidebar and bottom navs keep `<nav
   aria-label>`; the tablist semantics (`role="tablist"`, `role="tab"`,
   `aria-selected`) moved to an inner div. Mobile `.bottom-nav` gets an
   inner `.bottom-nav-tablist` grid; also fixed a regression where the
   restructure hid the bottom nav (`display` was dropped).
3. **Contrast**: `.settings-hint` now uses the muted color token directly
   (no opacity reduction).

## Verification (after, live production)

- **axe: 0 violations on every tab** — Home, Assist, Places, Safe Journey,
  SOS, Emergency(→SOS), Community, Settings, Caregiver all PASS.
- Heading outlines verified via Playwright simulating rotor navigation:
  - Home → H1:Home | H2:Home | H3:Status | H3:Permissions | H3:Assist | ...
  - Assist → H1:Assist | H2:Camera-to-voice assistance
  - Places → H1:Places | H2:Saved places | H2:Add a place
  - Safe Journey → H1:Safe Journey | H2:Start a safe journey
  - SOS → H1:SOS | H2:SOS center | H3:Emergency contacts | H2:SOS history
  - Community → H1:Community | H2:Community reports | H2:Add a report
  - Settings → H1:Settings | H2:<name> | H3:Voice & audio | H3:Hazard
    alerts | H3:Interface | H3:Account | H3:Reading history
  - Caregiver → H1:Caregiver | H2:People you support | H2:Open SOS
    requests | H2:Recent journeys
- 0 unlabeled buttons on any tab; live regions present on every screen
  (3–7 depending on tab); bottom nav visible on mobile and a landmark.
- 97/97 frontend tests, build clean, `npm audit` 0 vulnerabilities.

## Still honest gaps (unchanged)

- Real touch gestures (swipe right/left, double-tap) and real TalkBack /
  VoiceOver behavior cannot be exercised in headless Chromium. The heading
  outlines and landmark structure were verified structurally; actual screen
  reader output requires a real device (see docs/real-device-testing-2026-08-07.md).
- The SOS flow still uses `window.confirm()` (native dialog) in the legacy
  SosTab; acceptable, flagged previously.
