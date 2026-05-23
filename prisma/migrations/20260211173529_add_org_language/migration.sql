-- CreateEnum
CREATE TYPE "Language" AS ENUM ('NEPALI', 'ENGLISH');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "language" "Language" NOT NULL DEFAULT 'NEPALI';
