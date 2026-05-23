// src/jobs/abandoned.job.ts
// ============================================================
// Runs daily at 9:00 AM Nepal time (UTC+5:45 = 03:15 UTC).
// Responsibilities:
//   - Reads `subscription.abandoned_after_days` from platform config
//   - Finds subscriptions SUSPENDED longer than that threshold
//   - Marks them EXPIRED (abandoned — recoverable only by super admin)
//   - Logs full audit trail
//
// The threshold is dynamically configurable by super admin via
// the Platform Config page — no code change or restart needed.
// ============================================================
import cron from 'node-cron';
import prisma from '../lib/prisma';
import { SubscriptionStatus } from '@prisma/client';
import { createLogger } from '../logger';
import { invalidatePlanCache } from '../services/plan.service';
import { withJobAlerts } from './withJobAlerts';

const log = createLogger('abandoned-job');

const PLATFORM_CONFIG_KEY = 'subscription.abandoned_after_days';
const FALLBACK_DAYS       = 60;

async function getAbandonedAfterDays(): Promise<number> {
  try {
    const config = await prisma.platformConfig.findUnique({
      where: { key: PLATFORM_CONFIG_KEY },
    });
    if (config) {
      const parsed = parseInt(config.value, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (err) {
    log.warn({ err }, `Could not read ${PLATFORM_CONFIG_KEY} — using fallback of ${FALLBACK_DAYS} days`);
  }
  return FALLBACK_DAYS;
}

export async function runAbandonedJob(): Promise<void> {
  log.info('Abandoned job started');

  const abandonedAfterDays = await getAbandonedAfterDays();
  const cutoffDate = new Date(Date.now() - abandonedAfterDays * 24 * 60 * 60 * 1000);

  log.info({ abandonedAfterDays, cutoffDate }, 'Checking for long-suspended subscriptions');

  const abandonedSubs = await prisma.orgSubscription.findMany({
    where: {
      status:      SubscriptionStatus.SUSPENDED,
      suspendedAt: { lte: cutoffDate },
    },
    include: {
      organization: { select: { id: true, name: true } },
    },
  });

  if (abandonedSubs.length === 0) {
    log.info('No abandoned subscriptions found');
    return;
  }

  log.info({ count: abandonedSubs.length }, 'Found abandoned subscriptions');

  for (const sub of abandonedSubs) {
    try {
      const daysSuspended = sub.suspendedAt
        ? Math.floor((Date.now() - sub.suspendedAt.getTime()) / (1000 * 60 * 60 * 24))
        : abandonedAfterDays;

      await prisma.$transaction(async (tx) => {
        await tx.orgSubscription.update({
          where: { id: sub.id },
          data:  { status: SubscriptionStatus.EXPIRED },
        });

        await tx.subscriptionBillingLog.create({
          data: {
            subscriptionId: sub.id,
            organizationId: sub.organizationId,
            event: 'EXPIRED_ABANDONED',
            note:  `Marked EXPIRED by system — suspended for ${daysSuspended} days (threshold: ${abandonedAfterDays} days). Suspended at: ${sub.suspendedAt?.toISOString().split('T')[0] ?? 'unknown'}`,
          },
        });
      });

      invalidatePlanCache(sub.organization.id);

      log.warn(
        { orgId: sub.organization.id, orgName: sub.organization.name, daysSuspended, abandonedAfterDays },
        'Subscription marked EXPIRED — abandoned'
      );

    } catch (err) {
      log.error({ err, subId: sub.id }, 'Error processing abandoned subscription');
    }
  }

  log.info({ processed: abandonedSubs.length }, 'Abandoned job completed');
}

export function startAbandonedJob(): void {
  cron.schedule('15 3 * * *', withJobAlerts('abandoned-job', runAbandonedJob));
  log.info('Abandoned job scheduled — runs daily at 09:00 NPT');
}
