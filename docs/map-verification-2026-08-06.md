# Map feature (MapLibre + OpenFreeMap) — live verification 2026-08-06

## What shipped

- **MapView.tsx** — reusable MapLibre GL JS component (dynamic import → separate
  954 kB lazy chunk, only loaded when a map tab is opened), Wispr-themed
  pulsing lavender marker, breadcrumb trail line, compass + metric scale.
- **Safe Journey tab** — live map of the blind user's own position while a
  journey is active (uses `navigator.geolocation` watch updates, falls back to
  the journey's last reported point).
- **Caregiver tab** — per-user "📍 Live location" expander showing the monitored
  user's position + 2-hour trail, only when consent is granted.
- **New endpoint** `GET /api/caregiver/location/:userId` — returns
  `{ consent, journey, trail }` only when BOTH the trusted-contact
  `canSeeLocation` flag AND the active journey's `shareLive` flag are true.
  Unauthorized reads return `{ journey: null, consent: false }` (uniform shape,
  no side-channel about which condition failed).
- **Consent toggle** — `PATCH /api/contacts/:id` + SOS tab toggle + add-contact
  checkbox, so a blind user can grant/revoke live-location visibility per
  contact. (This flag existed in the schema but had no way to be set — the map
  would otherwise never show anything.)
- **CSP** — `connect-src` now allows `https://tiles.openfreemap.org`
  (style JSON, sprite/glyphs, vector tiles all served from that one domain).
- **Tests** — 5 new backend tests: consent:false (no contact), consent:true +
  null journey (no active sharing journey), journey + trail (both flags), blind
  user blocked (403), PATCH consent toggle grant/revoke/foreign 404.

## Verified live against watchora.ramagiritharun.in

1. **API consent gating** (real users, real journeys):
   - grant → caregiver receives `consent:true`, journey payload, 3-point trail
   - unrelated user → `consent:false`, `journey:null`
   - PATCH revoke → next fetch returns `consent:false` (revocation works)
2. **Safe Journey tab (headless Chromium)**: map canvas + live marker render.
3. **Caregiver tab (headless Chromium)**: "Live location" expander renders the
   map, marker, and journey destination text.
4. **Tiles/CSP**: 4 requests to `tiles.openfreemap.org` (style + tiles + fonts),
   0 failures, 0 CSP violations.
5. **Unit suite**: 61/61 passing (server), frontend + server builds clean.

Map tiles are free / no API key (OpenFreeMap, ODbL/OSM attribution shown on map).

## Notes

- E2E used throwaway `map-e2e-*` users, removed from the DB afterwards.
- `docs/` entry records the live verification; the E2E script itself was kept
  out of the repo (contains a host-specific Playwright path).
