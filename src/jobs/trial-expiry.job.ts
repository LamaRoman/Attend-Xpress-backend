// src/jobs/trial-expiry.job.ts
// ============================================================
// Runs daily at 8:00 AM Nepal time (UTC+5:45 = 02:15 UTC).
// Responsibilities:
//   - Sends 7-day trial warning email
//   - Sends 1-day trial warning email
//   - Flips TRIALING → GRACE_PERIOD when trial ends
//     (grace period expiry is handled by grace-period.job.ts)
// ============================================================
import cron from 'node-cron';
import prisma from '../lib/prisma';
import { SubscriptionStatus } from '@prisma/client';
import { emailService } from '../services/email.service';
import { invalidatePlanCache } from '../services/plan.service';
import { createLogger } from '../logger';

const log = createLogger('trial-expiry-job');

// ── Helpers ──────────────────────────────────────────────────

function daysFromNow(date: Date): number {
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ── Main job function ────────────────────────────────────────

export async function runTrialExpiryJob(): Promise<void> {
  log.info('Trial expiry job started');

  // ── Find all TRIALING subscriptions ────────────────────────
  const trialing = await prisma.orgSubscription.findMany({
    where: { status: SubscriptionStatus.TRIALING },
    include: {
      plan: {
        select: { gracePeriodDays: true, displayName: true },
      },
      organization: {
        select: {
          id: true,
          name: true,
          email: true,
          // Admin lookup via OrgMembership (not User.users)
          memberships: {
            where: { role: 'ORG_ADMIN', isActive: true, leftAt: null },
            select: {
              user: { select: { email: true, firstName: true } },
            },
            take: 1,
          },
        },
      },
    },
  });

  for (const sub of trialing) {
    try {
      if (!sub.trialEndsAt) continue;

      const org              = sub.organization;
      const adminMembership  = org.memberships[0];
      const adminEmail       = adminMembership?.user.email ?? org.email;
      const adminName        = adminMembership?.user.firstName ?? 'there';
      const daysLeft         = daysFromNow(sub.trialEndsAt);

      // ── Trial ended — enter grace period ─────────────────
      if (daysLeft <= 0) {
        const gracePeriodDays = sub.plan.gracePeriodDays ?? 7;
        const graceEndsAt = new Date(
          Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000
        );

        await prisma.$transaction(async (tx) => {
          await tx.orgSubscription.update({
            where: { id: sub.id },
            data: {
              status:      SubscriptionStatus.GRACE_PERIOD,
              graceEndsAt,
            },
          });

          await tx.subscriptionBillingLog.create({
            data: {
              subscriptionId: sub.id,
              organizationId: sub.organizationId,
              event: 'GRACE_PERIOD_STARTED',
              note: `Trial ended — grace period of ${gracePeriodDays} days started. Grace ends: ${graceEndsAt.toISOString().split('T')[0]}`,
            },
          });
        });

        invalidatePlanCache(org.id);

        await emailService.sendTrialExpiredNotice({
          to: adminEmail,
          orgName: org.name,
          adminName,
        });

        log.info(
          { orgId: org.id, orgName: org.name, graceEndsAt },
          'Trial ended — grace period started'
        );
        continue;
      }

      // ── 7-day warning ─────────────────────────────────────
      if (daysLeft <= 7 && !sub.trialReminderSentAt) {
        await emailService.sendTrialExpiryWarning({
          to: adminEmail,
          orgName: org.name,
          adminName,
          daysLeft,
          trialEndsAt: sub.trialEndsAt,
        });

        await prisma.orgSubscription.update({
          where: { id: sub.id },
          data: { trialReminderSentAt: new Date() },
        });

        log.info({ orgId: org.id, daysLeft }, '7-day trial warning sent');
      }

      // ── 1-day warning ─────────────────────────────────────
      if (daysLeft <= 1 && !sub.trialFinalReminderAt) {
        await emailService.sendTrialExpiryWarning({
          to: adminEmail,
          orgName: org.name,
          adminName,
          daysLeft: 1,
          trialEndsAt: sub.trialEndsAt,
        });

        await prisma.orgSubscription.update({
          where: { id: sub.id },
          data: { trialFinalReminderAt: new Date() },
        });

        log.info({ orgId: org.id }, '1-day trial warning sent');
      }

    } catch (err) {
      log.error({ err, subId: sub.id }, 'Error processing trialing subscription');
    }
  }

  log.info('Trial expiry job completed');
}

// ── Schedule ─────────────────────────────────────────────────

import { withJobAlerts } from './withJobAlerts';

export function startTrialExpiryJob(): void {
  cron.schedule('15 2 * * *', withJobAlerts('trial-expiry-job', runTrialExpiryJob));

  log.info('Trial expiry job scheduled — runs daily at 08:00 NPT');
}