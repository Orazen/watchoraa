import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/asyncHandler.js';
import { requireAdmin } from '../lib/auth.js';
import { recordAudit } from '../lib/audit.js';
import { prisma } from '../lib/prisma.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get(
  '/users',
  asyncHandler(async (_request, response) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    response.json({ users });
  }),
);

const roleSchema = z.object({ role: z.enum(['BLIND_USER', 'CAREGIVER', 'ADMIN']) });

adminRouter.patch(
  '/users/:id/role',
  asyncHandler(async (request, response) => {
    const parsed = roleSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request' });
      return;
    }

    const id = String(request.params.id);
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      response.status(404).json({ error: 'User not found' });
      return;
    }

    if (id === request.userId && parsed.data.role !== 'ADMIN') {
      response.status(400).json({ error: 'You cannot remove your own admin role' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { role: parsed.data.role },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    });
    await recordAudit({
      actorId: request.userId,
      action: 'admin.user.role_changed',
      entityType: 'User',
      entityId: user.id,
      metadata: { toRole: user.role },
    });
    response.json({ user });
  }),
);

const isActiveSchema = z.object({ isActive: z.boolean() });

adminRouter.patch(
  '/users/:id/active',
  asyncHandler(async (request, response) => {
    const parsed = isActiveSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request' });
      return;
    }

    const id = String(request.params.id);
    if (id === request.userId && !parsed.data.isActive) {
      response.status(400).json({ error: 'You cannot deactivate your own account' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      response.status(404).json({ error: 'User not found' });
      return;
    }

    const user = await prisma.user.update({
      where: { id },
      data: { isActive: parsed.data.isActive },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    });
    await recordAudit({
      actorId: request.userId,
      action: parsed.data.isActive ? 'admin.user.activated' : 'admin.user.deactivated',
      entityType: 'User',
      entityId: user.id,
      metadata: { email: user.email },
    });
    response.json({ user });
  }),
);

adminRouter.get(
  '/incidents',
  asyncHandler(async (_request, response) => {
    const incidents = await prisma.incidentReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { reporter: { select: { fullName: true, email: true } } },
    });
    response.json({ incidents });
  }),
);

adminRouter.delete(
  '/incidents/:id',
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const existing = await prisma.incidentReport.findUnique({ where: { id } });
    if (!existing) {
      response.status(404).json({ error: 'Incident not found' });
      return;
    }
    await prisma.incidentReport.delete({ where: { id } });
    await recordAudit({
      actorId: request.userId,
      action: 'admin.incident.deleted',
      entityType: 'IncidentReport',
      entityId: id,
      metadata: { category: existing.category, severity: existing.severity },
    });
    response.status(204).send();
  }),
);

adminRouter.get(
  '/assistance',
  asyncHandler(async (_request, response) => {
    const requests = await prisma.assistanceRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { fullName: true, email: true } } },
    });
    response.json({ requests });
  }),
);

adminRouter.get(
  '/ai-stats',
  asyncHandler(async (_request, response) => {
    const [total, successCount, demoCount, byMode, recentErrors, avgLatency] = await Promise.all([
      prisma.aIRequestLog.count(),
      prisma.aIRequestLog.count({ where: { success: true } }),
      prisma.aIRequestLog.count({ where: { provider: 'demo' } }),
      prisma.aIRequestLog.groupBy({ by: ['mode'], _count: { mode: true } }),
      prisma.aIRequestLog.findMany({
        where: { success: false },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, mode: true, errorMessage: true, createdAt: true },
      }),
      prisma.aIRequestLog.aggregate({ _avg: { latencyMs: true } }),
    ]);

    response.json({
      total,
      successCount,
      failureCount: total - successCount,
      demoCount,
      liveCount: total - demoCount,
      averageLatencyMs: avgLatency._avg.latencyMs != null ? Math.round(avgLatency._avg.latencyMs) : null,
      byMode: byMode.map((entry) => ({ mode: entry.mode, count: entry._count.mode })),
      recentErrors,
    });
  }),
);

// ── Prompt versioning (safety teams tune per-mode prompts; active version is used by /api/ai/generate) ──
const promptSchema = z.object({
  mode: z.enum(['NAVIGATION', 'ASSISTANT', 'READING', 'ENVIRONMENT', 'EMERGENCY']),
  prompt: z.string().min(1).max(20_000),
});

adminRouter.get(
  '/prompts',
  asyncHandler(async (_request, response) => {
    const prompts = await prisma.promptVersion.findMany({ orderBy: [{ mode: 'asc' }, { version: 'desc' }] });
    response.json({ prompts });
  }),
);

adminRouter.post(
  '/prompts',
  asyncHandler(async (request, response) => {
    const parsed = promptSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }
    const { mode, prompt } = parsed.data;
    const latest = await prisma.promptVersion.findFirst({ where: { mode }, orderBy: { version: 'desc' } });
    const nextVersion = (latest?.version ?? 0) + 1;
    const created = await prisma.promptVersion.create({ data: { mode, version: nextVersion, prompt } });
    await recordAudit({
      actorId: request.userId,
      action: 'admin.prompt.created',
      entityType: 'PromptVersion',
      entityId: created.id,
      metadata: { mode, version: nextVersion },
    });
    response.status(201).json({ prompt: created });
  }),
);

adminRouter.post(
  '/prompts/:id/activate',
  asyncHandler(async (request, response) => {
    const id = String(request.params.id);
    const target = await prisma.promptVersion.findUnique({ where: { id } });
    if (!target) {
      response.status(404).json({ error: 'Prompt version not found' });
      return;
    }
    // Deactivate all others in the same mode, then activate this one.
    await prisma.$transaction([
      prisma.promptVersion.updateMany({ where: { mode: target.mode }, data: { isActive: false } }),
      prisma.promptVersion.update({ where: { id }, data: { isActive: true } }),
    ]);
    await recordAudit({
      actorId: request.userId,
      action: 'admin.prompt.activated',
      entityType: 'PromptVersion',
      entityId: id,
      metadata: { mode: target.mode, version: target.version },
    });
    response.json({ ok: true, prompt: { ...target, isActive: true } });
  }),
);

// ── Incident moderation: set status (OPEN / REVIEWED / REMOVED) ──
const incidentStatusSchema = z.object({ status: z.enum(['OPEN', 'REVIEWED', 'REMOVED']) });

adminRouter.patch(
  '/incidents/:id/status',
  asyncHandler(async (request, response) => {
    const parsed = incidentStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Invalid status' });
      return;
    }
    const id = String(request.params.id);
    const existing = await prisma.incidentReport.findUnique({ where: { id } });
    if (!existing) {
      response.status(404).json({ error: 'Incident not found' });
      return;
    }
    const incident = await prisma.incidentReport.update({ where: { id }, data: { status: parsed.data.status } });
    await recordAudit({
      actorId: request.userId,
      action: `admin.incident.${parsed.data.status.toLowerCase()}`,
      entityType: 'IncidentReport',
      entityId: id,
      metadata: { from: existing.status },
    });
    response.json({ incident });
  }),
);
