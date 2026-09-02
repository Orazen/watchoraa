import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAuth, signToken, issueRefreshToken, rotateRefreshToken, revokeAllRefreshTokens, newResetToken, consumeResetToken } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';

export const authRouter = Router();

const authRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a moment and try again.' },
});

const signupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  fullName: z.string().min(1).max(200),
  role: z.enum(['BLIND_USER', 'CAREGIVER']).default('BLIND_USER'),
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

function toPublicUser(user: { id: string; email: string; fullName: string; role: string; preferredLanguage: string }) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    preferredLanguage: user.preferredLanguage,
  };
}

authRouter.post(
  '/signup',
  authRateLimiter,
  asyncHandler(async (request, response) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const { email, password, fullName, role } = parsed.data;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      response.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    // Fresh-install bootstrap: the very first account becomes the workspace
    // owner (admin). The advisory lock makes the count-then-create atomic, so
    // two concurrent signups can never both win the empty-table race.
    const user = await prisma.$transaction(async (tx) => {
      // ::text cast — $queryRaw cannot deserialize the void result the lock
      // function otherwise returns (fails with "Failed to deserialize column
      // of type 'void'").
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(727100001)::text AS lock`;
      const userCount = await tx.user.count();
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          role: userCount === 0 ? 'ADMIN' : role,
        },
      });
      return { created, isFirst: userCount === 0 };
    });

    await recordAudit({
      actorId: user.created.id,
      action: user.isFirst ? 'auth.first_admin_signup' : 'auth.signup',
      entityType: 'User',
      entityId: user.created.id,
      metadata: { email: user.created.email, role: user.created.role },
    });

    const token = signToken({ sub: user.created.id, email: user.created.email });
    const refresh = await issueRefreshToken(user.created.id, user.created.email);
    response.status(201).json({ token, refreshToken: refresh.token, user: toPublicUser(user.created) });
  }),
);

authRouter.post(
  '/login',
  authRateLimiter,
  asyncHandler(async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request' });
      return;
    }

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      response.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      response.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    if (!user.isActive) {
      response.status(403).json({ error: 'This account has been deactivated. Contact an administrator.' });
      return;
    }

    const token = signToken({ sub: user.id, email: user.email });
    const refresh = await issueRefreshToken(user.id, user.email);
    await recordAudit({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email },
    });
    response.json({ token, refreshToken: refresh.token, user: toPublicUser(user) });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (request, response) => {
    const user = await prisma.user.findUnique({ where: { id: request.userId } });
    if (!user) {
      response.status(404).json({ error: 'User not found' });
      return;
    }

    response.json({ user: toPublicUser(user) });
  }),
);

// Refresh-token rotation: the client exchanges an unexpired refresh token for a
// fresh access token + a NEW refresh token. Old refresh rows are revoked.
authRouter.post(
  '/refresh',
  authRateLimiter,
  asyncHandler(async (request, response) => {
    const parsed = z.object({ refreshToken: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'refreshToken required' });
      return;
    }
    const next = await rotateRefreshToken(parsed.data.refreshToken);
    if (!next) {
      response.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: next.userId } });
    if (!user) {
      response.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    await recordAudit({
      actorId: user.id,
      action: 'auth.token_refreshed',
      entityType: 'User',
      entityId: user.id,
    });
    response.json({ token: signToken({ sub: user.id, email: user.email }), refreshToken: next.token, user: toPublicUser(user) });
  }),
);

// Logout: revoke the presented refresh token (and the user's other sessions).
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (request, response) => {
    const parsed = z.object({ refreshToken: z.string().optional() }).safeParse(request.body);
    if (parsed.success && parsed.data.refreshToken) {
      const { prisma: db } = await import('../lib/prisma.js');
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256').update(parsed.data.refreshToken).digest('hex');
      await db.refreshToken.updateMany({ where: { tokenHash: hash }, data: { revokedAt: new Date() } });
    } else {
      await revokeAllRefreshTokens(request.userId!);
    }
    await recordAudit({
      actorId: request.userId,
      action: 'auth.logout',
      entityType: 'User',
      entityId: request.userId,
    });
    response.json({ ok: true });
  }),
);

// Forgot password: creates a one-hour reset token. Email delivery requires an
// SMTP provider (see lib/notify.ts). For local development ONLY, an operator
// can set EXPOSE_DEV_RESET_TOKEN=true to have the raw token returned in the
// response. This must never be enabled in production: anyone who knows a
// user's email could otherwise take over the account. Read per-request so
// tests can enable it without restarting the process.
authRouter.post(
  '/forgot-password',
  authRateLimiter,
  asyncHandler(async (request, response) => {
    const parsed = z.object({ email: z.string().email().max(200) }).safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'A valid email is required' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    // Always return ok to avoid account enumeration.
    if (!user) {
      response.json({ ok: true, note: 'If an account exists, a reset link has been issued.' });
      return;
    }
    const reset = newResetToken();
    await prisma.passwordReset.create({ data: { userId: user.id, tokenHash: reset.hash, expiresAt: reset.expiresAt } });
    await recordAudit({
      actorId: user.id,
      action: 'auth.forgot_password',
      entityType: 'User',
      entityId: user.id,
    });
    // Best-effort email delivery; falls back to a server-side log when SMTP is
    // not configured, so the operator can complete the flow from the logs.
    const { sendPasswordResetEmail } = await import('../lib/notify.js');
    const delivered = await sendPasswordResetEmail(user.email, reset.raw).catch(() => false);
    response.json({
      ok: true,
      note: 'If an account exists, a reset link has been issued.',
      ...(process.env.EXPOSE_DEV_RESET_TOKEN === 'true' ? { devToken: reset.raw } : {}),
      ...(delivered ? { delivery: 'email' } : {}),
    });
  }),
);

authRouter.post(
  '/reset-password',
  authRateLimiter,
  asyncHandler(async (request, response) => {
    const parsed = z
      .object({
        token: z.string().min(1),
        password: z.string().min(8).max(200),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'token and a password of at least 8 characters are required' });
      return;
    }
    const user = await consumeResetToken(parsed.data.token);
    if (!user) {
      response.status(400).json({ error: 'This reset link is invalid or has expired.' });
      return;
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await revokeAllRefreshTokens(user.id); // invalidate existing sessions on password change
    await recordAudit({
      actorId: user.id,
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: user.id,
    });
    const token = signToken({ sub: user.id, email: user.email });
    const refresh = await issueRefreshToken(user.id, user.email);
    response.json({ ok: true, token, refreshToken: refresh.token, user: { id: user.id, email: user.email } });
  }),
);
