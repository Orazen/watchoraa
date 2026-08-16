// PrimaryActionCard: a large, voice-first action card for the dashboard.
// Clear heading, one-sentence explanation, large activation button, voice
// command hint, and current state.

import type { ReactNode } from 'react';

export function PrimaryActionCard({
  icon,
  title,
  explanation,
  buttonLabel,
  onActivate,
  voiceHint,
  state,
  stateTone = 'neutral',
}: {
  icon: string;
  title: string;
  explanation: string;
  buttonLabel: string;
  onActivate: () => void;
  voiceHint?: string;
  state?: string;
  stateTone?: 'ok' | 'warn' | 'danger' | 'neutral';
}) {
  return (
    <article className="primary-card" aria-label={title}>
      <div className="primary-card-head">
        <span className="primary-card-icon" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h3>{title}</h3>
          <p className="primary-card-explanation">{explanation}</p>
        </div>
      </div>
      {state && (
        <p className={`primary-card-state state-${stateTone}`} aria-live="polite">
          {state}
        </p>
      )}
      <button className="primary-btn primary-card-button" style={{ minHeight: 56 }} onClick={onActivate}>
        {buttonLabel}
      </button>
      {voiceHint && <p className="voice-hint"><span aria-hidden="true">🎙️</span> Say: “{voiceHint}”</p>}
    </article>
  );
}

export function StatusBanner({ children, tone = 'info', ariaLive = 'polite' }: { children: ReactNode; tone?: 'info' | 'warn' | 'danger' | 'ok'; ariaLive?: 'polite' | 'assertive' }) {
  return (
    <div className={`status-banner banner-${tone}`} role={ariaLive === 'assertive' ? 'alert' : 'status'} aria-live={ariaLive}>
      {children}
    </div>
  );
}
