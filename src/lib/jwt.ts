import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config';
import { AuthenticationError } from './errors';

export interface JWTPayload {
  userId: string;
  id: string;
  email: string;
  role: string;
  organizationId: string | null;
  membershipId: string | null; // null for SUPER_ADMIN (no org membership)
  branchId: string | null; // null for SUPER_ADMIN, ORG_ADMIN, and pre-Phase-6 sessions
}

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as any,
  });
}

export function verifyToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, config.JWT_SECRET) as JWTPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Token has expired', 'TOKEN_EXPIRED');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthenticationError('Invalid token', 'INVALID_TOKEN');
    }
    throw new AuthenticationError('Token verification failed', 'TOKEN_ERROR');
  }
}

// Hash the token for storage (we never store raw JWTs in DB)
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Calculate expiration date from JWT_EXPIRES_IN string
export function getTokenExpiration(): Date {
  const match = config.JWT_EXPIRES_IN.match(/^(\d+)([dhms])$/);
  if (!match) {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default 7 days
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return new Date(Date.now() + num * multipliers[unit]);
}