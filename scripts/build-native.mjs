#!/usr/bin/env node
/**
 * Build the native desktop/mobile app.
 *
 * The only thing worth scripting here is the check. A native build that is
 * missing VITE_API_BASE_URL produces an app that installs, opens, signs the
 * user in, and then fails every single request — because the webview resolves
 * `/api/...` against its own bundled asset origin. That is a long and
 * confusing bug to diagnose from a user's report, and a five-line check here
 * turns it into a build failure with a clear message.
 *
 * Usage:
 *   node scripts/build-native.mjs check            # validate only
 *   node scripts/build-native.mjs tauri <args...>  # check, then run tauri
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_API_BASE = 'https://watchora.ramagiritharun.in';
const ALLOWED_SCHEMES = new Set(['https:', 'http:']);
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

const mode = process.argv[2] ?? 'check';
const rest = process.argv.slice(3);

/** Mirrors apiBaseProblem() in src/runtimeEnv.ts; keep the two in step. */
function problem(raw) {  const value = (raw ?? '').trim();
  if (!value) return 'VITE_API_BASE_URL is not set. A native build must name the API host explicitly.';
  const base = value.replace(/\/+$/, '');
  let url;
  try {
    url = new URL(base);
  } catch {
    return `${value} is not an absolute URL (expected something like ${DEFAULT_API_BASE})`;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return `${value} uses ${url.protocol}//; only http and https are allowed.`;
  }
  if (LOOPBACK.has(url.hostname)) {
    return `${value} points at a loopback address, which only resolves on this machine.`;
  }
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) {
    return `${value} is plain http to a remote host; the app's traffic carries location, camera and audio. Use https.`;
  }
  return null;
}

const normalise = (raw) => (raw ?? '').trim().replace(/\/+$/, '');

// An unset value fails too: for the website, unset is correct and means
// same-origin, but a webview is never the website's origin, so a native build
// without this variable cannot work.
const issue = problem(process.env.VITE_API_BASE_URL);

if (issue) {
  console.error(`✗ ${issue}`);
  if (mode === 'tauri') {
    console.error(`\n  Set it and try again:\n    VITE_API_BASE_URL=${DEFAULT_API_BASE} npm run native -- ${rest.join(' ')}`);
  } else {
    console.error(`\n  Set it for a native build:\n    VITE_API_BASE_URL=${DEFAULT_API_BASE} npm run native -- check`);
  }
  process.exit(1);
}

const apiBase = normalise(process.env.VITE_API_BASE_URL);
console.log(`✓ API base: ${apiBase}`);

if (mode === 'check') {
  console.log('  (check only — pass "tauri <args>" to build)');
  process.exit(0);
}

if (mode !== 'tauri') {
  console.error(`✗ unknown mode "${mode}". Use "check" or "tauri <args>".`);
  process.exit(2);
}

// The Rust side reads this with option_env!, so it has to be in the
// environment at compile time, not only at bundle time.
const result = spawnSync('npx', ['tauri', ...rest], {
  stdio: 'inherit',
  env: { ...process.env, VITE_API_BASE_URL: apiBase },
});
process.exit(result.status ?? 1);
