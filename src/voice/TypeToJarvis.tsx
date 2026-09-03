// Type-to-Jarvis: a text command bar for when the browser can't listen
// (unsupported SpeechRecognition, denied mic, or the user simply prefers
// typing). It routes through the SAME brain as voice — deterministic
// commands, companion feeling-phrases, confirmations, spoken responses —
// so typing "where am i" behaves identically to saying it.
// Visible only when voice is unavailable or blocked, or expanded on demand
// (the "Ask by text" toggle) for everyone else.

import { useEffect, useRef, useState } from 'react';
import { useVoiceAssistant } from './VoiceAssistantProvider';

export function TypeToJarvis({ autoFocus = false }: { autoFocus?: boolean }) {
  const { handleTranscript, state, supported, micPermission } = useVoiceAssistant();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus when voice is unsupported/blocked — typing is the primary path then.
  useEffect(() => {
    if (autoFocus && (!supported || !micPermission)) inputRef.current?.focus();
  }, [autoFocus, supported, micPermission]);

  const voiceBlocked = !supported || (!micPermission && state === 'permission-needed');

  async function submit() {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await handleTranscript(text);
      setValue('');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="type-jarvis" role="search">
      <label className="type-jarvis-label" htmlFor="type-jarvis-input">
        {voiceBlocked
          ? 'Voice is not available here — type your command and Watchora will speak the answer.'
          : 'Or type a command (same as speaking):'}
      </label>
      <div className="type-jarvis-row">
        <input
          id="type-jarvis-input"
          ref={inputRef}
          type="text"
          value={value}
          placeholder={voiceBlocked ? 'e.g. where am i — or: emergency' : 'Type a command, e.g. where am i'}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          aria-describedby="type-jarvis-hint"
        />
        <button type="button" className="primary-btn" onClick={() => void submit()} disabled={busy || !value.trim()}>
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </div>
      <p id="type-jarvis-hint" className="soft-note" style={{ margin: 0 }}>
        Try: where am i · list my places · what's reported near me · scan the barcode · find my wallet · tell me more · emergency
      </p>
    </div>
  );
}
