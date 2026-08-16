// PermissionSettings: the Settings → Permissions group. Shows current status,
// re-request buttons, and test controls for camera/mic/location/notifications.

import { PermissionCenter } from '../permissions/PermissionCenter';
import type { PermissionService } from '../permissions/permissionService';

export function PermissionSettings({
  service,
  onBack,
}: {
  service: PermissionService;
  onBack: () => void;
}) {
  return (
    <div className="permission-settings">
      <div className="section-head">
        <div>
          <p className="topbar-kicker">settings · permissions</p>
          <h2>Permission Centre</h2>
        </div>
        <button className="ghost-btn" onClick={onBack} aria-label="Back to settings">
          ← Back
        </button>
      </div>
      <PermissionCenter service={service} onClose={onBack} />
    </div>
  );
}
