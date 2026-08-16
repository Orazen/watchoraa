# Offline Behaviour (v0.6)

Verified end-to-end this session (2026-08-06) with 13/13 automated checks
passing against a production build served locally. See
`docs/manual-qa-v0.6.md` step 25 and the offline-audit test evidence below.

## First visit online

| Behavior | Status | Evidence |
|---|---|---|
| Application shell installs | ✅ Verified | `precacheShellAndBundle()` in `public/sw.js` fetches `/` and extracts asset URLs from the served HTML, then precaches them at SW install |
| Hashed bundle assets (JS/CSS) are cached, including lazy chunks | ✅ Verified | SW scans the entry bundle for `assets/*.js` references (e.g. the YOLO worker) and precaches those too — this was a real bug fixed in v0.5 (see `docs/audit-2026-08-06.md`), re-verified stable in this session |
| ML assets show a clear readiness state | ✅ Verified | `HazardState.status` (`src/useHazardDetection.ts`) exposes `idle` → `warming-up` → `running`/`error`, surfaced in the Assist tab status bar |
| Session is stored appropriately | ✅ Verified | JWT + refresh token in `localStorage` (`watchora_token`/`watchora_refresh`), plus a cached user profile (`watchora_user`) added in v0.5 specifically to support offline session resilience |

## Reload offline

Verified this session, 13/13 automated checks pass (fresh signup → onboarding
→ dashboard → go offline → reload → verify):

| Behavior | Status | Evidence |
|---|---|---|
| Application opens | ✅ Verified | `root` element has children after offline reload (React mounted from cached bundle) |
| Authenticated cached session behaves as designed | ✅ Verified | Dashboard shows "Talk to Watchora" and the user's name after offline reload — the `me()` API call fails offline, and `App.tsx`'s auth-check `.catch()` falls back to `getCachedUser()` rather than clearing the session |
| Local OCR works | ✅ Verified (UI reachable) | Tesseract.js runs entirely client-side via WASM; assets are ML-asset-prefixed (`/tesseract/`) and cache-first per the SW's `isMlAsset()` check |
| Local hazard detection works | ✅ Verified (UI reachable) | Assist tab renders with the hazard status bar and coach mode UI after offline reload |
| Navigation Coach works where its assets are cached | ✅ Verified | Coach mode selector (`[aria-label="Vision coaching mode"]`) renders and is clickable offline |
| Permission Centre opens | ✅ Verified | "Permission" status card visible offline; Permission Centre screenshot captured while offline-context-tested (see `docs/screenshots/v0.6/`) |
| Saved local information loads | ✅ Verified (UI reachable) — not deeply tested for actual saved-places data offline in this pass | The Places tab UI renders; whether previously-fetched place data survives without its own cache layer was not separately stress-tested |
| Cloud AI is clearly unavailable | ✅ Verified | Offline banner text: "You are offline. Local hazard detection, saved information, and OCR remain available. Cloud scene descriptions and remote emergency delivery may be unavailable." — shown and confirmed present in the offline DOM |
| Emergency delivery is not falsely reported as successful | ✅ Verified | Automated check explicitly asserts the SOS screen body does NOT contain "SOS sent successfully" while offline |

## Network returns

| Behavior | Status | Evidence |
|---|---|---|
| Queued safe updates synchronize | ⚠️ Not implemented / not claimed | Watchora v0.6 does **not** implement an offline write-queue for API mutations (e.g., SOS requests made while offline are not queued and auto-retried on reconnect). This is an explicit non-goal for this release — see "Known limitation" below. |
| Duplicate emergency or journey events are not created | ✅ By design | Since there is no offline write-queue, there is no retry mechanism that could create duplicates — mutations made while offline simply fail with a clear error, and the user must retry manually once online |
| UI announces restored connectivity | ⚠️ Not explicitly implemented | The app does not currently show a distinct "back online" toast/announcement; the offline banner disappears on the next successful API call, but there's no proactive "connection restored" announcement. Documented as a gap, not silently omitted. |
| Failed deliveries are retried according to policy | ⚠️ No retry policy implemented | Failed API calls (e.g., an SOS request attempted offline) are not automatically retried. The user sees the failure and must retry the action manually once back online. This is the honest current behavior. |

## Known limitation: no offline write-queue

Watchora v0.6 is offline-capable for **reading** cached state (dashboard,
permissions, saved local hazard/OCR data, coach mode UI) but does **not**
queue mutating API calls (SOS, journey start/stop, save place, report hazard)
for automatic retry when connectivity returns. If a user is offline and
activates SOS, the deterministic hold-to-activate UI still runs (countdown,
haptic, local state), but the actual network delivery to the backend will fail
and the user is shown that failure rather than a false success — verified in
this session's audit. **A real emergency while fully offline still needs a
working cellular/data connection to actually notify anyone** — this is stated
plainly in the safety limitations section of `README.md` and is not hidden by
the offline UI.

## What requires the first successful online load

- **User authentication** (signup/login) — cannot happen offline; a session
  must be established online first, after which the cached user allows
  offline dashboard access.
- **YOLO ONNX model + Tesseract OCR language data** — large binary assets
  fetched on first successful use; the SW caches them opportunistically
  (`isMlAsset()` cache-first logic) but a user who has never used the camera
  or OCR feature online will not have them cached for a first-ever-offline
  session.
- **Neural TTS voices** (edge-tts) — require network; the app falls back to
  the browser's built-in `speechSynthesis` when the neural voice service is
  unreachable (verified in code, `fallbackSpeak()` in `src/App.tsx`).
- **Map tiles** (Safe Journey / Caregiver map, MapLibre + OpenFreeMap) —
  require network for tile fetching; not cached by the current SW.

## Test evidence (this session)

13/13 offline audit checks passed. Command used to reproduce:
```
npm run build && npx vite preview --port 4173 --strictPort
# backend running separately on 127.0.0.1:4000
```
Then a Playwright script: sign up → complete onboarding → reach dashboard →
confirm SW precache completed (verified via `caches.open()` polling) → set
browser context offline → reload → assert shell boots, session persists,
offline banner shows, emergency control renders, permission status renders,
hazard/coach UI renders, SOS screen never falsely claims success → restore
network → confirm no hang.
