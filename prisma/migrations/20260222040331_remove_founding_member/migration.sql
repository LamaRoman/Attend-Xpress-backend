/*
  Warnings:

  - You are about to drop the column `foundingMemberNote` on the `org_subscriptions` table. All the data in the column will be lost.
  - You are about to drop the column `isFoundingMember` on the `org_subscriptions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "org_subscriptions" DROP COLUMN "foundingMemberNote",
DROP COLUMN "isFoundingMember";
