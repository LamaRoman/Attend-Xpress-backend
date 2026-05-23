-- PR 6: QR semantics rework
--
-- 1. Make qr_codes.signature nullable. The HMAC signature is no longer
--    verified on scan (it was stored alongside the token, adding no
--    security). The column stays for one release for rollback safety;
--    a follow-up PR will drop it.
-- 2. Add qr_codes.lastRotatedAt for admin-UI display of static-QR
--    regeneration history.
-- 3. Add organizations.staticQRExpiryDays (default 90) so new static
--    QRs can't be replayed indefinitely if their URL leaks. Existing
--    static QRs have expiresAt=null and are grandfathered — admins
--    must click Regenerate to pick up the new expiry.

-- AlterTable
ALTER TABLE "qr_codes" ALTER COLUMN "signature" DROP NOT NULL;
ALTER TABLE "qr_codes" ADD COLUMN "lastRotatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "staticQRExpiryDays" INTEGER DEFAULT 90;
