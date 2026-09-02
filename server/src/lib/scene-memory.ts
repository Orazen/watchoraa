/**
 * Short-lived scene-summary memory for follow-up questions ("tell me more").
 *
 * Stores the last few AI-generated TEXT summaries per user — never frames or
 * images (privacy: the promise is frames are processed in memory on the
 * server per request and never retained). Entries expire after 90 seconds:
 * stale scene answers are dangerous for a blind user, so anything older is
 * memory. Follow-up answers that use memory must age-stamp themselves and
 * must never answer motion/safety questions ("did that car move?") — the
 * prompt builder instructs the model to route those to a fresh capture.
 */

const TTL_MS = 90_000;
const MAX_PER_USER = 3;
const MAX_USERS = 500;

interface Entry {
  summary: string;
  at: number;
}

const store = new Map<string, Entry[]>();

export function rememberSummary(userId: string, summary: string): void {
  if (!userId || !summary) return;
  // Lazy sweep: cheap on the write path, no timer needed.
  const now = Date.now();
  for (const [key, entries] of store) {
    const alive = entries.filter((e) => now - e.at < TTL_MS);
    if (alive.length === 0) store.delete(key);
    else store.set(key, alive);
  }

  const list = (store.get(userId) ?? []).filter((e) => now - e.at < TTL_MS);
  list.push({ summary: summary.slice(0, 600), at: now });
  while (list.length > MAX_PER_USER) list.shift();
  store.set(userId, list);
  if (store.size > MAX_USERS) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
}

/** Returns recent summaries oldest→newest (for prompt context), or []. */
export function recentSummaries(userId: string): string[] {
  const now = Date.now();
  const list = (store.get(userId) ?? []).filter((e) => now - e.at < TTL_MS);
  if (list.length === 0) {
    store.delete(userId);
    return [];
  }
  store.set(userId, list);
  return list.map((e) => e.summary);
}

/** Age in seconds of the newest summary, or null when memory is empty. */
export function newestSummaryAgeSeconds(userId: string): number | null {
  const list = (store.get(userId) ?? []).filter((e) => Date.now() - e.at < TTL_MS);
  if (list.length === 0) return null;
  return Math.round((Date.now() - list[list.length - 1].at) / 1000);
}
