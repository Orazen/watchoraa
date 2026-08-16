import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../gemini-provider.js';
import { AiProviderError } from '../types.js';

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GeminiProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses a valid structured response', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: 'Stop, chair ahead.',
                    details: ['Path clearer to the right.'],
                    warnings: ['Confirm with your cane.'],
                    confidence: 'medium',
                    shouldStop: true,
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const provider = new GeminiProvider('test-key', 'gemini-2.5-flash');
    const result = await provider.generate({ mode: 'navigation', prompt: 'ahead?' }, new AbortController().signal);

    expect(result.summary).toBe('Stop, chair ahead.');
    expect(result.confidence).toBe('medium');
    expect(result.shouldStop).toBe(true);
  });

  it('throws invalid_key on 401/403', async () => {
    mockFetchOnce({ ok: false, status: 401, json: async () => ({}) });
    const provider = new GeminiProvider('bad-key', 'gemini-2.5-flash');

    await expect(provider.generate({ mode: 'navigation', prompt: 'x' }, new AbortController().signal)).rejects.toMatchObject({
      kind: 'invalid_key',
    } satisfies Partial<AiProviderError>);
  });

  it('throws provider_error on malformed JSON text', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
    });
    const provider = new GeminiProvider('key', 'gemini-2.5-flash');

    await expect(provider.generate({ mode: 'assistant', prompt: 'x' }, new AbortController().signal)).rejects.toMatchObject({
      kind: 'provider_error',
    });
  });

  it('throws provider_error when response fails schema validation', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: '' }) }] } }],
      }),
    });
    const provider = new GeminiProvider('key', 'gemini-2.5-flash');

    await expect(provider.generate({ mode: 'assistant', prompt: 'x' }, new AbortController().signal)).rejects.toMatchObject({
      kind: 'provider_error',
    });
  });

  it('rejects emergency mode without calling the network', async () => {
    const fetchMock = mockFetchOnce({ ok: true, status: 200, json: async () => ({}) });
    const provider = new GeminiProvider('key', 'gemini-2.5-flash');

    await expect(provider.generate({ mode: 'emergency', prompt: 'x' }, new AbortController().signal)).rejects.toMatchObject({
      kind: 'unsupported',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
