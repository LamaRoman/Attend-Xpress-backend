// src/jobs/grace-period.job.ts
// ============================================================
// Runs daily at 8:30 AM Nepal time (UTC+5:45 = 02:45 UTC).
// Responsibilities:
//   - Sends a mid-grace reminder email to orgs in GRACE_PERIOD
//   - When grace period expires, transitions the subscription to SUSPENDED.
//     There is no longer a free-tier downgrade path — the STARTER plan was
//     retired, so an org that doesn't pay by the end of grace gets
//     suspended regardless of employee count.
// ============================================================
import cron from 'node-cron';
import prisma from '../lib/prisma';
import { SubscriptionStatus } from '@prisma/client';
import { emailService } from '../services/email.service';
import { invalidatePlanCache } from '../services/plan.service';
import { createLogger } from '../logger';

const log = createLogger('grace-period-job');

// ── Main job function ────────────────────────────────────────

export async function runGracePeriodJob(): Promise<void> {
  log.info('Grace period job started');

  // ── Find all GRACE_PERIOD subscriptions ────────────────────
  const graceSubs = await prisma.orgSubscription.findMany({
    where: { status: SubscriptionStatus.GRACE_PERIOD },
    include: {
      plan: {
        select: { displayName: true },
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

  const now = new Date();

  for (const sub of graceSubs) {
    try {
      const org        = sub.organization;
      const adminMembership = org.memberships[0];
      const adminEmail = adminMembership?.user.email ?? org.email;
      const adminName  = adminMembership?.user.firstName ?? 'there';

      // ── Send mid-grace reminder (once, when halfway through) ─
      if (!sub.gracePeriodReminderSentAt && sub.graceEndsAt) {
        const totalGraceMs = sub.graceEndsAt.getTime() - (sub.trialEndsAt?.getTime() ?? now.getTime());
        const halfwayAt    = new Date((sub.trialEndsAt?.getTime() ?? now.getTime()) + totalGraceMs / 2);

        if (now >= halfwayAt) {
          const daysLeft = Math.max(
            0,
            Math.ceil((sub.graceEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          );

          await emailService.sendTrialExpiredNotice({
            to: adminEmail,
            orgName: org.name,
            adminName,
          });

          await prisma.orgSubscription.update({
            where: { id: sub.id },
            data: { gracePeriodReminderSentAt: now },
          });

          log.info({ orgId: org.id, daysLeft }, 'Mid-grace reminder sent');
        }
      }

      // ── Grace period not yet expired — skip ──────────────────
      if (!sub.graceEndsAt || now < sub.graceEndsAt) continue;

      // ── Grace period expired — suspend the subscription ──────
      // Previously, orgs with employees ≤ Starter threshold were quietly
      // downgraded to the STARTER (free) plan. STARTER has been retired,
      // so every unpaid org now lands on SUSPENDED regardless of size.
      const employeeCount = sub.currentEmployeeCount;

      await prisma.$transaction(async (tx) => {
        await tx.orgSubscription.update({
          where: { id: sub.id },
          data: {
            status:                   SubscriptionStatus.SUSPENDED,
            suspendedAt:              now,
            graceEndsAt:              null,
            gracePeriodReminderSentAt: null,
          },
        });

        await tx.subscriptionBillingLog.create({
          data: {
            subscriptionId: sub.id,
            organizationId: sub.organizationId,
            event: 'SUSPENDED_GRACE_EXPIRED',
            note: `Grace period expired — subscription suspended (${employeeCount} employees). Payment required to reactivate.`,
          },
        });
      });

      invalidatePlanCache(org.id);

      log.warn(
        { orgId: org.id, orgName: org.name, employeeCount },
        'Grace expired — subscription suspended'
      );

    } catch (err) {
      log.error({ err, subId: sub.id }, 'Error processing grace period subscription');
    }
  }

  log.info('Grace period job completed');
}

// ── Schedule ─────────────────────────────────────────────────

import { withJobAlerts } from './withJobAlerts';

export function startGracePeriodJob(): void {
  cron.schedule(
    '45 2 * * *',
    withJobAlerts('grace-period-job', runGracePeriodJob, { severity: 'critical' })
  );

  log.info('Grace period job scheduled — runs daily at 08:30 NPT');
}