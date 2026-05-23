import QRCode from 'qrcode';
import prisma from '../lib/prisma';
import { generateQRToken } from '../lib/crypto';
import { config } from '../config';
import { NotFoundError } from '../lib/errors';
import { createLogger } from '../logger';
import { JWTPayload } from '../lib/jwt';

const log = createLogger('qr-service');

// Rotating QR: expires 24h after creation. Not configurable for now.
const ROTATING_QR_EXPIRY_MS = 24 * 60 * 60 * 1000;

// Fallback default if Organization.staticQRExpiryDays is somehow null
// on an otherwise-valid row. Should match the schema default.
const DEFAULT_STATIC_EXPIRY_DAYS = 90;

/**
 * Compute expiresAt for a newly-created static QR based on the org's
 * configured staticQRExpiryDays. Returns null (no expiry) if the org
 * explicitly opted out by setting staticQRExpiryDays to 0 or a negative.
 */
async function resolveStaticExpiry(organizationId: string): Promise<Date | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { staticQRExpiryDays: true },
  });
  const days = org?.staticQRExpiryDays ?? DEFAULT_STATIC_EXPIRY_DAYS;
  if (days <= 0) return null; // org opted out of static-QR expiry
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export class QRService {
  /**
   * Generate a new rotating QR code (24h expiry) — revokes existing active codes.
   *
   * Q-03 fix: wrapped in a transaction to prevent two admins creating
   * duplicate active rotating QR codes on concurrent clicks.
   */
  async generate(currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;

    const qrCode = await prisma.$transaction(async (tx) => {
      // Revoke existing active non-static QR codes for this org
      await tx.qRCode.updateMany({
        where: { organizationId, status: 'ACTIVE', expiresAt: { not: null } },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });

      const token = generateQRToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ROTATING_QR_EXPIRY_MS);

      return tx.qRCode.create({
        data: {
          token,
          status: 'ACTIVE',
          expiresAt,
          lastRotatedAt: now,
          createdByMembershipId: currentUser.membershipId!,
          organizationId,
        },
        select: {
          id: true,
          token: true,
          status: true,
          scanCount: true,
          expiresAt: true,
          lastRotatedAt: true,
          createdAt: true,
        },
      });
    });

    const scanUrl = buildScanUrl(qrCode.token);
    const qrImage = await this.generateQRImage(scanUrl);

    log.info({ orgId: organizationId, qrId: qrCode.id }, 'QR code generated (rotating)');

    return { qrCode, scanUrl, qrImage };
  }

  /**
   * Generate a static QR code for the org. If an active static QR exists,
   * returns it unchanged (idempotent "show me" path). Admins who want a
   * fresh token must call regenerateStatic.
   *
   * A QR is considered "static" if either:
   *   - Legacy: expiresAt IS NULL (created before PR 6, grandfathered)
   *   - New:    lastRotatedAt IS NOT NULL AND expiresAt is further out than
   *             the rotating window (so we can't confuse it with a rotating)
   */
  async generateStatic(currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;

    const existing = await prisma.qRCode.findFirst({
      where: {
        organizationId,
        status: 'ACTIVE',
        OR: [
          { expiresAt: null },
          {
            AND: [
              { expiresAt: { gt: new Date(Date.now() + ROTATING_QR_EXPIRY_MS) } },
              { lastRotatedAt: { not: null } },
            ],
          },
        ],
      },
      select: {
        id: true,
        token: true,
        status: true,
        scanCount: true,
        expiresAt: true,
        lastRotatedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      const scanUrl = buildScanUrl(existing.token);
      const qrImage = await this.generateQRImage(scanUrl);
      const qrImageLarge = await this.generateQRImageLarge(scanUrl);
      return { qrCode: existing, scanUrl, qrImage, qrImageLarge, isExisting: true };
    }

    const token = generateQRToken();
    const now = new Date();
    const expiresAt = await resolveStaticExpiry(organizationId);

    const qrCode = await prisma.qRCode.create({
      data: {
        token,
        status: 'ACTIVE',
        expiresAt, // null = org opted out, else now + staticQRExpiryDays
        lastRotatedAt: now,
        createdByMembershipId: currentUser.membershipId!,
        organizationId,
      },
      select: {
        id: true,
        token: true,
        status: true,
        scanCount: true,
        expiresAt: true,
        lastRotatedAt: true,
        createdAt: true,
      },
    });

    const scanUrl = buildScanUrl(token);
    const qrImage = await this.generateQRImage(scanUrl);
    const qrImageLarge = await this.generateQRImageLarge(scanUrl);

    log.info({ orgId: organizationId, qrId: qrCode.id }, 'Static QR code generated');

    return { qrCode, scanUrl, qrImage, qrImageLarge, isExisting: false };
  }

  /**
   * Regenerate static QR — revokes old static and creates a new one.
   * Wrapped in transaction for atomicity.
   */
  async regenerateStatic(currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;
    const expiresAt = await resolveStaticExpiry(organizationId);

    const qrCode = await prisma.$transaction(async (tx) => {
      // Revoke existing static QRs (legacy null-expiry + new-style far-future).
      // Careful not to revoke rotating QRs here.
      await tx.qRCode.updateMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          OR: [
            { expiresAt: null },
            {
              AND: [
                { expiresAt: { gt: new Date(Date.now() + ROTATING_QR_EXPIRY_MS) } },
                { lastRotatedAt: { not: null } },
              ],
            },
          ],
        },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });

      const token = generateQRToken();
      const now = new Date();

      return tx.qRCode.create({
        data: {
          token,
          status: 'ACTIVE',
          expiresAt,
          lastRotatedAt: now,
          createdByMembershipId: currentUser.membershipId!,
          organizationId,
        },
        select: {
          id: true,
          token: true,
          status: true,
          scanCount: true,
          expiresAt: true,
          lastRotatedAt: true,
          createdAt: true,
        },
      });
    });

    const scanUrl = buildScanUrl(qrCode.token);
    const qrImage = await this.generateQRImage(scanUrl);
    const qrImageLarge = await this.generateQRImageLarge(scanUrl);

    log.info({ orgId: organizationId }, 'Static QR regenerated');

    return { qrCode, scanUrl, qrImage, qrImageLarge, isExisting: false };
  }

  /**
   * Get current active QR code(s) for the org.
   */
  async getActive(currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;

    const qrCode = await prisma.qRCode.findFirst({
      where: {
        organizationId,
        status: 'ACTIVE',
        OR: [
          { expiresAt: null }, // Legacy static QR — no expiry
          { expiresAt: { gt: new Date() } }, // Any QR that hasn't expired
        ],
      },
      select: {
        id: true,
        token: true,
        status: true,
        scanCount: true,
        expiresAt: true,
        lastRotatedAt: true,
        createdAt: true,
        createdByMembership: {
          select: {
            user: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!qrCode) {
      throw new NotFoundError('No active QR code found. Generate one first.');
    }

    const scanUrl = buildScanUrl(qrCode.token);
    const qrImage = await this.generateQRImage(scanUrl);

    // isStatic: legacy null-expiry OR lastRotatedAt-tagged far-future expiry
    const isStatic =
      qrCode.expiresAt === null ||
      (qrCode.lastRotatedAt !== null &&
        qrCode.expiresAt !== null &&
        qrCode.expiresAt.getTime() > Date.now() + ROTATING_QR_EXPIRY_MS);

    const { createdByMembership, ...rest } = qrCode;
    return {
      qrCode: {
        ...rest,
        createdBy: createdByMembership?.user || null,
      },
      scanUrl,
      qrImage,
      isStatic,
    };
  }

  /**
   * Revoke active QR code(s)
   */
  async revoke(currentUser: JWTPayload) {
    const organizationId = currentUser.organizationId!;

    const updated = await prisma.qRCode.updateMany({
      where: { organizationId, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    log.info({ orgId: organizationId, count: updated.count }, 'QR codes revoked');

    return { message: `${updated.count} QR code(s) revoked` };
  }

  private async generateQRImage(url: string): Promise<string> {
    return QRCode.toDataURL(url, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  }

  private async generateQRImageLarge(url: string): Promise<string> {
    return QRCode.toDataURL(url, {
      width: 800,
      margin: 3,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  }
}

/**
 * Build the scan URL. Only the token goes in the query string — the
 * legacy `signature` parameter is no longer generated. Older printed
 * QRs still work because the scan page tolerates unknown query params
 * and the backend validator no longer checks signatures.
 */
function buildScanUrl(token: string): string {
  return `${config.FRONTEND_URL}/scan?token=${token}`;
}

export const qrService = new QRService();
