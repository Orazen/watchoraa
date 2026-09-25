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
  /**
   * Text-only single-shot completion returning parsed JSON (used by the
   * voice intent parser). Providers that cannot guarantee JSON should throw
   * AiProviderError rather than return unstructured text.
   */
  completeJson(prompt: string, signal: AbortSignal): Promise<Record<string, unknown>>;
  /**
   * Vision completion with explicit messages and one image; returns the raw
   * plain-text reply with no JSON contract. Used by the OCR text-reading path
   * (routes/ocr.ts), where the model must answer with the extracted text
   * itself — an empty string means the frame held no readable text.
   */
  completeVision(messages: VisionMessage[], image: { base64: string; mimeType: string }, signal: AbortSignal): Promise<string>;
  /** Short provider identifier used in logs: 'gemini' | 'openai-compatible'. */
  readonly id: string;
}

/** One message for vision completions: role plus plain-text content. */
export interface VisionMessage {
  role: 'system' | 'user';
  text: string;
}
