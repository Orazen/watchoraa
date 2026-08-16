// Permission centre types (v0.4 voice-first PWA).
// Tracks every capability Watchora depends on and its browser state.

export type PermissionState =
  | 'not-requested'
  | 'requesting'
  | 'allowed'
  | 'denied'
  | 'unavailable'
  | 'temporarily-unavailable'
  | 'browser-unsupported';

export type PermissionKey =
  | 'camera'
  | 'microphone'
  | 'location'
  | 'notifications'
  | 'motion'
  | 'wakeLock'
  | 'vibration'
  | 'network'
  | 'serviceWorker'
  | 'offlineModels'
  | 'battery';

export interface PermissionInfo {
  key: PermissionKey;
  state: PermissionState;
  /** Human-readable, screen-reader friendly label. */
  label: string;
  /** One-sentence explanation of why Watchora wants this. */
  explanation: string;
  /** When the state last changed (for "re-check on next session" semantics). */
  updatedAt: number;
  /** Extra context: accuracy in metres for location, etc. */
  detail?: string;
  /** Browser-native permission name when one exists (camera/mic/notifications/geolocation). */
  nativeName?: PermissionName | 'geolocation';
  /** Whether the user has been educated about this permission (education is separate from the grant). */
  educated?: boolean;
}

export interface PermissionSnapshot {
  byKey: Record<PermissionKey, PermissionInfo>;
  /** Overall readiness: how many critical permissions are allowed. */
  ready: boolean;
  /** Critical permissions that gate the primary features. */
  critical: PermissionKey[];
  updatedAt: number;
}

export const CRITICAL_PERMISSIONS: PermissionKey[] = ['camera', 'microphone', 'location', 'battery'];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  camera: 'Camera',
  microphone: 'Microphone',
  location: 'Precise location',
  notifications: 'Notifications',
  motion: 'Motion sensors',
  wakeLock: 'Screen wake lock',
  vibration: 'Vibration',
  network: 'Network',
  serviceWorker: 'Service worker',
  battery: 'Battery level',
  offlineModels: 'Offline models',
};

export const PERMISSION_EXPLANATIONS: Record<PermissionKey, string> = {
  camera:
    'Camera access lets Watchora describe scenes, read text, and detect nearby obstacles. Camera frames stay on your device unless you request AI analysis.',
  microphone:
    'Microphone access lets you control Watchora with your voice. Your microphone is used only while voice control is active.',
  location:
    'Location access is needed for saved places, outdoor navigation, Safe Journey, and emergency location sharing.',
  notifications:
    'Notifications let Watchora provide journey reminders and emergency updates when the application is not visible.',
  motion:
    'Motion access can help detect unusual phone movement and improve journey awareness. It does not prove that a theft or emergency occurred.',
  wakeLock:
    'Keeping the screen awake helps during journeys and long reading sessions.',
  vibration: 'Vibration provides haptic feedback for warnings and confirmations.',
  network: 'A network connection is required for cloud scene descriptions and remote emergency delivery.',
  serviceWorker: 'The service worker enables offline support and faster loading.',
  battery:
    'Battery level helps Watchora estimate how long your device will last during a journey or emergency. It is shared only with trusted contacts during active journeys and emergencies.',
  offlineModels: 'Local models for object detection and OCR are cached for offline use.',
};
