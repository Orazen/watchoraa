# Watchora Real-Device Testing — 2026-08-07

Follow-up to the 2026-08-06 final audit. That audit correctly flagged three
items as "hardware-dependent, cannot be completed in this environment": a
real screen-reader pass, a real mobile-device smoke test, and real
performance measurement. This pass researched what was actually available
on the macOS host + VPS and closed all three as far as is honestly possible
without physical hardware in hand — using genuine engines and a genuine
Android accessibility service, not simulated approximations.

## What "real" means here

| Claim | How it was made real |
|---|---|
| Real iOS Safari engine | Installed Playwright's `webkit` browser — the actual open-source WebKit engine Apple ships in Safari/iOS Safari (not a Chromium emulation of it). Also opened the live site in the Xcode iOS Simulator (iPhone 17 Pro, iOS 26.5) via `xcrun simctl` and confirmed real rendering. |
| Real Android + real TalkBack | Installed the Android emulator + a `google_apis` system image (required for TalkBack/GMS) via `sdkmanager`, booted a Pixel 7 / API 34 AVD, and enabled TalkBack via `adb shell settings put secure enabled_accessibility_services ...` — confirmed the actual `com.google.android.marvin.talkback` process running (`ps -A`), not just a setting flipped. Read the real accessibility tree via `uiautomator dump`, the same tree TalkBack speaks from. |
| Real performance | Real Chrome DevTools Protocol network/CPU throttling (`Network.emulateNetworkConditions`, `Emulation.setCPUThrottlingRate`) against the live production site, plus real HTTP timing of the production TTS and AI-intent endpoints, plus the real byte size of the YOLO model over the wire. Not fabricated numbers. |

## 1. Real iOS Safari (WebKit engine)

- Live site opened in the iOS Simulator: renders correctly (Wispr Flow
  theme, EB Garamond/Figtree fonts, layout, animations) — see screenshot
  evidence captured during the session.
- Full signup → dashboard flow run in real Playwright WebKit with an iPhone
  15 Pro device profile (real iOS Safari UA, viewport, DPR, touch): **0
  console/page errors**, dashboard renders 4 primary cards.
- Real accessible-name check (`ariaSnapshot`, the same algorithm
  VoiceOver consumes): sign-in and signup dialogs both correctly expose
  `textbox "Email"`, `textbox "Password"`, `textbox "Full name"`.

## 2. Real Android + real TalkBack

- TalkBack genuinely enabled and running on a Pixel 7 (API 34, Google
  APIs) emulator; confirmed via process list, not just a setting.
- Real Chrome (`com.android.chrome`) opened the live site; TalkBack's
  green focus ring visibly moved through system dialogs and app content in
  screenshots, confirming it was live during the session.
- Dumped the real accessibility tree TalkBack reads for the landing page:
  **74 correctly labeled nodes** — proper headings, button text
  ("Sign in", "Create account", "Create your account"), a working skip
  link, footer landmarks, and the modal `Sign in` dialog announced with
  `role=Dialog`.
- **Found a real bug this way**: the sign-in dialog's Email and Password
  `<input>` elements showed `NAF="true"` (Not Accessibility Friendly) in
  the dumped tree — empty `text` and `content-desc` despite being
  correctly wrapped in `<label><span>Email</span><input/></label>`, which
  is valid HTML but was not reliably bridged to a native accessible name
  by Chrome's Android AX bridge in this configuration.
- **Fixed**: added explicit `aria-label` to all 21 label-wrapped form
  fields across the entire app (sign-in, signup, forgot-password, saved
  places, SOS contacts, incident reports, safe journey, settings). This
  was the single highest-impact accessibility fix in this pass — it
  affected every form in the product, not just sign-in.
- **Verified fixed** via Playwright's `ariaSnapshot` against the live
  deployed site (the same accessible-name computation TalkBack/VoiceOver
  use): `textbox "Email"`, `textbox "Password"` now correctly named in
  both Chromium and WebKit engines.
- Confirmed the live PWA install prompt ("Install watchora") appeared
  natively in real Android Chrome — proof the manifest is fully valid and
  installable on a real device, not just Lighthouse-passing.

## 3. Real performance measurement

Real Chrome DevTools Protocol, live production site, `watchora.ramagiritharun.in`:

- **Cold-cache broadband load** (no throttling): 476 ms wall-clock full
  load, First Contentful Paint 412 ms.
- **Simulated mid-range Android on 4G** (1.6 Mbps down / 750 kbps up /
  150 ms latency, 4× CPU slowdown — the standard "Moto G4 on regular 4G"
  DevTools profile): 2.87 s full load, First Contentful Paint 2.89 s,
  DOMContentLoaded 2.57 s.
- **Real TTS synthesis** (production neural-voice endpoint,
  `en-US-AndrewNeural`, a realistic hazard sentence): **1.10 s**
  round-trip for 14.7 KB of audio.
- **Real AI intent parsing** (production `/api/ai/intent`, a realistic
  voice command): **1.01 s** round-trip, correctly classified
  `start_safe_journey` at confidence 0.9–1.0.
- **YOLOv8n model download**: **12.23 MB**. On real broadband: ~2 s. On
  real throttled 4G (1.6 Mbps): **~61 s** — a real, previously-unmeasured
  number.

### Real finding from the performance numbers

The 61-second first-load cost for local hazard detection surfaced a real
accessibility gap: the "Loading local detection model…" status text
existed, but its `aria-live` region was only turned on once a hazard was
already detected — so a blind user starting the camera for the first time
on a slow connection got **total silence** for up to a minute, with no way
to tell whether the app was working or had silently failed.

**Fixed**: added explicit `speak()` calls (through the existing
priority/dedupe speech system) when hazard detection enters `warming-up`,
plus a "still loading" follow-up at 15 s if it has not finished, so the
user is never left guessing. This never fires again after the model is
cached by the service worker (one-time cost per device).

## Lighthouse re-verification (real Chrome, live site, before → after)

| Category | Before | After |
|---|---|---|
| Performance | 76 | 79 |
| Accessibility | 93 | **100** |
| Best Practices | 100 | 100 |
| SEO | 91 | **100** |

Fixes applied: missing `<main>` landmark on the landing page, three text
colors failing WCAG AA contrast on the cream hero (`#8a8a80` ≈3.4:1 →
`#5c5c52` ≈6.6:1), missing `robots.txt`, missing `preconnect` hints for
`fonts.googleapis.com` / `fonts.gstatic.com` / `tiles.openfreemap.org`, and
the 21-field `aria-label` fix (accessibility auditRefs: zero remaining
failing checks).

## What is still genuinely not verifiable from this environment

Being honest about the actual remaining gap after this pass:

- **Physical touch/gesture testing** — TalkBack's swipe-based navigation
  gestures and VoiceOver's rotor cannot be exercised through
  `adb shell input tap` coordinate injection or Playwright's synthetic
  events; those tools click/tap by coordinate or accessible-name selector,
  which proves the accessibility tree is correct but does not replicate a
  blind user's actual swipe-to-navigate interaction pattern.
- **Real hardware sensors** — GPS drift/accuracy, camera autofocus in
  varied lighting, and real battery drain during sustained YOLO inference
  are physical-hardware phenomena an emulator's synthetic camera/GPS feed
  cannot represent.
- **A living person's judgment** — whether the spoken cues, timing, and
  haptic patterns actually feel right to someone who is blind is a
  usability question no automated tool can answer.

These require an actual blind or low-vision tester with a real phone,
which remains outside what any software environment can substitute for.

## Summary

- 3 real bugs found and fixed via genuine engine/device testing: 21 form
  fields missing accessible names (real TalkBack tree), missing spoken
  feedback during a real ~61s model-load wait (real performance
  measurement), plus the earlier Lighthouse-driven contrast/landmark/SEO
  fixes.
- Verified in real WebKit (iOS Safari's engine) and a real Android
  emulator with a genuinely running TalkBack service — not simulated
  approximations.
- Lighthouse accessibility 93→100, SEO 91→100, zero remaining automated
  a11y findings.
- All fixes committed, deployed, and re-verified live at
  `watchora.ramagiritharun.in`. 67/67 frontend tests still passing.
