# Watchora — Growth Plan 2026-09

Written from a full product/code audit (see `docs/hardening-2026-09-02.md`), the
existing competitive analysis (`docs/competitive-edge.md`), and fresh market
research (2026-09-02). Position: **where to play, how to win, what to build
next.**

---

## 1. Where we are (honest)

- **Product**: the only browser-based assistant that combines real-time scene
  narration, on-device YOLO hazard detection with haptics, offline OCR,
  GPS-anchored places, deterministic SOS with caregiver portal, and moderated
  community hazard reports. Competing hackathon-stage projects (EyeGuide,
  Visio, CFassist, SightlineAI, VisionVoice) have none of the safety,
  accounts, or offline layers. Incumbents (Be My Eyes, Seeing AI, Envision,
  Aira) are app-store native, mostly English-first.
- **Engineering posture**: after the 2026-09-02 hardening pass, the trust
  foundations are real (bcrypt/JWT/rotation with reuse kill-switch, RBAC on
  SOS acknowledgements, enforced consent expiry, email notifications, audit
  trail). Deployment: single Docker image (Dokploy) + Vercel demo deployment.
- **Reality check**: zero external users, no native app, PWA discovery is
  weak, and the demo deployment still has fake data paths. The product is
  ahead of the go-to-market — the GTM is at zero.

## 2. Market (research-verified)

- **Population**: ≥2.2B people with vision impairment (WHO, Feb 2026 fact
  sheet); ~$411B/yr productivity loss; prevalence 4× higher in low/middle-
  income regions. Blindness specifically ~40–50M (IAPB estimates).
- **India is the wedge**: largest blind population of any country, a
  smartphone-first assistive-tech audience, and Watchora already ships
  neural TTS in every major Indian language (323 voices) — something no
  incumbent does well. **Competitors are English/US-centric; the Indic flank
  is open.**
- **Business-model lessons**:
  - Be My Eyes: free forever for users; monetize enterprises (Service
    Connect — Microsoft, Google, Meta, Hilton pay). Raised $6.1M in 2025.
  - Aira: institutions sponsor free use at venues (B2B2C).
  - NaviLens: sells infrastructure to transit agencies (NYC MTA, Barcelona).
  - Envision/OrCam/WeWALK: users/payers WILL pay recurring — but skip
    hardware for now.
  - Microsoft Soundscape was **retired**, stranding users → independent
    products win trust by publishing a durability commitment.

## 3. Strategy: three bets

### Bet 1 — India-first, caregiver-led (primary)
Individual blind users are often price-constrained; **the family is the
payer**. Watchora's caregiver portal + SOS + safe-journey monitoring is
exactly what a parent/spouse will pay for.
- Free tier: narration, OCR, hazard layer, saved places (the "second pair of
  eyes" — never paywalled; it is the trust builder).
- **Family Plan ($3–5/mo or ₹199/mo)**: live location sharing, journey
  escalation alerts (email → SMS → WhatsApp), SOS delivery receipts,
  multi-caregiver groups.
- Distribution: blind schools (500+ in India), NAB/LV Prasad partnerships,
  WhatsApp/Telegram blind-tech communities (where this audience already
  lives), regional-language launch waves (Hindi → Tamil → Telugu → Bengali).

### Bet 2 — Credibility-first in US/UK (secondary)
This community moves on trust: NFB/AFB conventions, blind-tech YouTubers
(Molly Burke, The Blind Life), VPAT publication for agency procurement.
Seed 20 beta users via O&M specialists before any paid push. No pricing in
the US until retention is proven.

### Bet 3 — Community hazard data as the moat (compounding)
Every walk uploads moderated hazard reports. City-by-city this becomes a
dataset no competitor has — and it is licensable later (transit agencies,
delivery/logistics accessibility routing). Free users generate it; it is the
network effect of the product.

## 4. Growth loops (built into the product)

1. **Caregiver invite loop**: every blind user naturally enrolls 1–3
   caregivers. Each caregiver signup is a viral invitation and a future
   payer. → Ship: "invite your family" step in onboarding (does not exist
   yet — top of the build list).
2. **Hazard map network effect**: more users → better local hazard feed →
   more value per walk.
3. **Language expansion**: each new language opens a new regional community
   with near-zero marginal cost (Edge TTS voices already cover 323).

## 5. North-star metrics

- **Weekly Journeys Monitored** (a Safe Journey or SOS session with ≥1
  location ping) — measures the safety value delivered, not vanity usage.
- Supporting: activated users (≥1 successful camera description in week 1),
  caregiver WAU, D7 retention, notification delivery success rate (must be
  >99% before charging for Family Plan — the promise has to be real).

## 6. 90-day roadmap (post-hardening)

**Days 0–30 — Make it real (trust + notifications)**
1. Deploy hardening pass; rotate leaked Sarvam key; configure SMTP.
2. WhatsApp/SMS delivery for SOS via a provider (Gupshup/Twilio) — email
   alone is too slow for emergencies. ← **highest-value feature in the repo
   right now.**
3. Caregiver invite flow in onboarding (email/SMS/WhatsApp link) — turns on
   Growth Loop #1.
4. Kill or clearly label all remaining demo-data paths in the client
   (`api.ts` silent fallback) — a demo that pretends to work will kill trust
   with exactly the reviewers who matter.

**Days 31–60 — Get to 100 real users (India)**
5. Partner with 2 blind schools / NAB chapter for a guided pilot (10 users
   each, weekly feedback calls).
6. Hindi/first-language onboarding; PWA install education for TalkBack users.
7. Publish a **durability commitment + data policy** page (counters the
   Soundscape effect; this community has been burned).
8. Instrument metrics above (privacy-respecting, opt-in analytics).

**Days 61–90 — Prove retention, prep native**
9. Analyze D7/D30; fix the top 3 drop-off causes.
10. Ship an Android native wrapper (Capacitor/Custom Tabs of the PWA) for
    Play Store presence — store presence is itself a trust signal, and
    background journey monitoring needs native anyway.
11. Draft Family Plan pricing test with pilot families; open SBIR /
    Google.org / Microsoft AI for Accessibility applications (grants fit the
    free-tier safety model).

## 7. Non-goals (unchanged, load-bearing)

Never replace the cane/guide dog; never authorize crossings; never identify
people as threats; no always-on background claims. The honesty positioning
is a competitive asset — protect it.

## 8. Key risks

| Risk | Mitigation |
|---|---|
| Missed hazard → user harm | conservative thresholds, fail-silent design (shipped), liability disclaimers, published accuracy benchmarks |
| Trust deficit (Soundscape effect) | durability commitment, org partnerships, open roadmap |
| Gemini cost at free scale | on-device YOLO/OCR already offload; cache aggressively; rate limits (shipped) |
| PWA discovery ceiling | native wrapper by day ~90 |
| Notification failure = false safety | delivery receipts surfaced to user; audit `contacts_notified`; SMS/WhatsApp redundancy |

---

*Sources: WHO fact sheet (Feb 2026), bemyeyes.com, seeingai.com,
letsenvision.com, aira.io, wewalk.io, navilens.com, wayaround.com,
microsoft.com/research (Soundscape). Some competitor pricing figures
unverifiable at research time — re-verify before investor materials.*
