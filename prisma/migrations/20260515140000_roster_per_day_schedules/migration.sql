-- Migration: roster_schedules — replace workingDays/workStartTime/workEndTime
-- with a per-day daySchedules JSONB column.
--
-- Existing rows are converted by spreading the single start/end time across
-- every working day that was listed in the old workingDays column.
--
-- Example:
--   workingDays = "1,2,3,4,5"  workStartTime = "10:00"  workEndTime = "18:00"
--   becomes:
--   daySchedules = {"1":{"start":"10:00","end":"18:00"},
--                   "2":{"start":"10:00","end":"18:00"},
--                   ...}

-- 1. Add new column (nullable first so migration can populate it)
ALTER TABLE "roster_schedules" ADD COLUMN "daySchedules" JSONB;

-- 2. Populate from existing flat columns
UPDATE "roster_schedules"
SET "daySchedules" = (
  SELECT jsonb_object_agg(
    day::text,
    jsonb_build_object('start', "workStartTime", 'end', "workEndTime")
  )
  FROM unnest(string_to_array("workingDays", ',')) AS day
);

-- 3. Enforce NOT NULL after population
ALTER TABLE "roster_schedules" ALTER COLUMN "daySchedules" SET NOT NULL;

-- 4. Drop the old flat columns
ALTER TABLE "roster_schedules" DROP COLUMN "workingDays";
ALTER TABLE "roster_schedules" DROP COLUMN "workStartTime";
ALTER TABLE "roster_schedules" DROP COLUMN "workEndTime";
