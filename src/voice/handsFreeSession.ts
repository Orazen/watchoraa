// Pure decision logic for hands-free voice control (unit-testable without a
// browser). Given a recognized transcript and the current session state, it
// decides what to do: route a command, prompt for one after a bare wake
// phrase, or ignore the speech entirely (privacy-first: nothing is routed
// unless the wake phrase was heard, or wake-phrase mode is off).

import { parseWakePhrase } from './wakePhrase';

export interface HandsFreeInput {
  transcript: string;
  wakePhraseEnabled: boolean;
  /** True when a bare wake phrase was already heard and a command is due. */
  wakeArmed: boolean;
}

export interface HandsFreeDecision {
  /** Command text to route, or null when the utterance must be ignored. */
  command: string | null;
  /** True when a bare wake phrase was heard and the user should be prompted. */
  promptForCommand: boolean;
  /** The next armed state to store. */
  wakeArmed: boolean;
}

export function decideHandsFreeAction(input: HandsFreeInput): HandsFreeDecision {
  const transcript = input.transcript.trim();
  if (!transcript) {
    return { command: null, promptForCommand: false, wakeArmed: input.wakeArmed };
  }

  // Armed: the user already said "Hey Watchora" and we asked for a command.
  // Whatever they say next is the command.
  if (input.wakeArmed) {
    return { command: transcript, promptForCommand: false, wakeArmed: false };
  }

  // Wake phrase disabled: hands-free routes every utterance directly.
  if (!input.wakePhraseEnabled) {
    return { command: transcript, promptForCommand: false, wakeArmed: false };
  }

  const parsed = parseWakePhrase(transcript);
  if (!parsed.matched) {
    // No wake phrase: discard (privacy).
    return { command: null, promptForCommand: false, wakeArmed: false };
  }
  if (parsed.command) {
    // "Hey Watchora, describe what is ahead" — one-shot command.
    return { command: parsed.command, promptForCommand: false, wakeArmed: false };
  }
  // Bare wake phrase: prompt, then arm for the next utterance.
  return { command: null, promptForCommand: true, wakeArmed: true };
}
