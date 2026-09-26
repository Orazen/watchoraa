import { runDemoCommand, type DemoExchange } from './landingDemo';

/**
 * Voice grammar for the LANDING PAGE — the actions a site visitor can do by
 * voice while just visiting (no account): move between sections, read a
 * section summary, open sign up / sign in, silence the assistant, hear the
 * command list, and run any demo command the real app router understands.
 *
 * Design grounded in voice-UX research: explicit tap-to-talk activation
 * rather than always-listening wake words (privacy + clarity), and when an
 * utterance is not understood, express uncertainty and OFFER NAMED
 * ALTERNATIVES (soft clarification) instead of a bare "not recognised".
 *
 * Same needle-normalization lesson as deterministicCommands.ts: normalize()
 * turns apostrophes into spaces, so needles are normalized the same way the
 * transcript is — a rule written "i'd" would otherwise never match anything.
 */

export function normalizeVoice(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text: string, ...needles: string[]): boolean {
  const t = normalizeVoice(text);
  return needles.some((n) => t.includes(normalizeVoice(n)));
}

export type LandingSectionTarget = 'wispr-demo' | 'wispr-features' | 'wispr-safety' | 'wispr-account' | 'wispr-top';

export type LandingChoice = 'demo' | 'features' | 'account';

export type LandingVoiceAction =
  | { kind: 'stop' }
  | { kind: 'help'; say: string }
  | { kind: 'demo'; exchange: DemoExchange }
  | { kind: 'goto'; target: LandingSectionTarget; say: string }
  | { kind: 'auth'; mode: 'signup' | 'signin'; say: string }
  | { kind: 'read'; say: string }
  | { kind: 'clarify'; say: string; choices: LandingChoice[] };

/** Spoken + visible command list. Kept to one breath. */
export const VOICE_HELP =
  'You can say: try the demo, what does watchora do, how does it stay safe, how much does it cost, sign up, sign in, read what it does, or any demo command like what time is it. Say stop to silence me.';

export const VOICE_ORIENTATION =
  'Voice control is on. I can move you around this page and run demo commands. Say what can I say to hear everything I understand, or try: what time is it.';

const READ_FEATURES =
  'watchora reads the world out loud. The camera describes what is ahead, hazards are detected on your phone in about a second without any network, text and banknotes are read by voice, and an emergency alerts your trusted contacts with real delivery confirmation.';

const READ_PAGE =
  'watchora turns a phone camera into a spoken second pair of eyes. On this page you can try the command brain live, read what watchora does, how it stays safe, and create a free account.';

/**
 * Match one spoken utterance. Demo phrases are delegated to the REAL app
 * router first (so "what time is it" works identically to the signed-in app);
 * everything else is landing-page navigation.
 */
export function resolveLandingVoice(text: string): LandingVoiceAction | null {
  if (!normalizeVoice(text)) return null;

  // Stop must always win, even mid-clarification.
  if (has(text, 'stop', 'be quiet', 'quiet', 'silence', 'shut up', 'never mind', 'nevermind', 'forget it')) {
    return { kind: 'stop' };
  }
  if (has(text, 'what can i say', 'what can you do', 'what are the commands', 'how does voice work', 'help')) {
    return { kind: 'help', say: VOICE_HELP };
  }

  // Real app router first — the demo IS the product.
  const exchange = runDemoCommand(text);
  if (exchange) return { kind: 'demo', exchange };

  if (has(text, 'sign up', 'create an account', 'create account', 'register', 'get started', 'make an account')) {
    return { kind: 'auth', mode: 'signup', say: 'Opening account creation.' };
  }
  if (has(text, 'sign in', 'log in', 'log me in', 'i have an account')) {
    return { kind: 'auth', mode: 'signin', say: 'Opening sign in.' };
  }
  if (has(text, 'cost', 'price', 'pricing', 'how much', 'is it free', 'free account', 'account section', 'set up', 'onboard')) {
    return { kind: 'goto', target: 'wispr-account', say: 'Here is the account section.' };
  }
  if (has(text, 'safe', 'safety', 'privacy', 'my data')) {
    return { kind: 'goto', target: 'wispr-safety', say: 'This is how watchora stays safe.' };
  }
  if (has(text, 'demo', 'try it', 'try watchora', 'let me try', 'try the app')) {
    return { kind: 'goto', target: 'wispr-demo', say: 'Taking you to the live demo. You can type or tap an example.' };
  }
  if (has(text, 'what does it do', 'what does watchora do', 'what is watchora', 'features', 'what it does', 'tell me about it', 'read what it does', 'read the features')) {
    return { kind: 'read', say: READ_FEATURES };
  }
  if (has(text, 'read the page', 'read everything', 'read this page', 'overview', 'what is this page')) {
    return { kind: 'read', say: READ_PAGE };
  }
  if (has(text, 'top', 'go back', 'go up', 'start over', 'back to the beginning')) {
    return { kind: 'goto', target: 'wispr-top', say: 'Back to the top.' };
  }

  // Soft clarification with NAMED choices (repair pattern), not a bare
  // "not recognised" — the caller offers these as tappable buttons too.
  return {
    kind: 'clarify',
    say: "I didn't catch a command I know. Did you want to try the demo, hear what watchora does, or set up an account? Say demo, features, or account.",
    choices: ['demo', 'features', 'account'],
  };
}

/** Resolve a clarification turn: did the user answer with one of the choices? */
export function matchChoice(text: string, choices: LandingChoice[]): LandingChoice | null {
  const t = normalizeVoice(text);
  if (!t) return null;
  if (choices.includes('demo') && has(t, 'demo', 'try it')) return 'demo';
  if (choices.includes('features') && has(t, 'features', 'what it does', 'what does it do')) return 'features';
  if (choices.includes('account') && has(t, 'account', 'sign up', 'free', 'cost')) return 'account';
  return null;
}
