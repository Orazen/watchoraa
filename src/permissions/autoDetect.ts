// Auto location detection (v0.5): tries GPS first; when it is denied or
// unavailable, falls back to a server-side approximate IP lookup so the Home
// map and "where am I" always have a position to show. The approximate state
// is always disclosed — a blind user must know the fix is city-level, not
// exact.

import { api } from '../api';
import type { PermissionService } from './permissionService';

export type DetectedLocation = {
  lat: number;
  lng: number;
  accuracy: number | null;
  /** False when derived from IP — city-level only. */
  precise: boolean;
  city?: string;
  country?: string;
};

/** Registers the detected position with the permission centre + callbacks. */
export interface AutoDetectCallbacks {
  permissionService: PermissionService;
  onLocation: (loc: DetectedLocation) => void;
  /** Optional spoken status ("Using approximate location from your network"). */
  onStatus?: (message: string) => void;
}

function setPermission(ps: PermissionService, state: 'allowed' | 'denied' | 'not-requested' | 'temporarily-unavailable', detail?: string): void {
  ps.set('location', state, detail);
}

/**
 * One-shot auto-detection. GPS attempt is short (6 s); on failure it queries
 * /api/geocode/ip. Never prompts twice, never loops.
 */
export async function autoDetectLocation(cb: AutoDetectCallbacks): Promise<DetectedLocation | null> {
  const { permissionService: ps } = cb;
  const geolocation = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;

  if (geolocation) {
    const gps = await new Promise<GeolocationPosition | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000);
      try {
        geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer);
            resolve(pos);
          },
          () => {
            clearTimeout(timer);
            resolve(null);
          },
          { enableHighAccuracy: false, timeout: 5500, maximumAge: 120000 },
        );
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
    if (gps) {
      const loc: DetectedLocation = {
        lat: gps.coords.latitude,
        lng: gps.coords.longitude,
        accuracy: Math.round(gps.coords.accuracy),
        precise: true,
      };
      setPermission(ps, 'allowed', `Accuracy approximately ${loc.accuracy} metres.`);
      cb.onLocation(loc);
      return loc;
    }
  }

  // GPS denied/absent: approximate IP fallback (server-side lookup).
  try {
    const ip = await api.geoIpLocation();
    const loc: DetectedLocation = {
      lat: ip.lat,
      lng: ip.lng,
      accuracy: null,
      precise: false,
      city: ip.city,
      country: ip.country,
    };
    setPermission(
      ps,
      'allowed',
      ip.city ? `Approximate — city level (near ${ip.city}). Precise GPS is not available.` : 'Approximate — city level, from your network. Precise GPS is not available.',
    );
    cb.onLocation(loc);
    cb.onStatus?.(ip.city ? `Using approximate location near ${ip.city}. Enable precise location for turn-by-turn accuracy.` : 'Using approximate location. Enable precise location for turn-by-turn accuracy.');
    return loc;
  } catch {
    setPermission(ps, 'denied', 'Location is unavailable: GPS was not granted and network location failed.');
    return null;
  }
}
