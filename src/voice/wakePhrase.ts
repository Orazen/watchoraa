// Hands-free wake phrase parsing (pure, unit-testable).
//
// Watchora is voice-first by default: a blind user should never need to find
// and tap a mic button to control the app. Instead the app listens
// continuously and only acts after it hears a wake phrase ("Hey Watchora",
// "Watchora", "OK Watchora"). Everything said before/without the wake phrase
// is ignored (never routed, never sent to the network).

export const DEFAULT_WAKE_PHRASES = ['hey watchora', 'watchora', 'ok watchora', 'wake watchora'];

export interface WakePhraseHit {
  /** Index of the matched phrase in the normalized transcript, or -1. */
  index: number;
  /** The exact phrase that matched (normalized). */
  phrase: string;
}

export interface WakeParse {
  /** True if a wake phrase was heard. */
  matched: boolean;
  /** Command text following the wake phrase, trimmed. Empty when the user
   * only said the wake phrase and is expected to speak a command next. */
  command: string;
}

export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    // Keep letters, digits, apostrophes and hyphens; everything else becomes
    // a single space so "Hey, Watchora!" and "hey  watchora" both normalize.
    .replace(/[^\w'’-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Finds the first wake phrase in a transcript, requiring a word boundary
 * before it so "my watchora list" matches but "awatchora" does not. */
export function findWakePhrase(transcript: string, wakePhrases: string[] = DEFAULT_WAKE_PHRASES): WakePhraseHit | null {
  const normalized = normalizeTranscript(transcript);
  if (!normalized) return null;
  for (const rawPhrase of wakePhrases) {
    const phrase = normalizeTranscript(rawPhrase);
    if (!phrase) continue;
    const index = normalized.indexOf(phrase);
    if (index < 0) continue;
    const before = index === 0 ? '' : normalized[index - 1];
    // Word boundary: the character before must not be a letter or digit.
    if (before && /[a-z0-9]/.test(before)) continue;
    return { index, phrase };
  }
  return null;
}

export function parseWakePhrase(transcript: string, wakePhrases: string[] = DEFAULT_WAKE_PHRASES): WakeParse {
  const hit = findWakePhrase(transcript, wakePhrases);
  if (!hit) return { matched: false, command: '' };
  const normalized = normalizeTranscript(transcript);
  const command = normalized.slice(hit.index + hit.phrase.length).trim();
  return { matched: true, command };
}

/** True when a transcript is only the wake phrase with no command attached. */
export function isBareWakePhrase(transcript: string, wakePhrases: string[] = DEFAULT_WAKE_PHRASES): boolean {
  const parsed = parseWakePhrase(transcript, wakePhrases);
  return parsed.matched && parsed.command === '';
}
