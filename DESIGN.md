# Watchora — Design System v2: "High-contrast ink on paper"

Status: active, replaces the ad-hoc v0.x stylesheet conventions.
Every value below was chosen by computing WCAG contrast ratios, not by taste.
Re-verify with `node /tmp/contrast.mjs` (or the table in this file) after any change.

## The premise

Watchora is used by blind and low-vision people. For them the visual design *is*
the accessibility: contrast, type size, and target size are not polish, they are
the product. v1 got the identity right (warm paper, ink rules, forest green) but
was too soft to use: muted body text sat at 4.07:1, several state colours were
below AA, the danger colour had no dark-mode value at all, and the main command
bar turned white-on-lavender (1.31:1) in dark mode.

v2 keeps the identity and raises its voice. The reference is letterpress: heavy
ink on warm paper, colour used as *weight* rather than as tint.

## 1. Colour

Light canvas is warm paper `#ffffeb`; cards are a half-step lighter `#fffef8`;
dark canvas is a warm near-black `#161613` (not pure black — pure black causes
halation for users with astigmatism). Ink is `#1a1a1a` / `#f4f2e6`.

| Token | Light | Dark | Text on paper (L) | Text on paper (D) |
|---|---|---|---|---|
| `--background` | `#ffffeb` | `#161613` | — | — |
| `--foreground` | `#1a1a1a` | `#f4f2e6` | 17.20 | 16.14 |
| `--card` | `#fffef8` | `#201f19` | — | — |
| `--muted` | `#f2f0dd` | `#2a2921` | — | — |
| `--muted-foreground` | `#4a4739` | `#c2beab` | 9.22 | 9.71 |
| `--primary` | `#034f46` | `#8fe6cd` | 9.39 | 12.40 |
| `--secondary` | `#f0d7ff` | `#4a3263` | fill only | fill only |
| `--accent` | `#743d00` | `#ffc27a` | 8.61 | 11.44 |
| `--destructive` | `#9a1c14` | `#ff9b8c` | 8.14 | 8.91 |
| `--success` | `#025c42` | `#6fe0b6` | 7.95 | 11.24 |
| `--warning` | `#6d4600` | `#ffd489` | 8.22 | 12.98 |
| `--info` | `#1c4e8a` | `#9cc4f5` | 8.28 | 10.04 |

Rules that are now invariants, not conventions:

1. **Every text token is ≥ 7:1 (WCAG AAA) on every surface it can land on** —
   background, card, and muted. 62 pairings were checked; v2 passes all but the
   two `--accent` fill cases, which are ≥ 7:1 by construction.
2. **`--accent` is a dark ember, not the old #ffa946.** #ffa946 measured 1.88:1
   as text on paper: a trap that only bit in light mode. Colour used as text must
   come from the text column above, never from a fill token.
3. **Legacy tokens live in a `--w-*` namespace** and must never redefine a
   standard name. `--card` and `--border` were still being redefined by
   `styles.css` after the v1 rename; that is fixed — the kit owns those names now.
4. **Every legacy token has a dark value.** `--danger` (#a3241f) had none and sat
   at 2.34:1 on the dark canvas — a red alarm affordance nobody could see. It now
   has a dark counterpart.
5. **Structural borders are ≥ 3:1** (SC 1.4.11). The legacy panel border was
   `rgba(26,26,26,0.3)` = 1.94:1 — invisible, and it was the entire basis of the
   "ink border" look. Alpha is now 0.55 light / 0.45 dark (3.88:1 / 4.52:1).

## 2. Type

One scale, ratio 1.25, anchored at 16px. v1 had **45 distinct font sizes** with
adjacent steps of 3-6px — imperceptible, so everything looked the same weight.

| Step | Size | Use |
|---|---|---|
| `xs` | 12px | upper-case kickers only, letter-spaced, never body copy |
| `sm` | 14px | secondary/meta text — **the floor for anything a user must read** |
| `base` | 16px | body |
| `lg` | 20px | card titles, nav labels |
| `xl` | 25px | section headings |
| `2xl` | 31px | page headings |
| `3xl` | 39px | display |

Hard rule: **nothing a user must read is below 14px.** v1 had 11 values at or
below 12.5px (down to 9.9px). Legacy rem sizes map onto this scale — 0.8/0.85rem
become 14px, 0.9/0.95rem become 16px, and so on — so a sentence reads the same
size whether it lands in a kit `Card` or a legacy `.panel`.

## 3. Targets and focus

**44px minimum on every interactive element.** This is WCAG 2.2 SC 2.5.5 (AAA)
and, more importantly, the practical floor for users with tremor. v1 shipped
36px `size="sm"` buttons on a destructive delete, a dialog close, and five
onboarding toggles; the shell's `.icon-btn` was 38px and pills ~29px. All of
these are now 44px. The kit's `sm` size is removed rather than left as a trap.

Focus rings are unchanged and already good (3px, 9.39:1 light / 12.40:1 dark) —
`--focus-ring` for legacy, `focus-visible:ring-2 ring-ring` for the kit. Do not
remove them; they are how a keyboard or switch-control user knows where they are.

## 4. Layout

**One obvious primary action per screen.** v1's Home screen put 4 large action
cards, 4 small outline buttons, the orb, a mic button, a command bar and 2
location buttons in one linear tab order — 15-18 stops before any content.

The v2 Home is three bands, in priority order:

1. **Status** — one line, always visible: what Watchora is doing right now.
2. **Command** — the orb and the type-to-Jarvis bar. These are the two ways in.
3. **Do** — the primary actions, large and few. Everything else moves to the
   sidebar, which is where navigation belongs.

**Navigation is one list, not two.** v1 rendered all 9 tabs twice (sidebar +
bottom nav) as two separate `role="tablist"`s in the same tab order — 18 stops of
pure duplication. v2 keeps both visually (sidebar on desktop, bottom bar on
mobile) but only one is in the accessibility tree at a time.

**Lists are bounded.** Six screens render unbounded `.map()` lists with a button
per item (places, SOS contacts, SOS history, community reports, wards, admin
users). For a screen-reader user that is a single endless tab sequence that gets
worse as their own data grows. v2 shows a short list with a count and a "show all"
affordance, rather than rendering everything at once.

## 5. Voice is the primary output

Any visual change must leave every `speak()` and `announce()` string
byte-identical. The screen is a confirmation surface; the spoken sentence is the
product. Re-wording a spoken string during a visual redesign is a regression
even if it reads better on screen.
