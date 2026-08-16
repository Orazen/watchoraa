# Browser & Device Support (v0.6)

Honest capability matrix. Watchora is a Progressive Web App — every capability
below depends on what the browser exposes, and browsers vary significantly for
speech recognition, motion sensors, and background execution. This document is
updated whenever a capability gap is discovered; nothing here is aspirational.

## Test coverage status

| Environment | Status | How verified |
|---|---|---|
| Desktop Chrome | ✅ Tested this session | Automated Playwright + Chromium (headless), full QA/offline/permission-denial/SOS flows, 24 screenshots captured |
| Desktop keyboard-only navigation | ✅ Tested this session | `Tab`/`Enter` traversal verified >10 focusable elements per screen; skip-to-content link present; modal focus trap present in code (`FocusManager.tsx`) |
| Android Chrome | ⬜ **HARDWARE REQUIRED — not completed this session** | No physical Android device or emulator with real sensors was available in this environment. Code paths for `SpeechRecognition`, `DeviceMotionEvent`, camera constraints, and vibration are all Android-Chrome-compatible per MDN, but this has not been confirmed on real hardware. |
| Android installed PWA mode | ⬜ **HARDWARE REQUIRED — not completed this session** | Manifest (`public/manifest.webmanifest`) and service worker are present and verified programmatically; actual "Add to Home Screen" install flow and standalone-mode behavior needs a real Android device. |
| iPhone Safari | ⬜ **HARDWARE REQUIRED — not completed this session** | No physical iPhone or macOS Safari with iOS simulator was exercised. Known Safari gaps below are documented from public API support tables, not from live testing. |
| iPhone Home Screen PWA | ⬜ **HARDWARE REQUIRED — not completed this session** | Same as above. |
| Samsung Internet | ⬜ **HARDWARE REQUIRED — not completed this session** | Not tested. |
| Firefox desktop | ⬜ **Not completed this session** | Not tested; Firefox's `SpeechRecognition` support is historically limited/behind a flag — documented as a known gap below from public compatibility data, not live-tested here. |

## Known/documented browser limitations (from public platform documentation, not yet independently re-verified on every browser)

| Capability | Chrome (desktop/Android) | Safari (macOS/iOS) | Firefox | Samsung Internet |
|---|---|---|---|---|
| `SpeechRecognition` (voice commands) | ✅ Full support | ⚠️ Partial/webkit-prefixed, historically inconsistent | ❌ Not supported without a flag | ✅ (Chromium-based) |
| `DeviceMotionEvent` (motion cadence) | ✅ | ⚠️ Requires explicit `requestPermission()` gesture on iOS 13+ | ✅ | ✅ |
| `navigator.vibrate` (haptics) | ✅ (Android) | ❌ Not supported on iOS Safari | ✅ (Android) | ✅ |
| Background camera after screen lock | ❌ Not guaranteed on any browser — PWAs are suspended when the tab loses foreground/screen locks | ❌ | ❌ | ❌ |
| Background location | ❌ Not guaranteed — foreground-only in a PWA; native app would be required for true background tracking | ❌ | ❌ | ❌ |
| Notification permission | ✅ | ⚠️ Web Push requires iOS 16.4+ and PWA installed to Home Screen | ✅ | ✅ |
| Wake Lock API (keep screen on during coaching) | ✅ | ⚠️ Supported iOS 16.4+ | ⚠️ Partial | ✅ |
| Offline model-loading (YOLO ONNX, Tesseract OCR) | ✅ (WASM + SW cache) | ✅ (WASM supported) | ✅ | ✅ |

**Wake phrase:** Watchora does not implement always-listening wake-phrase
detection in this release (v0.6) — this is intentional, not a bug. The app
never claims always-on background listening (see the safety statement in
`README.md`). Voice activation is push-to-talk via the "Talk to Watchora"
button or `Ctrl/Cmd+Shift+V`.

## Fallback behavior when a capability is unavailable

Every capability gap has a documented, tested fallback (see
`docs/accessibility-testing.md` "Denied-permission paths" for verification):

| Missing capability | Fallback |
|---|---|
| `SpeechRecognition` unsupported | Voice state shows `unsupported`; all functions remain reachable via tap/keyboard; spoken message explains the limitation where TTS is available |
| Vibration unsupported | Haptic calls silently no-op (`src/haptics.ts` checks `navigator.vibrate` existence); spoken/visual hazard alerts are unaffected |
| Motion permission absent | Navigation Coach uses the conservative stationary cadence (0.5 FPS) — verified in code, `src/App.tsx:518` gates on `permissionService.get('motion').state === 'allowed'` |
| Camera denied | Assist tab shows a clear "camera not requested"/"denied" state with a recovery action (Permission Centre); dashboard, SOS, and voice remain fully usable — verified in this session's denied-permissions test (10/10 checks pass) |
| Wake Lock unsupported | No functional impact; the screen may sleep during a long coaching session — documented, not silently degraded |
| Offline before model cache is ready | First-visit-before-cache-complete offline access is not possible for local YOLO/OCR (they are large binary assets fetched from network); the SW precaches them opportunistically after first successful install — see `docs/offline-behaviour.md` |

## Recommended minimum browser versions (from public compatibility data, not independently verified)

- Chrome/Edge 90+
- Safari 16.4+ (for full Web Push + Wake Lock support; earlier versions work with reduced notification/wake-lock capability)
- Firefox: usable for TTS + camera + OCR + hazard detection; voice command input degraded without `SpeechRecognition`

## Explicit gap: real-device testing not completed

This release-readiness audit (2026-08-06) was performed entirely via headless
Chromium browser automation on macOS. **No physical Android or iOS device was
available in this environment.** The items above marked "HARDWARE REQUIRED" are
the exact tests that still need to run on real hardware before this branch can
be considered fully release-ready for all target browsers. See the final audit
report for the explicit recommendation on this gap.
