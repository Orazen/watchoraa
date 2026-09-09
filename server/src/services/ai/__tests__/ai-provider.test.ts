import { describe, expect, it } from 'vitest';
import { resolveAiConfig, serverAiFallbackFromEnv, buildProvider, OPENAI_DEFAULT_BASE_URL } from '../ai-provider.js';
import { encryptSecret } from '../../../lib/secret-box.js';

// resolveAiConfig really decrypts user prefs, so the fixture payload must be a
// genuine ciphertext. Keys are assembled at runtime — no real credentials here.
process.env.JWT_SECRET ||= 'test-secret';
const KEY_A = `test-${'a'.repeat(8)}`;
const KEY_B = `test-${'b'.repeat(8)}`;
const USER_ENC = encryptSecret(`user-${'k'.repeat(6)}`);
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const GEMINI_MODEL = 'gemini-3.6-flash';

const userOpenAiPref = { provider: 'OPENAI_COMPATIBLE', model: 'llama-3.3-70b-versatile', baseUrl: GROQ_BASE, apiKeyEnc: USER_ENC };
const userGeminiPref = { provider: 'GEMINI', model: null, baseUrl: null, apiKeyEnc: USER_ENC };

describe('serverAiFallbackFromEnv', () => {
  it('returns null when no server key is configured', () => {
    expect(serverAiFallbackFromEnv({ AI_PROVIDER: 'OPENAI_COMPATIBLE', GEMINI_MODEL })).toBeNull();
  });

  it('builds an OpenAI-compatible fallback from AI_* vars', () => {
    const fallback = serverAiFallbackFromEnv({
      AI_API_KEY: KEY_A,
      AI_PROVIDER: 'OPENAI_COMPATIBLE',
      AI_MODEL: 'llama-3.3-70b-versatile',
      AI_BASE_URL: GROQ_BASE,
      GEMINI_MODEL,
    });
    expect(fallback).toEqual({
      provider: 'OPENAI_COMPATIBLE',
      apiKey: KEY_A,
      model: 'llama-3.3-70b-versatile',
      baseUrl: GROQ_BASE,
    });
  });

  it('returns null for an OpenAI-compatible fallback without a base URL', () => {
    expect(
      serverAiFallbackFromEnv({ AI_API_KEY: KEY_A, AI_PROVIDER: 'OPENAI_COMPATIBLE', GEMINI_MODEL }),
    ).toBeNull();
  });

  it('prefers AI_API_KEY over the legacy GEMINI_API_KEY', () => {
    const fallback = serverAiFallbackFromEnv({ AI_API_KEY: KEY_A, AI_PROVIDER: 'GEMINI', GEMINI_API_KEY: KEY_B, GEMINI_MODEL });
    expect(fallback).toEqual({ provider: 'GEMINI', apiKey: KEY_A, model: GEMINI_MODEL });
  });

  it('falls back to the legacy GEMINI_* vars', () => {
    expect(serverAiFallbackFromEnv({ AI_PROVIDER: 'OPENAI_COMPATIBLE', GEMINI_API_KEY: KEY_B, GEMINI_MODEL })).toEqual({
      provider: 'GEMINI',
      apiKey: KEY_B,
      model: GEMINI_MODEL,
    });
  });
});

describe('resolveAiConfig', () => {
  it('user key wins over any server fallback', () => {
    const resolved = resolveAiConfig(userOpenAiPref, { provider: 'GEMINI', apiKey: KEY_B, model: GEMINI_MODEL });
    if (resolved.source !== 'user') throw new Error('expected user-sourced config');
    expect(resolved.provider).toBe('OPENAI_COMPATIBLE');
  });

  it('server fallback applies when the user has no key', () => {
    const resolved = resolveAiConfig({ ...userOpenAiPref, apiKeyEnc: null }, { provider: 'OPENAI_COMPATIBLE', apiKey: KEY_B, model: 'llama-3.3-70b-versatile', baseUrl: GROQ_BASE });
    expect(resolved).toMatchObject({ source: 'server', provider: 'OPENAI_COMPATIBLE', baseUrl: GROQ_BASE });
  });

  it('falls back to demo when nothing is configured', () => {
    expect(resolveAiConfig(null, null)).toEqual({ source: 'demo' });
    expect(resolveAiConfig({ ...userOpenAiPref, apiKeyEnc: null }, null).source).toBe('demo');
  });
});

describe('buildProvider', () => {
  it('builds an OpenAI-compatible provider for a server fallback', () => {
    const provider = buildProvider({ source: 'server', provider: 'OPENAI_COMPATIBLE', apiKey: KEY_A, model: 'm', baseUrl: GROQ_BASE });
    expect(provider.id).toBe('openai-compatible');
  });

  it('builds a Gemini provider for a server Gemini fallback', () => {
    expect(buildProvider({ source: 'server', provider: 'GEMINI', apiKey: KEY_A, model: 'm' }).id).toBe('gemini');
  });

  it('defaults the user OpenAI-compatible base URL', () => {
    const resolved = resolveAiConfig({ ...userOpenAiPref, baseUrl: null }, null);
    expect(resolved).toMatchObject({ source: 'user', baseUrl: OPENAI_DEFAULT_BASE_URL });
  });
});
