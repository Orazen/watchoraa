// AI intent parser (v0.4): a backend-routed fallback for flexible voice wording,
// used only AFTER deterministic matching fails. The server holds the Gemini key
// and restricts to a safe allow-list of intents. Returns null when unavailable.

import type { AiIntentParser } from './commandRouter';
import type { VoiceIntent } from './voiceTypes';

export class BackendIntentParser implements AiIntentParser {
  constructor(private readonly parseFn: (transcript: string) => Promise<VoiceIntent | null>) {}

  async parseIntent(transcript: string): Promise<VoiceIntent | null> {
    try {
      return await this.parseFn(transcript);
    } catch {
      return null;
    }
  }
}

/**
 * Recent-command context for pronoun follow-ups ("take me there again").
 * Sent ephemerally with each parse request — the server uses it only for that
 * one prompt and never persists it.
 */
let recentCommandContext = '';
export function setRecentCommandContext(summary: string): void {
  recentCommandContext = summary.slice(0, 1000);
}
export function getRecentCommandContext(): string {
  return recentCommandContext;
}
