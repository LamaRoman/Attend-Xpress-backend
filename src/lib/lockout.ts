import { redisClient } from './redis';
import { createLogger } from '../logger';
import { AuthenticationError } from './errors';

const log = createLogger('lockout');

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes

// ── In-memory fallback ────────────────────────────────────────
const memoryStore = new Map<string, { count: number; lockedUntil: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [email, record] of memoryStore) {
    if (record.lockedUntil < now && record.count > 0) memoryStore.delete(email);
  }
}, 30 * 60 * 1000);
// ─────────────────────────────────────────────────────────────

function lockoutKey(email: string) {
  return `login:lockout:${email.toLowerCase()}`;
}

export async function checkLockout(email: string): Promise<void> {
  if (redisClient) {
    try {
      const raw = await redisClient.get(lockoutKey(email));
      if (!raw) return;
      const record = JSON.parse(raw);
      if (record.lockedUntil > Date.now()) {
        const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
        throw new AuthenticationError('Account locked. Try again in ' + mins + ' minute(s).');
      }
    } catch (err) {
      if (err instanceof AuthenticationError) throw err;
      log.error({ err }, 'Redis checkLockout failed - falling back to memory');
      checkLockoutMemory(email);
    }
  } else {
    checkLockoutMemory(email);
  }
}

export async function recordFailedAttempt(email: string): Promise<void> {
  if (redisClient) {
    try {
      const key = lockoutKey(email);
      const raw = await redisClient.get(key);
      const record = raw ? JSON.parse(raw) : { count: 0, lockedUntil: 0 };
      record.count++;
      if (record.count >= MAX_ATTEMPTS) {
        record.lockedUntil = Date.now() + LOCKOUT_DURATION_SECONDS * 1000;
        log.warn({ email, attempts: record.count }, 'Account locked after failed attempts');
      }
      await redisClient.set(key, JSON.stringify(record), 'EX', LOCKOUT_DURATION_SECONDS);
    } catch (err) {
      log.error({ err }, 'Redis recordFailedAttempt failed - falling back to memory');
      recordFailedAttemptMemory(email);
    }
  } else {
    recordFailedAttemptMemory(email);
  }
}

export async function clearFailedAttempts(email: string): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.del(lockoutKey(email));
    } catch (err) {
      log.error({ err }, 'Redis clearFailedAttempts failed - falling back to memory');
      memoryStore.delete(email);
    }
  } else {
    memoryStore.delete(email);
  }
}

function checkLockoutMemory(email: string): void {
  const record = memoryStore.get(email);
  if (record && record.lockedUntil > Date.now()) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    throw new AuthenticationError('Account locked. Try again in ' + mins + ' minute(s).');
  }
}

function recordFailedAttemptMemory(email: string): void {
  const record = memoryStore.get(email) || { count: 0, lockedUntil: 0 };
  record.count++;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_SECONDS * 1000;
  }
  memoryStore.set(email, record);
}
