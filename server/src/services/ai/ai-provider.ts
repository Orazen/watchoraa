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
  | { source: 'server'; provider: 'GEMINI'; apiKey: string; model: string }
  | { source: 'demo' };

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Resolution order: the user's own AI provider settings (their key, their
 * provider, their model) win; if the user has none, the server-wide Gemini
 * key applies; with neither, AI runs in demo mode.
 */
export function resolveAiConfig(userPref: { provider: string; model: string | null; baseUrl: string | null; apiKeyEnc: string | null } | null, serverKey: string | undefined, serverModel: string): ResolvedAiConfig {
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
    return { source: 'user', provider: 'GEMINI', apiKey, model: userPref.model || serverModel };
  }
  if (serverKey) {
    return { source: 'server', provider: 'GEMINI', apiKey: serverKey, model: serverModel };
  }
  return { source: 'demo' };
}

export function buildProvider(config: ResolvedAiConfig): AiProvider {
  switch (config.source) {
    case 'demo':
      return new DemoProvider();
    case 'server':
      return new GeminiProvider(config.apiKey, config.model);
    case 'user':
      return config.provider === 'OPENAI_COMPATIBLE'
        ? new OpenAiCompatibleProvider(config.apiKey, config.model, config.baseUrl ?? OPENAI_DEFAULT_BASE_URL)
        : new GeminiProvider(config.apiKey, config.model);
  }
}

export { AiProviderError };
export type { AiMode, AiProvider, AiRequest, AiResult } from './types.js';
