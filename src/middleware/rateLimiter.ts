import rateLimit from 'express-rate-limit';
import { createLogger } from '../logger';

const log = createLogger('rate-limiter');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Rate limiter notes (reviewed 2026-05)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All limiters below use express-rate-limit's default in-memory store. That
 * means counters live in the Node process, not in shared storage. Two
 * implications worth flagging:
 *
 *   1. Per-IP limits are per-process. If we ever run more than one backend
 *      instance behind a load balancer, the effective limit becomes
 *      `max * instanceCount`. Today we run a single instance, so this is fine.
 *
 *   2. Counters reset on restart. A deploy clears them. Acceptable trade-off
 *      because deploys are infrequent enough that this isn't an attack vector.
 *
 * When to revisit:
 *   - Scaling to >1 backend instance (horizontal scale, blue/green, etc.)
 *   - Any single office exceeding ~400 employees sharing one WAN IP
 *   - A real incident where the current ceilings cause false positives
 *
 * Migration path when needed: add `rate-limit-redis` as the `store` option
 * on each limiter. Redis is already a dependency for scan-lockout and
 * lockout. See DEPLOYMENT.md "Known limits & future work" for the full
 * rationale.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Strict rate limit for login, password reset, forgot password.
 * Does NOT cover /refresh — see refreshRateLimiter below.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    error: {
      message: 'Too many login attempts. Please try again in 15 minutes.',
      code: 'RATE_LIMIT_AUTH',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    log.warn({ ip: req.ip, path: req.path }, 'Auth rate limit exceeded');
    res.status(429).json(options.message);
  },
});
/**
 * Token refresh rate limit — separate from login because /refresh is called
 * automatically by the app on every 401, not by the user manually.
 * Brute-force risk is low (requires a valid refresh token).
 * 60 per 15 min supports ~30 concurrent users refreshing tokens.
 */
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  message: {
    error: {
      message: 'Too many token refresh attempts. Please try again in 15 minutes.',
      code: 'RATE_LIMIT_REFRESH',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    log.warn({ ip: req.ip, path: req.path }, 'Refresh rate limit exceeded');
    res.status(429).json(options.message);
  },
});

/**
 * Rate limit for QR scan endpoint (public, unauthenticated)
 * 500 scans per 15 min per IP — supports a 500-employee office sharing one
 * WAN IP during morning clock-in rush (~33 scans/min sustained).
 */
export const scanRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: {
    error: {
      message: 'Too many scan attempts. Please try again later.',
      code: 'RATE_LIMIT_SCAN',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    log.warn({ ip: req.ip, path: req.path }, 'Scan rate limit exceeded');
    res.status(429).json(options.message);
  },
});

/**
 * General API rate limit — prevents abuse across all endpoints
 */
export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per 15 min per IP
  message: {
    error: {
      message: 'Too many requests. Please slow down.',
      code: 'RATE_LIMIT_GENERAL',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limit for field-tracking ping endpoint
 * Field staff pings every 10s while clocked in = 90 pings / 15min per user.
 * 2000 per 15 min supports ~20 field staff on a shared office WAN IP with
 * generous headroom for retries and network blips.
 */
export const pingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000,
  message: {
    error: {
      message: 'Too many ping requests.',
      code: 'RATE_LIMIT_PING',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});