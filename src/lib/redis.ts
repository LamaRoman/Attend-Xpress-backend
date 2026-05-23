import Redis from 'ioredis';
import { createLogger } from '../logger';

const log = createLogger('redis');

const REDIS_URL = process.env.REDIS_URL;

let redisClient: Redis | null = null;

if (REDIS_URL) {
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    tls: { rejectUnauthorized: false },
  });

  redisClient.on('connect', () => log.info('Redis connected'));
  redisClient.on('error', (err) => log.error({ err }, 'Redis error'));
} else {
  log.warn('REDIS_URL not set - falling back to in-memory lockout');
}

export { redisClient };
