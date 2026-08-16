import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const auditRouter = Router();
auditRouter.use(requireAdmin);

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  action: z.string().max(100).optional(),
});

auditRouter.get(
  '/',
  asyncHandler(async (request, response) => {
    const parsed = listSchema.safeParse(request.query);
    const limit = parsed.success ? parsed.data.limit : 100;
    const action = parsed.success ? parsed.data.action : undefined;

    const rows = await prisma.auditLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: { email: true, fullName: true } } },
    });

    response.json({ logs: rows });
  }),
);
