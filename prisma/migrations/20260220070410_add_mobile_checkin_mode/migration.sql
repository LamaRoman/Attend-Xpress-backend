-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('QR_ONLY', 'MOBILE_ONLY', 'BOTH');

-- AlterEnum
ALTER TYPE "CheckInMethod" ADD VALUE 'MOBILE_CHECKIN';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "attendanceMode" "AttendanceMode" NOT NULL DEFAULT 'QR_ONLY';
