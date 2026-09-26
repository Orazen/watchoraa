import { describe, expect, it } from 'vitest';
import { runDemoCommand, DEMO_SUGGESTIONS, DEMO_UNKNOWN_REPLY } from '../landingDemo';

// The landing-page demo quotes the app's real spoken strings and honestly
// describes the rest. These tests pin the two most dangerous properties of
// that demo: (1) every suggested chip actually routes through the real
// deterministic command router, and (2) safety commands NEVER perform — they
// stop at the confirmation gate and say so.
describe('landing demo brain', () => {
  it('routes every suggestion chip through the real command router', () => {
    for (const { transcript } of DEMO_SUGGESTIONS) {
      const exchange = runDemoCommand(transcript);
      expect(exchange, `chip "${transcript}" must match the deterministic router`).not.toBeNull();
    }
  });

  it('emergency stops at the confirmation gate and never performs', () => {
    const exchange = runDemoCommand('emergency');
    expect(exchange?.intent).toBe('emergency');
    expect(exchange?.requiresConfirmation).toBe(true);
    expect(exchange?.reply.say).toContain('Say confirm');
    expect(exchange?.reply.note).toMatch(/stops at the gate|nothing is sent/);
  });

  it('cancel emergency is also gated', () => {
    const exchange = runDemoCommand('cancel emergency');
    expect(exchange?.requiresConfirmation).toBe(true);
  });

  it('quotes the real no-journey lost answer', () => {
    const exchange = runDemoCommand("i'm lost");
    expect(exchange?.reply.say).toBe(
      'You do not have an active journey. Say emergency if you need help now.',
    );
  });

  it('answers the clock live, same format as the app', () => {
    const fixed = new Date(2026, 8, 26, 14, 5);
    const exchange = runDemoCommand('what time is it', fixed);
    expect(exchange?.reply.say).toBe('It is 2:05 PM.');
  });

  it('speaks the real help message', () => {
    const exchange = runDemoCommand('what can you do');
    expect(exchange?.reply.say).toContain('You can say:');
    expect(exchange?.reply.note).toMatch(/actual help message/);
  });

  it('describes rather than fabricates for camera intents', () => {
    const exchange = runDemoCommand('what money is this');
    expect(exchange?.intent).toBe('identify_currency');
    expect(exchange?.reply.say).toMatch(/^In the app /);
  });

  it('returns null for unrecognized phrases and the caller uses the honest reply', () => {
    expect(runDemoCommand('tell me a joke about penguins')).toBeNull();
    expect(DEMO_UNKNOWN_REPLY.say).toContain('did not recognise');
  });

  it('extracts the destination for a safe journey', () => {
    const exchange = runDemoCommand('start a safe journey to the pharmacy');
    expect(exchange?.intent).toBe('start_safe_journey');
    expect(exchange?.reply.say).toContain('pharmacy');
  });

  it('extracts the object name for find-my-things', () => {
    const exchange = runDemoCommand('find my keys');
    expect(exchange?.intent).toBe('find_thing');
    expect(exchange?.reply.say).toContain('keys');
  });
});
