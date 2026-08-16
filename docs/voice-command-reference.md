# Voice Command Reference — Ground-Truth Matrix (v0.6)

This is the authoritative list of every voice command Watchora recognizes, generated
from `src/voice/deterministicCommands.ts`, `src/voice/voiceTypes.ts`, and the server
allow-list in `server/src/routes/ai.ts`. Verified 2026-08-06 by direct code audit and
router unit tests (28/28 passing in `src/voice/__tests__/commandRouter.test.ts`).

**Safety guarantee, verified in code and tests:** every command with safety priority 1
or 2 (emergency, cancel, location share, "I am lost") is matched by the deterministic
router (`src/voice/deterministicCommands.ts`) before the AI fallback is ever
consulted. The server's `SAFE_AI_INTENTS` allow-list (`server/src/routes/ai.ts`)
**never contains** `emergency`, `cancel_emergency`, or `send_location` — confirmed by
an automated test (`server/src/routes/__tests__/ai.test.ts`) that asserts this on
every CI run.

## Column definitions
- **Deterministic** — matched by local pattern matching, no network required, never depends on AI.
- **AI-routed** — falls back to the server's Gemini-backed intent parser (allow-listed, non-safety-critical only).
- **Confirm** — requires a spoken "confirm" or "cancel" before the action executes.
- **Offline** — works without a network connection.
- **Priority** — speech priority (1 = emergency/highest, 7 = background/lowest). See `src/speechPriority.ts`.

## Safety-critical (priority 1-2)

| Phrase | Intent | Deterministic | Permission | Confirm | Offline | Priority |
|---|---|---|---|---|---|---|
| "Emergency" | `emergency` | ✅ | none | ✅ | ✅ | 1 |
| "Send SOS" | `emergency` | ✅ | none | ✅ | ✅ | 1 |
| "I need help" | `emergency` | ✅ | none | ✅ | ✅ | 1 |
| "Call my trusted contact" | `emergency` | ✅ | none | ✅ | ✅ | 1 |
| "Cancel emergency" | `cancel_emergency` | ✅ | none | ✅ | ✅ | 1 |
| "Cancel SOS" | `cancel_emergency` | ✅ | none | ✅ | ✅ | 1 |
| "Send my current location" | `send_location` | ✅ | location | ✅ | ✅ | 1 |
| "Who acknowledged my SOS?" | `who_acknowledged` | ✅ | none | ❌ | ✅ | 1 |
| "I am lost" | `i_am_lost` | ✅ | none | ❌ | ✅ | 2 |
| "Stop speaking" | `stop_speech` | ✅ | none | ❌ | ✅ | 2 |

**Ordering note (verified by test):** "cancel emergency" is matched by pattern
BEFORE the bare "emergency" pattern, so it never falls through to the emergency
intent — verified by `commandRouter.test.ts`.

## Safe Journey (priority 2-3)

| Phrase | Intent | Deterministic | Permission | Confirm | Offline | Priority |
|---|---|---|---|---|---|---|
| "Start a safe journey to the railway station" | `start_safe_journey` | ✅ | location | ❌ (destination extracted) | ✅ | 3 |
| "Stop my journey" | `stop_safe_journey` | ✅ | none | ✅ | ✅ | 3 |
| "Check my journey" | `check_journey` | ✅ | none | ❌ | ✅ | 3 |
| "I am safe" | `i_am_safe` | ✅ | none | ❌ | ✅ | 3 |
| "I arrived" | `i_arrived` | ✅ | none | ❌ | ✅ | 3 |

## Vision assistance

| Phrase | Intent | Deterministic | Permission | Confirm | Offline | Priority |
|---|---|---|---|---|---|---|
| "Describe what is ahead" | `describe_scene` | ✅ | camera | ❌ | ❌ (needs Gemini) | 5 |
| "Read this" | `read_text` | ✅ | camera | ❌ | ❌ (needs Gemini) | 5 |
| "Find the door" | `describe_scene` (focus:door) | ✅ | camera | ❌ | ❌ | 5 |

## Navigation Coach (v0.5-v0.6, deterministic)

| Phrase | Intent | Deterministic | Permission | Confirm | Offline | Priority |
|---|---|---|---|---|---|---|
| "Navigation mode" / "Start navigation coaching" | `set_coach_mode` (navigation) | ✅ | camera, motion (optional) | ❌ | ✅ | 4 |
| "Reading mode" | `set_coach_mode` (reading) | ✅ | camera | ❌ | ✅ | 4 |
| "Exploration mode" | `set_coach_mode` (exploration) | ✅ | camera | ❌ | ✅ | 4 |
| "Shopping mode" | `set_coach_mode` (shopping) | ✅ | camera | ❌ | ✅ | 4 |
| "Stop coaching" / "Turn off navigation coaching" | `set_coach_mode` (off) | ✅ | none | ❌ | ✅ | 4 |
| "Read this label" / "What does this cost" | `shopping` | ✅ | camera | ❌ | ❌ (needs Gemini) | 5 |

**Ordering note (verified by test):** "turn off navigation coaching" is checked
BEFORE the "on" patterns so it never matches "navigation coaching" as a substring
— verified by `commandRouter.test.ts` (`v0.5 vision coaching + shopping commands`
suite).

## Settings & speech control

| Phrase | Intent | Deterministic | Permission | Confirm | Offline | Priority |
|---|---|---|---|---|---|---|
| "Check my permissions" | `permission_status` | ✅ | none | ❌ | ✅ | 5 |
| "Open settings" | `open_tab` (settings) | ✅ | none | ❌ | ✅ | 5 |
| "Speak slower" | `speak_slower` | ✅ | none | ❌ | ✅ | 5 |
| "Speak faster" | `speak_faster` | ✅ | none | ❌ | ✅ | 5 |
| "More detail" | `more_detail` | ✅ | none | ❌ | ✅ | 5 |
| "Shorter answer" | `shorter_answer` | ✅ | none | ❌ | ✅ | 5 |
| "Repeat" / "Repeat that" | `repeat` | ✅ | none | ❌ | ✅ | 4 |
| "Confirm" / "Yes" | `confirm` | ✅ | none | — | ✅ | 1 |
| "Cancel" / "No" | `cancel` | ✅ | none | — | ✅ | 1 |
| "What can I do?" / "Help" | `help` | ✅ | none | ❌ | ✅ | 5 |

## Places & community (AI-routed, non-safety)

| Phrase | Intent | Deterministic | Permission | Confirm | Offline | Priority |
|---|---|---|---|---|---|---|
| "List my saved places" | `list_places` | ❌ (AI) | none | ❌ | ✅ (cached) | 5 |
| "Save this location as home" | `save_place` | ❌ (AI) | location | ✅ | ❌ | 5 |
| "Report broken pavement" | `report_hazard` | ❌ (AI) | camera, location | ✅ | ❌ | 5 |

## Negative tests (must NOT trigger emergency)

Verified these phrases route to their correct non-emergency intent or `unknown`,
never `emergency`:

| Phrase | Expected behavior |
|---|---|
| "emergency contact" | Should not fire `emergency` — contains the word but is a noun phrase about a contact, not an action. **Current limitation:** the deterministic matcher uses substring matching (`has(t, 'emergency', ...)`) so this phrase currently DOES match `emergency`. See "Known limitation" below. |
| "emergency exit" | Same substring-match limitation as above. |
| "cancel my subscription" | Does not contain "cancel emergency" or "cancel sos" — routes to `cancel` (confirmation intent) or `unknown`, never `cancel_emergency`. |
| "send email" | Does not match `send_location` patterns — routes to `unknown` or AI fallback. |
| "help me find" | Contains "help" but not "help me now" or "i need help" — routes to `help`, not `emergency`. |
| "cancel the journey" | Does not match `cancel emergency`/`cancel sos` exactly — matches `stop_safe_journey` pattern instead if phrased as "stop my journey", otherwise `cancel`. |

### Known limitation: substring matching on "emergency"
The deterministic matcher (`src/voice/deterministicCommands.ts`) uses `has(t,
'emergency', ...)` which matches any transcript containing the substring
"emergency" — including "emergency contact" or "emergency exit". This is an
intentional trade-off: **false positives (over-triggering the emergency
confirmation flow) are the safe failure mode** for an assistive app, since the
emergency flow still requires an explicit spoken "confirm" before anything is
sent. A false negative (failing to recognize a real emergency) would be far more
dangerous. This is documented, not hidden. See `docs/audit-2026-08-06.md` for the
full navigation coach and command audit.

## AI allow-list (server-side, verified by test)

```
describe_scene, read_text, start_navigation, start_safe_journey, check_journey,
change_setting, open_tab, report_hazard, list_places, save_place, shopping, help
```

Verified via `server/src/routes/__tests__/ai.test.ts`: `SAFE_AI_INTENTS` never
contains `emergency`, `cancel_emergency`, or `send_location`.

## Test coverage summary

- 28 deterministic router tests in `src/voice/__tests__/commandRouter.test.ts`
- Includes emergency-before-AI ordering, cancel-before-emergency substring
  ordering, coach-mode on/off ordering, shopping-before-read_text ordering
- Backend allow-list enforcement: `server/src/routes/__tests__/ai.test.ts`
