import { describe, expect, it } from 'vitest';
import { parseWakePhrase, findWakePhrase, isBareWakePhrase, normalizeTranscript, DEFAULT_WAKE_PHRASES } from '../wakePhrase';

describe('wake phrase parsing', () => {
  it('extracts the command after "hey watchora"', () => {
    const parsed = parseWakePhrase('Hey Watchora, describe what is ahead');
    expect(parsed.matched).toBe(true);
    expect(parsed.command).toBe('describe what is ahead');
  });

  it('matches bare "watchora" at the start', () => {
    const parsed = parseWakePhrase('Watchora open settings');
    expect(parsed.matched).toBe(true);
    expect(parsed.command).toBe('open settings');
  });

  it('supports "ok watchora"', () => {
    const parsed = parseWakePhrase('OK Watchora start a safe journey');
    expect(parsed.matched).toBe(true);
    expect(parsed.command).toBe('start a safe journey');
  });

  it('matches the wake phrase mid-sentence after punctuation', () => {
    const parsed = parseWakePhrase('... hey watchora read this');
    expect(parsed.matched).toBe(true);
    expect(parsed.command).toBe('read this');
  });

  it('returns an empty command for a bare wake phrase', () => {
    const parsed = parseWakePhrase('hey watchora');
    expect(parsed.matched).toBe(true);
    expect(parsed.command).toBe('');
    expect(isBareWakePhrase('hey watchora')).toBe(true);
  });

  it('does not match a non-word "awatchora" (word boundary)', () => {
    const parsed = parseWakePhrase('awatchora');
    expect(parsed.matched).toBe(false);
  });

  it('does not match inside "mywatchora"', () => {
    expect(findWakePhrase('mywatchora')).toBeNull();
  });

  it('does not route ordinary conversation without the wake phrase', () => {
    const parsed = parseWakePhrase('describe what is ahead');
    expect(parsed.matched).toBe(false);
    expect(parsed.command).toBe('');
  });

  it('normalizes case, punctuation and whitespace', () => {
    const parsed = parseWakePhrase('  HEY   WATCHORA!!!  read  THIS  ');
    expect(parsed.matched).toBe(true);
    expect(parsed.command).toBe('read this');
  });

  it('handles apostrophes and hyphens in commands', () => {
    const parsed = parseWakePhrase('watchora call my contact');
    expect(parsed.matched).toBe(true);
    expect(parsed.command).toBe('call my contact');
  });

  it('returns null hit for empty input', () => {
    expect(findWakePhrase('')).toBeNull();
    expect(findWakePhrase('   ')).toBeNull();
  });

  it('normalizeTranscript keeps letters, digits, apostrophes and hyphens', () => {
    expect(normalizeTranscript("Watchora — what's ahead?")).toBe("watchora what's ahead");
    expect(normalizeTranscript('')).toBe('');
  });

  it('exposes default wake phrases in priority order with watchora first', () => {
    expect(DEFAULT_WAKE_PHRASES).toContain('watchora');
    expect(DEFAULT_WAKE_PHRASES[0]).toBe('hey watchora');
  });

  it('matches the first wake phrase even when multiple appear', () => {
    const parsed = parseWakePhrase('hey watchora, watchora');
    expect(parsed.matched).toBe(true);
  });
});
