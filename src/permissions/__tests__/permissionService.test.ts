// Unit tests for the permission service (v0.4). Uses a fake browser so no real
// permissions are touched.

import { describe, expect, it } from 'vitest';
import { PermissionService, type BrowserLike } from '../permissionService';

function fakeBrowser(overrides: Partial<BrowserLike['navigator']> & { notificationPermission?: NotificationPermission } = {}): BrowserLike {
  const nav = {
    mediaDevices: {
      getUserMedia: async () => {
        throw new DOMException('Permission denied', 'NotAllowedError');
      },
    },
    geolocation: {
      getCurrentPosition: (ok: (p: { coords: { accuracy: number } }) => void) => ok({ coords: { accuracy: 18 } }),
    },
    onLine: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    ...overrides,
  };
  return {
    navigator: nav,
    Notification: overrides.notificationPermission !== undefined
      ? { permission: overrides.notificationPermission, requestPermission: async () => overrides.notificationPermission! }
      : undefined,
  } as BrowserLike;
}

describe('PermissionService static states', () => {
  it('marks vibration + network + SW allowed on a capable browser', () => {
    const svc = new PermissionService(fakeBrowser({ vibrate: () => true, serviceWorker: {}, wakeLock: {} }));
    svc.refreshStatic();
    expect(svc.get('vibration').state).toBe('allowed');
    expect(svc.get('network').state).toBe('allowed');
    expect(svc.get('serviceWorker').state).toBe('allowed');
    expect(svc.get('wakeLock').state).toBe('allowed');
  });

  it('marks vibration + wake lock unsupported when absent', () => {
    const svc = new PermissionService(fakeBrowser());
    svc.refreshStatic();
    expect(svc.get('vibration').state).toBe('browser-unsupported');
    expect(svc.get('wakeLock').state).toBe('browser-unsupported');
  });

  it('tracks network offline', () => {
    const svc = new PermissionService(fakeBrowser({ onLine: false }));
    svc.refreshStatic();
    expect(svc.get('network').state).toBe('temporarily-unavailable');
  });
});

describe('PermissionService requests', () => {
  it('returns denied when getUserMedia is refused', async () => {
    const svc = new PermissionService(fakeBrowser());
    const state = await svc.request('camera');
    expect(state).toBe('denied');
  });

  it('returns allowed + detail when location succeeds', async () => {
    const svc = new PermissionService(fakeBrowser());
    const state = await svc.request('location');
    expect(state).toBe('allowed');
    expect(svc.get('location').detail).toContain('18 metres');
  });

  it('returns allowed when notifications already granted', async () => {
    const svc = new PermissionService(fakeBrowser({ notificationPermission: 'granted' }));
    const state = await svc.request('notifications');
    expect(state).toBe('allowed');
  });

  it('returns browser-unsupported when Notification is missing', async () => {
    const svc = new PermissionService(fakeBrowser({ notificationPermission: undefined }));
    const state = await svc.request('notifications');
    expect(state).toBe('browser-unsupported');
  });
});

describe('PermissionService snapshot readiness', () => {
  it('ready only when all critical permissions allowed', async () => {
    const svc = new PermissionService(fakeBrowser({ vibrate: () => true }));
    svc.refreshStatic();
    expect(svc.snapshot().ready).toBe(false);
    // Grant location via a successful geolocation.
    await svc.request('location');
    expect(svc.get('location').state).toBe('allowed');
  });
});
