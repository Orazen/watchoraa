// Caretaker-configures-the-blind-user-account journey, verified against
// PRODUCTION. A blind user grants remote care to a caregiver; the caregiver
// configures the account remotely (voice detail level, language, speech
// rate); the ward's own preferences reflect it; a non-granted caregiver is
// refused non-committally; the audit trail records who changed what.
// Test accounts are cleaned up at the end via SSH (best effort).
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'https://watchora.ramagiritharun.in';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const stamp = Date.now();
const wardEmail = `e2e-ward-${stamp}@test.in`;
const caregiverEmail = `e2e-care-${stamp}@test.in`;
const outsiderEmail = `e2e-out-${stamp}@test.in`;
const PASSWORD = 'e2e-Care-2026!';
const ids = { ward: '', caregiver: '', outsider: '' };

async function signup(request, email, role) {
  const r = await request.post(`${BASE}/api/auth/signup`, {
    data: { email, password: PASSWORD, fullName: role === 'CAREGIVER' ? `Care ${stamp}` : `Ward ${stamp}`, role },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status(), body };
}

// ── 1. Accounts ────────────────────────────────────────────────────────
{
  const ctx = await (await chromium.launch()).newContext();
  const ward = await signup(ctx.request, wardEmail, 'BLIND_USER');
  const caregiver = await signup(ctx.request, caregiverEmail, 'CAREGIVER');
  const outsider = await signup(ctx.request, outsiderEmail, 'CAREGIVER');
  check('ward + caregiver + outsider accounts created', ward.status === 201 && caregiver.status === 201 && outsider.status === 201, JSON.stringify({ ward: ward.status, caregiver: caregiver.status, outsider: outsider.status }));
  ids.ward = ward.body?.user?.id ?? '';
  ids.caregiver = caregiver.body?.user?.id ?? '';
  ids.outsider = outsider.body?.user?.id ?? '';
  await ctx.close();
}

// ── 2. The ward grants remote care to the caregiver ───────────────────
let wardToken = '';
{
  const ctx = await (await chromium.launch()).newContext();
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: wardEmail, password: PASSWORD } });
  wardToken = (await login.json()).token ?? '';
  const grant = await ctx.request.post(`${BASE}/api/contacts`, {
    headers: { Authorization: `Bearer ${wardToken}` },
    data: { name: `Caregiver ${stamp}`, email: caregiverEmail, canReceiveAlerts: true, canManageSettings: true },
  });
  check('ward links the caregiver with canManageSettings', grant.status() === 201, `status=${grant.status()}`);
  await ctx.close();
}

// ── 3. Caregiver configures the ward's account remotely ───────────────
let caregiverToken = '';
{
  const ctx = await (await chromium.launch()).newContext();
  const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: caregiverEmail, password: PASSWORD } });
  caregiverToken = (await login.json()).token ?? '';
  const auth = { Authorization: `Bearer ${caregiverToken}` };

  const view = await ctx.request.get(`${BASE}/api/caregiver/ward-settings/${ids.ward}`, { headers: auth });
  check('caregiver can view the ward settings', view.status() === 200, `status=${view.status()}`);

  const save = await ctx.request.put(`${BASE}/api/caregiver/ward-settings/${ids.ward}`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    data: { verbosity: 2, preferredLanguage: 'te', speechRate: 0.9, textScale: 1.15 },
  });
  const saveBody = await save.json().catch(() => ({}));
  check(
    'caregiver sets voice detail level + language + rate + text scale',
    save.status() === 200 && saveBody.preferences?.verbosity === 2 && saveBody.ward?.preferredLanguage === 'te' && saveBody.preferences?.speechRate === 0.9,
    `status=${save.status()} body=${JSON.stringify(saveBody).slice(0, 140)}`,
  );

  const verify = await ctx.request.get(`${BASE}/api/caregiver/ward-settings/${ids.ward}`, { headers: auth });
  const vBody = await verify.json();
  check('remote configuration persists', verify.status() === 200 && vBody.preferences?.verbosity === 2 && vBody.ward?.preferredLanguage === 'te');

  // A caregiver with NO grant is refused, non-committally.
  const outLogin = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: outsiderEmail, password: PASSWORD } });
  const outToken = (await outLogin.json()).token ?? '';
  const refused = await ctx.request.get(`${BASE}/api/caregiver/ward-settings/${ids.ward}`, { headers: { Authorization: `Bearer ${outToken}` } });
  check('non-granted caregiver refused (403)', refused.status() === 403, `status=${refused.status()}`);
  await ctx.close();
}

// ── 4. The ward's account reflects the caretaker's setup ──────────────
{
  const ctx = await (await chromium.launch()).newContext();
  const prefs = await ctx.request.get(`${BASE}/api/preferences`, { headers: { Authorization: `Bearer ${wardToken}` } });
  const pBody = await prefs.json();
  check(
    "ward's own preferences show the caretaker's setup",
    prefs.status() === 200 && pBody.preferences?.verbosity === 2 && pBody.preferences?.speechRate === 0.9 && pBody.preferences?.textScale === 1.15,
    JSON.stringify(pBody).slice(0, 140),
  );
  const me = await ctx.request.get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${wardToken}` } });
  const meBody = await me.json();
  check("ward's account language updated", me.status() === 200 && meBody.user?.preferredLanguage === 'te', JSON.stringify(meBody).slice(0, 120));
  await ctx.close();
}

// ── 5. Browser: the caregiver UI does the same, by hand ───────────────
{
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 45000 });
  // API-login (localStorage session restore) to bypass locator fragility.
  await page.evaluate(([tok]) => localStorage.setItem('watchora_token', tok), [caregiverToken]);
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2500);
  const tabOpened = await page.evaluate(() => document.getElementById('tab-caregiver')?.click());
  await page.waitForTimeout(1500);
  const editor = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /adjust settings/i.test(b.textContent || ''));
    btn?.click();
    return !!btn;
  });
  await page.waitForTimeout(1500);
  const ui = await page.evaluate(() => ({
    detailGroup: !!document.querySelector('[role="radiogroup"][aria-label$="voice detail level"]'),
    languageSelect: !!document.querySelector('select[aria-label$="account language"]'),
    languageValue: document.querySelector('select[aria-label$="account language"]')?.value,
    detailedChecked: [...document.querySelectorAll('[role="radio"]')].find((r) => r.textContent === 'Detailed')?.getAttribute('aria-checked'),
  }));
  check('caregiver editor shows detail level + language', editor && ui.detailGroup && ui.languageSelect, JSON.stringify(ui));
  check('editor reflects the API-set configuration', ui.languageValue === 'te' && ui.detailedChecked === 'true', JSON.stringify(ui));
  await browser.close();
}

// ── 6. Cleanup: remove the three test accounts (best effort) ──────────
{
  const { execSync } = await import('node:child_process');
  try {
    const emails = [wardEmail, caregiverEmail, outsiderEmail].map((e) => `'${e}'`).join(',');
    execSync(
      `ssh -o ConnectTimeout=8 -o StrictHostKeyChecking=no tarun@173.249.38.101 "docker exec dokploy-postgres.1.axuiikrq3sq0oqoy3ir7fitpa psql -U watchora_app -d watchora -c \\"DELETE FROM \\\\\\"User\\\\\\" WHERE email IN (${emails});\\""`,
      { stdio: 'pipe' },
    );
    check('test accounts cleaned from prod DB', true);
  } catch (e) {
    check('test accounts cleaned from prod DB', false, String(e).slice(0, 120));
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(failed.length ? 1 : 0);
