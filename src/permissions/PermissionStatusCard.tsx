// PermissionStatusCard: shows the current permission readiness on the
// dashboard. Clicking opens the Permission Centre. Screen-reader friendly.

import { describePermissionState, type PermissionService } from './permissionService';
import type { PermissionSnapshot } from './permissionTypes';
import { useEffect, useState } from 'react';

export function PermissionStatusCard({ service, onOpen }: { service: PermissionService; onOpen: () => void }) {
  const [snap, setSnap] = useState<PermissionSnapshot>(service.snapshot());

  useEffect(() => service.subscribe(setSnap), [service]);

  const allowed = snap.critical.filter((k) => snap.byKey[k].state === 'allowed').length;
  const total = snap.critical.length;
  const ready = snap.ready;

  const statusLine = ready
    ? `All critical permissions are active.`
    : `${allowed} of ${total} critical permissions are active.`;

  return (
    <div className="status-card" role="region" aria-label="Permission status">
      <div className="status-card-head">
        <span className="status-icon" aria-hidden="true">
          {ready ? '✅' : '⚠️'}
        </span>
        <div>
          <h3>Permissions</h3>
          <p className="status-line" aria-live="polite">
            {statusLine}
          </p>
        </div>
      </div>
      <ul className="permission-mini-list">
        {snap.critical.map((k) => {
          const info = snap.byKey[k]!;
          return (
            <li key={k} className="permission-mini">
              <span>{info.label}</span>
              <strong>{describePermissionState(info.state)}</strong>
            </li>
          );
        })}
      </ul>
      <button className="secondary-btn" onClick={onOpen}>
        Open Permission Centre
      </button>
    </div>
  );
}
