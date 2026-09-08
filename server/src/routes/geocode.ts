// Reverse geocoding for the spoken "where am I?" answer, proxied through the
// server so the strict CSP holds and Nominatim's usage policy is honored:
// max 1 request/second (enforced by limiter + cache), a real User-Agent, and
// only https to the fixed nominatim host. Coordinates are rounded to ~11m
// before lookup so the cache absorbs repeated fixes.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { safeFetch } from '../lib/safe-url.js';

const NOMINATIM_BASE = process.env.NOMINATIM_BASE_URL ?? 'https://nominatim.openstreetmap.org';
const NOMINATIM_UA = 'Watchora/1.0 (assistive navigation for blind users; contact: operator@watchora.app)';

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

const lookupLimiter = rateLimit({
  windowMs: 60_000,
  max: 20, // well under Nominatim's 1/sec policy with caching in front
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many location lookups. Please wait a moment.' },
});

export interface PlaceInfo {
  display: string;
  road?: string;
  city?: string;
  suburb?: string;
  state?: string;
  /** Nominatim jsonv2 top-level fields used to infer indoors vs outdoors. */
  name?: string;
  addresstype?: string;
}

const cache = new Map<string, { at: number; info: PlaceInfo }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;

function cacheKey(lat: number, lng: number): string {
  // 4 decimals ≈ 11m — repeated GPS fixes in the same spot share an entry.
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

export function makeGeocodeRouter(provider: (lat: number, lng: number) => Promise<PlaceInfo> = nominatimProvider): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/reverse',
    lookupLimiter,
    asyncHandler(async (request, response) => {
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json({ error: 'lat and lng query parameters are required' });
        return;
      }
      const { lat, lng } = parsed.data;
      const key = cacheKey(lat, lng);

      const cached = cache.get(key);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        response.json({ ...cached.info, cached: true });
        return;
      }

      let info: PlaceInfo;
      try {
        info = await provider(lat, lng);
      } catch {
        response.status(502).json({ error: 'Location lookup is not reachable right now.' });
        return;
      }

      cache.set(key, { at: Date.now(), info });
      if (cache.size > CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      response.json({ ...info, cached: false });
    }),
  );

  return router;
}

/** Nominatim reverse lookup, whitelisted fields only. */
export async function nominatimProvider(lat: number, lng: number): Promise<PlaceInfo> {
  const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const res = await safeFetch(url, {
    headers: { 'User-Agent': NOMINATIM_UA, 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { display: '' };
  const body = (await res.json()) as {
    display_name?: string;
    name?: string;
    addresstype?: string;
    address?: Record<string, string>;
  };
  const a = body.address ?? {};
  return {
    display: body.display_name?.slice(0, 200) ?? '',
    name: body.name,
    addresstype: body.addresstype,
    road: a.road ?? a.pedestrian ?? a.footway,
    suburb: a.suburb ?? a.neighbourhood ?? a.city_district,
    city: a.city ?? a.town ?? a.village ?? a.county,
    state: a.state,
  };
}

export const geocodeRouter: Router = makeGeocodeRouter();

// ---- IP-based approximate location ---------------------------------------
// Fallback for when the browser's GPS permission is denied/unavailable: the
// Home map and "where am I" still show a city-level position derived from the
// caller's public IP. Trust proxy = 1 (app.ts) makes req.ip the real client.
const ipCache = new Map<string, { at: number; body: IpLocation }>();
const IP_CACHE_TTL_MS = 30 * 60 * 1000; // IPs move rarely; city-level anyway
const IP_CACHE_MAX = 500;

export interface IpLocation {
  lat: number;
  lng: number;
  approximate: true;
  city?: string;
  country?: string;
}

async function ipWhoIsLookup(ip: string): Promise<IpLocation> {
  const url = `https://ipwho.is/${encodeURIComponent(ip)}`;
  const res = await safeFetch(url, {
    headers: { 'User-Agent': NOMINATIM_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('ip lookup failed');
  const body = (await res.json()) as {
    success?: boolean;
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
  };
  if (body.success === false || typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
    throw new Error('ip lookup unavailable');
  }
  return {
    lat: body.latitude,
    lng: body.longitude,
    approximate: true,
    city: body.city,
    country: body.country,
  };
}

export function makeIpLocationRouter(provider: (ip: string) => Promise<IpLocation> = ipWhoIsLookup): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/ip',
    lookupLimiter,
    asyncHandler(async (request, response) => {
      const ip = request.ip ?? '';
      // Private/loopback addresses (local dev, health checks) have no public
      // geolocation — fail cleanly rather than returning a datacenter answer.
      if (!ip || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('::1') || ip.includes('172.16.') || ip === '::ffff:127.0.0.1') {
        response.status(404).json({ error: 'No public IP available for this connection.' });
        return;
      }

      const cached = ipCache.get(ip);
      if (cached && Date.now() - cached.at < IP_CACHE_TTL_MS) {
        response.json({ ...cached.body, cached: true });
        return;
      }

      let info: IpLocation;
      try {
        info = await provider(ip);
      } catch {
        response.status(502).json({ error: 'Approximate location is not reachable right now.' });
        return;
      }

      ipCache.set(ip, { at: Date.now(), body: info });
      if (ipCache.size > IP_CACHE_MAX) {
        const oldest = ipCache.keys().next().value;
        if (oldest) ipCache.delete(oldest);
      }
      response.json({ ...info, cached: false });
    }),
  );

  return router;
}

export const ipLocationRouter: Router = makeIpLocationRouter();
