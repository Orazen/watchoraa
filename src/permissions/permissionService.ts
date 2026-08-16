// Permission service: a framework-free tracker for all browser capabilities
// Watchora needs. Pure-ish so it can be unit-tested; DOM/browser interactions
// are isolated behind injectable functions. The React layer (PermissionCenter,
// PermissionOnboarding) consumes this.

import type { PermissionInfo, PermissionKey, PermissionSnapshot, PermissionState } from './permissionTypes';
import { CRITICAL_PERMISSIONS, PERMISSION_EXPLANATIONS, PERMISSION_LABELS } from './permissionTypes';

export interface BrowserLike {
  navigator: {
    mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> };
    permissions?: { query?: (d: { name: PermissionName }) => Promise<{ state: PermissionState }> };
    geolocation?: { getCurrentPosition?: (ok: (p: { coords: { accuracy: number } }) => void, err?: (e: unknown) => void, opts?: object) => void };
    serviceWorker?: unknown;
    vibrate?: (pattern: number | number[]) => boolean;
    wakeLock?: unknown;
    onLine: boolean;
    userAgent: string;
  };
  Notification?: { permission: NotificationPermission; requestPermission?: () => Promise<NotificationPermission> };
  DeviceOrientationEvent?: unknown;
  DeviceMotionEvent?: unknown;
  navigator_?: never;
}

export function detectBrowser(): BrowserLike {
  return (typeof window !== 'undefined' ? window : ({} as unknown as BrowserLike)) as BrowserLike;
}

export const PERMISSION_KEYS: PermissionKey[] = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'motion',
  'wakeLock',
  'vibration',
  'network',
  'serviceWorker',
  'offlineModels',
  'battery',
];

function now(): number {
  return Date.now();
}

/** Maps a raw browser permission state to our canonical state. */
export function normalizeState(raw: string | undefined, fallback: PermissionState): PermissionState {
  switch (raw) {
    case 'granted':
    case 'allowed':
      return 'allowed';
    case 'prompt':
      return 'not-requested';
    case 'denied':
      return 'denied';
    case 'unavailable':
      return 'unavailable';
    default:
      return fallback;
  }
}

export class PermissionService {
  private browser: BrowserLike;
  private byKey: Record<PermissionKey, PermissionInfo>;
  private listeners = new Set<(snap: PermissionSnapshot) => void>();
  private inFlight: Partial<Record<PermissionKey, Promise<PermissionState>>> = {};

  constructor(browser: BrowserLike = detectBrowser()) {
    this.browser = browser;
    this.byKey = {
      camera: this.make('camera'),
      microphone: this.make('microphone'),
      location: this.make('location'),
      notifications: this.make('notifications'),
      motion: this.make('motion'),
      wakeLock: this.make('wakeLock'),
      vibration: this.make('vibration'),
      network: this.make('network'),
      serviceWorker: this.make('serviceWorker'),
      offlineModels: this.make('offlineModels'),
      battery: this.make('battery'),
    };
    // Seed non-interactive states immediately.
    this.refreshStatic();
  }

  private make(key: PermissionKey): PermissionInfo {
    return {
      key,
      state: 'not-requested',
      label: PERMISSION_LABELS[key],
      explanation: PERMISSION_EXPLANATIONS[key],
      updatedAt: now(),
    };
  }

  subscribe(cb: (snap: PermissionSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.snapshot());
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.listeners) cb(snap);
  }

  snapshot(): PermissionSnapshot {
    const critical = CRITICAL_PERMISSIONS;
    const allowed = critical.filter((k) => this.byKey[k].state === 'allowed').length;
    return {
      byKey: { ...this.byKey },
      ready: allowed === critical.length,
      critical,
      updatedAt: now(),
    };
  }

  get(key: PermissionKey): PermissionInfo {
    return this.byKey[key];
  }

  set(key: PermissionKey, state: PermissionState, detail?: string): void {
    this.byKey[key] = { ...this.byKey[key], state, updatedAt: now(), detail: detail ?? this.byKey[key].detail };
    this.emit();
  }

  markEducated(key: PermissionKey): void {
    this.byKey[key] = { ...this.byKey[key], educated: true, updatedAt: now() };
    this.emit();
  }

  /** Re-checks static capabilities that don't require a prompt (vibration, network, SW, wake lock, motion support). */
  refreshStatic(): void {
    const b = this.browser;
    const nav = b.navigator;
    const ua = nav.userAgent || '';
    const isMobile = /iPhone|iPad|Android/i.test(ua);

    // Vibration
    this.byKey.vibration.state = typeof nav.vibrate === 'function' ? 'allowed' : 'browser-unsupported';

    // Network
    this.byKey.network.state = nav.onLine ? 'allowed' : 'temporarily-unavailable';

    // Service worker
    this.byKey.serviceWorker.state = nav.serviceWorker ? 'allowed' : 'browser-unsupported';

    // Wake lock
    this.byKey.wakeLock.state = nav.wakeLock ? 'allowed' : 'browser-unsupported';

    // Motion sensors: only meaningful on mobile; presence of the event interfaces is a hint.
    this.byKey.motion.state = isMobile && (typeof b.DeviceMotionEvent === 'function' || typeof b.DeviceOrientationEvent === 'function') ? 'not-requested' : 'browser-unsupported';

    // Offline models: default not-requested; set to allowed once cached (see useHazardDetection).
    this.emit();
  }

  /** Requests a browser permission. Returns the resulting state. */
  async request(key: PermissionKey): Promise<PermissionState> {
    if (this.inFlight[key]) return this.inFlight[key]!;
    this.set(key, 'requesting');
    const p = this.doRequest(key).then((state) => {
      this.set(key, state);
      return state;
    });
    this.inFlight[key] = p;
    try {
      return await p;
    } finally {
      delete this.inFlight[key];
    }
  }

  private async doRequest(key: PermissionKey): Promise<PermissionState> {
    const b = this.browser;
    const nav = b.navigator;
    switch (key) {
      case 'microphone':
        return this.requestMedia('audio');
      case 'camera':
        return this.requestMedia('video');
      case 'location':
        return this.requestLocation();
      case 'notifications':
        return this.requestNotifications();
      case 'motion':
        return this.requestMotion();
      case 'battery':
        return this.requestBattery();
      default:
        // Motion/wakeLock/vibration/network/SW are not promptable in the browser.
        return this.byKey[key].state;
    }
  }

  private async requestMedia(kind: 'audio' | 'video'): Promise<PermissionState> {
    const gUM = this.browser.navigator.mediaDevices?.getUserMedia;
    if (!gUM) return 'browser-unsupported';
    try {
      const stream = await gUM(kind === 'audio' ? { audio: true } : { video: { facingMode: 'environment' } });
      // Immediately stop the stream: we only needed it to confirm the permission.
      for (const track of stream.getTracks()) track.stop();
      return 'allowed';
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
      if (name === 'NotFoundError') return 'unavailable';
      return 'temporarily-unavailable';
    }
  }

  private requestLocation(): Promise<PermissionState> {
    return new Promise((resolve) => {
      const geo = this.browser.navigator.geolocation?.getCurrentPosition;
      if (!geo) {
        resolve('browser-unsupported');
        return;
      }
      geo(
        (pos) => {
          const accuracy = Math.round(pos.coords.accuracy);
          this.byKey.location.detail = `Accuracy approximately ${accuracy} metres.`;
          resolve(accuracy > 100 ? 'temporarily-unavailable' : 'allowed');
        },
        (err) => {
          const code = (err as { code?: number })?.code;
          if (code === 1) resolve('denied');
          else if (code === 2) resolve('temporarily-unavailable');
          else resolve('unavailable');
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    });
  }

  private async requestNotifications(): Promise<PermissionState> {
    const N = this.browser.Notification;
    if (!N) return 'browser-unsupported';
    if (N.permission === 'granted') return 'allowed';
    if (N.permission === 'denied') return 'denied';
    if (!N.requestPermission) return 'browser-unsupported';
    const result = await N.requestPermission();
    return result === 'granted' ? 'allowed' : result === 'denied' ? 'denied' : 'not-requested';
  }

  /**
   * Request motion sensor permission.
   * iOS 13+ Safari requires explicit permission via DeviceOrientationEvent.requestPermission().
   * Other browsers either support motion without prompt or don't support it at all.
   */
  private async requestMotion(): Promise<PermissionState> {
    const w = this.browser as unknown as Window & {
      DeviceOrientationEvent?: {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
    };
    if (typeof w.DeviceOrientationEvent === 'undefined') return 'browser-unsupported';
    // If the requestPermission method exists (iOS Safari), call it.
    if (w.DeviceOrientationEvent.requestPermission) {
      try {
        const result = await w.DeviceOrientationEvent.requestPermission();
        return result === 'granted' ? 'allowed' : 'denied';
      } catch {
        return 'temporarily-unavailable';
      }
    }
    // On non-iOS browsers, motion events are available without explicit permission.
    return 'allowed';
  }

  /**
   * Request battery permission by attempting to read battery level.
   * The Battery Status API may require user gesture in some browsers.
   */
  private async requestBattery(): Promise<PermissionState> {
    const nav = this.browser.navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    if (!nav.getBattery) return 'browser-unsupported';
    try {
      const battery = await nav.getBattery();
      // If we can read the level, permission is effectively granted.
      if (typeof battery.level === 'number') {
        this.byKey.battery.detail = `Level approximately ${Math.round(battery.level * 100)} percent.`;
        return 'allowed';
      }
      return 'temporarily-unavailable';
    } catch {
      return 'denied';
    }
  }
}

export function describePermissionState(state: PermissionState): string {
  switch (state) {
    case 'allowed':
      return 'active';
    case 'denied':
      return 'not allowed';
    case 'requesting':
      return 'requesting…';
    case 'unavailable':
      return 'unavailable';
    case 'temporarily-unavailable':
      return 'temporarily unavailable';
    case 'browser-unsupported':
      return 'not supported by this browser';
    default:
      return 'not requested';
  }
}
