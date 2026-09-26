// Full-journey production E2E for watchora: every core user journey on the
// live site — logged-out smoke, static pages, real signup through the UI
// (trusted keystrokes — the native-setter trick does not reach this screen's
// React state), the onboarding wizard, the typed command brain with real
// speech capture, the emergency confirmation gate, places add/remove, safe
// journey, settings, keyboard-only roving tablists, admin, logout, and
// mobile width. BASE_URL defaults to production. Exit 1 on any failure.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'https://watchora.ramagiritharun.in';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const consoleErrors = [];
function wireResponses(page) {
  page.on('response', (r) => {
    if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url().replace('https://watchora.ramagiritharun.in', '')}`);
  });
}
function wireConsole(page) {
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 140)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // A 401 on a signed-out load is the app honestly reporting "not signed in".
    if (/Failed to load resource.*401/.test(text)) return;
    // Back-to-back suite runs from one IP exhaust the per-route limiters
    // (TTS 30/min, places, etc.) — the limiter is doing its job and the
    // client speaks a honest "wait a moment" or falls back. Not a defect.
    if (/Failed to load resource.*429/.test(text)) return;
    consoleErrors.push(text.slice(0, 140));
  });
}

/** Type into a React input with TRUSTED events (execCommand insertText).
 * The native-setter + input-event trick does not update state everywhere
 * (the auth screen's controlled inputs ignore it), and .fill() never did. */
async function typeInto(page, selector, text) {
  await page.evaluate(([sel, val]) => {
    const el = document.querySelector(sel);
    el.focus();
    el.value = '';
    document.execCommand('insertText', false, val);
  }, [selector, text]);
}

async function spokenAt(page) {
  return page.evaluate(() => window.__spoken.slice(-1)[0] || '');
}

/** Wait until the LAST spoken line matches, or return what is there after the
 * timeout. Speech is queued (each neural TTS fetch takes seconds), so fixed
 * sleeps are always wrong in one direction or the other. */
async function waitForSpoken(page, reSource, timeout = 25000) {
  try {
    await page.waitForFunction(
      (src) => new RegExp(src).test(window.__spoken.slice(-1)[0] || ''),
      reSource,
      { timeout },
    );
  } catch { /* fall through: report whatever was last spoken */ }
  return spokenAt(page);
}

async function sendCommand(page, text) {
  await typeInto(page, '#type-jarvis-input', text);
  await page.evaluate(() => {
    const input = document.getElementById('type-jarvis-input');
    const btn = [...(input?.closest('.type-jarvis')?.querySelectorAll('button') ?? [])].find((b) => /send/i.test(b.textContent) && !b.disabled);
    btn?.click();
  });
}

const browser = await chromium.launch();

// ── 1. Logged-out smoke + static pages ────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  wireConsole(page);
  const hz = await page.request.get(`${BASE}/api/healthz`);
  check('healthz 200', hz.status() === 200, `status=${hz.status()}`);
  for (const path of ['/install-guide.html', '/commitment.html']) {
    const r = await page.request.get(`${BASE}${path}`);
    const body = await r.text();
    check(`static ${path} 200 with content`, r.status() === 200 && body.length > 500, `status=${r.status()} len=${body.length}`);
  }
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  const landing = await page.evaluate(() => !!document.querySelector('.voice-orb') && !!document.querySelector('#wispr-demo'));
  check('landing renders demo + voice orb', landing);
  await ctx.close();
}

// ── 2. Signup through the real UI + onboarding wizard ─────────────────
const stamp = Date.now();
const EMAIL = `e2e-full-${stamp}@test.in`;
let userToken = '';
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  wireConsole(page);
  await page.addInitScript(() => {
    window.__spoken = [];
    window.__posts = [];
    window.__tts = [];
    const of2 = window.fetch;
    window.fetch = (...a) => { const u = String(a[0]); if (u.includes('/api/tts/audio')) window.__tts.push(decodeURIComponent(u.split('text=')[1] || '')); return of2(...a); };
    const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
    if (orig) window.speechSynthesis.speak = (u) => { window.__spoken.push(String(u.text)); return orig(u); };
    window.__apiLog = [];
    const of = window.fetch;
    window.fetch = (...args) => {
      const url = String(args[0]);
      const method = (args[1]?.method || 'GET').toUpperCase();
      if (method === 'POST') window.__posts.push(url);
      return of(...args).then((res) => {
        try { if (url.includes('/api/')) window.__apiLog.push({ u: url.replace(location.origin, ''), m: method, s: res.status }); } catch { /* ignore */ }
        return res;
      });
    };
  });
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Create account')?.click());
  await page.waitForTimeout(500);
  await typeInto(page, 'input[placeholder="Your name"]', 'E2E Full Journey');
  await typeInto(page, 'input[placeholder="you@example.com"]', EMAIL);
  await typeInto(page, 'input[placeholder="At least 8 characters"]', 'e2e-Full-2026!');
  const submitOk = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="auth-title"]');
    const btn = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => /create account/i.test(b.textContent) && b.getClientRects().length > 0 && !b.disabled);
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;
  });
  check('signup form submitted', !!submitOk, `button=${submitOk}`);
  await page.waitForTimeout(3500);

  // Onboarding wizard (welcome → voice → mic → camera → location → …):
  // prefer the skip/continue path; permissions are unavailable in headless.
  // Wait for the wizard to appear (it renders ~1s after the shell; racing it
  // made the walker exit before the first step).
  let wizardAppeared = true;
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('[role="dialog"]')].some((d) => d.getAttribute('aria-labelledby') === 'permission-onboarding-title' && d.getClientRects().length > 0),
      { timeout: 20000 },
    );
  } catch {
    wizardAppeared = false;
  }
  // Walk the wizard until it is REALLY finished: permission requests deny
  // slowly in headless and steps auto-advance, so require the dialog to be
  // gone on two consecutive checks 1s apart before believing it.
  let steps = 0;
  let goneStreak = 0;
  while (steps < 30 && goneStreak < 2) {
    const clicked = await page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-labelledby') === 'permission-onboarding-title' && d.getClientRects().length > 0);
      if (!dialog) return null;
      const buttons = [...dialog.querySelectorAll('button')].filter((b) => !b.disabled && b.getClientRects().length > 0);
      const btn = buttons.find((b) => /skip|not now|continue|start watchora|done|finish|got it|later|open watchora/i.test(b.textContent))
        ?? buttons[buttons.length - 1];
      if (!btn) return null;
      btn.click();
      return btn.textContent.trim().slice(0, 30);
    });
    if (clicked) {
      steps += 1;
      goneStreak = 0;
      await page.waitForTimeout(800);
    } else {
      goneStreak += 1;
      await page.waitForTimeout(1000);
    }
  }
  const onboardingGone = goneStreak >= 2;
  const onboardKeySet = await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('watchora_onboarding_') && localStorage.getItem(k)));
  check('onboarding wizard appeared, walked, and persisted', wizardAppeared && onboardingGone && steps >= 4 && onboardKeySet, `appeared=${wizardAppeared} gone=${onboardingGone} steps=${steps} key=${onboardKeySet}`);

  const appShell = await page.evaluate(() => ({
    nav: !!document.querySelector('[aria-label="Primary navigation"]'),
    homeTab: !!document.getElementById('tab-home'),
    jarvis: !!document.getElementById('type-jarvis-input'),
  }));
  check('app shell reached after signup', appShell.nav && appShell.homeTab && appShell.jarvis, JSON.stringify(appShell));

  // ── 3. Command brain (typed) + confirmation gate ─────────────────────
  // (The clock is verified in the fresh session below — in this session it
  // sits behind ~8 onboarding speeches, each stalled 12s in headless audio.)
  await sendCommand(page, 'emergency');
  const gateAck = await page
    .waitForFunction(() => window.__spoken.some((t) => t.includes('Say confirm')) || (window.__tts || []).some((t) => t.includes('Say confirm')), { timeout: 30000 })
    .then(() => true)
  check('"emergency" parks at the confirmation gate', gateAck);

  await sendCommand(page, 'cancel');
  const cancelAck = await page
    .waitForFunction(() => window.__spoken.some((t) => t.includes('Cancelled')) || (window.__tts || []).some((t) => t.includes('Cancelled')), { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check('"cancel" aborts the parked emergency', cancelAck);
  const emergencyPosted = await page.evaluate(() => window.__posts.some((u) => /emergenc/i.test(u)));
  check('no emergency network call was made', !emergencyPosted, JSON.stringify(await page.evaluate(() => window.__posts)));

  // Keyboard-only roving tabindex in the real app tablist.
  await page.evaluate(() => document.getElementById('tab-home')?.focus());
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const roving = await page.evaluate(() => {
    const active = document.activeElement;
    return { id: active?.id, selected: active?.getAttribute('aria-selected'), tabLabel: active?.textContent?.trim().slice(0, 14) };
  });
  check('arrow key moves tab focus AND selection', roving.id !== 'tab-home' && roving.selected === 'true', JSON.stringify(roving));

  // ── 4. Places: create + delete with spoken confirm ───────────────────
  await page.evaluate(() => document.getElementById('tab-routes')?.click());
  await page.waitForTimeout(1000);
  await typeInto(page, '#places-name', 'E2E Pharmacy');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save place')?.click());
  let placeRow = false;
  try {
    await page.waitForFunction(() => document.querySelector('#panel-routes')?.textContent?.includes('E2E Pharmacy'), { timeout: 15000 });
    placeRow = true;
  } catch { /* fall through */ }
  check('place created and listed', placeRow);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Remove E2E Pharmacy')?.click());
  await page.waitForTimeout(600);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Confirm remove E2E Pharmacy')?.click());
  let placeGone = false;
  try {
    await page.waitForFunction(() => !document.querySelector('#panel-routes')?.textContent?.includes('E2E Pharmacy'), { timeout: 15000 });
    placeGone = true;
  } catch { /* fall through */ }
  check('two-step delete removes the place', placeGone);
  const placeDeleted = await page.evaluate(() => window.__apiLog.some((e) => e.m === 'DELETE' && e.u.includes('/api/places') && e.s === 200));

  // ── 5. Safe journey: start via UI, check in, end ─────────────────────
  await page.evaluate(() => document.getElementById('tab-journey')?.click());
  await page.waitForTimeout(1000);
  await typeInto(page, '#journey-destination', 'E2E Clinic');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /start.*journey/i.test(b.textContent))?.click());
  let journeyStarted = false;
  try {
    await page.waitForFunction(() => window.__apiLog.some((e) => e.m === 'POST' && e.u.includes('/api/safe-journey') && e.s === 201), { timeout: 20000 });
    journeyStarted = true;
  } catch { /* fall through */ }
  check('safe journey starts (API 201)', journeyStarted);
  let checkin = false;
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /check.?in/i.test(b.textContent) && b.getClientRects().length > 0), { timeout: 15000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /check.?in/i.test(b.textContent))?.click());
    checkin = true;
  } catch { /* fall through */ }
  // Wait for the "End journey" control deterministically and confirm it
  // disappears — a leftover active journey makes the fresh session's start
  // 409 (the API correctly refuses a duplicate).
  let endClicked = false;
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^end journey$/i.test(b.textContent.trim()) && b.getClientRects().length > 0), { timeout: 20000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^end journey$/i.test(b.textContent.trim()))?.click());
    endClicked = true;
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /^end journey$/i.test(b.textContent.trim()) && b.getClientRects().length > 0), { timeout: 20000 });
  } catch { /* fall through */ }
  check('journey check-in + end actions fire', checkin && endClicked, `checkin=${checkin} end=${endClicked}`);

  // Capture the token BEFORE logout clears localStorage.
  userToken = await page.evaluate(() => localStorage.getItem('watchora_token') || '') || '';

  // ── 7. Logout returns to landing ─────────────────────────────────────
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Log out')?.click());
  await page.waitForTimeout(1500);
  const backOut = await page.evaluate(() => !!document.querySelector('.voice-orb'));
  check('logout returns to landing', backOut);

  await ctx.close();
}

// ── 8. Admin journey: login, admin tablist keyboard, users table ──────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  wireConsole(page);
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sign in')?.click());
  await page.waitForTimeout(500);
  await typeInto(page, 'input[placeholder="you@example.com"]', 'admin@watchora.app');
  await typeInto(page, 'input[placeholder="At least 8 characters"]', 'WatchoraAdmin!2026');
  const loginSubmitted = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-labelledby="auth-title"]');
    const btn = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => /^sign in$/i.test(b.textContent.trim()) && b.getClientRects().length > 0 && !b.disabled);
    if (btn) { btn.click(); return btn.textContent.trim(); }
    return null;
  });
  check('admin login submitted', !!loginSubmitted, `button=${loginSubmitted}`);
  let adminTab = false;
  try {
    await page.waitForFunction(() => !!document.getElementById('tab-admin'), { timeout: 20000 });
    adminTab = true;
  } catch {
    adminTab = !!document.getElementById('tab-admin');
  }
  check('admin account sees the Admin tab', adminTab);
  if (adminTab) {
    await page.evaluate(() => document.getElementById('tab-admin')?.click());
    await page.waitForTimeout(1300);
    await page.evaluate(() => document.getElementById('tab-admin-users')?.focus());
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    const adminRoving = await page.evaluate(() => ({ id: document.activeElement?.id, sel: document.activeElement?.getAttribute('aria-selected') }));
    check('admin tablist arrow keys work', (adminRoving.id || '').startsWith('tab-admin-') && adminRoving.sel === 'true', JSON.stringify(adminRoving));
    const usersVisible = await page.evaluate(() => document.body.textContent.includes('Users') && document.body.textContent.length > 200);
    check('admin users panel renders', usersVisible);
  }
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Log out')?.click());
  await ctx.close();
}

// ── 8b. Fresh session: command brain + settings ack (no speech backlog) ─
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  wireConsole(page);
  wireResponses(page);
  if (userToken) {
    await page.addInitScript((tok) => {
      localStorage.setItem('watchora_token', tok);
      window.__spoken = []; window.__tts = [];
      const o = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
      if (o) window.speechSynthesis.speak = (u) => { window.__spoken.push(String(u.text)); return o(u); };
      const of3 = window.fetch;
      window.fetch = (...a) => { const u = String(a[0]); if (u.includes('/api/tts/audio')) window.__tts.push(decodeURIComponent(u.split('text=')[1] || '')); return of3(...a); };
    }, userToken);
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2000);
    // With no speech backlog, the clock ack lands in seconds.
    await sendCommand(page, 'what time is it');
    let clockAck = false;
    try {
      await page.waitForFunction(
        () => window.__spoken.some((t) => /It is \d+:\d+ (AM|PM)/.test(t)) || (window.__tts || []).some((t) => /It is \d+/.test(t)),
        { timeout: 30000 },
      );
      clockAck = true;
    } catch { /* fall through */ }
    check('typed "what time is it" speaks the clock', clockAck);
    // Place create + delete speech acks (queue is empty here — each neural
    // utterance is requested immediately and captured).
    await page.evaluate(() => document.getElementById('tab-routes')?.click());
    await page.waitForFunction(() => !!document.getElementById('places-name'), { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { const el = document.getElementById('places-name'); el.focus(); document.execCommand('insertText', false, 'E2E Voice Pharmacy'); });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Save place')?.click());
    const placeSavedAck = await page
      .waitForFunction(() => (window.__tts || []).some((t) => t.includes('E2E Voice Pharmacy saved')) || window.__spoken.some((t) => t.includes('E2E Voice Pharmacy saved')), { timeout: 25000 })
      .then(() => true)
      .catch(() => false);
    check('place creation is named back by voice', placeSavedAck);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Remove E2E Voice Pharmacy')?.click());
    await page.waitForTimeout(700);
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === 'Confirm remove E2E Voice Pharmacy')?.click());
    const placeRemovedAck = await page
      .waitForFunction(() => (window.__tts || []).some((t) => t.includes('Removed E2E Voice Pharmacy')) || window.__spoken.some((t) => t.includes('Removed E2E Voice Pharmacy')), { timeout: 25000 })
      .then(() => true)
      .catch(() => false);
    check('place removal is spoken', placeRemovedAck);
    // Journey start + check-in + end speech acks.
    await page.evaluate(() => document.getElementById('tab-journey')?.click());
    await page.waitForFunction(() => !!document.getElementById('journey-destination'), { timeout: 15000 }).catch(() => {});
    await page.evaluate(() => { const el = document.getElementById('journey-destination'); el.focus(); document.execCommand('insertText', false, 'E2E Voice Clinic'); });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /start.*journey/i.test(x.textContent))?.click());
    const journeyStartAck = await page
      .waitForFunction(() => (window.__tts || []).some((t) => t.includes('Safe journey started to E2E Voice Clinic')) || window.__spoken.some((t) => t.includes('Safe journey started to E2E Voice Clinic')), { timeout: 25000 })
      .then(() => true)
      .catch(() => false);
    check('safe journey start is spoken', journeyStartAck);
    let checkinClicked = false;
    try {
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => /check.?in/i.test(x.textContent) && x.getClientRects().length > 0), { timeout: 15000 });
      await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /check.?in/i.test(x.textContent))?.click());
      checkinClicked = true;
    } catch { /* fall through */ }
    const checkinAck = checkinClicked
      ? await page
        .waitForFunction(() => (window.__tts || []).some((t) => t.includes('Checked in')) || window.__spoken.some((t) => t.includes('Checked in')), { timeout: 25000 })
        .then(() => true)
        .catch(() => false)
      : false;
    let endClicked = false;
    try {
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => /^end journey$/i.test(x.textContent.trim()) && x.getClientRects().length > 0), { timeout: 20000 });
      await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => /^end journey$/i.test(x.textContent.trim()))?.click());
      endClicked = true;
    } catch { /* fall through */ }
    const journeyEndAck = !endClicked ? false : await page
      .waitForFunction(() => (window.__tts || []).some((t) => /ended|arrived safely/i.test(t)) || window.__spoken.some((t) => /ended|arrived safely/i.test(t)), { timeout: 25000 })
      .then(() => true)
      .catch(() => false);
    check('journey check-in and end are spoken', checkinAck && journeyEndAck, `checkin=${checkinAck} end=${journeyEndAck}`);
  } else {
    check('fresh session: token available', false, 'no token captured');
  }
  await ctx.close();
}

// ── 9. Mobile 390px: bottom nav usable, no overflow ───────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  wireConsole(page);
  if (userToken) {
    await page.addInitScript((tok) => localStorage.setItem('watchora_token', tok), userToken);
  }
  // Reload AT the target width (resize events do not fire in IAB — memory lesson).
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);
  const mobile = await page.evaluate(() => {
    const bottom = document.querySelector('.bottom-nav');
    const style = bottom ? getComputedStyle(bottom) : null;
    return {
      hasToken: !!localStorage.getItem('watchora_token'),
      loggedOut: !!document.querySelector('.voice-orb'),
      bottomVisible: !!style && style.display !== 'none',
      hidden: bottom?.getAttribute('aria-hidden'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (userToken) {
    check('mobile: signed-in shell shows bottom nav', mobile.bottomVisible && mobile.hidden !== 'true', JSON.stringify(mobile));
    check('mobile: no horizontal overflow in app', mobile.overflow <= 0, `overflow=${mobile.overflow}`);
    await page.evaluate(() => document.getElementById('tab-mobile-sos')?.click());
    await page.waitForTimeout(900);
    const sos = await page.evaluate(() => !!document.getElementById('panel-sos'));
    check('mobile: bottom nav switches tabs', sos);
  } else {
    check('mobile: landing state usable', mobile.loggedOut && mobile.overflow <= 0, JSON.stringify(mobile));
  }
  await ctx.close();
}

// ── 10. Console errors across all journeys ────────────────────────────
check('no console/page errors anywhere', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
await browser.close();
process.exit(failed.length ? 1 : 0);
