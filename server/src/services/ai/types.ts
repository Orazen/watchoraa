export type AiMode = 'navigation' | 'assistant' | 'reading' | 'environment' | 'emergency';

export type Confidence = 'low' | 'medium' | 'high';

export interface AiRequest {
  mode: AiMode;
  prompt: string;
  /** Optional fully-resolved prompt (e.g. an admin-activated PromptVersion). */
  promptOverride?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export interface AiResult {
  mode: AiMode;
  summary: string;
  details: string[];
  warnings: string[];
  confidence: Confidence;
  shouldStop: boolean;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'invalid_key' | 'timeout' | 'unsupported' | 'provider_error',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiProvider {
  generate(request: AiRequest, signal: AbortSignal): Promise<AiResult>;
}
