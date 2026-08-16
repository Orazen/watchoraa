import { GeminiProvider } from './gemini-provider.js';
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from './types.js';

export class DemoProvider implements AiProvider {
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
}

let cachedProvider: { key: string; provider: AiProvider } | null = null;

export function getAiProvider(apiKey: string | undefined, model: string): AiProvider {
  if (!apiKey) {
    return new DemoProvider();
  }

  if (cachedProvider?.key === apiKey) {
    return cachedProvider.provider;
  }

  const provider = new GeminiProvider(apiKey, model);
  cachedProvider = { key: apiKey, provider };
  return provider;
}

export { AiProviderError };
export type { AiMode, AiProvider, AiRequest, AiResult } from './types.js';
