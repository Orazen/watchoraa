# Research: PaddleOCR + Blind Map Control (2026-09-03)

Two deep studies commissioned to guide the next tranche. Full technical
briefs preserved in session research; key decisions and roadmap below.

## Study 1 — PaddleOCR vs Tesseract.js (verdict: integrate PP-OCRv5 mobile)

**Feasibility confirmed.** PP-OCRv5 mobile runs in the browser via
onnxruntime-web — the exact infrastructure Watchora already runs for YOLO.
Two maintained runtimes exist: the `paddleocr` npm package (TS, ONNX,
det+rec, no opencv dependency — preferred) and `esearch-ocr`. Apache-2.0
(models + code).

**Numbers**: English det+rec ≈ 12.6 MB ONNX (4.8 MB det + 7.8 MB rec) vs
current 9.5 MB Tesseract eng — the ~60 MB warm list absorbs it. Script
models for Hindi (devanagari) and Tamil are 7.9 MB each, share the same det.
PP-OCRv5 mobile det scores 0.910 on printed English; Tesseract's weak point
is precisely detection (page segmentation on signage/receipts), which is the
blind-user content mix. WASM latency estimate 1–5 s per signage shot on
mid-range phones (unverified — prototype with a 736px min-side det cap).

**Decision**: integrate PP-OCRv5 mobile via `paddleocr` npm as a second
on-device engine in a new worker (mirroring `yolo.worker.ts`), keeping
Tesseract.js as transition fallback, Gemini fallback unchanged. Add
devanagari/ta rec lazily per user language. **Status: next tranche — this is
a multi-day build (worker + model hosting + warm-list + tests).**

## Study 2 — Map & location control for blind users (Soundscape patterns)

**Source of truth**: Microsoft Soundscape (open-sourced, MIT) — loved because
it built autonomy and ambient awareness, not turn-by-turn. Core patterns,
ranked for Watchora:

1. **Spoken around-me lists** — "What's around me?" → POIs with distance +
   clock-direction, capped, selectable. Data: OSM Overpass (proxied + cached
   + throttled).
2. **Virtual beacons** — pick a target; periodic "beacon at 10 o'clock, 150
   metres" with stereo-panned tone; "arrived" within 15 m.
3. **Ambient callouts** — announce OSM POIs passed within 40 m, ≥25 s apart,
   only during active journeys. (PWA limitation: screen must be on.)
4. **Rich "where am I"** — road + area + heading.
5. **Saved places with clock-direction on demand.**
6. **Journey departure/arrival spoken summaries.**

Data policy for OSM: Nominatim allows max 1 req/s with a real User-Agent;
proxy + cache mandatory (Watchora does both: server route with 20/min
limiter and an ~11 m-grid LRU cache, `NOMINATIM_BASE_URL` swappable per the
"apps must switch endpoints without update" policy). Compass: iOS needs a
one-time user-gesture permission (`DeviceOrientationEvent.requestPermission`)
— ship an "Enable compass" button; Android exposes absolute heading.

## Shipped in this tranche (patterns 4 + 5)

- **`where am I`** → reverse geocode via server proxy → "You are on Church
  Road, in Bengaluru. Nearest saved place: Home, 340 m away, at about 9
  o'clock." Each piece fails honestly and independently.
- **`list my places`** → speaks the three nearest saved places with distance
  + clock-direction (previously it only opened a tab and never spoke).
- New server route `GET /api/geocode/reverse` (safeFetch, Nominatim policy
  compliant, injectable provider, 4 tests).

## Roadmap (next tranches, in order)

1. PP-OCRv5 mobile integration (Study 1 decision above).
2. Virtual beacons to saved places (pattern 2 — all client-side; geo +
   speech infra already exist).
3. "Around me" Overpass POI lists (pattern 1 — needs Overpass proxy route,
   same safeFetch/cache/limiter pattern as geocode).
4. Ambient callouts during journeys (pattern 3; PWA backgrounding limits
   mean screen-on only — validate with pilot users).
5. Compass permission button + heading-aware phrasing.
