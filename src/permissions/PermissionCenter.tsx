// PermissionCenter: the full, always-accessible permission status + control
// surface. Reached from onboarding, the dashboard status card, Settings, and
// the voice command "Check my permissions".

import { useEffect, useRef, useState } from 'react';
import { describePermissionState, type PermissionService } from './permissionService';
import type { PermissionKey, PermissionSnapshot } from './permissionTypes';
import { PERMISSION_KEYS } from './permissionService';
import { useLiveAnnouncer } from '../accessibility/LiveAnnouncer';
import { useFocusTrap } from '../accessibility/FocusManager';

const CAN_REQUEST: PermissionKey[] = ['camera', 'microphone', 'location', 'notifications', 'motion', 'battery'];

export function PermissionCenter({ service, onClose }: { service: PermissionService; onClose: () => void }) {
  const [snap, setSnap] = useState<PermissionSnapshot>(service.snapshot());
  const [busy, setBusy] = useState<PermissionKey | null>(null);
  const { announce } = useLiveAnnouncer();

  // It is rendered inside a full-viewport opaque .modal-scrim, so it IS modal.
  // With aria-modal="false" a screen reader did not hide the dimmed, blurred
  // dashboard underneath, so swipe navigation walked the user through an app
  // they cannot see or use. Trapping focus makes the modal semantics honest.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, true);

  // Keyboard equivalent of clicking the scrim: without this, "Close" is
  // mouse-only and the dialog is a WCAG 2.1.2 keyboard trap for a screen-reader
  // user who dismissed it without a pointer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => service.subscribe(setSnap), [service]);

  async function request(key: PermissionKey) {
    setBusy(key);
    const state = await service.request(key);
    setBusy(null);
    const label = service.get(key).label;
    announce(`${label} is now ${describePermissionState(state)}.`, state === 'allowed' ? 'polite' : 'assertive');
  }

  return (
    <div
      className="permission-center"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Permission Centre"
      tabIndex={-1}
    >
      <div className="section-head">
        <div>
          <p className="topbar-kicker">permission centre</p>
          <h2 id="permission-center-title">Permissions</h2>
        </div>
        <button className="ghost-btn" onClick={onClose} aria-label="Close permission centre">
          ✕ Close
        </button>
      </div>

      <p className="muted-note">
        Browsers require you to approve each permission. Nothing is requested silently.
      </p>

      <ul className="permission-list">
        {PERMISSION_KEYS.map((key) => {
          const info = snap.byKey[key]!;
          const canReq = CAN_REQUEST.includes(key);
          return (
            <li key={key} className="permission-item">
              <div className="permission-item-head">
                <strong>{info.label}</strong>
                <span className={`pill ${info.state === 'allowed' ? 'pill-success' : info.state === 'denied' ? 'pill-danger' : 'pill-neutral'}`}>
                  {describePermissionState(info.state)}
                </span>
              </div>
              <p className="permission-explanation" id={`perm-${key}`}>
                {info.explanation}
              </p>
              {info.detail && <p className="permission-detail">{info.detail}</p>}
              {canReq && (info.state === 'not-requested' || info.state === 'denied' || info.state === 'temporarily-unavailable') && (
                <button
                  className="secondary-btn"
                  disabled={busy === key}
                  onClick={() => request(key)}
                  // Explain the consequence at the point of activation, where a
                  // screen-reader user actually hears it. The reference used to
                  // dangle on the <p> below, pointing at no element at all.
                  aria-describedby={`perm-${key}`}
                >
                  {busy === key ? 'Requesting…' : `Enable ${info.label}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="permission-fallback" role="note">
        <h3>If a permission is not allowed</h3>
        <ul>
          <li>Camera denied → use GPS, saved places, and caregiver support.</li>
          <li>Microphone denied → use the large controls on every screen.</li>
          <li>Location denied → enter a manual address or nearby landmark.</li>
          <li>Notifications denied → SOS and journeys still work; escalation uses email/SMS when configured.</li>
          <li>Motion denied → manual SOS remains available.</li>
          <li>Battery denied → journey and emergency estimates will not include remaining power.</li>
        </ul>
      </div>
    </div>
  );
}
