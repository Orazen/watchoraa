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
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());
