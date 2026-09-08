import { z } from 'zod';
import { safeFetch } from '../../lib/safe-url.js';
import { buildPrompt } from './prompt-builder.js';
import { AiProviderError, type AiProvider, type AiRequest, type AiResult } from './types.js';

/**
 * OpenAI-compatible chat-completions provider. Works with OpenAI itself and
 * any endpoint speaking the same protocol (Groq, OpenRouter, Together,
 * self-hosted vLLM/Ollama with /v1). Vision models receive the frame as a
 * data-URL image_url part; text-only models receive text only.
 */
const chatResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }).optional(),
      }),
    )
    .min(1),
});

const MODEL_TIMEOUT_MS = 15_000;

const modelResponseSchema = z.object({
  summary: z.string().min(1).max(600),
  details: z.array(z.string().max(400)).max(5).default([]),
  warnings: z.array(z.string().max(400)).max(5).default([]),
  confidence: z.enum(['low', 'medium', 'high']).default('low'),
  shouldStop: z.boolean().default(false),
});

export class OpenAiCompatibleProvider implements AiProvider {
  readonly id = 'openai-compatible';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async generate(request: AiRequest, signal: AbortSignal): Promise<AiResult> {
    if (request.mode === 'emergency') {
      throw new AiProviderError('AI is not used for emergency mode', 'unsupported');
    }

    const prompt = request.promptOverride ?? buildPrompt(request.mode, request.prompt);
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    if (request.imageBase64 && request.imageMimeType) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${request.imageMimeType};base64,${request.imageBase64}` },
      });
    }

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), MODEL_TIMEOUT_MS);
    const onExternalAbort = () => timeoutController.abort();
    signal.addEventListener('abort', onExternalAbort);

    let response: Response;
    try {
      response = await safeFetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content }],
          temperature: 0.4,
          response_format: { type: 'json_object' },
        }),
        signal: timeoutController.signal,
      });
    } catch (error) {
      if (timeoutController.signal.aborted) {
        throw new AiProviderError('AI request timed out', 'timeout');
      }
      throw new AiProviderError(error instanceof Error ? error.message : 'AI request failed', 'provider_error');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onExternalAbort);
    }

    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new AiProviderError('AI provider rejected the request (invalid API key, base URL, or model)', 'invalid_key');
    }
    if (response.status === 404) {
      throw new AiProviderError('AI endpoint or model not found — check the model name and base URL', 'invalid_key');
    }
    if (!response.ok) {
      throw new AiProviderError(`AI provider error (status ${response.status})`, 'provider_error');
    }

    const payload = (await response.json().catch(() => null)) as unknown;
    const parsedChat = chatResponseSchema.safeParse(payload);
    if (!parsedChat.success) {
      throw new AiProviderError('AI provider returned an unexpected response shape', 'provider_error');
    }
    const rawText = parsedChat.data.choices[0]?.message?.content;
    if (!rawText) {
      throw new AiProviderError('AI provider returned an empty response', 'provider_error');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawText.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch {
      throw new AiProviderError('AI provider returned a non-JSON response', 'provider_error');
    }

    const parsed = modelResponseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AiProviderError('AI response did not match the expected shape', 'provider_error');
    }

    return {
      mode: request.mode,
      summary: parsed.data.summary,
      details: parsed.data.details,
      warnings: parsed.data.warnings,
      confidence: parsed.data.confidence,
      shouldStop: parsed.data.shouldStop,
    };
  }

  /** Text-only JSON completion for the voice intent parser. */
  async completeJson(prompt: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), MODEL_TIMEOUT_MS);
    const onExternalAbort = () => timeoutController.abort();
    signal.addEventListener('abort', onExternalAbort);

    try {
      const response = await safeFetch(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: timeoutController.signal,
      });
      if (!response.ok) {
        throw new AiProviderError(
          `AI provider error (status ${response.status})`,
          response.status === 401 || response.status === 403 || response.status === 404 ? 'invalid_key' : 'provider_error',
        );
      }
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = payload.choices?.[0]?.message?.content;
      if (!text) throw new AiProviderError('AI provider returned an empty response', 'provider_error');
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (timeoutController.signal.aborted) throw new AiProviderError('AI request timed out', 'timeout');
      throw new AiProviderError(error instanceof Error ? error.message : 'AI request failed', 'provider_error');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onExternalAbort);
    }
  }
}
