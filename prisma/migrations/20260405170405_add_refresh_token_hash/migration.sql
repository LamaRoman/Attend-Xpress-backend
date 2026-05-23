/*
  Warnings:

  - A unique constraint covering the columns `[refreshTokenHash]` on the table `user_sessions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "refreshTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshTokenHash_key" ON "user_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "user_sessions_refreshTokenHash_idx" ON "user_sessions"("refreshTokenHash");
