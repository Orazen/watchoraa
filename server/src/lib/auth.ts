import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { prisma } from './prisma.js';
import { recordAudit } from './audit.js';

export interface AuthTokenPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Short-lived access tokens: a stolen token stops working within the hour even
// if refresh tokens are never revoked. The SPA refreshes on 401, so a short TTL
// is transparent to users.
const ACCESS_TTL = '1h';
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function signToken(payload: Omit<AuthTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(payload: Omit<AuthTokenPayload, 'type'>): string {
  // jti (random id) makes every token unique — two tokens minted in the same
  // second would otherwise share iat/exp/sub and hash to the same stored hash.
  return jwt.sign({ ...payload, type: 'refresh', jti: randomBytes(16).toString('base64url') }, env.JWT_SECRET, { expiresIn: '90d' });
}

/** Issues a refresh token, persists its hash, and returns the raw token + id. */
export async function issueRefreshToken(userId: string, email: string): Promise<{ token: string; id: string }> {
  const token = signRefreshToken({ sub: userId, email });
  const row = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    },
  });
  return { token, id: row.id };
}

/**
 * Rotates a refresh token: verifies the raw token against its stored hash,
 * revokes the old row, and issues a fresh one. Returns null when invalid.
 */
export async function rotateRefreshToken(rawToken: string): Promise<{ token: string; id: string; userId: string } | null> {
  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(rawToken, env.JWT_SECRET) as AuthTokenPayload;
  } catch {
    return null;
  }
  if (payload.type !== 'refresh') return null;

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) return null;

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || !user.isActive) return null;

  // Revoke first via a conditional update so only ONE concurrent request with
  // this token can win; both requests passing a read-check would otherwise each
  // mint a fresh session. count === 0 means the token was already consumed —
  // the classic replay signature — so kill every session for this user.
  const revoked = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) {
    await revokeAllRefreshTokens(user.id);
    await recordAudit({
      actorId: user.id,
      action: 'auth.refresh_reuse_detected',
      entityType: 'User',
      entityId: user.id,
    }).catch(() => undefined);
    return null;
  }

  const next = await issueRefreshToken(user.id, user.email);
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { replacedByTokenId: next.id },
  });
  return { ...next, userId: user.id };
}

/** Revokes every refresh token for a user (logout-all / security). */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
}

export function newResetToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw), expiresAt: new Date(Date.now() + 60 * 60 * 1000) }; // 1 hour
}

/** Consumes a reset token and returns the user when valid; null otherwise. */
export async function consumeResetToken(rawToken: string): Promise<{ id: string; email: string } | null> {
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) return null;

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user || !user.isActive) return null;

  await prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return { id: user.id, email: user.email };
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    response.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length);
  let decoded: AuthTokenPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
  } catch {
    response.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  if (decoded.type !== 'access') {
    response.status(401).json({ error: 'Invalid token type' });
    return;
  }

  prisma.user
    .findUnique({ where: { id: decoded.sub }, select: { isActive: true } })
    .then((user) => {
      if (!user || !user.isActive) {
        response.status(401).json({ error: 'Account is deactivated' });
        return;
      }
      request.userId = decoded.sub;
      next();
    })
    .catch(next);
}

/** Attaches request.userId when a valid access token is present, but never rejects the request. */
export function optionalAuth(request: Request, _response: Response, next: NextFunction): void {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }

  try {
    const decoded = jwt.verify(header.slice('Bearer '.length), env.JWT_SECRET) as AuthTokenPayload;
    if (decoded.type === 'access') request.userId = decoded.sub;
  } catch {
    // Ignore invalid tokens on optional-auth routes; treat as anonymous.
  }
  next();
}

export function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    response.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  let decoded: AuthTokenPayload;
  try {
    decoded = jwt.verify(header.slice('Bearer '.length), env.JWT_SECRET) as AuthTokenPayload;
  } catch {
    response.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  if (decoded.type !== 'access') {
    response.status(401).json({ error: 'Invalid token type' });
    return;
  }

  prisma.user
    .findUnique({ where: { id: decoded.sub } })
    .then((user) => {
      if (!user || !user.isActive) {
        response.status(401).json({ error: 'Account is deactivated' });
        return;
      }
      if (user.role !== 'ADMIN') {
        response.status(403).json({ error: 'Admin access required' });
        return;
      }
      request.userId = decoded.sub;
      next();
    })
    .catch(next);
}
