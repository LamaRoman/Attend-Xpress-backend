-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "isManualEntry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modificationNote" TEXT,
ADD COLUMN     "modifiedAt" TIMESTAMP(3),
ADD COLUMN     "modifiedBy" TEXT,
ADD COLUMN     "originalCheckIn" TIMESTAMP(3),
ADD COLUMN     "originalCheckOut" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "workEndTime" TEXT NOT NULL DEFAULT '18:00',
ADD COLUMN     "workStartTime" TEXT NOT NULL DEFAULT '10:00',
ADD COLUMN     "workingDays" TEXT NOT NULL DEFAULT '0,1,2,3,4,5';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "shiftEndTime" TEXT,
ADD COLUMN     "shiftStartTime" TEXT;
