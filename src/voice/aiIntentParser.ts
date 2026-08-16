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
