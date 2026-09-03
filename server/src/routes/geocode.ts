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

export const geocodeRouter = Router();
geocodeRouter.use(requireAuth);

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
    address?: Record<string, string>;
  };
  const a = body.address ?? {};
  return {
    display: body.display_name?.slice(0, 200) ?? '',
    road: a.road ?? a.pedestrian ?? a.footway,
    suburb: a.suburb ?? a.neighbourhood ?? a.city_district,
    city: a.city ?? a.town ?? a.village ?? a.county,
    state: a.state,
  };
}

export const geocodeRouterActive: Router = makeGeocodeRouter();
