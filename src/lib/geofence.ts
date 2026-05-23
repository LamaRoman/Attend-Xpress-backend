/**
 * Geofence validation — centralised logic for all attendance endpoints.
 *
 * Fixes applied:
 *   G-01: Throw when geofenceEnabled=true but coordinates are null
 *   G-02: Reject low-accuracy GPS readings
 *   G-04: Don't reveal exact distance in user-facing errors
 *   S-07: Return distance + coords for audit logging
 */

import { ValidationError } from './errors';
import { createLogger } from '../logger';

const log = createLogger('geofence');

/** Haversine distance in metres between two lat/lng points. */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in metres
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeofenceInput {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null; // GPS accuracy in metres from the device
}

export interface OrgGeofenceConfig {
  geofenceEnabled: boolean;
  officeLat: number | null;
  officeLng: number | null;
  geofenceRadius: number; // metres
}

export interface GeofenceResult {
  passed: boolean;
  distanceMetres: number | null;
  claimedLat: number | null;
  claimedLng: number | null;
  claimedAccuracy: number | null;
}

/**
 * Validate geofence for an attendance action.
 *
 * Returns a GeofenceResult that callers should include in audit logs.
 * Throws ValidationError if the check fails.
 *
 * If geofencing is disabled for the org, returns a passing result immediately.
 */
export function validateGeofence(
  org: OrgGeofenceConfig,
  input: GeofenceInput
): GeofenceResult {
  // Geofencing disabled — always pass
  if (!org.geofenceEnabled) {
    return {
      passed: true,
      distanceMetres: null,
      claimedLat: input.latitude ?? null,
      claimedLng: input.longitude ?? null,
      claimedAccuracy: input.accuracy ?? null,
    };
  }

  // FIX G-01: geofencing enabled but office coordinates not configured
  if (org.officeLat == null || org.officeLng == null) {
    log.error({ org }, 'Geofencing enabled but office coordinates are null');
    throw new ValidationError(
      'Geofencing is enabled but office location is not configured. Please contact your administrator.',
      'GEOFENCE_NOT_CONFIGURED'
    );
  }

  // GPS coordinates required when geofencing is on
  if (input.latitude == null || input.longitude == null) {
    throw new ValidationError(
      'Location is required. Please enable GPS on your device.',
      'LOCATION_REQUIRED'
    );
  }

  // FIX G-02: reject low-accuracy readings
  const maxAcceptableAccuracy = Math.max(org.geofenceRadius, 150); // at least 150m tolerance
  if (input.accuracy != null && input.accuracy > maxAcceptableAccuracy) {
    throw new ValidationError(
      'GPS signal is too weak. Please move to an open area and try again.',
      'GPS_LOW_ACCURACY'
    );
  }

  const distance = calculateDistance(
    input.latitude,
    input.longitude,
    org.officeLat,
    org.officeLng
  );

  const radius = org.geofenceRadius || 100;

  if (distance > radius) {
    // FIX G-04: generic message — don't reveal exact distance to the user
    log.info(
      {
        claimedLat: input.latitude,
        claimedLng: input.longitude,
        distance: Math.round(distance),
        radius,
      },
      'Geofence check failed'
    );
    throw new ValidationError(
      'You are outside the allowed check-in area. Please move closer to the office and try again.',
      'OUTSIDE_GEOFENCE'
    );
  }

  return {
    passed: true,
    distanceMetres: Math.round(distance),
    claimedLat: input.latitude,
    claimedLng: input.longitude,
    claimedAccuracy: input.accuracy ?? null,
  };
}

/**
 * A branch's geofence override. Any field may be null:
 *   - officeLat/officeLng null → branch has no location set, fall back to org
 *   - geofenceRadius null → use the org's radius for this branch
 */
export interface BranchGeofenceOverride {
  officeLat: number | null;
  officeLng: number | null;
  geofenceRadius: number | null;
}

/**
 * Resolve the effective geofence config for an attendance action.
 *
 * Per the multi-branch design:
 *   - If the employee's branch has its own office coordinates set, use those.
 *   - The branch's radius is used if set, otherwise we fall back to the org's
 *     radius.
 *   - If the branch has no coordinates (or no branch at all), behaviour is
 *     identical to the pre-branch world: the org's config is used as-is.
 *
 * `geofenceEnabled` is always sourced from the org — branches do not opt
 * individual employees out of geofencing.
 */
export function resolveGeofenceConfig(
  org: OrgGeofenceConfig,
  branch: BranchGeofenceOverride | null
): OrgGeofenceConfig {
  if (!branch || branch.officeLat == null || branch.officeLng == null) {
    return org;
  }
  return {
    geofenceEnabled: org.geofenceEnabled,
    officeLat: branch.officeLat,
    officeLng: branch.officeLng,
    geofenceRadius: branch.geofenceRadius ?? org.geofenceRadius,
  };
}