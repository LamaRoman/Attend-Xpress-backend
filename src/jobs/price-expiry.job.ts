// src/jobs/price-expiry.job.ts
// ============================================================
// Runs daily at 08:45 AM Nepal time (UTC+5:45 = 03:00 UTC).
// Finds subscriptions where customPriceExpiresAt <= now and
// reverts them to the plan's default price per employee.
// Logs the reversion to the billing log and invalidates cache.
// ============================================================

import cron from 'node-cron';
import prisma from '../lib/prisma';
import { invalidatePlanCache } from '../services/plan.service';
import { createLogger } from '../logger';
import { withJobAlerts } from './withJobAlerts';

const log = createLogger('price-expiry-job');

export async function runPriceExpiryJob(): Promise<void> {
  log.info('Price expiry job started');
  const now = new Date();

  try {
    const expired = await prisma.orgSubscription.findMany({
      where: {
        customPricePerEmployee: { not: null },
        customPriceExpiresAt:   { lte: now },
      },
      include: {
        organization: { select: { id: true, name: true } },
        plan: { select: { displayName: true, pricePerEmployee: true } },
      },
    });

    for (const sub of expired) {
      const oldPrice = Number(sub.customPricePerEmployee);
      const newPrice = Number(sub.plan.pricePerEmployee);

      await prisma.orgSubscription.update({
        where: { id: sub.id },
        data: {
          customPricePerEmployee: null,
          customPriceExpiresAt:   null,
        },
      });

      await prisma.subscriptionBillingLog.create({
        data: {
          subscriptionId: sub.id,
          organizationId: sub.organizationId,
          event: 'CUSTOM_PRICE_EXPIRED',
          note: `Discounted price (Rs. ${oldPrice}/emp) expired — reverted to plan default (Rs. ${newPrice}/emp) for ${sub.plan.displayName}`,
        },
      });

      invalidatePlanCache(sub.organizationId);

      log.info(
        { orgId: sub.organizationId, orgName: sub.organization.name, oldPrice, newPrice },
        'Custom price expired — reverted to plan default'
      );
    }

    log.info({ reverted: expired.length }, 'Price expiry job completed');
  } catch (err) {
    log.error({ err }, 'Price expiry job failed');
  }
}

export function startPriceExpiryJob(): void {
  // 03:00 UTC = 08:45 NPT
  cron.schedule(
    '0 3 * * *',
    withJobAlerts('price-expiry-job', runPriceExpiryJob, { severity: 'critical' }),
    { timezone: 'UTC' }
  );
  log.info('Price expiry job scheduled — daily at 08:45 NPT');
}
