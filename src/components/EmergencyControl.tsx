// EmergencyControl: always-visible emergency button with hold-to-activate or
// confirmation, a spoken + haptic cancellation countdown, and a status screen.
// At least 64px tall. When an emergency is active it overrides normal UI.

import { useEffect, useRef, useState } from 'react';
import { useLiveAnnouncer } from '../accessibility/LiveAnnouncer';

export type EmergencyStatus = {
  sessionId?: string;
  state: 'idle' | 'confirming' | 'activating' | 'active' | 'resolving';
  locationSent?: boolean;
  contactsNotified?: boolean;
  acknowledged?: number;
  liveSharing?: boolean;
};

export function EmergencyControl({
  status,
  onTrigger,
  onCancel,
  onResolve,
  speak,
}: {
  status: EmergencyStatus;
  onTrigger: (payload: { lat?: number; lng?: number; battery?: number }) => void;
  onCancel: () => void;
  onResolve: () => void;
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
}) {
  const [holdMs, setHoldMs] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against double-activation: a real touch/mouse press-and-hold
  // already triggers via the 1s interval in startHold(), then the browser
  // fires a native synthetic "click" after pointerup — without this flag
  // that click would call handleClick and re-run beginActivation().
  const activatedByHoldRef = useRef(false);
  const { announce } = useLiveAnnouncer();

  // Hold-to-activate: 1 second hold opens the 5s spoken cancellation window.
  function startHold() {
    if (status.state === 'active') return;
    setHoldMs(0);
    holdTimer.current = setInterval(() => {
      setHoldMs((v) => {
        const next = v + 100;
        if (next >= 1000) {
          if (holdTimer.current) clearInterval(holdTimer.current);
          activatedByHoldRef.current = true;
          beginActivation();
          return 0;
        }
        return next;
      });
    }, 100);
  }

  // Click fallback for anyone whose input method never dispatches
  // pointerdown/pointerup — this is not a rare edge case: screen readers
  // (TalkBack double-tap, VoiceOver double-tap) synthesize a plain "click"
  // event only, never real pointer events, on the exact devices/interaction
  // pattern a blind user relies on. Without this, SOS was unreachable by
  // touch for the population it exists to protect. Also covers switch
  // access and other assistive input that only fires click.
  function handleClick() {
    if (activatedByHoldRef.current) {
      activatedByHoldRef.current = false;
      return;
    }
    if (status.state === 'active' || confirming) return;
    beginActivation();
  }

  function endHold() {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
    setHoldMs(0);
  }

  const activatingRef = useRef(false);
  const countdownVibrateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function beginActivation() {
    // Idempotency guard against the same physical action firing twice
    // (e.g. Enter key producing both a keydown handler call and a browser
    // synthetic click, or a hold-release producing both the interval
    // callback and a synthetic click) — state alone isn't enough since
    // React updates aren't synchronous within one event-loop tick.
    if (activatingRef.current) return;
    activatingRef.current = true;
    setConfirming(true);
    announce('Emergency activated. Sharing your location.', 'assertive');
    speak('Emergency activated. Sharing your location. Say cancel within five seconds, or press cancel.', 1, 'emergency-activate');
    // Blind-user-perspective audit (2026-08-07): this component's own header
    // comment promised a "haptic cancellation countdown" but no vibration
    // code existed anywhere in the file — only speech. In a loud environment
    // (traffic, crowds — exactly where SOS is most likely needed) or for a
    // deafblind user, that left the 5-second cancel window with zero
    // feedback. Vibrate once per second during the countdown, independent of
    // the hazard-detection haptic settings toggle: an emergency should
    // always have a physical cue if the device supports it.
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(200);
      let ticks = 0;
      countdownVibrateRef.current = setInterval(() => {
        ticks += 1;
        if (ticks >= 4) {
          if (countdownVibrateRef.current) clearInterval(countdownVibrateRef.current);
          countdownVibrateRef.current = null;
          return;
        }
        navigator.vibrate(200);
      }, 1000);
    }
    // Auto-proceed after 5s unless cancelled.
    setTimeout(() => {
      setConfirming(false);
      activatingRef.current = false;
      onTrigger({});
    }, 5000);
  }

  function stopCountdownVibration() {
    if (countdownVibrateRef.current) {
      clearInterval(countdownVibrateRef.current);
      countdownVibrateRef.current = null;
    }
  }


  useEffect(() => {
    return () => {
      if (holdTimer.current) clearInterval(holdTimer.current);
      stopCountdownVibration();
    };
  }, []);

  // When active: override with a status screen.
  if (status.state === 'active') {
    return (
      <div className="emergency-active" role="alert" aria-live="assertive">
        <h2><span aria-hidden="true">🚨</span> Emergency active</h2>
        <ul className="emergency-status-list">
          <li className={status.locationSent ? 'done' : ''}><span aria-hidden="true">📍</span> {status.locationSent ? 'Location sent' : 'Sending location…'}</li>
          <li className={status.contactsNotified ? 'done' : ''}><span aria-hidden="true">👥</span> {status.contactsNotified ? 'Contacts notified' : 'Notifying contacts…'}</li>
          <li><span aria-hidden="true">✅</span> {status.acknowledged ?? 0} acknowledgement{status.acknowledged === 1 ? '' : 's'}</li>
          <li>🔄 {status.liveSharing ? 'Live sharing active' : 'Live sharing off'}</li>
        </ul>
        <div className="control-inline">
          <button className="primary-btn" style={{ minHeight: 64, background: 'var(--danger)', color: '#fff' }} onClick={onResolve}>
            <span aria-hidden="true">✅</span> I am safe — resolve
          </button>
          <button className="ghost-btn" style={{ minHeight: 64 }} onClick={onCancel}>
            Cancel emergency
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="emergency-control-wrap">
      {confirming && (
        <div className="emergency-confirm" role="alert" aria-live="assertive">
          <p>
            Emergency will activate in 5 seconds. <strong>Say “cancel” or press Cancel</strong> to stop.
          </p>
          <div className="control-inline">
            <button className="primary-btn" style={{ minHeight: 64, background: 'var(--danger)', color: '#fff' }} onClick={() => { setConfirming(false); activatingRef.current = false; stopCountdownVibration(); onCancel(); }}>
              <span aria-hidden="true">✋</span> Cancel
            </button>
            <button className="secondary-btn" style={{ minHeight: 64 }} onClick={() => { setConfirming(false); stopCountdownVibration(); onTrigger({}); }}>
              Activate now
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="emergency-button"
        style={{ minHeight: 64 }}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            beginActivation();
          }
        }}
        onClick={handleClick}
        aria-label="Activate emergency SOS. Shares your location with trusted contacts. Sighted touch users can also hold for one second; everyone else can just tap or press Enter."
      >
        <span className="emergency-button-icon" aria-hidden="true">
          🚨
        </span>
        <span className="emergency-button-label">
          {holdMs > 0 ? `Hold ${(1 - holdMs / 1000).toFixed(1)}s…` : 'Hold for SOS'}
        </span>
      </button>
      <p className="voice-hint"><span aria-hidden="true">🎙️</span> Say: “Emergency”</p>
    </div>
  );
}
