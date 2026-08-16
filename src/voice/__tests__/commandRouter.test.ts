// Unit tests for the deterministic voice command router (v0.4).
// Safety-critical commands must always match locally, never via AI.

import { describe, expect, it } from 'vitest';
import { matchDeterministicCommand } from '../deterministicCommands';
import { CommandRouter } from '../commandRouter';
import { ConfirmationManager } from '../confirmationManager';

describe('deterministic emergency commands', () => {
  it('matches emergency phrases', () => {
    for (const phrase of ['Emergency', 'Watchora emergency', 'Send SOS', 'I need help', 'Call my trusted contact']) {
      const i = matchDeterministicCommand(phrase);
      expect(i?.intent, phrase).toBe('emergency');
      expect(i?.deterministic).toBe(true);
    }
  });

  it('requires confirmation for emergency', () => {
    const router = new CommandRouter();
    const intent = matchDeterministicCommand('Emergency')!;
    expect(router.requiresConfirmation(intent)).toBe(true);
  });

  it('matches cancel emergency', () => {
    expect(matchDeterministicCommand('Cancel emergency')?.intent).toBe('cancel_emergency');
    expect(matchDeterministicCommand('Cancel SOS')?.intent).toBe('cancel_emergency');
  });

  it('matches location sharing', () => {
    expect(matchDeterministicCommand('Send my current location')?.intent).toBe('send_location');
  });
});

describe('deterministic journey commands', () => {
  it('starts a journey with a destination', () => {
    const i = matchDeterministicCommand('Start a safe journey to the railway station')!;
    expect(i.intent).toBe('start_safe_journey');
    expect(i.parameters.destination).toBe('railway station');
  });

  it('requires confirmation when no destination given', () => {
    const i = matchDeterministicCommand('Start a safe journey')!;
    expect(i.requiresConfirmation).toBe(true);
  });

  it('matches safety phrases', () => {
    expect(matchDeterministicCommand('I am safe')?.intent).toBe('i_am_safe');
    expect(matchDeterministicCommand('I am lost')?.intent).toBe('i_am_lost');
    expect(matchDeterministicCommand('I arrived')?.intent).toBe('i_arrived');
    expect(matchDeterministicCommand('Stop my journey')?.intent).toBe('stop_safe_journey');
  });
});

describe('deterministic assist/settings commands', () => {
  it('matches assistance', () => {
    expect(matchDeterministicCommand('Describe what is ahead')?.intent).toBe('describe_scene');
    expect(matchDeterministicCommand('Read this')?.intent).toBe('read_text');
  });

  it('matches settings', () => {
    expect(matchDeterministicCommand('Check my permissions')?.intent).toBe('permission_status');
    expect(matchDeterministicCommand('Speak slower')?.intent).toBe('speak_slower');
    expect(matchDeterministicCommand('Stop speaking')?.intent).toBe('stop_speech');
    expect(matchDeterministicCommand('Turn hazard vibration on')?.parameters.setting).toBe('hazardVibration');
  });

  it('matches tab navigation', () => {
    expect(matchDeterministicCommand('Open Safe Journey')?.parameters.tab).toBe('journey');
    expect(matchDeterministicCommand('Open settings')?.parameters.tab).toBe('settings');
  });

  it('matches help', () => {
    expect(matchDeterministicCommand('What can I do?')?.intent).toBe('help');
  });

  it('returns null for unknown', () => {
    expect(matchDeterministicCommand('the sky is blue today')).toBeNull();
  });
});

describe('confirmation manager', () => {
  it('routes confirm/cancel to the active request only', () => {
    const cm = new ConfirmationManager();
    let confirmed = 0;
    let cancelled = 0;
    expect(cm.request('emergency', 'Confirm?', () => confirmed++, () => cancelled++)).toBe(true);
    expect(cm.request('emergency', 'second', () => {})).toBe(false); // one at a time
    cm.handleConfirmIntent({ intent: 'confirm', parameters: {}, confidence: 1, requiresConfirmation: false, deterministic: true });
    expect(confirmed).toBe(1);
    cm.handleConfirmIntent({ intent: 'cancel', parameters: {}, confidence: 1, requiresConfirmation: false, deterministic: true });
    expect(cancelled).toBe(0); // already consumed
  });
});

describe('hybrid router (deterministic first, AI never for safety)', () => {
  it('deterministic wins even when the AI parser is present', async () => {
    const aiCalls: string[] = [];
    const router = new CommandRouter({
      aiParser: {
        async parseIntent(t: string) {
          aiCalls.push(t);
          return { intent: 'describe_scene', parameters: {}, confidence: 1, requiresConfirmation: false, deterministic: false };
        },
      },
    });
    const i = await router.route('Emergency');
    expect(i.intent).toBe('emergency');
    expect(i.deterministic).toBe(true);
    expect(aiCalls.length).toBe(0); // AI never consulted for safety
  });

  it('falls back to AI for flexible wording', async () => {
    const router = new CommandRouter({
      aiParser: {
        async parseIntent() {
          return { intent: 'describe_scene', parameters: {}, confidence: 0.9, requiresConfirmation: false, deterministic: false };
        },
      },
    });
    const i = await router.route('please tell me what you can see');
    expect(i.intent).toBe('describe_scene');
    expect(i.deterministic).toBe(false);
  });

  it('returns unknown offline without AI', async () => {
    const router = new CommandRouter({ aiParser: { async parseIntent() { return { intent: 'describe_scene', parameters: {}, confidence: 1, requiresConfirmation: false, deterministic: false }; } }, offline: true });
    const i = await router.route('please tell me what you can see');
    expect(i.intent).toBe('unknown');
  });
});

describe('v0.5 vision coaching + shopping commands', () => {
  it.each([
    ['navigation mode', 'navigation'],
    ['turn on navigation coaching', 'navigation'],
    ['reading mode', 'reading'],
    ['exploration mode', 'exploration'],
    ['shopping mode', 'shopping'],
    ['stop coaching', 'off'],
    ['turn off navigation coaching', 'off'],
  ])('maps "%s" to set_coach_mode(%s)', async (phrase, mode) => {
    const router = new CommandRouter({ aiParser: null });
    const i = await router.route(phrase);
    expect(i.intent).toBe('set_coach_mode');
    expect(i.parameters.mode).toBe(mode);
    expect(i.deterministic).toBe(true);
  });

  it.each(['read this label', 'what does this cost', 'check this product', 'read the barcode'])(
    'maps "%s" to shopping',
    async (phrase) => {
      const router = new CommandRouter({ aiParser: null });
      const i = await router.route(phrase);
      expect(i.intent).toBe('shopping');
      expect(i.deterministic).toBe(true);
    },
  );

  it('never lets coaching phrases touch the safety router', async () => {
    const router = new CommandRouter({ aiParser: null });
    const i = await router.route('stop coaching');
    expect(i.intent).toBe('set_coach_mode');
    expect(i.requiresConfirmation).toBe(false);
  });
});
