// src/jobs/billing.job.ts
// ============================================================
// Runs daily at 08:30 AM Nepal time (UTC+5:45 = 02:45 UTC).
// Checks nextBillingDate on all active subscriptions and:
//   - Sends 7-day renewal reminder email
//   - Flips ACTIVE → PAST_DUE on billing date
//   - Flips PAST_DUE → SUSPENDED after grace period (configurable)
// ============================================================

import cron from 'node-cron';
import prisma from '../lib/prisma';
import { emailService } from '../services/email.service';
import { invalidatePlanCache } from '../services/plan.service';
import { createLogger } from '../logger';
import { withJobAlerts } from './withJobAlerts';

const log = createLogger('billing-job');

async function getGracePeriodDays(): Promise<number> {
  try {
    const config = await prisma.platformConfig.findUnique({
      where: { key: 'billing.grace_period_days' },
    });
    return config ? parseInt(config.value, 10) : 7;
  } catch {
    return 7; // safe default
  }
}

export async function runBillingJob(): Promise<void> {
  log.info('Billing job started');
  const now = new Date();
  const gracePeriodDays = await getGracePeriodDays();

  try {
    // ── 1. Send 7-day renewal reminder ───────────────────────
    const reminderThreshold = new Date(now);
    reminderThreshold.setDate(reminderThreshold.getDate() + 7);

    const dueSoon = await prisma.orgSubscription.findMany({
      where: {
        status: 'ACTIVE',
        nextBillingDate: { lte: reminderThreshold, gte: now },
        billingReminderSentAt: null,
      },
      include: {
        organization: { select: { name: true, email: true } },
        plan: { select: { displayName: true, pricePerEmployee: true } },
      },
    });

    for (const sub of dueSoon) {
      const daysUntilBilling = Math.ceil(
        (sub.nextBillingDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      const effectivePrice = sub.customPricePerEmployee !== null
        ? Number(sub.customPricePerEmployee)
        : sub.plan.pricePerEmployee;
      const amountDue = Number(effectivePrice) * sub.currentEmployeeCount;

      try {
        await emailService.sendBillingReminder({
          to: sub.organization.email ?? '',
          orgName: sub.organization.name,
          daysUntilBilling,
          amountDue,
          planName: sub.plan.displayName,
          billingDate: sub.nextBillingDate!,
          employeeCount: sub.currentEmployeeCount,
          pricePerEmployee: Number(effectivePrice),
        });

        await prisma.orgSubscription.update({
          where: { id: sub.id },
          data: { billingReminderSentAt: now },
        });

        log.info({ orgId: sub.organizationId, daysUntilBilling }, '7-day billing reminder sent');
      } catch (err) {
        log.error({ err, orgId: sub.organizationId }, 'Failed to send billing reminder');
      }
    }

    // ── 2. Flip ACTIVE → PAST_DUE on billing date ────────────
    const overdue = await prisma.orgSubscription.findMany({
      where: {
        status: 'ACTIVE',
        nextBillingDate: { lt: now },
      },
      include: {
        organization: { select: { name: true, email: true } },
        plan: { select: { displayName: true, pricePerEmployee: true } },
      },
    });

    for (const sub of overdue) {
      const effectivePrice = sub.customPricePerEmployee !== null
        ? Number(sub.customPricePerEmployee)
        : sub.plan.pricePerEmployee;
      const amountDue = Number(effectivePrice) * sub.currentEmployeeCount;

      await prisma.orgSubscription.update({
        where: { id: sub.id },
        data: { status: 'PAST_DUE' },
      });

      await prisma.subscriptionBillingLog.create({
        data: {
          subscriptionId: sub.id,
          organizationId: sub.organizationId,
          event: 'PAST_DUE',
          fromStatus: 'ACTIVE',
          toStatus: 'PAST_DUE',
          amount: amountDue,
          employeeCount: sub.currentEmployeeCount,
          note: `Auto-flagged past due. Grace period: ${gracePeriodDays} days.`,
        },
      });

      invalidatePlanCache(sub.organizationId);

      try {
        await emailService.sendPaymentDueNotice({
          to: sub.organization.email ?? '',
          orgName: sub.organization.name,
          amountDue,
          planName: sub.plan.displayName,
          employeeCount: sub.currentEmployeeCount,
          pricePerEmployee: Number(effectivePrice),
          gracePeriodDays,
        });
      } catch (err) {
        log.error({ err, orgId: sub.organizationId }, 'Failed to send payment due notice');
      }

      log.info({ orgId: sub.organizationId, amountDue }, 'Subscription flipped to PAST_DUE');
    }

    // ── 3. Flip PAST_DUE → SUSPENDED after grace period ──────
    const graceCutoff = new Date(now);
    graceCutoff.setDate(graceCutoff.getDate() - gracePeriodDays);

    const toSuspend = await prisma.orgSubscription.findMany({
      where: {
        status: 'PAST_DUE',
        nextBillingDate: { lt: graceCutoff },
      },
      include: {
        organization: { select: { name: true, email: true } },
      },
    });

    for (const sub of toSuspend) {
      await prisma.orgSubscription.update({
        where: { id: sub.id },
        data: { status: 'SUSPENDED' },
      });

      await prisma.subscriptionBillingLog.create({
        data: {
          subscriptionId: sub.id,
          organizationId: sub.organizationId,
          event: 'SUSPENDED',
          fromStatus: 'PAST_DUE',
          toStatus: 'SUSPENDED',
          note: `Auto-suspended after ${gracePeriodDays}-day grace period expired.`,
        },
      });

      invalidatePlanCache(sub.organizationId);

      try {
        await emailService.sendSuspensionNotice({
          to: sub.organization.email ?? '',
          orgName: sub.organization.name,
          gracePeriodDays,
        });
      } catch (err) {
        log.error({ err, orgId: sub.organizationId }, 'Failed to send suspension notice');
      }

      log.info({ orgId: sub.organizationId }, 'Subscription auto-suspended after grace period');
    }

    log.info({
      reminders: dueSoon.length,
      pastDue: overdue.length,
      suspended: toSuspend.length,
    }, 'Billing job completed');

  } catch (err) {
    log.error({ err }, 'Billing job failed');
  }
}

export function startBillingJob(): void {
  // 02:45 UTC = 08:30 NPT
  cron.schedule(
    '45 2 * * *',
    withJobAlerts('billing-job', runBillingJob, { severity: 'critical' }),
    { timezone: 'UTC' }
  );
  log.info('Billing job scheduled — daily at 08:30 NPT');
}
