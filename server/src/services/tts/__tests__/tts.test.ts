import { describe, expect, it } from 'vitest';
import { chunkText, generateSecMsGec } from '../edge-tts.js';
import { localeFromVoice, curatedVoices, defaultVoiceFor } from '../voices.js';

describe('generateSecMsGec', () => {
  it('is deterministic for a fixed timestamp and 64 hex chars', () => {
    const a = generateSecMsGec(1786000000123);
    const b = generateSecMsGec(1786000000123);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9A-F]{64}$/);
  });

  it('changes across 5-minute windows', () => {
    const a = generateSecMsGec(1786000000123);
    const b = generateSecMsGec(1786000000123 + 5 * 60 * 1000);
    expect(a).not.toBe(b);
  });
});

describe('chunkText', () => {
  it('returns the text unchanged when short', () => {
    expect(chunkText('Hello world')).toEqual(['Hello world']);
  });

  it('splits long text on sentence boundaries', () => {
    const long = 'One. '.repeat(400); // 2000 chars
    const chunks = chunkText(long, 500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 510)).toBe(true);
  });

  it('handles empty input', () => {
    expect(chunkText('   ')).toEqual([]);
  });
});

describe('voice catalog', () => {
  it('includes all major Indian languages with male+female voices', () => {
    const voices = curatedVoices();
    for (const locale of ['hi-IN', 'ta-IN', 'te-IN', 'kn-IN', 'ml-IN', 'bn-IN', 'gu-IN', 'mr-IN', 'ur-IN']) {
      const list = voices.filter((v) => v.locale === locale);
      expect(list.length).toBe(2);
      expect(list.some((v) => v.gender === 'Female')).toBe(true);
      expect(list.some((v) => v.gender === 'Male')).toBe(true);
    }
  });

  it('localeFromVoice parses the locale prefix', () => {
    expect(localeFromVoice('hi-IN-SwaraNeural')).toBe('hi-IN');
    expect(localeFromVoice('en-US-JennyNeural')).toBe('en-US');
    expect(localeFromVoice('garbage')).toBe('en-US');
  });

  it('defaultVoiceFor returns a voice per locale with an English fallback', () => {
    expect(defaultVoiceFor('hi-IN')).toBe('hi-IN-SwaraNeural');
    expect(defaultVoiceFor('xx-XX')).toBe('en-US-JennyNeural');
  });
});
