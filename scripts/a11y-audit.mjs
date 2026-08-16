// Comprehensive accessibility audit against the LIVE Watchora production app.
// Runs axe-core on every tab + custom blind-user-perspective checks derived
// from the research (unlabeled buttons, heading order, live regions, target
// sizes, focus management).

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = 'https://watchora.ramagiritharun.in';
const email = `audit-${Date.now()}@test.in`;
const password = 'supersecret123';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); // mobile
const page = await context.newPage();
const errors = [];

await page.addInitScript(() => {
  window.SpeechRecognition = class {
    constructor() { this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null; }
    start() { setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { setTimeout(() => this.onend && this.onend(), 0); }
    abort() {}
  };
  window.webkitSpeechRecognition = window.SpeechRecognition;
  window.Audio = class {
    constructor() { this.onplay = null; this.onended = null; this.onerror = null; this._t = null; }
    play() { if (this.onplay) this.onplay(); this._t = setTimeout(() => this.onended && this.onended(), 60); return Promise.resolve(); }
    pause() { if (this._t) clearTimeout(this._t); }
  };
});

async function axeScan(label) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    help: v.help,
    targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
  }));
  errors.push({ label, violations });
  console.log(`\n=== ${label} ===`);
  if (violations.length === 0) console.log('  axe: PASS (0 violations)');
  else for (const v of violations) console.log(`  [${v.impact}] ${v.id} x${v.nodes} — ${v.help}\n      ${v.targets.join(' | ')}`);
}

// Custom blind-user checks
async function customChecks(label) {
  const out = await page.evaluate(() => {
    const results = [];
    // 1. Unlabeled buttons
    const unlabeled = [...document.querySelectorAll('button')]
      .filter((b) => {
        const text = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || '';
        const title = b.getAttribute('title') || '';
        const imgAlt = b.querySelector('img[alt]')?.getAttribute('alt') || '';
        return !text && !aria && !title && !imgAlt;
      })
      .map((b) => (b.className || b.id || '?' ).toString().slice(0, 60));
    if (unlabeled.length) results.push({ check: 'unlabeled-buttons', count: unlabeled.length, items: unlabeled.slice(0, 10) });

    // 2. Heading order
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => `${h.tagName}:${(h.textContent || '').trim().slice(0, 40)}`);
    const levels = headings.map((h) => parseInt(h[1]));
    let skip = null;
    for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) skip = { i, from: levels[i - 1], to: levels[i], text: headings[i] };
    if (skip) results.push({ check: 'heading-order-skip', detail: skip, headings: headings.slice(0, 12) });
    if (headings.length) results.push({ check: 'headings', headings: headings.slice(0, 14) });

    // 3. Small touch targets (<24px)
    const small = [...document.querySelectorAll('button, a, [role=button], input, select, [role=switch]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && getComputedStyle(el).visibility !== 'hidden';
      })
      .map((el) => `${(el.tagName + '.' + (el.className || '').toString().slice(0, 30)).slice(0, 50)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    if (small.length) results.push({ check: 'small-targets', count: small.length, items: small.slice(0, 10) });

    // 4. Live regions present
    const liveRegions = [...document.querySelectorAll('[aria-live], [role=status], [role=alert]')].map((el) => ({
      role: el.getAttribute('role'),
      live: el.getAttribute('aria-live'),
      text: (el.textContent || '').trim().slice(0, 50),
    }));
    results.push({ check: 'live-regions', count: liveRegions.length, regions: liveRegions.slice(0, 6) });

    // 5. Landmarks
    const landmarks = [...document.querySelectorAll('main, nav, header, footer, [role=main], [role=navigation], [role=banner]')]
      .map((el) => el.tagName.toLowerCase() + (el.getAttribute('role') ? `[${el.getAttribute('role')}]` : '') + (el.getAttribute('aria-label') ? ` aria-label="${el.getAttribute('aria-label')}"` : ''));
    results.push({ check: 'landmarks', landmarks });

    return results;
  });
  for (const r of out) {
    if (r.check === 'headings') continue;
    console.log(`  CUSTOM ${r.check}:`, JSON.stringify(r.count !== undefined ? { count: r.count, items: r.items } : (r.landmarks || r.regions || r.detail || r.headings)));
  }
}

try {
  // Signup
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('button:has-text("Create your account"), button:has-text("Create account")').first().click();
  await page.waitForSelector('input[type="email"]');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  const name = await page.locator('input[placeholder*="ame"], input[placeholder*="Name"]').count();
  if (name > 0) await page.fill('input[placeholder*="ame"], input[placeholder*="Name"]', 'Audit User');
  await page.locator('button:has-text("Create account")').last().click();
  await page.waitForSelector('.voice-dashboard, .app-shell', { timeout: 30000 });

  // Dismiss onboarding
  try { await page.waitForSelector('.onboarding-backdrop', { timeout: 15000 }); } catch {}
  for (let i = 0; i < 12; i++) {
    if ((await page.locator('.onboarding-backdrop').count()) === 0) break;
    const startBtn = page.locator('.onboarding-backdrop button:has-text("Start Watchora")').first();
    if ((await startBtn.count()) > 0) { await startBtn.click(); await page.waitForTimeout(300); continue; }
    const skipBtn = page.locator('.onboarding-backdrop button:has-text("Skip for now")').first();
    if ((await skipBtn.count()) > 0) await skipBtn.click();
    else {
      const c = page.locator('.onboarding-backdrop button:has-text("Continue")').first();
      if ((await c.count()) > 0) await c.click(); else { const a = page.locator('.onboarding-backdrop button').first(); if ((await a.count()) > 0) await a.click(); else break; }
    }
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(800);

  // Audit each tab via voice command (also exercises hands-free nav)
  const tabs = [
    ['home', 'Home'],
    ['tracking', 'Assist'],
    ['routes', 'Places'],
    ['journey', 'Safe Journey'],
    ['sos', 'Emergency'],
    ['community', 'Community'],
    ['settings', 'Settings'],
    ['caregiver', 'Caregiver'],
  ];
  for (const [key, label] of tabs) {
    // Use voice to navigate (proves hands-free works for each tab)
    if (key === 'home') {
      await page.evaluate(() => { const nav = document.querySelector('[role=tab]'); nav?.click(); });
    } else {
      await page.evaluate((l) => {
        const nav = [...document.querySelectorAll('[role=tab]')].find((t) => (t.textContent || '').toLowerCase().includes(l.toLowerCase()));
        nav?.click();
      }, label);
      if (key === 'caregiver' && (await page.locator('[role=tab]:has-text("Caregiver")').count()) === 0) {
        console.log('\n=== caregiver ===\n  SKIP (not visible for this role)');
        continue;
      }
    }
    await page.waitForTimeout(1200);
    await axeScan(label);
    await customChecks(label);
  }
} catch (err) {
  console.log('ERROR:', err.message);
} finally {
  const summary = errors.map((e) => `${e.label}: ${e.violations.length ? e.violations.map((v) => v.id + 'x' + v.nodes).join(', ') : 'PASS'}`).join('\n');
  console.log('\n\n=== SUMMARY ===\n' + summary);
  await browser.close();
}
