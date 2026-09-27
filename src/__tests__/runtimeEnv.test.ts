import { describe, it, expect } from 'vitest';
import { apiBaseProblem, normaliseApiBase, resolveApiBase } from '../runtimeEnv';

describe('normaliseApiBase', () => {
  it('keeps an empty or absent value empty, because that means same-origin', () => {
    expect(normaliseApiBase('')).toBe('');
    expect(normaliseApiBase('   ')).toBe('');
    expect(normaliseApiBase(undefined)).toBe('');
    expect(normaliseApiBase(null)).toBe('');
  });

  it('strips trailing slashes so callers never emit a double slash', () => {
    expect(normaliseApiBase('https://a.example/')).toBe('https://a.example');
    expect(normaliseApiBase('https://a.example///')).toBe('https://a.example');
    expect(normaliseApiBase('  https://a.example/  ')).toBe('https://a.example');
  });
});

describe('resolveApiBase', () => {
  it('uses an explicitly configured host, whatever the page host is', () => {
    // The native case: the webview is on an asset origin, so only the explicit
    // value can be right.
    expect(resolveApiBase({ VITE_API_BASE_URL: 'https://api.example/' }, 'tauri.localhost')).toBe(
      'https://api.example',
    );
  });

  it('is same-origin for the website and the installed PWA', () => {
    expect(resolveApiBase({}, 'watchora.ramagiritharun.in')).toBe('');
  });

  it('points a dev server at the hand-started API', () => {
    expect(resolveApiBase({}, 'localhost')).toBe('http://127.0.0.1:4000');
    expect(resolveApiBase({}, '127.0.0.1')).toBe('http://127.0.0.1:4000');
  });

  it('does NOT treat the native asset origin as a dev host', () => {
    // This is the bug the module exists to prevent: an unguarded "is this
    // localhost" test lets tauri.localhost fall through to same-origin, and
    // every request then resolves against the bundled asset origin.
    expect(resolveApiBase({}, 'tauri.localhost')).toBe('');
    expect(resolveApiBase({}, 'localhost').startsWith('http://127.0.0.1:4000')).toBe(true);
  });

  it('ignores a blank configured value rather than treating it as a host', () => {
    expect(resolveApiBase({ VITE_API_BASE_URL: '  ' }, 'watchora.ramagiritharun.in')).toBe('');
  });
});

describe('apiBaseProblem', () => {
  it('accepts empty (same-origin is legitimate for the web build)', () => {
    expect(apiBaseProblem('')).toBeNull();
    expect(apiBaseProblem(undefined)).toBeNull();
  });

  it('accepts a public https host', () => {
    expect(apiBaseProblem('https://watchora.ramagiritharun.in')).toBeNull();
    expect(apiBaseProblem('https://api.example:8443/')).toBeNull();
  });

  it('rejects a value that is not an absolute URL', () => {
    // The realistic typo: writing the path instead of the origin.
    expect(apiBaseProblem('/api')).toMatch(/not an absolute URL/);
    expect(apiBaseProblem('watchora.example')).toMatch(/not an absolute URL/);
  });

  it('rejects a non-http scheme', () => {
    expect(apiBaseProblem('ftp://a.example')).toMatch(/only http and https/);
    expect(apiBaseProblem('file:///etc/passwd')).toMatch(/only http and https/);
    expect(apiBaseProblem('javascript:alert(1)')).toMatch(/only http and https/);
  });

  it('rejects loopback, which only resolves on the build machine', () => {
    expect(apiBaseProblem('http://localhost:4000')).toMatch(/loopback/);
    expect(apiBaseProblem('http://127.0.0.1:4000')).toMatch(/loopback/);
  });
});
