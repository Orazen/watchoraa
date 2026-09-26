import { describe, expect, it } from 'vitest';
import { resolveLandingVoice, matchChoice, VOICE_HELP, type LandingChoice } from '../landingVoice';

// The landing voice grammar: a visitor can navigate the page, open account
// flows, hear the command list, silence the assistant, run real demo
// commands, and — when the utterance is not understood — get a clarifying
// question with named choices instead of a bare "not recognised".
describe('landing voice grammar', () => {
  it('navigates between the page sections by voice', () => {
    expect(resolveLandingVoice('show me the demo')?.kind === 'goto' ? (resolveLandingVoice('show me the demo') as { target: string }).target : null).toBe('wispr-demo');
    expect(resolveLandingVoice('try it')).toMatchObject({ kind: 'goto', target: 'wispr-demo' });
    expect(resolveLandingVoice('go back to the top')).toMatchObject({ kind: 'goto', target: 'wispr-top' });
  });

  it('opens account creation and sign in', () => {
    expect(resolveLandingVoice('create an account')).toMatchObject({ kind: 'auth', mode: 'signup' });
    expect(resolveLandingVoice('sign up please')).toMatchObject({ kind: 'auth', mode: 'signup' });
    expect(resolveLandingVoice('sign in')).toMatchObject({ kind: 'auth', mode: 'signin' });
  });

  it('answers cost and safety questions with navigation', () => {
    expect(resolveLandingVoice('how much does it cost')).toMatchObject({ kind: 'goto', target: 'wispr-account' });
    expect(resolveLandingVoice('is my data safe')).toMatchObject({ kind: 'goto', target: 'wispr-safety' });
  });

  it('stop always wins, even phrased politely', () => {
    expect(resolveLandingVoice('stop')).toMatchObject({ kind: 'stop' });
    expect(resolveLandingVoice('be quiet now')).toMatchObject({ kind: 'stop' });
    expect(resolveLandingVoice('never mind')).toMatchObject({ kind: 'stop' });
  });

  it('speaks the command list on help', () => {
    const action = resolveLandingVoice('what can I say');
    expect(action).toMatchObject({ kind: 'help' });
    if (action?.kind === 'help') expect(action.say).toContain('try the demo');
  });

  it('delegates demo phrases to the REAL app router', () => {
    const action = resolveLandingVoice('what time is it');
    expect(action?.kind).toBe('demo');
    if (action?.kind === 'demo') expect(action.exchange.intent).toBe('what_time_is_it');
    const emergency = resolveLandingVoice('emergency');
    if (emergency?.kind === 'demo') expect(emergency.exchange.requiresConfirmation).toBe(true);
  });

  it('clarifies with NAMED choices instead of bare failure', () => {
    const action = resolveLandingVoice('make me a sandwich');
    expect(action?.kind).toBe('clarify');
    if (action?.kind === 'clarify') {
      expect(action.say).toContain('Did you want');
      expect(action.choices).toEqual(['demo', 'features', 'account']);
    }
    expect(VOICE_HELP).toContain('Say stop');
  });

  it('reads section summaries', () => {
    const action = resolveLandingVoice('read what it does');
    expect(action?.kind).toBe('read');
    if (action?.kind === 'read') expect(action.say).toContain('reads the world out loud');
  });

  it('resolves clarification choices by voice', () => {
    const choices: LandingChoice[] = ['demo', 'features', 'account'];
    expect(matchChoice('the demo please', choices)).toBe('demo');
    expect(matchChoice('what it does', choices)).toBe('features');
    expect(matchChoice('an account', choices)).toBe('account');
    expect(matchChoice('make me a sandwich', choices)).toBeNull();
  });

  it('normalizes apostrophes like the app router does', () => {
    // "i'd like to try it" → "i d like to try it" must still hit "try it".
    expect(resolveLandingVoice("i'd like to try it")).toMatchObject({ kind: 'goto', target: 'wispr-demo' });
  });
});
