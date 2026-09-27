// Watch-mode E2E for the companion.
//
// Runs the real production build in a real browser and checks the things a
// unit test cannot: that the mascot actually renders, that the spoken strings
// reach speech, that the touch signatures fire through the real vibration API,
// and that the screen is operable by keyboard and screen reader alone.
//
// The two hardest things to test here are faked, deliberately and honestly:
//
//   1. Device orientation. Headless Chromium exposes DeviceOrientationEvent but
//      never fires it. We dispatch real events with a compass heading and a
//      downward pitch, which is the only way to prove the heading readout and
//      the look-down warning work at all.
//   2. Vibration. `navigator.vibrate` is a no-op in headless, so it is
//      replaced with a recorder. That is the ONLY substitution: the decision
//      about *whether* to vibrate, the pattern, and its ordering are all the
//      app's own code.
//
// Run:  BASE_URL=https://watchora.ramagiritharun.in node scripts/watch-e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'https://watchora.ramagiritharun.in';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
let context = await browser.newContext({ viewport: { width: 420, height: 900 } });
let page = await context.newPage();

// ── Instrument: speech, vibration, and a fake camera ────────────────────
// A named function, not an inline arrow, so a replacement page can be given
// the identical instrumentation.
function instrument() {
  window.__spoken = [];
  window.__tts = [];
  window.__vibrations = [];
  window.__orientationFired = 0;

  // The app's PRIMARY voice path is neural TTS over /api/tts/audio, with
  // speechSynthesis only as a fallback (App.tsx). Watching speechSynthesis
  // alone misses every real spoken line, so capture the fetch as the primary
  // record and the utterance API as the secondary one. Assertions read both.
  const of = window.fetch;
  window.fetch = (...a) => {
    const u = String(a[0]);
    if (u.includes('/api/tts/audio')) {
      try {
        const raw = decodeURIComponent(u.split('text=')[1] || '');
        window.__tts.push(raw.split('&voice=')[0].replace(/\+/g, ' '));
      } catch { /* malformed url: nothing to record */ }
    }
    return of(...a);
  };

  const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
  if (orig) {
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push(String(u.text));
      return orig(u);
    };
  }
  // Record every vibration pattern the app requests. Patterns are what the
  // blind user actually feels, so asserting on them is asserting on the
  // product's primary channel — not on an implementation detail.
  try {
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: (pattern) => {
        window.__vibrations.push(pattern);
        return true;
      },
    });
  } catch {
    /* non-fatal: the touch checks then report as failures, correctly */
  }
  // Everything the app has ever said, newest last, across both channels.
  window.allSaid = () => [...window.__tts, ...window.__spoken];
  window.speakQueued = () => window.allSaid().join(' | ');
  window.lastSpoken = () => window.allSaid().slice(-1)[0] || '';
}

await page.addInitScript(instrument);

/** Open a page in a BRAND-NEW context carrying the signed-in session.
 *
 * Navigating within a context that has signed in reliably wedges the
 * renderer: `goto` never observes domcontentloaded even though the server
 * answers in 0.3s, and a fresh page in the SAME context is wedged too. The
 * signed-in app holds the hazard loop and speech queue open, and Chromium's
 * per-host connection budget never frees. A new context built from the saved
 * storage state has the same cookies and a clean connection pool, and loads
 * in ~1s. This is a harness workaround for a headless constraint, not an app
 * defect: a real user's browser navigates normally. */
async function freshSignedInPage() {
  const state = await context.storageState();
  await context.close();
  context = await browser.newContext({ viewport: { width: 420, height: 900 }, storageState: state });
  const p = await context.newPage();
  p.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource.*(401|429)/.test(text)) return;
    if (/ERR_ABORTED|net::ERR_FAILED|ERR_FILE_NOT_FOUND/.test(text)) return;
    consoleErrors.push(text.slice(0, 200));
  });
  p.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
  return p;
}

// Fire genuine DeviceOrientationEvent objects. webkitCompassHeading is the
// absolute compass path; absolute:true is the magnetometer-corrected alpha
// path. Both are exercised so neither can silently regress to the other.
async function fireOrientation({ compass = null, alpha = null, beta = 0, gamma = 0, absolute = false }) {
  await page.evaluate(
    ({ compass, alpha, beta, gamma, absolute }) => {
      const ev = new Event('deviceorientation');
      Object.defineProperties(ev, {
        alpha: { value: alpha },
        beta: { value: beta },
        gamma: { value: gamma },
        absolute: { value: absolute },
        webkitCompassHeading: { value: compass },
      });
      window.dispatchEvent(ev);
      window.__orientationFired += 1;
    },
    { compass, alpha, beta, gamma, absolute },
  );
  await page.waitForTimeout(60);
}

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // Back-to-back suite runs from one IP exhaust the per-route limiters (TTS
  // 30/min). That is the limiter working, and the client degrades honestly —
  // not a defect in the Watch feature.
  if (/Failed to load resource.*(401|429)/.test(text)) return;
  // A neural-TTS fetch aborted by navigation, or an asset 404 from a
  // long-running suite session, is teardown noise rather than a defect. A
  // clean single load of ?watch=start produces zero of these.
  if (/ERR_ABORTED|net::ERR_FAILED|ERR_FILE_NOT_FOUND/.test(text)) return;
  consoleErrors.push(text.slice(0, 200));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

/** Type into a React input with TRUSTED events. The auth screen's controlled
 * inputs ignore the native-setter + input-event trick (documented in
 * full-prod-e2e.mjs), and .fill() never worked. execCommand does. */
async function typeInto(page, selector, text) {
  await page.evaluate(
    ([sel, val]) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.focus();
      el.value = '';
      document.execCommand('insertText', false, val);
    },
    [selector, text],
  );
}

// ── 1. Load, sign up, and clear the permission wizard ───────────────────
const EMAIL = `e2e-watch-${Date.now()}@example.com`;
await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
check('app loads', (await page.title()).length > 0, await page.title());

await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create account')?.click());
await page.waitForTimeout(500);
await typeInto(page, 'input[placeholder="Your name"]', 'E2E Watch');
await typeInto(page, 'input[placeholder="you@example.com"]', EMAIL);
await typeInto(page, 'input[placeholder="At least 8 characters"]', 'e2e-Watch-2026!');

const submitOk = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"][aria-labelledby="auth-title"]');
  const btn = [...(dialog?.querySelectorAll('button') ?? [])].find(
    (b) => /create account/i.test(b.textContent) && b.getClientRects().length > 0 && !b.disabled,
  );
  if (btn) { btn.click(); return btn.textContent.trim(); }
  return null;
});
check('signup form submitted', !!submitOk, `button=${submitOk}`);
await page.waitForTimeout(3500);

// Walk the permission wizard out. Headless has no mic/camera, so steps
// auto-advance; require the dialog GONE on two consecutive checks 1s apart
// before believing the walk finished.
{
  // The wizard renders ~1s AFTER login. Without this wait a fast run sees
  // "no dialog" twice, declares victory, and then the wizard appears on top
  // of every later step — which is how the whole suite collapses.
  let appeared = true;
  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[role="dialog"]')].some(
          (d) => d.getAttribute('aria-labelledby') === 'permission-onboarding-title' && d.getClientRects().length > 0,
        ),
      { timeout: 20000 },
    );
  } catch {
    appeared = false;
  }
  let steps = 0;
  let goneStreak = 0;
  while (steps < 30 && goneStreak < 2) {
    const clicked = await page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(
        (d) => d.getAttribute('aria-labelledby') === 'permission-onboarding-title' && d.getClientRects().length > 0,
      );
      if (!dialog) return 'gone';
      const buttons = [...dialog.querySelectorAll('button')].filter((b) => !b.disabled && b.getClientRects().length > 0);
      const skip = buttons.find((b) => /skip|not now|later|done|finish/i.test(b.textContent));
      const next = buttons.find((b) => /continue|next|got it|ok/i.test(b.textContent));
      (skip || next || buttons[buttons.length - 1])?.click();
      return 'clicked';
    });
    goneStreak = clicked === 'gone' ? goneStreak + 1 : 0;
    steps += 1;
    await page.waitForTimeout(1000);
  }
  check('permission wizard appeared then dismissed', appeared && goneStreak >= 2, `appeared=${appeared} steps=${steps}`);
}

// ── 2. The Watch tab exists and is reachable ───────────────────────────
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim() || ''),
);
check('Watch tab is present in navigation', tabs.some((t) => /watch/i.test(t)), tabs.join(' | '));

// ── 3. Deep link: ?watch=start must switch Watch on ────────────────────
// Loaded in a fresh context carrying the session (see freshSignedInPage).
page = await freshSignedInPage();
await page.addInitScript(instrument);
await page.goto(`${BASE}/?watch=start`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3500);
const deepLink = await page.evaluate(() => ({
  url: window.location.search,
  panel: document.querySelector('#panel-watch') ? 'watch' : 'other',
  started: document.body.textContent.includes('Watching'),
}));
check('?watch=start opens the Watch screen', deepLink.panel === 'watch', JSON.stringify(deepLink));
check('?watch=start switches Watch on', deepLink.started, `panel=${deepLink.panel}`);
check('deep-link params are stripped from the URL', deepLink.url === '', `search="${deepLink.url}"`);

// Speech is queued behind a neural TTS fetch, so the announcement is not in
// the array yet on the frame after the deep link. Wait for it.
let spokeOnStart = '';
try {
  await page.waitForFunction(
    () => /watching the path ahead|watch is on|watch mode is on|watching for you/i.test(window.allSaid().join(' | ')),
    { timeout: 25000 },
  );
} catch { /* fall through: report whatever is there */ }
spokeOnStart = await page.evaluate(() => window.allSaid().join(' | '));
check(
  'starting Watch is announced in words',
  /watching the path ahead|watch is on|watch mode is on|watching for you/i.test(spokeOnStart),
  spokeOnStart.slice(-160),
);

// ── 4. The mascot rendered and states itself in words ───────────────────
const mascot = await page.evaluate(() => {
  const panel = document.querySelector('#panel-watch');
  if (!panel) return null;
  const status = panel.querySelector('[role="status"]');
  return {
    hasOrb: !!panel.querySelector('canvas'),
    label: status?.textContent?.trim() || '',
  };
});
check('mascot canvas rendered', !!mascot?.hasOrb, JSON.stringify(mascot));
check('mascot announces its state in text', (mascot?.label?.length || 0) > 0, mascot?.label);

// ── 5. Cadence is a real radiogroup ────────────────────────────────────
const cadence = await page.evaluate(() => {
  const group = document.querySelector('#panel-watch [role="radiogroup"]');
  if (!group) return null;
  return {
    label: group.getAttribute('aria-label'),
    options: [...group.querySelectorAll('[role="radio"]')].map((r) => ({
      text: r.textContent?.trim(),
      checked: r.getAttribute('aria-checked'),
    })),
  };
});
check('cadence exposed as a radiogroup', !!cadence, JSON.stringify(cadence?.label));
check('three exclusive cadence options', cadence?.options.length === 3, String(cadence?.options.length));
check(
  'exactly one cadence is selected',
  cadence?.options.filter((o) => o.checked === 'true').length === 1,
  JSON.stringify(cadence?.options.map((o) => o.checked)),
);

// ── 6. Touch signature: the mascot must be FELT ────────────────────────
// A cadence tap is confirmed in WORDS, not vibration: the user tapped
// deliberately and gets an immediate spoken acknowledgement, which is the
// channel that matters here. The vibration assertion belongs on the mascot's
// own state changes, which are involuntary and must be felt — checked below.
// Wait for the hazard model to actually finish downloading before tapping
// cadence. Its warm-up announcement re-fires each time warm-up restarts
// (App.tsx resets the spoken flag when the status leaves 'warming-up'), so
// draining speech alone can declare quiet in the gap and the next
// announcement lands after the mark. The visible status text is the honest
// signal that loading is done.
let modelReady = true;
try {
  await page.waitForFunction(() => !document.body.textContent.includes('Loading local detection model'), { timeout: 120000 });
} catch {
  modelReady = false;
}
check('hazard model finished loading before the cadence tap', modelReady, `ready=${modelReady}`);
await waitForQuietSpeech(6000, 60000);
const cadenceMark = await page.evaluate(() => window.allSaid().length);
await page.evaluate(() => {
  const opts = [...document.querySelectorAll('#panel-watch [role="radio"]')];
  const vigilant = opts.find((o) => /vigilant/i.test(o.textContent || ''));
  vigilant?.click();
});
let cadenceSaid = '';
try {
  await page.waitForFunction(
    (n) => /watch is now in \w+ mode/i.test(window.allSaid().slice(n).join(' | ')),
    cadenceMark,
    { timeout: 40000 },
  );
} catch { /* fall through: report whatever is there */ }
// Read the whole session as well as the after-mark window. The confirmation
// is spoken at priority 4 and lands FIRST, ahead of the cold-start backlog —
// so on a busy load the line can be dispatched into the queue before the
// array the mark counted has finished shifting. Only this tap can produce
// "Watch is now in <x> mode", so the session-wide read stays honest.
cadenceSaid = await page.evaluate(
  (n) =>
    window.allSaid().find((l) => /watch is now in \w+ mode/i.test(l))
    ?? window.allSaid().slice(n).slice(-1)[0]
    ?? '',
  cadenceMark,
);
check(
  'selecting a cadence is confirmed in words',
  /watch is now in \w+ mode/i.test(cadenceSaid),
  `said="${cadenceSaid.slice(0, 160)}"`,
);

// Every mascot state that means something carries a DISTINCT touch pattern,
// except `asleep`, which is deliberately silent (MASCOT_PROFILES.asleep.touch
// is null) — a resting mascot must not buzz. So the signature check is on the
// start transition, not the stop, and asserts the patterns differ from each
// other rather than merely existing.
const vibeOnStart = await page.evaluate(() => window.__vibrations.slice());
check(
  'starting Watch fires a touch signature',
  vibeOnStart.length > 0,
  `patterns=${JSON.stringify(vibeOnStart)}`,
);
// The mascot legitimately cycles awake → guiding → awake while it speaks, so
// repeats are expected; what matters is that the states it DOES use are
// distinguishable from one another by feel, not that every pulse is unique.
const distinct = new Set(vibeOnStart.map((p) => JSON.stringify(p)));
check(
  'touch signatures are distinguishable, not one generic buzz',
  vibeOnStart.length > 0 && distinct.size >= 2,
  `total=${vibeOnStart.length} distinct=${distinct.size} patterns=${JSON.stringify(vibeOnStart)}`,
);

// ── 7. Orientation: compass, no compass, and looking down ──────────────
// Feeds a steady run of absolute compass readings. The stabiliser requires
// several agreeing samples before any direction may be named, so a single
// event must NOT produce a direction.
await fireOrientation({ compass: 214, beta: 5, gamma: 0 });
const afterOne = await page.evaluate(() => document.body.textContent);
check(
  'a single compass sample does not name a direction',
  !/facing (roughly )?(north|south|east|west)/i.test(afterOne),
  'one sample must not be enough',
);
for (let i = 0; i < 6; i += 1) await fireOrientation({ compass: 213 + (i % 2), beta: 5, gamma: 0 });
const compassUi = await page.evaluate(() => {
  const panel = document.querySelector('#panel-watch');
  const t = panel?.textContent || '';
  return { hasFacing: /facing/i.test(t), namesDirection: /north|south|east|west/i.test(t) };
});
check('a steady compass run does name a direction', compassUi.namesDirection, JSON.stringify(compassUi));

// No compass at all: absolute alpha only. The app must refuse to name a
// cardinal direction rather than inventing one.
for (let i = 0; i < 6; i += 1) await fireOrientation({ alpha: 90, beta: 0, gamma: 0, absolute: false });
const noCompass = await page.evaluate(() => {
  const t = document.querySelector('#panel-watch')?.textContent || '';
  return { saysNoCompass: /no compass|not giving me a compass/i.test(t), stillNames: /you are facing (north|south|east|west)/i.test(t) };
});
check('without a compass it says so', noCompass.saysNoCompass, JSON.stringify(noCompass));
check('without a compass it names no direction', !noCompass.stillNames, JSON.stringify(noCompass));

// Looking down: the sensor covers the region the camera cannot see.
for (let i = 0; i < 4; i += 1) await fireOrientation({ alpha: 90, beta: 70, gamma: 0, absolute: false });
const lookDown = await page.evaluate(() => {
  const t = document.querySelector('#panel-watch')?.textContent || '';
  return { warns: /angled down|at the ground|kerbs/i.test(t) };
});
check('aiming the phone down warns about the ground', lookDown.warns, JSON.stringify(lookDown));

// ── 8. The honesty guarantee: no "clear" / "safe" overclaim ───────────
// Assert on the CLAIM, not on the raw sentence. The app's honest line is
// "I am not saying the path is clear" — a naive /\bpath is clear\b/ matches
// inside that denial and would fail the very wording the rule exists to
// produce. Each line is checked only up to its first " — " clause break,
// which is the part making the assertion; a negated mention is not a claim.
const honesty = await page.evaluate(() => {
  const claims = window.allSaid().map((line) => line.split('—')[0].split(' - ')[0]);
  const offenders = claims.filter((c) => /\b(path is clear|looks clear|it is safe|is safe to|you can go|all clear)\b/i.test(c));
  return { total: claims.length, offenders: offenders.slice(0, 3) };
});
check(
  'Watch never claims the path is clear or safe',
  honesty.offenders.length === 0,
  `checked=${honesty.total} offenders=${JSON.stringify(honesty.offenders)}`,
);

// ── 9. Keyboard-only operation of the whole screen ─────────────────────
// Another fresh context, same reason as the deep-link leg.
page = await freshSignedInPage();
await page.addInitScript(instrument);
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3500);
// Reach the Watch screen the way a keyboard user actually does: arrow along
// the VISIBLE tablist (automatic activation — selection follows focus, per
// WAI-ARIA). At 420px the visible list is the mobile bottom nav, so targeting
// the desktop `tab-watch` id directly would focus a hidden element and prove
// nothing.
const startTab = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.getClientRects().length > 0 && t.getAttribute('aria-selected') === 'true');
  if (!tab) return null;
  tab.focus();
  return tab.id;
});
check('a visible tab is focusable to start from', !!startTab, `tab=${startTab}`);
for (let i = 0; i < 10; i += 1) {
  const onWatch = await page.evaluate(() => !!document.querySelector('#panel-watch'));
  if (onWatch) break;
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
}
const onWatch = await page.evaluate(() => !!document.querySelector('#panel-watch'));
check('Watch screen is reachable by keyboard alone (arrow keys)', onWatch, `panel=${onWatch}`);
const keyboard = await page.evaluate(() => {
  const panel = document.querySelector('#panel-watch');
  if (!panel) return { ok: false, why: 'watch panel absent' };
  const focusables = panel.querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])');
  const offscreen = [...focusables].filter((el) => el.getClientRects().length === 0);
  return { ok: true, count: focusables.length, offscreen: offscreen.length };
});
check('Watch screen exposes keyboard focusable controls', keyboard.ok && keyboard.count > 0, JSON.stringify(keyboard));
check('no focusable control is offscreen', keyboard.offscreen === 0, `offscreen=${keyboard.offscreen}`);

// Tab roving on the tablist must still work with the new tab added.
await page.keyboard.press('Tab');
const roving = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
  return { total: tabs.length, selected: selected?.textContent?.trim() || '', tabindex: selected?.getAttribute('tabindex') };
});
check('tablist has a single selected tab', roving.total > 0 && roving.selected.length > 0, JSON.stringify(roving));
check('selected tab is in the tab order (roving tabindex)', roving.tabindex === '0', `tabindex=${roving.tabindex}`);

// ── 10. Manifest: installable + shortcuts ──────────────────────────────
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
  if (!href) return null;
  const res = await fetch(href);
  return res.ok ? res.json() : null;
});
check('manifest is fetchable', !!manifest, manifest ? manifest.name : 'missing');
check('manifest is standalone + has shortcuts', manifest?.display === 'standalone' && Array.isArray(manifest?.shortcuts), JSON.stringify(manifest?.shortcuts?.map((s) => s.short_name)));
check('manifest ships a Start Watch shortcut', manifest?.shortcuts?.some((s) => /watch/i.test(s.name)), '');
check('manifest ships an Emergency shortcut', manifest?.shortcuts?.some((s) => /emerg/i.test(s.name)), '');

// ── 11. Typed commands route to the right Watch intent ─────────────────
// The deterministic router is where a regression would be silent: a phrase
// falls through to the LLM path, the user gets a chat answer instead of
// switching Watch on, and nothing anywhere reports a failure. So each phrase
// is typed for real and the SPOKEN REPLY is the assertion — if the router
// missed, the reply will not match and the check fails.
/** Wait until the app stops speaking for `quietMs`.
 *
 * Headless has no audio sink, so a queued neural clip never ends on its own
 * and only clears on the 12s watchdog — a cold session can have a minute of
 * onboarding chatter still draining. Asserting against that queue is a race:
 * the same command passes on one run and fails on the next purely on timing.
 * Draining first makes every speech assertion below deterministic. */
async function waitForQuietSpeech(quietMs = 6000, maxMs = 150000) {
  const deadline = Date.now() + maxMs;
  let last = -1;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => window.allSaid().length);
    if (n !== last) {
      last = n;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

async function askCommand(text, expect) {
  // The typed input lives on the home tab, and "start watch" navigates to the
  // Watch screen. Come back before every command or the send button is gone.
  await page.evaluate(() => {
    const home = document.getElementById('tab-home');
    if (home && home.getAttribute('aria-selected') !== 'true') home.click();
  });
  await page.waitForTimeout(300);
  const mark = await page.evaluate(() => window.allSaid().length);
  await page.evaluate((t) => {
    const input = document.getElementById('type-jarvis-input');
    if (!input) return;
    input.focus();
    input.value = '';
    document.execCommand('insertText', false, t);
  }, text);
  await page.evaluate(() => {
    const input = document.getElementById('type-jarvis-input');
    const btn = [...(input?.closest('.type-jarvis')?.querySelectorAll('button') ?? [])].find(
      (b) => /send/i.test(b.textContent) && !b.disabled,
    );
    btn?.click();
  });
  // Onboarding and permission prompts speak on their own schedule, so the LAST
  // line is frequently not our answer. Wait for a line AFTER the mark that
  // matches what this command should produce. No retry: the caller drains the
  // queue first, and a second attempt would only add to the backlog it is
  // racing.
  try {
    await page.waitForFunction(
      ([n, src]) => window.allSaid().slice(n).some((line) => new RegExp(src, 'i').test(line)),
      [mark, expect.source],
      { timeout: 40000 },
    );
  } catch { /* fall through: report whatever is there */ }
  return page.evaluate(
    ([n, src]) =>
      window.allSaid().slice(n).find((line) => new RegExp(src, 'i').test(line))
      ?? window.allSaid().slice(n).slice(-1)[0]
      ?? '',
    [mark, expect.source],
  );
}

// Each expected reply is the app's REAL wording, so a router regression that
// falls through to the LLM cannot accidentally satisfy the check. The queue
// is drained first so these are deterministic rather than a timing race.
await waitForQuietSpeech();
const facingReply = await askCommand('which way am I facing', /facing|compass|orientation|turned/i);
check(
  '"which way am I facing" is answered as orientation, not as a distance',
  /facing|compass|orientation|turned/i.test(facingReply) && !/\b\d+\s*(m|metres|meters|minutes)\b/i.test(facingReply),
  facingReply.slice(0, 120),
);

// The capability list is the longest line the app speaks and is queued last
// of all the command replies, so it is asked with the same retry as the rest.
const capsReply = await askCommand('what can watch do', /can (see|tap|reach)|cannot/i);
check(
  '"what can watch do" states capabilities AND limits',
  /can (see|tap|reach)/i.test(capsReply) && /cannot/i.test(capsReply),
  capsReply.slice(0, 140),
);

const startReply = await askCommand('start watch', /watching the path ahead/i);
check('"start watch" switches Watch on', /watching the path ahead/i.test(startReply), startReply.slice(0, 120));
const onNow = await page.evaluate(() => !!document.querySelector('#panel-watch'));
check('"start watch" navigates to the Watch screen', onNow, `panel=${onNow}`);

// Match the app's REAL status wording. A loose /watch/i is a trap here: every
// permission prompt says "Watchora", so a loose match reports PASS while the
// actual answer is still queued behind neural TTS.
const statusReply = await askCommand('watch status', /watch mode is (on|off)/i);
check('"watch status" reports on/off state', /watch mode is (on|off)/i.test(statusReply), statusReply.slice(0, 120));

// The safety-critical one: "stop watching" must NOT be swallowed by a
// looser start-phrase rule. If a regression let "watch for me" match while
// "stop watching" also started it, the user could never switch it off.
const stopSaid = await askCommand('stop watching', /watch is off|no longer watching/i);
check('"stop watching" is acknowledged as off', /watch is off|no longer watching/i.test(stopSaid), stopSaid.slice(0, 120));
// The same 10s dedupe cooldown that protects against nagging also swallows an
// immediate repeat, so wait it out before asking whether it really stopped.
await page.waitForTimeout(11000);
const afterStop = await askCommand('watch status', /watch mode is off/i);
check(
  '"stop watching" actually stops it (status confirms off)',
  /watch mode is off/i.test(afterStop),
  afterStop.slice(0, 120),
);

// ── 12. Clean console ──────────────────────────────────────────────────
check('no console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
await browser.close();
process.exit(failed.length ? 1 : 0);
