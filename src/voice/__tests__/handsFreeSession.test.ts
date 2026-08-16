import { describe, expect, it } from 'vitest';
import { decideHandsFreeAction } from '../handsFreeSession';

describe('hands-free decision state machine', () => {
  it('routes a one-shot command after the wake phrase', () => {
    const d = decideHandsFreeAction({ transcript: 'Hey Watchora, describe what is ahead', wakePhraseEnabled: true, wakeArmed: false });
    expect(d.command).toBe('describe what is ahead');
    expect(d.promptForCommand).toBe(false);
    expect(d.wakeArmed).toBe(false);
  });

  it('prompts and arms after a bare wake phrase', () => {
    const d = decideHandsFreeAction({ transcript: 'Hey Watchora', wakePhraseEnabled: true, wakeArmed: false });
    expect(d.command).toBeNull();
    expect(d.promptForCommand).toBe(true);
    expect(d.wakeArmed).toBe(true);
  });

  it('routes the next utterance as the command while armed', () => {
    const d = decideHandsFreeAction({ transcript: 'read this', wakePhraseEnabled: true, wakeArmed: true });
    expect(d.command).toBe('read this');
    expect(d.wakeArmed).toBe(false);
  });

  it('ignores conversation without the wake phrase (privacy)', () => {
    const d = decideHandsFreeAction({ transcript: 'describe what is ahead', wakePhraseEnabled: true, wakeArmed: false });
    expect(d.command).toBeNull();
    expect(d.promptForCommand).toBe(false);
    expect(d.wakeArmed).toBe(false);
  });

  it('routes everything directly when wake phrase is off', () => {
    const d = decideHandsFreeAction({ transcript: 'open settings', wakePhraseEnabled: false, wakeArmed: false });
    expect(d.command).toBe('open settings');
    expect(d.wakeArmed).toBe(false);
  });

  it('does not stay armed forever on silence', () => {
    const d = decideHandsFreeAction({ transcript: '   ', wakePhraseEnabled: true, wakeArmed: true });
    expect(d.command).toBeNull();
    expect(d.wakeArmed).toBe(true);
  });

  it('never routes an empty command', () => {
    const d = decideHandsFreeAction({ transcript: '', wakePhraseEnabled: false, wakeArmed: false });
    expect(d.command).toBeNull();
  });
});
