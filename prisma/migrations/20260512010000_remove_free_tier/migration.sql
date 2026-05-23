-- Remove the STARTER (free) tier.
--
-- The free tier has been retired. After this migration, the only plan tier
-- is OPERATIONS — all orgs are on the paid plan, with subscription status
-- (TRIALING / ACTIVE / GRACE_PERIOD / PAST_DUE / SUSPENDED / CANCELLED /
-- EXPIRED) telling the rest of the story.
--
-- Migration order is critical:
--   1. Re-point every OrgSubscription on STARTER to OPERATIONS, granting a
--      fresh trial as a goodwill gesture (TRIALING + 30-day clock from now).
--   2. Delete the STARTER PricingPlan rows.
--   3. Drop the unused 'max_employees_free' SystemConfig key.
--   4. Recreate the TierName enum without STARTER. Postgres does not support
--      `ALTER TYPE ... DROP VALUE`, so we rename-create-cast-drop.

-- 1) Move STARTER subscribers to OPERATIONS with a fresh trial.
--    isTrialUsed is reset to false because the org never trialled OPERATIONS;
--    this is the goodwill grant. graceEndsAt and other lifecycle fields are
--    cleared so the orgs land on a clean trial state.
UPDATE "org_subscriptions"
SET
  "planId"                    = (
    SELECT "id" FROM "pricing_plans" WHERE "tier" = 'OPERATIONS' LIMIT 1
  ),
  "status"                    = 'TRIALING',
  "trialStartedAt"            = NOW(),
  "trialEndsAt"               = NOW() + INTERVAL '30 days',
  "isTrialUsed"               = FALSE,
  "graceEndsAt"               = NULL,
  "gracePeriodReminderSentAt" = NULL,
  "trialReminderSentAt"       = NULL,
  "trialFinalReminderAt"      = NULL,
  "billingReminderSentAt"     = NULL,
  "conversionNudgeSentAt"     = NULL,
  "suspendedAt"               = NULL
WHERE "planId" IN (SELECT "id" FROM "pricing_plans" WHERE "tier" = 'STARTER');

-- 2) Delete the STARTER plan row(s).
DELETE FROM "pricing_plans" WHERE "tier" = 'STARTER';

-- 3) Drop the unused 'max_employees_free' PlatformConfig key (free-tier residue).
DELETE FROM "platform_config" WHERE "key" = 'max_employees_free';

-- 4) Recreate the TierName enum without STARTER.
ALTER TYPE "TierName" RENAME TO "TierName_old";
CREATE TYPE "TierName" AS ENUM ('OPERATIONS');
ALTER TABLE "pricing_plans"
  ALTER COLUMN "tier" TYPE "TierName"
  USING "tier"::text::"TierName";
DROP TYPE "TierName_old";
