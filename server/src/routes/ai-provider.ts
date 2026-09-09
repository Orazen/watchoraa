import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';
import { encryptSecret, decryptSecret, maskSecret } from '../lib/secret-box.js';
import { OPENAI_DEFAULT_BASE_URL } from '../services/ai/ai-provider.js';

/**
 * Per-user AI provider settings ("bring your own key"). A user may connect
 * their own Gemini key or any OpenAI-compatible endpoint (OpenAI, Groq,
 * OpenRouter, self-hosted vLLM/Ollama). Keys are stored AES-256-GCM
 * encrypted and NEVER returned to the client — only a masked preview.
 * Without user settings the server-wide key (if any) is used.
 */
export const aiProviderRouter = Router();
aiProviderRouter.use(requireAuth);

const ALLOWED_PROVIDERS = new Set(['GEMINI', 'OPENAI_COMPATIBLE']);
const ALLOWED_BASE_HOSTS = new Set([
  'api.openai.com',
  'api.groq.com',
  'openrouter.ai',
  'api.together.xyz',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.cerebras.ai',
  // Common local/self-hosted endpoints (browser cannot reach these; a server
  // deployment next to the user's own machine can).
  'localhost',
  '127.0.0.1',
]);

function isSelfHostedHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    /\.(lan|local|home|internal)$/i.test(host) ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

/** Shared with the caregiver ward-settings route, which accepts the same config. */
export function validateBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname;
    // Public AI endpoints must be https (the key travels over the open
    // internet); self-hosted endpoints may use plain http since they sit on
    // the user's own network and local servers rarely have TLS.
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isSelfHostedHost(host))) return null;
    const hostOk = ALLOWED_BASE_HOSTS.has(host) || isSelfHostedHost(host);
    if (!hostOk) return null;
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
  } catch {
    return null;
  }
}

/** Masked preview of an AI provider pref — key material never leaves the server. */
export function serializeAiPref(pref: { provider: string; model: string | null; baseUrl: string | null; apiKeyEnc: string | null }) {
  let maskedKey: string | null = null;
  if (pref.apiKeyEnc) {
    try {
      maskedKey = maskSecret(decryptSecret(pref.apiKeyEnc));
    } catch {
      maskedKey = null; // e.g. server secret rotated — treat as unset, user can re-enter
    }
  }
  return {
    provider: pref.provider,
    model: pref.model,
    baseUrl: pref.baseUrl,
    hasKey: Boolean(pref.apiKeyEnc),
    maskedKey,
  };
}

aiProviderRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const pref = await prisma.aiProviderPref.findUnique({ where: { userId: request.userId! } });
    response.json({
      providerSettings: pref
        ? serializeAiPref(pref)
        : { provider: 'GEMINI', model: null, baseUrl: null, hasKey: false, maskedKey: null },
    });
  }),
);

const putSchema = z
  .object({
    provider: z.enum(['GEMINI', 'OPENAI_COMPATIBLE']),
    model: z.string().max(120).nullable().optional(),
    baseUrl: z.string().max(300).nullable().optional(),
    apiKey: z.string().min(8).max(400).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

aiProviderRouter.put(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = putSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const { provider, model, baseUrl, apiKey } = parsed.data;

    let normalizedBaseUrl: string | null | undefined = undefined;
    if (baseUrl !== undefined) {
      if (baseUrl === null || baseUrl.trim() === '') {
        normalizedBaseUrl = provider === 'OPENAI_COMPATIBLE' ? OPENAI_DEFAULT_BASE_URL : null;
      } else {
        const ok = validateBaseUrl(baseUrl.trim());
        if (!ok) {
          response.status(400).json({
            error:
              'Base URL must be https and point at a supported AI endpoint (api.openai.com, api.groq.com, openrouter.ai, api.together.xyz, api.mistral.ai, api.deepseek.com) or a private/self-hosted host.',
          });
          return;
        }
        normalizedBaseUrl = ok;
      }
    }

    if (provider === 'GEMINI' && normalizedBaseUrl) {
      response.status(400).json({ error: 'Gemini does not use a custom base URL.' });
      return;
    }

    const data = {
      provider,
      ...(model !== undefined ? { model: model && model.trim() !== '' ? model.trim() : null } : {}),
      ...(normalizedBaseUrl !== undefined ? { baseUrl: normalizedBaseUrl } : {}),
      ...(apiKey !== undefined ? { apiKeyEnc: apiKey ? encryptSecret(apiKey) : null } : {}),
    };

    const updated = await prisma.aiProviderPref.upsert({
      where: { userId: request.userId! },
      create: { userId: request.userId!, ...data },
      update: data,
    });

    await recordAudit({
      actorId: request.userId,
      action: 'ai_provider.updated',
      entityType: 'AiProviderPref',
      entityId: updated.id,
      metadata: { provider, hasKey: apiKey !== undefined ? Boolean(apiKey) : undefined, model: data.model ?? undefined },
    });

    response.json({ providerSettings: serializeAiPref(updated) });
  }),
);

aiProviderRouter.delete(
  '/key',
  asyncHandler(async (request, response) => {
    const existing = await prisma.aiProviderPref.findUnique({ where: { userId: request.userId! } });
    let updated = existing;
    if (existing) {
      updated = await prisma.aiProviderPref.update({ where: { userId: request.userId! }, data: { apiKeyEnc: null } });
      await recordAudit({ actorId: request.userId, action: 'ai_provider.key_removed', entityType: 'AiProviderPref', entityId: existing.id });
    }
    // 200 + JSON (not 204): the client destructures { ok, providerSettings } and
    // needs the post-removal state to refresh its UI.
    response.json({
      ok: true,
      providerSettings: updated
        ? serializeAiPref(updated)
        : { provider: 'GEMINI', model: null, baseUrl: null, hasKey: false, maskedKey: null },
    });
  }),
);
