/**
 * Scan lockout — per-employeeId brute-force protection for
 * scan-public and mobile-checkin endpoints.
 *
 * FIX S-03: The existing scanRateLimiter is per-IP. PINs are 4-6
 * digits (10k-1M combos). An attacker rotating IPs can brute-force
 * any employee's PIN. This module adds per-employeeId lockout.
 *
 * Backed by Redis with an in-memory fallback so single-instance
 * deployments still work without REDIS_URL configured. Pattern
 * mirrors `lib/lockout.ts` so failures degrade identically.
 */

import { redisClient } from './redis';
import { ValidationError } from './errors';
import { createLogger } from '../logger';

const log = createLogger('scan-lockout');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
const IDLE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface LockoutEntry {
  failedAttempts: number;
  lockedUntil: number | null;
  lastAttemptAt: number;
}

// ── In-memory fallback ────────────────────────────────────────
const memoryStore = new Map<string, LockoutEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    // Remove entries that have been idle for over an hour
    if (now - entry.lastAttemptAt > IDLE_TTL_MS) {
      memoryStore.delete(key);
    }
  }
}, 10 * 60 * 1000);
// ─────────────────────────────────────────────────────────────

function lockoutKey(employeeId: string): string {
  return `scan:lockout:${employeeId.toUpperCase()}`;
}

function normalize(employeeId: string): string {
  return employeeId.toUpperCase();
}

/**
 * Check if an employeeId is locked out. Throws if locked.
 */
export async function checkScanLockout(employeeId: string): Promise<void> {
  const key = normalize(employeeId);

  if (redisClient) {
    try {
      const raw = await redisClient.get(lockoutKey(employeeId));
      if (!raw) return;
      const entry: LockoutEntry = JSON.parse(raw);
      if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
        const remainingMinutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
        log.warn({ employeeId: key, remainingMinutes }, 'Scan attempt while locked out');
        throw new ValidationError(
          `Too many failed attempts. Try again in ${remainingMinutes} minute(s).`,
          'SCAN_LOCKED_OUT'
        );
      }
      return;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      log.error({ err }, 'Redis checkScanLockout failed - falling back to memory');
      checkScanLockoutMemory(key);
      return;
    }
  }

  checkScanLockoutMemory(key);
}

/**
 * Record a failed scan attempt (wrong PIN). Locks out after MAX_FAILED_ATTEMPTS.
 */
export async function recordFailedScanAttempt(employeeId: string): Promise<void> {
  const key = normalize(employeeId);

  if (redisClient) {
    try {
      const redisKey = lockoutKey(employeeId);
      const raw = await redisClient.get(redisKey);
      const entry: LockoutEntry = raw
        ? JSON.parse(raw)
        : { failedAttempts: 0, lockedUntil: null, lastAttemptAt: 0 };

      entry.failedAttempts += 1;
      entry.lastAttemptAt = Date.now();

      if (entry.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_DURATION_SECONDS * 1000;
        log.warn(
          { employeeId: key, attempts: entry.failedAttempts },
          'Employee scan locked out'
        );
      }

      await redisClient.set(redisKey, JSON.stringify(entry), 'EX', LOCKOUT_DURATION_SECONDS);
      return;
    } catch (err) {
      log.error({ err }, 'Redis recordFailedScanAttempt failed - falling back to memory');
      recordFailedScanAttemptMemory(key);
      return;
    }
  }

  recordFailedScanAttemptMemory(key);
}

/**
 * Clear failed attempts after a successful scan.
 */
export async function clearFailedScanAttempts(employeeId: string): Promise<void> {
  const key = normalize(employeeId);

  if (redisClient) {
    try {
      await redisClient.del(lockoutKey(employeeId));
      return;
    } catch (err) {
      log.error({ err }, 'Redis clearFailedScanAttempts failed - falling back to memory');
      memoryStore.delete(key);
      return;
    }
  }

  memoryStore.delete(key);
}

// ── Memory-only helpers ──────────────────────────────────────
function checkScanLockoutMemory(key: string): void {
  const entry = memoryStore.get(key);
  if (!entry) return;

  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const remainingMinutes = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    log.warn({ employeeId: key, remainingMinutes }, 'Scan attempt while locked out');
    throw new ValidationError(
      `Too many failed attempts. Try again in ${remainingMinutes} minute(s).`,
      'SCAN_LOCKED_OUT'
    );
  }

  // Lockout expired — reset
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    memoryStore.delete(key);
  }
}

function recordFailedScanAttemptMemory(key: string): void {
  const entry = memoryStore.get(key) || {
    failedAttempts: 0,
    lockedUntil: null,
    lastAttemptAt: 0,
  };

  entry.failedAttempts += 1;
  entry.lastAttemptAt = Date.now();

  if (entry.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_SECONDS * 1000;
    log.warn({ employeeId: key, attempts: entry.failedAttempts }, 'Employee scan locked out');
  }

  memoryStore.set(key, entry);
}
