// Regression tests for the speech layer.
//
// Both suites here exist because of defects that were found empirically on the
// running app, not by reading code. Each test names the user-visible failure it
// prevents from coming back.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpeechPriorityManager, type SpeechPriority } from '../speechPriority';

function makeManager(verbosity = 1) {
  const play = vi.fn();
  const stop = vi.fn();
  const mgr = new SpeechPriorityManager({ play, stop, verbosity });
  return { mgr, play, stop };
}

describe('SpeechPriorityManager — cooldown vs. command answers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // THE DEFECT: every one of the ~55 command handlers in App.tsx passed a
  // dedupeKey, and the manager applied the default 10s cooldown to ANY keyed
  // request. So asking "what time is it" twice inside ten seconds answered the
  // second time with total silence. For a blind user silence is
  // indistinguishable from the app having failed to hear them, which is the
  // worst possible failure mode for a voice interface.
  it('never dedupes when cooldownMs is 0 — a repeated command always speaks', () => {
    const { mgr, play } = makeManager();
    mgr.speak({ text: 'It is 3:40 PM.', priority: 5, dedupeKey: 'what-time', cooldownMs: 0 });
    mgr.onEnded();
    mgr.speak({ text: 'It is 3:40 PM.', priority: 5, dedupeKey: 'what-time', cooldownMs: 0 });
    mgr.onEnded();

    expect(play).toHaveBeenCalledTimes(2);
  });

  it('repeats without limit when cooldownMs is 0', () => {
    const { mgr, play } = makeManager();
    for (let i = 0; i < 6; i += 1) {
      mgr.speak({ text: 'Still here.', priority: 5, dedupeKey: 'ping', cooldownMs: 0 });
      mgr.onEnded();
    }
    expect(play).toHaveBeenCalledTimes(6);
  });

  // The dedupe cooldown is NOT dead code — it exists for ambient warnings,
  // which is exactly what the file header says it is for. Suppressing those is
  // the feature; suppressing answers was the bug.
  it('still suppresses a repeated AMBIENT warning within the default cooldown', () => {
    const { mgr, play } = makeManager();
    mgr.speak({ text: 'Step detected ahead.', priority: 2, dedupeKey: 'hazard-front' });
    mgr.onEnded();
    mgr.speak({ text: 'Step detected ahead.', priority: 2, dedupeKey: 'hazard-front' });
    mgr.onEnded();

    expect(play).toHaveBeenCalledTimes(1);
  });

  it('allows the ambient warning again once the cooldown has elapsed', () => {
    const { mgr, play } = makeManager();
    mgr.speak({ text: 'Step detected ahead.', priority: 2, dedupeKey: 'hazard-front' });
    mgr.onEnded();
    vi.advanceTimersByTime(10_001);
    mgr.speak({ text: 'Step detected ahead.', priority: 2, dedupeKey: 'hazard-front' });
    mgr.onEnded();

    expect(play).toHaveBeenCalledTimes(2);
  });

  it('honours an explicit non-zero cooldown', () => {
    const { mgr, play } = makeManager();
    mgr.speak({ text: 'Battery low.', priority: 3, dedupeKey: 'battery', cooldownMs: 30_000 });
    mgr.onEnded();
    mgr.speak({ text: 'Battery low.', priority: 3, dedupeKey: 'battery', cooldownMs: 30_000 });
    mgr.onEnded();
    expect(play).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_001);
    mgr.speak({ text: 'Battery low.', priority: 3, dedupeKey: 'battery', cooldownMs: 30_000 });
    mgr.onEnded();
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('keys dedupe independently per dedupeKey', () => {
    const { mgr, play } = makeManager();
    mgr.speak({ text: 'Left hazard.', priority: 2, dedupeKey: 'hazard-left' });
    mgr.onEnded();
    mgr.speak({ text: 'Right hazard.', priority: 2, dedupeKey: 'hazard-right' });
    mgr.onEnded();
    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe('SpeechPriorityManager — verbosity gate', () => {
  // THE DEFECT: the verbosity-0 ("essential detail only") gate dropped every
  // request above priority 2, and all the safe-journey outcome messages were
  // spoken at the default priority 5. A user who selected the cognitive
  // accessibility accommodation and then tapped "I'm safe" or "I'm lost" got
  // NOTHING — not on success, not on failure — and could not tell a completed
  // check-in from a dropped request.
  it('drops priority 5 chatter in essential mode', () => {
    const { mgr, play } = makeManager(0);
    mgr.speak({ text: 'Some background detail.', priority: 5 });
    expect(play).not.toHaveBeenCalled();
  });

  it('still speaks safety outcomes at priority 2 in essential mode', () => {
    const { mgr, play } = makeManager(0);
    mgr.speak({ text: 'Help requested. Your trusted contact has been notified.', priority: 2 });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('never dedupes a priority-2 safety outcome when cooldownMs is 0', () => {
    const { mgr, play } = makeManager(0);
    mgr.speak({ text: 'Checked in.', priority: 2, dedupeKey: 'journey-checkin', cooldownMs: 0 });
    mgr.onEnded();
    mgr.speak({ text: 'Checked in.', priority: 2, dedupeKey: 'journey-checkin', cooldownMs: 0 });
    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe('SpeechPriorityManager — interruption and queueing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets a higher priority interrupt a lower one', () => {
    const { mgr, play, stop } = makeManager();
    mgr.speak({ text: 'A long description.', priority: 5 });
    mgr.speak({ text: 'Stop. Step ahead.', priority: 2 });
    expect(stop).toHaveBeenCalled();
    expect(play).toHaveBeenLastCalledWith('Stop. Step ahead.', 2, undefined);
  });

  it('plays the next queued item when the current one ends', () => {
    const { mgr, play } = makeManager();
    mgr.speak({ text: 'First.', priority: 4 });
    mgr.speak({ text: 'Second.', priority: 4 });
    expect(play).toHaveBeenCalledTimes(1);
    mgr.onEnded();
    expect(play).toHaveBeenLastCalledWith('Second.', 4, undefined);
  });

  it('releases the lock via the watchdog so the app can never go permanently silent', () => {
    const { mgr, play } = makeManager();
    mgr.speak({ text: 'Something long.', priority: 5 });
    // No onEnded() is ever called — the stall the watchdog exists for.
    vi.advanceTimersByTime(12_000);
    mgr.speak({ text: 'Are you still there?', priority: 5 });
    expect(play).toHaveBeenCalledTimes(2);
  });
});
