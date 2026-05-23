/**
 * withJobAlerts — wraps a cron job runner with:
 *   1. Structured start/finish logging
 *   2. Top-level error capture
 *   3. Alerter notification on failure
 *
 * Use this as the function passed to `cron.schedule(...)`. It replaces
 * the old pattern of:
 *
 *   cron.schedule('15 2 * * *', async () => {
 *     try { await runX(); } catch (err) { log.error(...); }
 *   });
 *
 * with:
 *
 *   cron.schedule('15 2 * * *', withJobAlerts('x-job', runX));
 *
 * The wrapped function never throws — node-cron has unpredictable
 * behavior when a tick handler rejects, and a thrown error inside the
 * scheduler can mask the next scheduled run entirely.
 */

import { alerter, Severity } from '../lib/alerter';
import { createLogger } from '../logger';

interface WithJobAlertsOptions {
  /** Defaults to 'error'. Use 'critical' for billing/money-touching jobs. */
  severity?: Severity;
  /** Override the alert title. Defaults to "<jobName> failed". */
  title?: string;
}

export function withJobAlerts(
  jobName: string,
  run: () => Promise<unknown>,
  options: WithJobAlertsOptions = {}
): () => Promise<void> {
  const log = createLogger(jobName);

  return async () => {
    const startedAt = Date.now();
    log.info({ job: jobName }, 'Job started');

    try {
      await run();
      const durationMs = Date.now() - startedAt;
      log.info({ job: jobName, durationMs }, 'Job completed');
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      log.error({ err, job: jobName, durationMs }, 'Job failed');

      // Alerter never throws — but we wrap defensively anyway so a
      // truly catastrophic alerter failure can't kill the cron tick.
      try {
        await alerter.send({
          source: jobName,
          title: options.title ?? `${jobName} failed`,
          severity: options.severity ?? 'error',
          error: err,
          context: { durationMs },
        });
      } catch (alertErr) {
        log.error({ err: alertErr }, 'Alerter threw despite contract');
      }
    }
  };
}
