// Regression tests for deterministic command routing.
//
// Every case here is a phrase a real user says that was measured as failing on
// the running app. The safety check-ins matter most: the safe-journey flow
// speaks "Check-in due. Are you safe?", and the natural human answer to that
// question did not route at all.

import { describe, it, expect } from 'vitest';
import { matchDeterministicCommand } from '../deterministicCommands';

const match = (phrase: string) => matchDeterministicCommand(phrase)?.intent ?? null;

describe('apostrophe contractions route (normalize strips them, needles must too)', () => {
  // THE DEFECT: normalize() replaces "'" with a space, so "i'm safe" became
  // "i m safe" while the rule's needle still read "i'm safe". The rule looked
  // correct in review, compiled fine, and simply never matched.
  it('routes "i\'m safe"', () => expect(match("i'm safe")).toBe('i_am_safe'));
  it('routes "i\'m lost"', () => expect(match("i'm lost")).toBe('i_am_lost'));
  it('routes "i\'m confused"', () => expect(match("i'm confused")).toBe('i_am_lost'));
  it('routes "what\'s around me"', () => expect(match("what's around me")).toBe('describe_surroundings'));
  it('routes "what\'s reported near me"', () => expect(match("what's reported near me")).toBe('reports_near'));
  it('routes "what\'s the time"', () => expect(match("what's the time")).toBe('what_time_is_it'));

  it('still routes the un-contracted spellings', () => {
    expect(match('i am safe')).toBe('i_am_safe');
    expect(match('i am lost')).toBe('i_am_lost');
    expect(match('what is around me')).toBe('describe_surroundings');
    expect(match('what is reported near me')).toBe('reports_near');
    expect(match('what is the time')).toBe('what_time_is_it');
  });

  it('routes arrival phrases', () => {
    expect(match('i arrived')).toBe('i_arrived');
    expect(match('arrived safely')).toBe('i_arrived');
    expect(match('made it')).toBe('i_arrived');
  });
});

describe('safety commands stay reachable', () => {
  it('routes emergency words', () => {
    expect(match('emergency')).toBe('emergency');
    expect(match('sos')).toBe('emergency');
    expect(match('send sos')).toBe('emergency');
    expect(match('i need help')).toBe('emergency');
  });

  it('routes cancellation ahead of the bare emergency match', () => {
    // "cancel emergency" contains "emergency" — the cancel rule has to win or
    // saying "cancel" is what raises the alarm.
    expect(match('cancel emergency')).toBe('cancel_emergency');
    expect(match('stand down')).toBe('cancel_emergency');
    expect(match('cancel sos')).toBe('cancel_emergency');
  });

  it('marks every confirmation-gated command as requiring confirmation', () => {
    for (const phrase of ['emergency', 'cancel emergency', 'end journey', 'share my location']) {
      expect(matchDeterministicCommand(phrase)?.requiresConfirmation).toBe(true);
    }
  });

  it('does not mark the safety check-ins as requiring confirmation', () => {
    // A check-in must never be parked behind a confirm: the user is answering
    // a question the app asked, and the escalation clock is running.
    for (const phrase of ["i'm safe", 'i arrived', "i'm lost"]) {
      expect(matchDeterministicCommand(phrase)?.requiresConfirmation).toBe(false);
    }
  });
});

describe('"who acknowledged" is a question, not an alarm', () => {
  // THE DEFECT: the emergency rule matches the bare substring "sos" and ran
  // first, so "who acknowledged my sos" — the question a frightened user asks
  // after sending an SOS to find out whether help arrived — re-armed the
  // emergency.
  it('routes the full phrase to who_acknowledged', () => {
    expect(match('who acknowledged my sos')).toBe('who_acknowledged');
  });

  it('routes the shorter forms', () => {
    expect(match('who acknowledged')).toBe('who_acknowledged');
    expect(match('who acknowledged my emergency')).toBe('who_acknowledged');
  });

  it('does not require confirmation — it only reads state', () => {
    expect(matchDeterministicCommand('who acknowledged my sos')?.requiresConfirmation).toBe(false);
  });
});

describe('the command vocabulary the UI advertises', () => {
  // Each of these was reachable and advertised. A command that routes to
  // `unknown` answers the user with "I am not sure what you asked."
  const advertised: Array<[string, string]> = [
    ['where am i', 'where_am_i'],
    ['what time is it', 'what_time_is_it'],
    ['list my places', 'list_places'],
    ['what is reported near me', 'reports_near'],
    ['scan the barcode', 'scan_product'],
    ['find my wallet', 'find_thing'],
    ['tell me more', 'follow_up'],
    ['emergency', 'emergency'],
    ['describe what is ahead', 'describe_scene'],
    ['read this', 'read_text'],
    ['what color is this', 'identify_color'],
    ['what money is this', 'identify_currency'],
    ['read the expiry', 'read_expiry'],
    ['what is around me', 'describe_surroundings'],
  ];

  it.each(advertised)('routes "%s"', (phrase, expected) => {
    expect(match(phrase)).toBe(expected);
  });

  // These were routed but had no handler in App.tsx, so the user got the
  // entire command menu read back to them instead of an answer.
  it.each([
    ['take me to the pharmacy', 'start_navigation'],
    ['how far is the station', 'start_navigation'],
    ['who acknowledged', 'who_acknowledged'],
  ])('routes the previously unhandled "%s"', (phrase, expected) => {
    expect(match(phrase)).toBe(expected);
  });

  it('extracts a destination from "take me to X"', () => {
    expect(matchDeterministicCommand('take me to the pharmacy')?.parameters.destination).toBe('pharmacy');
  });
});

describe('journey and utility commands', () => {
  it('routes journey lifecycle', () => {
    expect(match('start a safe journey')).toBe('start_safe_journey');
    expect(match('end journey')).toBe('stop_safe_journey');
    expect(match('check my journey')).toBe('check_journey');
  });

  it('routes voice-control utilities', () => {
    expect(match('be quiet')).toBe('stop_speech');
    expect(match('say that again')).toBe('repeat');
    expect(match('speak slower')).toBe('speak_slower');
  });

  it('routes coaching modes, with off-phrases winning over on-phrases', () => {
    expect(match('navigation mode')).toBe('set_coach_mode');
    expect(match('turn off navigation coaching')).toBe('set_coach_mode');
    expect(matchDeterministicCommand('turn off navigation coaching')?.parameters.mode).toBe('off');
    expect(matchDeterministicCommand('navigation mode')?.parameters.mode).toBe('navigation');
  });
});

describe('non-commands still fall through', () => {
  // The matcher must not become so eager that ordinary speech is captured as a
  // command — the AI parser needs those.
  it('returns null for unrelated phrases', () => {
    expect(match('')).toBeNull();
    expect(match('   ')).toBeNull();
    expect(match('the weather is nice today')).toBeNull();
  });
});
