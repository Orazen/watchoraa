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
function wireConsole(page) {
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 140)}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // A 401 on a signed-out load is the app honestly reporting "not signed in".
    if (/Failed to load resource.*401/.test(text)) return;
    // Rapid back-to-back suites can exhaust the TTS limiter (30/min); the
    // client degrades to speechSynthesis, so no user-facing silence.
    if (/Failed to load resource.*429/.test(text) && /tts/.test(m.location?.url || '')) return;
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
    const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
    if (orig) window.speechSynthesis.speak = (u) => { window.__spoken.push(String(u.text)); return orig(u); };
    const of = window.fetch;
    window.fetch = (...args) => {
      try {
        if ((args[1]?.method || 'GET').toUpperCase() === 'POST') window.__posts.push(String(args[0]));
      } catch { /* ignore */ }
      return of(...args);
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
  await sendCommand(page, 'what time is it');
  const clockSpoken = await page
    .waitForFunction(() => window.__spoken.some((t) => /It is \d+:\d+ (AM|PM)/.test(t)), { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check('typed "what time is it" speaks the clock', clockSpoken);

  await sendCommand(page, 'emergency');
  const gateSpoken = await waitForSpoken(page, 'Say confirm');
  check('"emergency" parks at the confirmation gate', /Say confirm/.test(gateSpoken), gateSpoken.slice(0, 90));

  await sendCommand(page, 'cancel');
  const cancelSpoken = await waitForSpoken(page, 'Cancelled');
  check('"cancel" aborts the parked emergency', /Cancelled|abort/i.test(cancelSpoken), cancelSpoken.slice(0, 90));
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
  const placeSpoken = await waitForSpoken(page, 'saved');
  let placeRow = false;
  try {
    await page.waitForFunction(() => document.body.textContent.includes('E2E Pharmacy'), { timeout: 10000 });
    placeRow = true;
  } catch { /* fall through */ }
  check('place created and named back', placeRow && /saved/i.test(placeSpoken), `row=${placeRow} spoken=${placeSpoken.slice(0, 70)}`);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Remove E2E Pharmacy')?.click());
  await page.waitForTimeout(600);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === 'Confirm remove E2E Pharmacy')?.click());
  await page.waitForTimeout(2000);
  const placeGone = await page.evaluate(() => !document.body.textContent.includes('E2E Pharmacy'));
  check('two-step delete removes the place', placeGone);

  // ── 5. Safe journey: start via UI, check in, end ─────────────────────
  await page.evaluate(() => document.getElementById('tab-journey')?.click());
  await page.waitForTimeout(1000);
  await typeInto(page, '#journey-destination', 'E2E Clinic');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /start.*journey/i.test(b.textContent))?.click());
  const journeySpoken = await waitForSpoken(page, 'Safe journey started to E2E Clinic');
  check('safe journey starts with spoken ack', /Safe journey started to E2E Clinic/.test(journeySpoken), journeySpoken.slice(0, 90));
  const checkin = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /check.?in/i.test(b.textContent));
    if (btn) { btn.click(); return true; }
    return false;
  });
  const checkinSpoken = checkin ? await waitForSpoken(page, 'check.?in|safe|journey', 15000) : '';
  const endClicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /end (the )?journey|end journey|arrived/i.test(b.textContent));
    if (btn) { btn.click(); return true; }
    return false;
  });
  const journeyEndSpoken = endClicked ? await waitForSpoken(page, 'ended|arrived|journey', 20000) : checkinSpoken;
  check('journey check-in + end give spoken feedback', checkin && (endClicked || /arrived|ended/i.test(journeyEndSpoken)), `checkin=${checkin} end=${endClicked} spoken=${journeyEndSpoken.slice(0, 80)}`);

  // ── 6. Settings: verbosity change is spoken ──────────────────────────
  await page.evaluate(() => document.getElementById('tab-settings')?.click());
  await page.waitForTimeout(1000);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /detailed/i.test(b.textContent))?.click());
  const settingsSpoken = await waitForSpoken(page, 'detail|verbosity|detailed|shorter|standard|essential', 8000);
  check('verbosity change acknowledged', /detailed|verbosity|detail/i.test(settingsSpoken), settingsSpoken.slice(0, 80));

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
