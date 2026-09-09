import { GeminiProvider } from './gemini-provider.js';
import { OpenAiCompatibleProvider } from './openai-provider.js';
import { decryptSecret } from '../../lib/secret-box.js';
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from './types.js';

export class DemoProvider implements AiProvider {
  readonly id = 'demo';

  async generate(request: AiRequest): Promise<AiResult> {
    if (request.mode === 'emergency') {
      throw new AiProviderError('AI is not used for emergency mode', 'unsupported');
    }

    const demoSummaries: Record<Exclude<AiRequest['mode'], 'emergency'>, string> = {
      navigation: 'Demo mode: path appears clear, but watch for low obstacles and steps.',
      assistant: `Demo mode: ${request.prompt.trim() || 'the user is inside a safe indoor space.'}`,
      reading: 'Demo mode: EXIT. Reception Desk. Stairs ahead on the right.',
      environment: 'Demo mode: this looks like an indoor space with furniture nearby.',
    };

    return {
      mode: request.mode,
      summary: demoSummaries[request.mode],
      details: [],
      warnings: ['This is a demo response. No live AI analysis was performed.'],
      confidence: 'low',
      shouldStop: false,
    };
  }

  async completeJson(): Promise<Record<string, unknown>> {
    return { intent: 'unknown', parameters: {}, confidence: 0, requiresConfirmation: false };
  }
}

/** The per-user configuration that selects and parameterizes a provider. */
export type ResolvedAiConfig =
  | { source: 'user'; provider: 'GEMINI' | 'OPENAI_COMPATIBLE'; apiKey: string; model: string; baseUrl?: string }
  | { source: 'server'; provider: 'GEMINI' | 'OPENAI_COMPATIBLE'; apiKey: string; model: string; baseUrl?: string }
  | { source: 'demo' };

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** Server-wide fallback derived from env (AI_* first, legacy GEMINI_* second). */
export type ServerAiFallback = { provider: 'GEMINI' | 'OPENAI_COMPATIBLE'; apiKey: string; model: string; baseUrl?: string } | null;

/**
 * Builds the server-wide fallback from environment variables. AI_API_KEY (any
 * provider) wins over the legacy GEMINI_API_KEY; an OpenAI-compatible
 * fallback requires AI_BASE_URL since there is no meaningful default beyond
 * OpenAI itself.
 */
export function serverAiFallbackFromEnv(e: {
  AI_API_KEY?: string;
  AI_PROVIDER: 'GEMINI' | 'OPENAI_COMPATIBLE';
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL: string;
}): ServerAiFallback {
  if (e.AI_API_KEY) {
    if (e.AI_PROVIDER === 'OPENAI_COMPATIBLE') {
      if (!e.AI_BASE_URL) return null;
      return { provider: 'OPENAI_COMPATIBLE', apiKey: e.AI_API_KEY, model: e.AI_MODEL || 'llama-3.3-70b-versatile', baseUrl: e.AI_BASE_URL };
    }
    return { provider: 'GEMINI', apiKey: e.AI_API_KEY, model: e.AI_MODEL || e.GEMINI_MODEL };
  }
  if (e.GEMINI_API_KEY) {
    return { provider: 'GEMINI', apiKey: e.GEMINI_API_KEY, model: e.GEMINI_MODEL };
  }
  return null;
}

/**
 * Resolution order: the user's own AI provider settings (their key, their
 * provider, their model) win; if the user has none, the server-wide key
 * applies (any provider); with neither, AI runs in demo mode.
 */
export function resolveAiConfig(
  userPref: { provider: string; model: string | null; baseUrl: string | null; apiKeyEnc: string | null } | null,
  serverFallback: ServerAiFallback,
): ResolvedAiConfig {
  if (userPref?.apiKeyEnc) {
    const apiKey = decryptSecret(userPref.apiKeyEnc);
    if (userPref.provider === 'OPENAI_COMPATIBLE') {
      return {
        source: 'user',
        provider: 'OPENAI_COMPATIBLE',
        apiKey,
        model: userPref.model || 'gpt-4o-mini',
        baseUrl: userPref.baseUrl || OPENAI_DEFAULT_BASE_URL,
      };
    }
    return { source: 'user', provider: 'GEMINI', apiKey, model: userPref.model || 'gemini-2.5-flash' };
  }
  if (serverFallback) {
    return { source: 'server', ...serverFallback };
  }
  return { source: 'demo' };
}

export function buildProvider(config: ResolvedAiConfig): AiProvider {
  switch (config.source) {
    case 'demo':
      return new DemoProvider();
    case 'server':
      return config.provider === 'OPENAI_COMPATIBLE'
        ? new OpenAiCompatibleProvider(config.apiKey, config.model, config.baseUrl ?? OPENAI_DEFAULT_BASE_URL)
        : new GeminiProvider(config.apiKey, config.model);
    case 'user':
      return config.provider === 'OPENAI_COMPATIBLE'
        ? new OpenAiCompatibleProvider(config.apiKey, config.model, config.baseUrl ?? OPENAI_DEFAULT_BASE_URL)
        : new GeminiProvider(config.apiKey, config.model);
  }
}

export { AiProviderError };
export type { AiMode, AiProvider, AiRequest, AiResult } from './types.js';
