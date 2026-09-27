/**
 * Where the API lives, for every runtime the client can boot in.
 *
 * The app ships as three things from one bundle: the website (served from the
 * API's own origin), the installed PWA (same origin, still), and the Tauri
 * desktop/mobile app (a webview whose origin is `tauri://localhost` on
 * macOS/Linux and `https://tauri.localhost` on Windows/Android).
 *
 * The webview case is why this is a module instead of an inline ternary. The
 * old rule was "use a relative URL unless the host is localhost", which is
 * correct for the website and actively wrong for the app: inside the webview
 * the host is not localhost, so a relative `/api/auth/login` resolved against
 * the app's own bundled asset origin and every request failed with a network
 * error the user would have experienced as "Watchora does not work". So the
 * native builds must name the API host explicitly.
 */

/** Schemes a native build is allowed to point at. */
const ALLOWED_SCHEMES = ['https:', 'http:'];

/** A dev API on loopback is fine; it is never a production target. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Strip a trailing slash so callers can always write `${base}/api/...` without
 * producing a double slash. An empty base is legitimate: it means same-origin.
 */
export function normaliseApiBase(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

/**
 * Why a configured API base is unusable, or null when it is fine.
 *
 * A typo in a build-time variable would otherwise ship an app that fails every
 * request in a way that looks like the server is down, so the native build
 * script calls this and refuses to bundle rather than shipping that.
 */
export function apiBaseProblem(raw: string | undefined | null): string | null {
  const base = normaliseApiBase(raw);
  if (!base) return null; // same-origin; correct for the website and the PWA
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return `${base} is not an absolute URL (expected something like https://watchora.example)`;
  }
  if (!ALLOWED_SCHEMES.includes(url.protocol)) {
    return `${base} uses ${url.protocol}//; only http and https are allowed`;
  }
  if (LOOPBACK_HOSTS.has(url.hostname)) {
    return `${base} points at a loopback address, which only resolves on the build machine`;
  }
  return null;
}

/**
 * Resolve the base for the current runtime.
 *
 * `VITE_API_BASE_URL` is the single definition of the value: `scripts/
 * build-native.mjs` puts it in the environment for both the Vite bundle and
 * the Rust compile, so the shell and the web layer can never disagree. The
 * website and the installed PWA leave it unset and get same-origin, which is
 * correct for both.
 */
export function resolveApiBase(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
  hostname: string = typeof window === 'undefined' ? '' : window.location.hostname,
): string {
  const fromEnv = env.VITE_API_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return normaliseApiBase(fromEnv);
  // No configured host. Same-origin is right for the website and the installed
  // PWA; a dev server on loopback needs the API started by hand.
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return 'http://127.0.0.1:4000';
  }
  return '';
}
