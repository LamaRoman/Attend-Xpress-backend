-- Drop legacy HMAC signature column from QRCode.
--
-- The signature was retired in the PR 6 QR semantics rework
-- (migration 20260419130000_qr_semantics_rework). The column has
-- since been kept nullable for backward compatibility but is no
-- longer read or written by any code path. Dropping it now to keep
-- the schema clean before further changes accumulate around it.
--
-- This is a destructive migration. Per DEPLOYMENT.md §3, this should
-- only be deployed after confirming the column is unused in the
-- currently-running version (it has been since PR 6).

ALTER TABLE "qr_codes" DROP COLUMN IF EXISTS "signature";
