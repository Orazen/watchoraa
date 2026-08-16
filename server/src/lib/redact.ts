const REDACT_KEYS = ['password', 'passwordHash', 'token', 'authorization', 'apiKey', 'api_key', 'secret'];

export function redactValue(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => redactValue(item));
  }

  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, value]) => [
        key,
        REDACT_KEYS.some((candidate) => candidate.toLowerCase() === key.toLowerCase()) ? '[REDACTED]' : redactValue(value),
      ]),
    );
  }

  return input;
}
