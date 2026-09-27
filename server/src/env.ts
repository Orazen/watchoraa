import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  // Server-wide fallback for any OpenAI-compatible provider (Groq, OpenRouter,
  // Cerebras, OpenAI…). AI_API_KEY wins over the legacy GEMINI_API_KEY.
  AI_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['GEMINI', 'OPENAI_COMPATIBLE']).default('OPENAI_COMPATIBLE'),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  // Server-side speech-to-text fallback for voice dictation (see routes/stt.ts).
  STT_API_KEY: z.string().optional(),
  STT_BASE_URL: z.string().optional(),
  STT_MODEL: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

/**
 * The native app's webview origins, which cannot be listed in configuration
 * because they are a property of the platform, not a deployment choice.
 *
 * The website is same-origin with this API, so it never exercises CORS at all.
 * The Tauri app always does: its webview runs on an asset origin
 * (`tauri://localhost` on macOS and Linux, `https://tauri.localhost` on Windows
 * and Android) and every request it makes is cross-origin. If these are absent
 * from the allowlist the preflight returns 204 with no
 * `Access-Control-Allow-Origin`, the browser blocks the response, and the app
 * fails in a way that looks exactly like a dead server — sign-in does nothing,
 * the mascot has nothing to describe, and there is no error a user can hear.
 *
 * `scripts/watch-e2e.mjs` asserts against this list on live production,
 * because nothing else in the test suite can see the difference.
 */
export const NATIVE_APP_ORIGINS = [
  'tauri://localhost',
  'https://tauri.localhost',
  'capacitor://localhost',
  'http://localhost',
  'http://127.0.0.1',
] as const;

/** Everything the API will answer a cross-origin preflight for. */
export const allowedOrigins: string[] = [
  ...new Set([...corsOrigins, ...NATIVE_APP_ORIGINS]),
];
