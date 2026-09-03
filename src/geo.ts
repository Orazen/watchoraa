// Phase C (scoped spatial awareness): GPS-anchored saved places.
// Deliberately NOT full SLAM — see docs/yolo-ocr-slam-plan.md #2.3 for why full
// visual SLAM is out of scope for a browser PWA. This gives outdoor, coarse
// relative positioning to saved places using the standard Geolocation API only.

export type Coordinates = { latitude: number; longitude: number };

export function getCurrentPosition(timeoutMs = 10_000): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not support location services.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      (error) => reject(new Error(error.message || 'Could not get your location.')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Haversine great-circle distance, in meters.
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial compass bearing from a to b, in degrees [0, 360).
export function bearingDegrees(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLon = toRadians(b.longitude - a.longitude);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

const COMPASS_DIRECTIONS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

export function compassDirection(deg: number): string {
  const index = Math.round(deg / 45) % 8;
  return COMPASS_DIRECTIONS[index];
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Human-friendly "X away, to the north" style summary for a saved place, used for
// both on-screen text and TTS — avoids the plan's flagged anti-pattern of ever
// stating a precise distance that isn't actually measurable (this one is: it's
// straight-line GPS math, not an AI guess).
export function describeRelativePosition(from: Coordinates, to: Coordinates): string {
  const meters = distanceMeters(from, to);
  const bearing = bearingDegrees(from, to);
  return `${formatDistance(meters)} away, to the ${compassDirection(bearing)}`;
}

/** Compass bearing → clock-face phrase (12 = straight ahead). Soundscape-style
 *  spatial description: blind users orient better to clock positions than to
 *  compass words when they know roughly which way they are facing. */
export function clockFromBearing(bearing: number): string {
  const hour = Math.round(bearing / 30) % 12 || 12;
  return `${hour} o'clock`;
}

/** Full spoken summary for a saved place: "Home, 340 m away, at about 9 o'clock." */
export function describePlaceAsSpoken(from: Coordinates, to: Coordinates, name: string): string {
  const meters = distanceMeters(from, to);
  const clock = clockFromBearing(bearingDegrees(from, to));
  return `${name}, ${formatDistance(meters)} away, at about ${clock}.`;
}
