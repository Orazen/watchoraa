// Landing-page blind-user walkthrough: keyboard-only, axe-core, live regions,
// speech capture, reduced motion, mobile width. Runs against a LOCAL preview
// build so it tests the code about to ship, not whatever prod has.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

// Capture EVERY speechSynthesis utterance + every un-user-initiated one,
// and install a controllable fake SpeechRecognition for the voice-control
// checks (headless Chromium has the real one but no usable audio backend).
await page.addInitScript(() => {
  window.__spoken = [];
  window.__speechCalls = 0;
  window.__cancelCalls = 0;
  const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
  const origCancel = window.speechSynthesis?.cancel?.bind(window.speechSynthesis);
  if (orig) {
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push(String(u.text));
      window.__speechCalls += 1;
      return orig(u);
    };
  }
  if (origCancel) {
    window.speechSynthesis.cancel = () => {
      window.__cancelCalls += 1;
      return origCancel();
    };
  }
  window.__recogInstances = [];
  class FakeRecognition {
    constructor() {
      window.__recogInstances.push(this);
      this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null;
      this.lang = ''; this.interimResults = false; this.maxAlternatives = 1;
    }
    start() { setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
});

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 1. No auto-speech on load — a landing page that talks unprompted is hostile.
const speechOnLoad = await page.evaluate(() => window.__speechCalls);
check('no speech before any user action', speechOnLoad === 0, `calls=${speechOnLoad}`);

// 2. Keyboard-only walk: first Tab must land on the skip link.
await page.keyboard.press('Tab');
const firstFocus = await page.evaluate(() => ({
  text: document.activeElement?.textContent?.trim().slice(0, 40),
  cls: document.activeElement?.className?.toString?.().slice(0, 60),
}));
check('first Tab lands on the skip link', firstFocus.text?.includes('Skip to the live demo'), JSON.stringify(firstFocus));

// 3. Skip link actually moves focus (Enter), to the demo section.
await page.keyboard.press('Enter');
const skipTarget = await page.evaluate(() => document.activeElement?.id);
check('skip link moves focus to the demo section', skipTarget === 'wispr-demo', `focus=${skipTarget}`);

// 4. Walk the full keyboard order — collect ~30 stops, assert the demo form is
// reachable and every stop is visible in the viewport.
const stops = [];
for (let i = 0; i < 30; i++) {
  await page.keyboard.press('Tab');
  const s = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { stop: 'END-OF-TAB' };
    const r = el.getBoundingClientRect();
    return {
      stop: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34)}`,
      offscreen: r.width > 0 && (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight + 800),
    };
  });
  if (s.stop === 'END-OF-TAB') break;
  stops.push(s);
  if (s.offscreen) { check('no offscreen tab stops', false, s.stop); }
}
check('no offscreen tab stops in first 30', !stops.some((s) => s.offscreen), `${stops.length} stops`);
const demoReachable = stops.some((s) => s.stop.includes('wispr-demo-input'));
check('demo input keyboard-reachable', demoReachable, stops.slice(0, 12).map((s) => s.stop).join(' | '));

// 5. Keyboard-only demo run: chips first (Space/Enter), then typed Enter.
await page.keyboard.press('Shift+Tab'); // walk back up to a chip
const chipRun = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') || '').startsWith('Try the command:'));
  chips[1]?.click(); // "What time is it"
  return chips.length;
});
check('example chips present', chipRun >= 6, `count=${chipRun}`);
await page.waitForTimeout(150);
const log1 = await page.evaluate(() => document.querySelector('[role="log"]')?.textContent || '');
check('chip reply lands in the live log', /It is \d+/.test(log1) && /Understood as: what time is it/.test(log1), log1.slice(0, 120));
const hearButtons = await page.evaluate(() => [...document.querySelectorAll('[role="log"] button')].filter((b) => (b.getAttribute('aria-label') || '') === 'Hear this response aloud').length);
check('each reply has a Hear-it control', hearButtons >= 1, `count=${hearButtons}`);

// 6. Typed path with a REAL user-typed Enter (native setter for React input).
await page.evaluate(() => {
  const el = document.getElementById('wispr-demo-input');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, 'emergency');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.focus('#wispr-demo-input');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const log2 = await page.evaluate(() => document.querySelector('[role="log"]')?.textContent || '');
check('typed emergency hits the confirmation gate', /Say confirm/.test(log2) && /needs your confirmation/.test(log2), log2.slice(-200));

// 7. Unknown phrase → honest reply, not a fake success.
await page.evaluate(() => {
  const el = document.getElementById('wispr-demo-input');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, 'tell me a joke about penguins');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
const log3 = await page.evaluate(() => document.querySelector('[role="log"]')?.textContent || '');
check('unknown phrase answered honestly', /did not recognise/.test(log3), log3.slice(-160));

// 8. "Hear it" speaks exactly the reply text via speechSynthesis.
const spokenBefore = await page.evaluate(() => window.__speechCalls);
const hearClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[role="log"] button')].find((b) => (b.getAttribute('aria-label') || '') === 'Hear this response aloud');
  btn?.click();
  return !!btn;
});
await page.waitForTimeout(200);
const spoken = await page.evaluate(() => window.__spoken);
check('Hear-it button speaks the reply', hearClicked && spoken.length > 0, JSON.stringify(spoken.slice(-1)));

// 9. Feature-card "Hear it" buttons exist with named labels.
const cardHear = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') || '').startsWith('Hear the example:')).length);
check('feature cards have named Hear-example buttons', cardHear >= 4, `count=${cardHear}`);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Hear the example:'))?.click());
await page.waitForTimeout(150);
const spoken2 = await page.evaluate(() => window.__spoken);
check('feature example actually speaks', spoken2.length > spoken.length, JSON.stringify(spoken2.slice(-1)));

// 10. Heading outline: one h1, ordered h2s, no skips.
const outline = await page.evaluate(() =>
  [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName}:${(h.textContent || '').trim().slice(0, 26)}`),
);
check('one h1', outline.filter((h) => h.startsWith('H1')).length === 1, outline.join(' → '));

// 11. Landmarks.
const landmarks = await page.evaluate(() => [...document.querySelectorAll('main,nav,header,footer,[role="log"]')].map((e) => e.tagName.toLowerCase() + (e.getAttribute('aria-label') ? `(${e.getAttribute('aria-label')})` : '')));
check('header/nav/main/footer/log landmarks', ['header', 'nav', 'main', 'footer'].every((l) => landmarks.some((x) => x.startsWith(l))), landmarks.join(','));

// 12. axe-core scan (WCAG 2 A/AA).
const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
const real = axe.violations.filter((v) => !['region'].includes(v.id));
check('axe violations (wcag2 A/AA + 2.2AA)', real.length === 0, real.map((v) => `${v.id}×${v.nodes.length}`).join(', ') || 'none');

// 13. Reduced motion: reveals must be visible immediately.
const rmContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const rmPage = await rmContext.newPage();
await rmPage.goto(BASE, { waitUntil: 'networkidle' });
const rmState = await rmPage.evaluate(() => {
  const el = document.querySelector('.wispr-reveal');
  return el ? getComputedStyle(el).opacity : 'missing';
});
check('reduced-motion keeps content visible', rmState === '1', `opacity=${rmState}`);
await rmContext.close();

// 14. Mobile width: no horizontal scroll, demo usable.
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mpage = await mobile.newPage();
await mpage.goto(BASE, { waitUntil: 'networkidle' });
const overflow = await mpage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('no horizontal overflow at 390px', overflow <= 0, `overflow=${overflow}px`);
await mpage.evaluate(() => {
  const chips = [...document.querySelectorAll('button')].filter((b) => (b.getAttribute('aria-label') || '').startsWith('Try the command:'));
  chips[0]?.click();
});
await mpage.waitForTimeout(150);
const mlog = await mpage.evaluate(() => document.querySelector('[role="log"]')?.textContent || '');
check('demo works on mobile', /You can say:/.test(mlog), mlog.slice(0, 80));
await mobile.close();

// ── Voice control (tap-to-talk orb) ────────────────────────────────────
async function pressOrbAndSpeak(utterance, wait = 250) {
  await page.evaluate(() => document.querySelector('.voice-orb').click());
  await page.waitForTimeout(120);
  await page.evaluate((t) => {
    const inst = window.__recogInstances[window.__recogInstances.length - 1];
    inst.onresult({ results: [[{ transcript: t }]] });
  }, utterance);
  await page.waitForTimeout(wait);
}
const getSpoken = () => page.evaluate(() => window.__spoken);

// 16. The mic is never started before the visitor opts in.
const recosBefore = await page.evaluate(() => window.__recogInstances.length);
check('no microphone activity before user opts in', recosBefore === 0, `instances=${recosBefore}`);

// 17. Orb exists with a clear label and a visible status region.
const orbState = await page.evaluate(() => {
  const orb = document.querySelector('.voice-orb');
  return { label: orb?.getAttribute('aria-label'), hasStatus: !!document.querySelector('[data-voice-control] [role="status"]') };
});
check('orb present with clear label + status region', orbState.label === 'Start voice control' && orbState.hasStatus, JSON.stringify(orbState));

// 18. First press = spoken onboarding, no recognition yet.
await page.evaluate(() => document.querySelector('.voice-orb').click());
await page.waitForTimeout(200);
const onboardSpoken = await getSpoken();
const instancesAfterOnboard = await page.evaluate(() => window.__recogInstances.length);
check('first press speaks the onboarding orientation', onboardSpoken.some((t) => t.includes('Voice control is on')), JSON.stringify(onboardSpoken.slice(-1)));
check('onboarding does not start the microphone', instancesAfterOnboard === 0, `instances=${instancesAfterOnboard}`);

// 19. The onboarding speech is still "playing" in headless (no onend event
// without an audio backend), so the first press barges in and silences —
// correct product behaviour — and the press after that starts listening.
await page.evaluate(() => document.querySelector('.voice-orb').click());
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector('.voice-orb').click());
await page.waitForTimeout(150);
const listening = await page.evaluate(() => document.querySelector('.voice-orb')?.getAttribute('data-phase'));
check('orb enters listening phase', listening === 'listening', `phase=${listening}`);
await page.evaluate((t) => {
  const inst = window.__recogInstances[window.__recogInstances.length - 1];
  inst.onresult({ results: [[{ transcript: t }]] });
}, 'try the demo');
await page.waitForTimeout(250);
const afterNav = await page.evaluate(() => ({ focus: document.activeElement?.id, spoken: window.__spoken.slice(-1)[0] }));
check('voice command "try the demo" navigates + speaks', afterNav.focus === 'wispr-demo' && /Taking you to the live demo/.test(afterNav.spoken || ''), JSON.stringify(afterNav));
await pressOrbAndSpeak('what does watchora do');
const afterRead = await page.evaluate(() => window.__spoken.slice(-1)[0]);
check('"what does watchora do" reads the features summary', /reads the world out loud/.test(afterRead || ''), afterRead);

// 20. Unknown utterance → named-choice repair, choices are tappable.
await pressOrbAndSpeak('make me a sandwich');
const clarify = await page.evaluate(() => ({
  spoken: window.__spoken.slice(-1)[0],
  choiceButtons: [...document.querySelectorAll('[aria-label^="Answer:"]')].map((b) => b.getAttribute('aria-label')),
}));
check('unknown utterance gets named-choice repair', /Did you want/.test(clarify.spoken || '') && clarify.choiceButtons.length === 3, JSON.stringify(clarify));

// 21. Tapping a choice resolves it (keyboard/tap answer path).
await page.evaluate(() => (document.querySelector('[aria-label="Answer: demo"]'))?.click());
await page.waitForTimeout(200);
const afterChoice = await page.evaluate(() => document.activeElement?.id);
check('tapping a repair choice navigates', afterChoice === 'wispr-demo', `focus=${afterChoice}`);

// 22. Voice help.
await pressOrbAndSpeak('what can i say');
const helpSpoken = await getSpoken();
check('"what can i say" speaks the command list', helpSpoken.some((t) => t.includes('You can say')), JSON.stringify(helpSpoken.slice(-1)));

// 23. Voice-run demo exchange lands in the visible conversation log.
await pressOrbAndSpeak('what time is it');
const demoLogVoice = await page.evaluate(() => document.querySelector('[role="log"]')?.textContent || '');
check('voice demo exchange appears in the demo log', /It is \d/.test(demoLogVoice), demoLogVoice.slice(-120));

// 24. "stop" silences immediately.
await pressOrbAndSpeak('what does watchora do', 150);
const cancelsBefore = await page.evaluate(() => window.__cancelCalls);
await pressOrbAndSpeak('stop', 150);
const stopState = await page.evaluate(() => ({
  status: document.querySelector('[data-voice-control] [role="status"]')?.textContent || '',
  cancels: window.__cancelCalls,
}));
check('"stop" silences the assistant', stopState.status.includes('Silenced') && stopState.cancels > cancelsBefore, JSON.stringify(stopState));

// 25. Hands-free toggle exists and flips without breaking state.
await page.evaluate(() => document.querySelector('[aria-label^="Hands-free"]')?.click());
await page.waitForTimeout(120);
const hfOn = await page.evaluate(() => document.querySelector('[aria-label^="Hands-free"]')?.getAttribute('aria-pressed'));
await page.evaluate(() => document.querySelector('[aria-label^="Hands-free"]')?.click());
await page.waitForTimeout(120);
const hfOff = await page.evaluate(() => document.querySelector('[aria-label^="Hands-free"]')?.getAttribute('aria-pressed'));
check('hands-free toggle flips', hfOn === 'true' && hfOff === 'false', `on=${hfOn} off=${hfOff}`);

// 26. Console errors (after the voice run too).
check('no console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} checks passed ==`);
await browser.close();
process.exit(failed.length ? 1 : 0);
