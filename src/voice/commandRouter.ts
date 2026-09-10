// Hybrid command router: deterministic commands first (safety-critical),
// then an optional AI intent parser for flexible wording. The AI parser must
// never handle emergency/journey intents that the deterministic layer already
// covers — those are locked to local matching.

import { matchDeterministicCommand } from './deterministicCommands';
import type { VoiceIntent } from './voiceTypes';
import { CONFIRMATION_REQUIRED, HELP_MESSAGE } from './voiceTypes';

export interface AiIntentParser {
  /** Returns null when it cannot parse or the model is unavailable. */
  parseIntent(transcript: string): Promise<VoiceIntent | null>;
}

export type RouterOptions = {
  aiParser?: AiIntentParser | null;
  /** When true, flexible AI interpretation is disabled (e.g. offline). */
  offline?: boolean;
};

const UNSUPPORTED_INTENTS: VoiceIntent['intent'][] = ['unknown'];

export class CommandRouter {
  private aiParser: AiIntentParser | null;
  private offline: boolean;
  /** In-flight AI parses keyed by normalized transcript: concurrent identical
   *  submissions (double-tap Send, Enter+click in the same tick) share one
   *  AI round-trip instead of paying for two. Settled entries are removed —
   *  this is dedupe of concurrent work, not a result cache. */
  private inflight = new Map<string, Promise<VoiceIntent>>();

  constructor(opts: RouterOptions = {}) {
    this.aiParser = opts.aiParser ?? null;
    this.offline = opts.offline ?? false;
  }

  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  setAiParser(parser: AiIntentParser | null): void {
    this.aiParser = parser;
  }

  /** Routes a transcript to a VoiceIntent. Deterministic match wins always. */
  async route(transcript: string): Promise<VoiceIntent> {
    const clean = transcript.trim();
    if (!clean) {
      return { intent: 'unknown', parameters: {}, confidence: 0, requiresConfirmation: false, deterministic: false };
    }
    const key = clean.toLowerCase();
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const run = this.routeUncached(clean).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async routeUncached(clean: string): Promise<VoiceIntent> {
    // 1. Deterministic (safety-critical) matching — always first, never skipped.
    const deterministic = matchDeterministicCommand(clean);
    if (deterministic) return deterministic;

    // 2. AI fallback for flexible wording (only when online + parser present).
    if (!this.offline && this.aiParser) {
      try {
        const ai = await this.aiParser.parseIntent(clean);
        if (ai && !UNSUPPORTED_INTENTS.includes(ai.intent)) {
          return { ...ai, deterministic: false };
        }
      } catch {
        // Fall through to unknown.
      }
    }

    return { intent: 'unknown', parameters: {}, confidence: 0, requiresConfirmation: false, deterministic: false };
  }

  /** Whether an intent requires explicit confirmation before execution. */
  requiresConfirmation(intent: VoiceIntent): boolean {
    if (intent.requiresConfirmation) return true;
    return CONFIRMATION_REQUIRED.includes(intent.intent);
  }
}

export const LOW_CONFIDENCE_MESSAGE =
  'I am not sure what you asked. You can say: describe what is ahead, read this, start a safe journey, or emergency.';

export { HELP_MESSAGE };
