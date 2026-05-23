/**
 * Alerter — sends operational alerts to one or more channels.
 *
 * Designed to be extensible: today we ship a Slack channel, but the
 * `Channel` interface is small enough to add Sentry, PagerDuty, email,
 * or anything else without changing call sites.
 *
 * Critical invariants:
 *   1. `send` NEVER throws. The alerter is called from inside catch
 *      blocks; if it threw, it would mask the original error and
 *      potentially crash the cron scheduler.
 *   2. If no channels are configured, the alerter is a structured
 *      no-op that still logs at warn level. Local dev without env
 *      vars stays quiet but visible.
 *   3. Per-source rate limiting prevents a busted job from spamming
 *      a channel with one alert per cron tick.
 */

import { config } from '../config';
import { createLogger } from '../logger';

const log = createLogger('alerter');

// ── Public types ─────────────────────────────────────────────

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export interface AlertInput {
  /** A short, stable identifier — used for rate limiting. e.g. "billing-job". */
  source: string;
  /** One-line headline. e.g. "Billing job crashed". */
  title: string;
  severity?: Severity;
  /** The thrown value, if any. Stack will be extracted automatically. */
  error?: unknown;
  /** Arbitrary structured context. Will be JSON-stringified into the alert body. */
  context?: Record<string, unknown>;
}

interface NormalizedAlert {
  source: string;
  title: string;
  severity: Severity;
  errorMessage?: string;
  errorStack?: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

interface Channel {
  name: string;
  send(alert: NormalizedAlert): Promise<void>;
}

// ── Rate limiting ────────────────────────────────────────────

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes per source
const lastSentBySource = new Map<string, number>();

function isRateLimited(source: string): boolean {
  const last = lastSentBySource.get(source);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_MS;
}

function recordSend(source: string): void {
  lastSentBySource.set(source, Date.now());
}

// ── Slack channel ────────────────────────────────────────────

function makeSlackChannel(webhookUrl: string): Channel {
  const severityEmoji: Record<Severity, string> = {
    info: ':information_source:',
    warning: ':warning:',
    error: ':rotating_light:',
    critical: ':fire:',
  };

  return {
    name: 'slack',
    async send(alert) {
      const lines: string[] = [
        `${severityEmoji[alert.severity]} *${alert.title}*`,
        `_source:_ \`${alert.source}\`  _at:_ ${alert.timestamp}`,
      ];

      if (alert.errorMessage) {
        lines.push(`*Error:* \`${alert.errorMessage}\``);
      }

      if (alert.context && Object.keys(alert.context).length > 0) {
        lines.push('*Context:*');
        lines.push('```' + JSON.stringify(alert.context, null, 2) + '```');
      }

      if (alert.errorStack) {
        // Trim aggressively — Slack messages have a ~40k char limit
        // but anything past 20 stack frames is rarely useful.
        const trimmed = alert.errorStack.split('\n').slice(0, 20).join('\n');
        lines.push('*Stack:*');
        lines.push('```' + trimmed + '```');
      }

      const body = JSON.stringify({ text: lines.join('\n') });

      // 5s timeout — we don't want a slow Slack to back up the cron tick
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });

        if (!res.ok) {
          // Slack returns 200 "ok" on success and various 4xx codes for
          // bad webhooks. We log but don't throw — this method's contract
          // is "never throw".
          const text = await res.text().catch(() => '<no body>');
          log.error(
            { status: res.status, body: text.slice(0, 200) },
            'Slack webhook returned non-2xx'
          );
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ── Channel registry ─────────────────────────────────────────

const channels: Channel[] = [];

if (config.SLACK_ALERT_WEBHOOK_URL) {
  channels.push(makeSlackChannel(config.SLACK_ALERT_WEBHOOK_URL));
  log.info('Alerter: Slack channel registered');
} else {
  log.warn(
    'Alerter: no channels configured (set SLACK_ALERT_WEBHOOK_URL to enable Slack)'
  );
}

// ── Normalization ────────────────────────────────────────────

function normalize(input: AlertInput): NormalizedAlert {
  const err = input.error;
  let errorMessage: string | undefined;
  let errorStack: string | undefined;

  if (err instanceof Error) {
    errorMessage = err.message;
    errorStack = err.stack;
  } else if (err !== undefined && err !== null) {
    errorMessage = String(err);
  }

  return {
    source: input.source,
    title: input.title,
    severity: input.severity ?? 'error',
    errorMessage,
    errorStack,
    context: input.context,
    timestamp: new Date().toISOString(),
  };
}

// ── Public API ───────────────────────────────────────────────

export const alerter = {
  /**
   * Send an alert to all configured channels. NEVER throws — failures
   * are logged at error level. Rate-limited per source (5 min default).
   *
   * Use from inside catch blocks, after you've already done log.error
   * with the same context. The alerter is a notification, not a
   * replacement for structured logging.
   */
  async send(input: AlertInput): Promise<void> {
    try {
      // Always log the alert locally so it's discoverable in logs even
      // if every channel is down or unconfigured.
      log.warn(
        {
          source: input.source,
          severity: input.severity ?? 'error',
          context: input.context,
          err: input.error,
        },
        `[alert] ${input.title}`
      );

      if (channels.length === 0) return;

      if (isRateLimited(input.source)) {
        log.debug({ source: input.source }, 'Alert rate-limited');
        return;
      }

      const normalized = normalize(input);

      // Fan out to all channels in parallel; one failing channel
      // must not block the others.
      const results = await Promise.allSettled(
        channels.map((c) => c.send(normalized))
      );

      for (const [i, r] of results.entries()) {
        if (r.status === 'rejected') {
          log.error(
            { channel: channels[i].name, err: r.reason },
            'Alert channel failed'
          );
        }
      }

      // Record the send AFTER attempting — even if all channels failed,
      // we don't want to retry every minute. Better to be silent for 5
      // min and try again than to spam.
      recordSend(input.source);
    } catch (err) {
      // Belt-and-braces: anything in this method that could throw
      // (logger crash, stringification edge case) lands here.
      log.error({ err }, 'Alerter itself threw — alert lost');
    }
  },

  /** For tests. Returns true if at least one channel is registered. */
  isEnabled(): boolean {
    return channels.length > 0;
  },

  /** For tests. Resets the rate-limit window. */
  _resetRateLimits(): void {
    lastSentBySource.clear();
  },
};
