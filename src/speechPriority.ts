// Speech priority manager (v0.3): a priority queue so that a danger message
// immediately interrupts lower-priority speech. Priorities follow the safety
// hierarchy from the startup plan:
//   1 emergency > 2 immediate danger > 3 route correction > 4 user answer
//   > 5 navigation > 6 description > 7 background
// Includes deduplication (don't repeat the same warning in a cooldown window)
// and a verbosity gate. Haptic equivalents can be attached per level.

export type SpeechPriority = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface SpeechRequest {
  text: string;
  priority: SpeechPriority;
  dedupeKey?: string;
  cooldownMs?: number;
  onInterrupt?: () => void;
}

const PRIORITY_LABEL: Record<SpeechPriority, string> = {
  1: 'emergency',
  2: 'danger',
  3: 'route-correction',
  4: 'user-answer',
  5: 'navigation',
  6: 'description',
  7: 'background',
};

export function priorityLabel(p: SpeechPriority): string {
  return PRIORITY_LABEL[p];
}

// Safety net: if `onEnded()` is never called (a stalled audio element, a
// browser autoplay-policy rejection that the play() call site failed to
// catch cleanly, or any other edge case), the manager would otherwise stay
// locked at `currentPriority` forever — every future speak() call of equal
// or lower priority silently queues and never plays, which for a blind-user
// assistive app means total, permanent silence with zero visible error.
// This watchdog guarantees the lock always releases within a bounded time,
// regardless of what specifically stalled.
const WATCHDOG_MS = 12_000;

export class SpeechPriorityManager {
  private currentPriority: SpeechPriority | null = null;
  private queue: SpeechRequest[] = [];
  private lastSpoken: Map<string, number> = new Map();
  private verbosity: number; // 0 = minimal, 1 = normal, 2 = detailed
  private playFn: (text: string, priority: SpeechPriority) => void;
  private stopFn: () => void;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    play: (text: string, priority: SpeechPriority) => void;
    stop: () => void;
    verbosity?: number;
  }) {
    this.playFn = opts.play;
    this.stopFn = opts.stop;
    this.verbosity = opts.verbosity ?? 1;
  }

  setVerbosity(v: number) {
    this.verbosity = Math.max(0, Math.min(2, v));
    // Lower-priority queued speech is dropped when verbosity drops.
    if (v < 2) this.queue = this.queue.filter((r) => r.priority <= 3);
  }

  /** Returns true if a speech request would currently be blocked by dedupe. */
  private deduped(req: SpeechRequest): boolean {
    if (!req.dedupeKey) return false;
    const cooldown = req.cooldownMs ?? 10_000;
    const last = this.lastSpoken.get(req.dedupeKey);
    if (last != null && Date.now() - last < cooldown) return true;
    this.lastSpoken.set(req.dedupeKey, Date.now());
    return false;
  }

  private armWatchdog(): void {
    this.disarmWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      // The site that started this utterance never confirmed it ended. Force
      // the lock open so the app is never permanently silent because of one
      // stuck request; the caller's own audio element is left to clean up
      // itself, this only unblocks the queue.
      this.onEnded();
    }, WATCHDOG_MS);
  }

  private disarmWatchdog(): void {
    if (this.watchdogTimer != null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Speak with priority. Higher priority interrupts lower; equal-or-lower is
   * queued (up to a small buffer) and plays when the current utterance ends.
   */
  speak(req: SpeechRequest): void {
    // Quiet mode (verbosity 0) only allows emergency + danger.
    if (this.verbosity === 0 && req.priority > 2) return;
    if (this.deduped(req)) return;

    if (this.currentPriority == null || req.priority < this.currentPriority) {
      // Interrupt the current utterance.
      if (this.currentPriority != null) this.stopFn();
      this.currentPriority = req.priority;
      this.armWatchdog();
      this.playFn(req.text, req.priority);
      return;
    }

    // Equal or lower priority: queue it (cap to avoid unbounded growth).
    if (this.queue.length < 5) this.queue.push(req);
  }

  /** Call when the active utterance ends to play the next queued item. */
  onEnded(): void {
    this.disarmWatchdog();
    this.currentPriority = null;
    const next = this.queue.shift();
    if (next) {
      this.currentPriority = next.priority;
      this.armWatchdog();
      this.playFn(next.text, next.priority);
    }
  }

  /** Call when a higher-priority message should cancel the queue. */
  clearQueue(): void {
    this.queue = [];
  }

  /** Debug/observability: current state. */
  state(): { current: SpeechPriority | null; queued: number; verbosity: number } {
    return { current: this.currentPriority, queued: this.queue.length, verbosity: this.verbosity };
  }
}
