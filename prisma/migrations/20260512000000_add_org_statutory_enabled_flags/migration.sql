-- AlterTable: add super-admin-controlled statutory deduction flags to the
-- organization. Defaults to false so existing organizations show no statutory
-- deductions in their payroll UI until the super admin explicitly enables
-- each one per organization. These flag names mirror the per-employee
-- enabled flags on employee_pay_settings; the payroll engine applies a
-- deduction only when BOTH the org-level and the per-employee flag are true.
ALTER TABLE "organizations" ADD COLUMN     "ssfEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN     "pfEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN     "citEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN     "tdsEnabled" BOOLEAN NOT NULL DEFAULT false;
