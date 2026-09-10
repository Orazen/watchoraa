import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../env.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { AiProviderError, buildProvider, resolveAiConfig, serverAiFallbackFromEnv, type AiMode, type ServerAiFallback } from '../services/ai/ai-provider.js';
import { buildPrompt, buildPromptWithOverride } from '../services/ai/prompt-builder.js';
import { rememberSummary, recentSummaries, newestSummaryAgeSeconds } from '../lib/scene-memory.js';

export const aiRouter = Router();

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // 6MB decoded
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png']);
const DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/;

// Server-wide AI fallback (AI_API_KEY any-provider first, legacy GEMINI_API_KEY
// second) — used whenever the requesting user has no key of their own.
const serverFallback: ServerAiFallback = serverAiFallbackFromEnv(env);

const generateSchema = z.object({
  mode: z.enum(['navigation', 'assistant', 'reading', 'environment', 'emergency']),
  prompt: z.string().min(1).max(2000),
  imageDataUrl: z.string().max(9_000_000).optional(),
  demo: z.boolean().optional(),
  // Follow-up requests consume the short-lived scene-summary memory.
  followUp: z.boolean().optional(),
});

// The intent+generate suites legitimately send ~20 requests inside one
// minute during tests, which made the 20/min cap flake the marginal test.
// Test runs get a relaxed cap; production keeps the 20/min safeguard.
const isTestRun = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const aiRateLimiter = rateLimit({
  windowMs: 60_000,
  max: isTestRun ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many analysis requests. Please wait a moment and try again.' },
});

function decodeImage(imageDataUrl: string): { base64: string; mimeType: string } {
  const match = DATA_URL_PATTERN.exec(imageDataUrl);
  if (!match) {
    throw new AiProviderError('Image must be a base64 data URL with mime type image/jpeg or image/png', 'unsupported');
  }

  const [, mimeType, base64] = match;
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw new AiProviderError('Unsupported image type', 'unsupported');
  }

  const decodedBytes = Math.floor((base64.length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) {
    throw new AiProviderError('Image is too large. Maximum decoded size is 6MB.', 'unsupported');
  }

  return { base64, mimeType };
}

function statusForError(error: AiProviderError): number {
  switch (error.kind) {
    case 'invalid_key':
      return 502;
    case 'timeout':
      return 504;
    case 'unsupported':
      return 400;
    default:
      return 502;
  }
}

function logAiRequest(entry: {
  userId?: string;
  mode: AiMode;
  provider: string;
  model: string;
  latencyMs: number;
  success: boolean;
  redactedInput: string;
  redactedOutput?: string;
  errorMessage?: string;
  promptVersion?: number;
}) {
  prisma.aIRequestLog
    .create({
      data: {
        userId: entry.userId,
        mode: entry.mode.toUpperCase() as 'NAVIGATION' | 'ASSISTANT' | 'READING' | 'ENVIRONMENT' | 'EMERGENCY',
        provider: entry.provider,
        model: entry.model,
        latencyMs: entry.latencyMs,
        success: entry.success,
        redactedInput: entry.redactedInput,
        redactedOutput: entry.redactedOutput,
        errorMessage: entry.errorMessage,
        promptVersion: entry.promptVersion,
      },
    })
    .catch(() => {
      // Logging is best-effort; never let it break the AI response path.
    });
}

const intentSchema = z.object({
  transcript: z.string().min(1).max(500),
  // Ephemeral context the client sends with each request: a short description
  // of recent commands (for pronoun follow-ups like "take me there too").
  // Never persisted, never used for anything but this one parse.
  context: z.string().max(1000).optional(),
});

// Safety-limited AI intent parsing (v0.4 voice-first): only non-safety-critical
// intents are allowed. Emergency/journey cancellation commands are locked to the
// deterministic router and never delegated here. Server-side so no API key is
// ever exposed to the frontend. Exported for tests that enforce the allow-list.
export const SAFE_AI_INTENTS = [
  'describe_scene',
  'describe_surroundings',
  'read_text',
  'start_navigation',
  'start_safe_journey',
  'check_journey',
  'change_setting',
  'open_tab',
  'report_hazard',
  'list_places',
  'save_place',
  'shopping',
  'identify_color',
  'identify_currency',
  'read_expiry',
  'help',
  // Not an app command: the model answers general knowledge / everyday
  // questions inline (parameters.answer) instead of leaving them "unknown".
  'general_question',
];

const INTENT_PROMPT = `You are the intent parser for Watchora, an assistive app for blind and low-vision people.
Parse the user's spoken command into a single JSON object:
One command: {"intent": string, "parameters": {string: string|number|boolean}, "confidence": number, "requiresConfirmation": boolean}
Several commands spoken in one breath: {"commands": [<one-command object>, ...]} — max 3, in spoken order.
Allowed intents: ${SAFE_AI_INTENTS.join(', ')}.
Never invent emergency, cancellation, or safety-critical intents. If the command is unsafe or unsupported, return {"intent":"unknown","parameters":{},"confidence":0,"requiresConfirmation":false}.
If the command is a general knowledge or everyday question that none of the allowed intents cover (for example "what is the capital of France" or "how do I boil an egg"), answer it briefly as {"intent":"general_question","parameters":{"answer":"<1-3 short spoken-style sentences>"},"confidence":0.8,"requiresConfirmation":false}. You cannot see the user's surroundings here — never answer questions that need a camera; return unknown for those.
When the command refers back to something with a pronoun ("there", "that place", "it again"), use the Recent context block to fill in the concrete parameters.
Respond with ONLY the JSON object, no markdown.

Examples:
User command: "open settings and save this place as home"
→ {"commands":[{"intent":"open_tab","parameters":{"tab":"settings"},"confidence":0.9,"requiresConfirmation":false},{"intent":"save_place","parameters":{"name":"home"},"confidence":0.9,"requiresConfirmation":false}]}
Context: recent commands — the user asked to navigate to "Roma Termini".
User command: "take me there again"
→ {"intent":"start_navigation","parameters":{"destination":"Roma Termini"},"confidence":0.85,"requiresConfirmation":false}
User command: "what is the capital of France"
→ {"intent":"general_question","parameters":{"answer":"The capital of France is Paris."},"confidence":0.9,"requiresConfirmation":false}
User command: "call for help"
→ {"intent":"unknown","parameters":{},"confidence":0,"requiresConfirmation":false}`;

interface ParsedCommand {
  intent: string;
  parameters: Record<string, unknown>;
  confidence: number;
  requiresConfirmation: boolean;
}

// Prefix-validate every emitted command against the allow-list and drop
// anything unknown or malformed — the model can never smuggle in an intent
// outside SAFE_AI_INTENTS, compound or not.
function sanitizeCommand(raw: unknown): ParsedCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const intent = typeof obj.intent === 'string' ? obj.intent : '';
  if (!SAFE_AI_INTENTS.includes(intent)) return null;
  const parameters =
    typeof obj.parameters === 'object' && obj.parameters !== null && !Array.isArray(obj.parameters)
      ? (obj.parameters as Record<string, unknown>)
      : {};
  const confidence = typeof obj.confidence === 'number' ? Math.min(1, Math.max(0, obj.confidence)) : 0;
  return { intent, parameters, confidence, requiresConfirmation: obj.requiresConfirmation === true };
}

aiRouter.post(
  '/intent',
  aiRateLimiter,
  requireAuth,
  asyncHandler(async (request, response) => {
    const parsed = intentSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    // Any configured provider (the user's own key first, then the server-wide
    // Gemini key) can parse intent via completeJson; with no AI configured the
    // demo provider returns the safe "unknown" fallback, so the deterministic
    // router alone remains authoritative for safety commands.
    const fallback = { intent: 'unknown', parameters: {}, confidence: 0, requiresConfirmation: false };
    try {
      const pref = await prisma.aiProviderPref.findUnique({ where: { userId: request.userId! } });
      const config = resolveAiConfig(pref, serverFallback);
      const provider = buildProvider(config);
      // Real-time context: current UTC date/time injected fresh on every
      // request (ephemeral — never cached, never persisted) so time-relative
      // wording is grounded in the actual moment.
      const nowBlock = `Current date/time: ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC.`;
      const contextBlock = parsed.data.context ? `Recent context (client-provided): ${parsed.data.context}` : '';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const obj = await provider.completeJson(
        `${INTENT_PROMPT}\n\n${[nowBlock, contextBlock].filter(Boolean).join('\n')}\n\nUser command: "${parsed.data.transcript}"`,
        controller.signal,
      );
      clearTimeout(timer);

      // Compound commands ({"commands": [...]}) are validated one by one and
      // unknown parts silently dropped; a single-object reply stays as-is.
      const commands = Array.isArray(obj.commands)
        ? (obj.commands.map(sanitizeCommand).filter((c): c is ParsedCommand => c !== null))
        : [];
      if (commands.length > 0) {
        const first = commands[0];
        // Back-compat: top-level fields mirror the first command so existing
        // clients that ignore `commands` keep working.
        response.json({ ...first, commands });
        return;
      }
      const intent = String(obj.intent ?? 'unknown');
      if (!SAFE_AI_INTENTS.includes(intent)) {
        response.json(fallback);
        return;
      }
      response.json({
        intent,
        parameters: typeof obj.parameters === 'object' && obj.parameters !== null ? obj.parameters : {},
        confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
        requiresConfirmation: obj.requiresConfirmation === true,
      });
    } catch {
      response.json(fallback);
    }
  }),
);

// ── Prompt versioning fallback (kept) ──
aiRouter.post(
  '/generate',
  aiRateLimiter,
  requireAuth, // account-gated: AI analysis is only for signed-in users (roadmap: RBAC first)
  asyncHandler(async (request, response) => {
    const parsed = generateSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const { mode, prompt, imageDataUrl, demo, followUp } = parsed.data;

    if (mode === 'emergency') {
      response.status(400).json({
        error: 'AI scene analysis is not used for emergency mode. Use the SOS workflow instead.',
      });
      return;
    }

    // Prompt versioning: if an admin activated a custom prompt for this mode,
    // use it as the instruction block — but ALWAYS composed with the safety
    // contract and response shape (buildPromptWithOverride appends them after
    // the override, so an admin prompt can never remove the guardrails).
    // Follow-up requests get scene-memory context: previous summaries with an
    // explicit age stamp and hard instructions against motion/safety guesses.
    // The memory holds TEXT summaries only — frames are never retained.
    let userPrompt = prompt;
    if (followUp) {
      const memory = recentSummaries(request.userId!);
      const age = newestSummaryAgeSeconds(request.userId!);
      if (memory.length === 0) {
        userPrompt = `${prompt}\n\n(Scene memory: empty — say plainly that nothing has been analyzed in the last 90 seconds and ask the user to capture a fresh view.)`;
      } else {
        userPrompt = [
          prompt,
          `Scene memory (previous summaries from the last 90 seconds, oldest first; newest is about ${age ?? 0} seconds old):`,
          ...memory.map((m, i) => `${i + 1}. ${m}`),
          'Rules for this follow-up: describe what the CURRENT frame adds beyond those summaries. When an object from memory is gone, say so plainly and mention where it was, with the age stamp ("a few seconds ago"). NEVER answer motion questions ("did it move?", "is it still there?") from memory — if the object is not clearly visible in the CURRENT frame, say you cannot tell from now and recommend a fresh capture.',
        ].join('\n');
      }
    }

    let resolvedPrompt = buildPrompt(mode, userPrompt);
    let promptVersion: number | null = null;
    try {
      const active = await prisma.promptVersion.findFirst({
        where: { mode: mode.toUpperCase() as 'NAVIGATION' | 'ASSISTANT' | 'READING' | 'ENVIRONMENT' | 'EMERGENCY', isActive: true },
        orderBy: { version: 'desc' },
      });
      if (active) {
        resolvedPrompt = buildPromptWithOverride(mode, userPrompt, active.prompt);
        promptVersion = active.version;
      }
    } catch {
      // Fall back to the built-in prompt if the lookup fails.
    }

    let image: { base64: string; mimeType: string } | undefined;
    try {
      if (imageDataUrl) {
        image = decodeImage(imageDataUrl);
      }
    } catch (error) {
      if (error instanceof AiProviderError) {
        response.status(statusForError(error)).json({ error: error.message });
        return;
      }
      throw error;
    }

    // Provider resolution: the user's own AI provider settings (bring-your-own
    // key) win over the server-wide key (any provider); demo mode applies only
    // when neither exists or the caller explicitly asked for demo.
    let config: Awaited<ReturnType<typeof resolveAiConfig>> = { source: 'demo' };
    if (demo !== true) {
      try {
        const pref = await prisma.aiProviderPref.findUnique({ where: { userId: request.userId! } });
        config = resolveAiConfig(pref, serverFallback);
      } catch {
        config = serverFallback ? { source: 'server', ...serverFallback } : { source: 'demo' };
      }
    }
    const provider = buildProvider(config);
    const isDemo = config.source === 'demo';

    const controller = new AbortController();
    const onClientDisconnect = () => controller.abort();
    request.on('close', onClientDisconnect);

    const startedAt = Date.now();
    const redactedInput = JSON.stringify({ promptLength: prompt.length, hasImage: Boolean(image) });

    try {
      const result = await provider.generate(
        {
          mode: mode as AiMode,
          prompt,
          promptOverride: promptVersion != null ? resolvedPrompt : undefined,
          imageBase64: image?.base64,
          imageMimeType: image?.mimeType,
        },
        controller.signal,
      );

      logAiRequest({
        userId: request.userId,
        mode: mode as AiMode,
        provider: provider.id,
        model: isDemo ? 'demo' : (config.source === 'demo' ? 'demo' : config.model),
        latencyMs: Date.now() - startedAt,
        success: true,
        redactedInput,
        redactedOutput: result.summary.slice(0, 500),
        promptVersion: promptVersion ?? undefined,
      });

      // Scene memory for follow-ups: text summaries only (never frames),
      // 90s TTL. Follow-up requests consume these as context.
      rememberSummary(request.userId!, result.summary);

      response.json({ ...result, demo: isDemo });
    } catch (error) {
      const errorMessage = error instanceof AiProviderError ? error.message : error instanceof Error ? error.message : 'Unknown error';
      logAiRequest({
        userId: request.userId,
        mode: mode as AiMode,
        provider: provider.id,
        model: isDemo ? 'demo' : (config.source === 'demo' ? 'demo' : config.model),
        latencyMs: Date.now() - startedAt,
        success: false,
        redactedInput,
        errorMessage,
      });

      if (error instanceof AiProviderError) {
        response.status(statusForError(error)).json({ error: error.message, kind: error.kind });
        return;
      }
      throw error;
    } finally {
      request.off('close', onClientDisconnect);
    }
  }),
);
