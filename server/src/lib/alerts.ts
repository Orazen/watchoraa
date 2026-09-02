import { recordAudit } from './audit.js';
import { prisma } from './prisma.js';

/**
 * Best-effort email alerts to a user's trusted contacts for safety events
 * (SOS trigger, "I'm lost"). Never throws: notification failure must not
 * block or fail the safety request itself. Delivery outcomes are audited so
 * the operator can see whether alerts are actually reaching humans.
 */
export async function notifyTrustedContacts(
  userId: string,
  kind: 'SOS' | 'LOST',
  context: { journeyId?: string; sessionId?: string } = {},
): Promise<void> {
  try {
    const [user, contacts] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }),
      prisma.trustedContact.findMany({ where: { userId, email: { not: null } }, select: { email: true } }),
    ]);
    if (!user || contacts.length === 0) return;
    const recipients = contacts.map((c) => c.email as string);
    const { sendEmergencyAlertEmail } = await import('./notify.js');
    const results = await Promise.allSettled(
      recipients.map((to) => sendEmergencyAlertEmail(to, user.fullName || 'A person you assist', kind, { when: new Date().toISOString() })),
    );
    await recordAudit({
      actorId: userId,
      action: kind === 'SOS' ? 'emergency.contacts_notified' : 'safe_journey.contacts_notified',
      entityType: 'User',
      entityId: userId,
      metadata: {
        recipients: recipients.length,
        delivered: results.filter((r) => r.status === 'fulfilled' && r.value).length,
        smtpConfigured: Boolean(process.env.SMTP_HOST),
        journeyId: context.journeyId ?? null,
        sessionId: context.sessionId ?? null,
      },
    });
  } catch (error) {
    console.error('[notify] trusted-contact notification failed', error);
  }
}
