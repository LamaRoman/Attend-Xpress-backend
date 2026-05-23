-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "geofenceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "geofenceRadius" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "officeLat" DOUBLE PRECISION,
ADD COLUMN     "officeLng" DOUBLE PRECISION;
