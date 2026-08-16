// Negative tests (release-readiness audit, 2026-08-06): phrases that must not
// accidentally trigger destructive/high-priority safety actions when the user
// did not intend them. Documents the actual, verified behavior of the
// deterministic router for release-readiness sign-off — see
// docs/voice-command-reference.md "Known limitation" section for the
// substring-matching trade-off this test suite records.

import { describe, expect, it } from 'vitest';
import { matchDeterministicCommand } from '../deterministicCommands';

describe('negative tests: phrases that must not accidentally trigger emergency', () => {
  it('KNOWN LIMITATION: "emergency contact" matches emergency (substring match; safe-fail-mode by design — still requires spoken confirm)', () => {
    const r = matchDeterministicCommand('emergency contact');
    expect(r?.intent).toBe('emergency');
    expect(r?.requiresConfirmation).toBe(true); // never auto-fires without confirm
  });

  it('KNOWN LIMITATION: "emergency exit" matches emergency (same substring-match trade-off)', () => {
    const r = matchDeterministicCommand('emergency exit');
    expect(r?.intent).toBe('emergency');
    expect(r?.requiresConfirmation).toBe(true);
  });

  it('"cancel my subscription" does not trigger cancel_emergency', () => {
    const r = matchDeterministicCommand('cancel my subscription');
    expect(r?.intent).not.toBe('cancel_emergency');
    expect(r?.intent).not.toBe('emergency');
  });

  it('"send email" does not trigger send_location', () => {
    const r = matchDeterministicCommand('send email');
    expect(r?.intent).not.toBe('send_location');
    expect(r?.intent).not.toBe('emergency');
  });

  it('"help me find" routes to help, not emergency', () => {
    const r = matchDeterministicCommand('help me find');
    expect(r?.intent).toBe('help');
  });

  it('"cancel the journey" does not trigger cancel_emergency', () => {
    const r = matchDeterministicCommand('cancel the journey');
    expect(r?.intent).not.toBe('cancel_emergency');
    expect(r?.intent).not.toBe('emergency');
  });

  it('all emergency-class matches always require confirmation before acting', () => {
    for (const phrase of ['emergency', 'send sos', 'i need help', 'cancel emergency', 'cancel sos']) {
      const r = matchDeterministicCommand(phrase);
      expect(r?.requiresConfirmation).toBe(true);
    }
  });
});

describe('home navigation and wake-phrase mode', () => {
  it('"go home" and "open home" route to the home tab', () => {
    for (const phrase of ['go home', 'open home', 'open the home screen', 'open dashboard']) {
      const r = matchDeterministicCommand(phrase);
      expect(r?.intent, phrase).toBe('open_tab');
      expect(r?.parameters.tab, phrase).toBe('home');
    }
  });

  it('"navigate home" is not hijacked by the home command', () => {
    const r = matchDeterministicCommand('navigate home');
    // It may be a navigation intent, but must NOT open the home tab.
    expect(r?.intent).not.toBe('open_tab');
  });

  it('"open settings" still routes to settings', () => {
    const r = matchDeterministicCommand('open settings');
    expect(r?.intent).toBe('open_tab');
    expect(r?.parameters.tab).toBe('settings');
  });
});
