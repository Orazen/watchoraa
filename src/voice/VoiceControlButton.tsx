// Persistent "Talk to Watchora" button. Large touch target, keyboard
// accessible, shows state with text + icon (never colour alone), haptic
// feedback, and never obstructs emergency controls.
//
// In hands-free mode (the default) this button is a pause/resume control for
// always-on listening, not a push-to-talk trigger: blind users should be able
// to control Watchora entirely by voice ("Hey Watchora, ...") without ever
// finding this button.

import { useEffect, useRef } from 'react';
import { useVoiceAssistant } from './VoiceAssistantProvider';

const STATE_LABEL: Record<string, string> = {
  idle: 'Ready. Press to talk to Watchora.',
  listening: 'Listening. Say Hey Watchora, then your command.',
  processing: 'Understanding.',
  speaking: 'Speaking.',
  paused: 'Voice control paused. Press to resume hands-free listening.',
  'permission-needed': 'Microphone permission needed. Open Permission Centre.',
  offline: 'Voice control is offline.',
  error: 'Voice control had an error. Try again.',
  unsupported: 'Voice control is not supported by this browser.',
};

const STATE_ICON: Record<string, string> = {
  idle: '🎤',
  listening: '🔴',
  processing: '⏳',
  speaking: '🔊',
  paused: '⏸️',
  'permission-needed': '🚫',
  offline: '📴',
  error: '⚠️',
  unsupported: '—',
};

export function VoiceControlButton({ className = '' }: { className?: string }) {
  const { state, toggleListening, startListening, handsFree } = useVoiceAssistant();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const listeningRef = useRef(state === 'listening');
  listeningRef.current = state === 'listening';

  // Haptic on state change.
  useEffect(() => {
    if (state === 'listening' && 'vibrate' in navigator) navigator.vibrate(30);
    if (state === 'processing' && 'vibrate' in navigator) navigator.vibrate([0, 20, 40]);
  }, [state]);

  // Space/Enter to toggle (native button behaviour covers this, but we add
  // explicit support for a keyboard shortcut on the page too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack typing in inputs.
      const el = document.activeElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        if (listeningRef.current) {
          // stop
          document.dispatchEvent(new CustomEvent('watchora:voice-stop'));
        } else {
          startListening();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startListening]);

  const isOn = handsFree ? state !== 'paused' && state !== 'permission-needed' && state !== 'offline' && state !== 'error' && state !== 'unsupported' : state === 'listening';
  const mainLabel = handsFree
    ? state === 'paused'
      ? 'Voice paused'
      : state === 'permission-needed'
        ? 'Microphone needed'
        : state === 'speaking'
          ? 'Speaking'
          : state === 'processing'
            ? 'Understanding'
            : 'Hands-free voice on'
    : state === 'listening'
      ? 'Listening…'
      : state === 'processing'
        ? 'Understanding…'
        : state === 'speaking'
          ? 'Speaking…'
          : 'Talk to Watchora';

  return (
    <button
      ref={btnRef}
      type="button"
      className={`voice-control-button ${state === 'listening' || (handsFree && isOn) ? 'voice-active' : ''} ${handsFree ? 'voice-handsfree' : ''} ${className}`}
      onClick={() => {
        if (listeningRef.current) document.dispatchEvent(new CustomEvent('watchora:voice-stop'));
        toggleListening();
      }}
      aria-label={STATE_LABEL[state] ?? 'Talk to Watchora'}
      aria-pressed={isOn}
      aria-live="polite"
      style={{ minHeight: 56, minWidth: 56 }}
    >
      <span className="voice-control-icon" aria-hidden="true">
        {STATE_ICON[state] ?? (handsFree ? '🎙️' : '🎤')}
      </span>
      <span className="voice-control-label">{mainLabel}</span>
    </button>
  );
}
