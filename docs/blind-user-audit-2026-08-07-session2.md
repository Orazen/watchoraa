# Blind-User-Perspective Audit — 2026-08-07 (Session 2)

## Fixes Applied

### 1. CRITICAL: Battery API accessed without consent (Privacy violation)
**Finding:** `SafeJourneyTab` called `navigator.getBattery()` unconditionally and sent the level to the server via `api.journeyLocation()` without any permission request or user consent. Battery data was stored in `JourneyLocation.battery` and `EmergencySession.battery` tables.

**Fix:**
- Added `battery` to `PermissionKey`, `PermissionService`, `PermissionTypes` (label, explanation, CRITICAL_PERMISSIONS)
- Added `requestBattery()` method in `PermissionService` that attempts `getBattery()` and gates future reads
- Added battery step to `PermissionOnboarding` with spoken guidance and explicit "Enable battery sharing / Skip" buttons
- `SafeJourneyTab` now only reads battery if `permissionService.get('battery').state === 'allowed'`
- `PermissionCenter` updated to allow requesting battery and show fallback explanation

### 2. Motion permission never actually requested
**Finding:** `PermissionOnboarding` had a "Motion sensors" step with only "Continue to summary" — no actual browser API call. On iOS 13+ Safari, `DeviceOrientationEvent.requestPermission()` is required.

**Fix:**
- Added `requestMotion()` in `PermissionService` that calls `DeviceOrientationEvent.requestPermission()` on iOS, falls back to 'allowed' on other browsers
- Changed motion onboarding step to `requestAndAdvance('motion', 'battery')` with proper "Enable motion sensors" button

### 3. No navigation maps / ARIA landmark structure
**Finding:** Tab buttons had `role="tab"` and `aria-selected` but no `aria-controls`, no panel IDs, no `role="tabpanel"`. Screen readers couldn't navigate by region or understand the page structure.

**Fix:**
- Added `id={`tab-${key}`}` and `aria-controls={`panel-${key}`}` to all sidebar + bottom-nav tab buttons
- Wrapped every tab's content in `<section role="tabpanel" id="panel-${key}" aria-labelledby="tab-${key}">`

### 4. Silent tab changes
**Finding:** Tapping a tab button updated the visual content and `document.title`, but screen readers got zero feedback. A blind user wouldn't know the screen changed.

**Fix:**
- Added `useEffect` on `activeTab` that announces `${label} tab` via the live region + speaks the tab name via TTS (skipped on initial mount)

### 5. Loading states invisible to screen readers
**Finding:** All 10 "Loading…" paragraphs across tabs (Places, SOS, Community, Settings, Admin) were plain text with no `aria-live`. A blind user switching tabs would get silence while data loaded.

**Fix:**
- Added `role="status" aria-live="polite"` to all loading paragraphs

## Live Verification Results

Verified against `https://watchora.ramagiritharun.in` via Playwright headless Chromium:

- ✅ `Has tabpanel roles: true` — all 9 tab panels have proper landmark roles
- ✅ `Tabs with aria-controls: 14` — all sidebar + bottom-nav tabs linked to panels
- ✅ `BATTERY STEP FOUND` — onboarding now includes "Battery sharing" step
- ✅ `Battery enable button: present` — explicit consent request exists
- ✅ `Live region present: true` — `announce()` messages reach screen readers
- ✅ `Skip link present: true` — skip link moves focus to main content
- ✅ Site healthy: HTTP 200, `/api/health` returns `{"ok":true}`

## Commits

1. `59d148b` — a11y+privacy: battery permission, motion request, navigation maps
2. `5a9027c` — a11y+privacy: tab announcements, loading states, logical flow audit

Both pushed to GitHub `main`, auto-deployed via Dokploy webhook.

## Honest Gaps

1. **Test user cleanup:** Two test users were created during live verification (`audit-{timestamp}@test.in`). SSH access to the production server (173.249.38.101) is unavailable (port 22 closed), so cleanup must be done server-side. SQL to run:
   ```sql
   DELETE FROM "User" WHERE email LIKE 'audit-%@test.in';
   ```

2. **Real device sound:** The ARIA structure and live regions are verified in the accessibility tree, but actual TalkBack/VoiceOver spoken output can only be confirmed on physical hardware. The emulator testing confirmed the tree structure but not the audio output.

3. **Motion permission on iOS:** The `requestMotion()` implementation uses `DeviceOrientationEvent.requestPermission()` which is the correct iOS API, but it can only be fully verified on a real iPhone with Safari.

4. **tsc -b local issue:** `npm run build` fails locally on Mac due to pre-existing global `babel-plugin-react-compiler` type errors in `/Users/ramagiritharun/node_modules` (not project-local). `vite build` succeeds. Tests pass (97/97). The VPS build is unaffected.

## Tests

- Frontend: 97/97 passing
- No new vulnerabilities introduced
