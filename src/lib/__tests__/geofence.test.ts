/**
 * Phase 5 — geofence resolution tests.
 *
 * These exercise the pure {@link resolveGeofenceConfig} helper: given an
 * org config and an optional branch override, the function must produce the
 * effective config used by validateGeofence. No DB, no mocks — the helper
 * itself is pure, and the service-side wrapper that loads from Prisma is
 * tested via the existing attendance integration suite.
 */

import {
  resolveGeofenceConfig,
  OrgGeofenceConfig,
  BranchGeofenceOverride,
} from '../geofence';

const ORG: OrgGeofenceConfig = {
  geofenceEnabled: true,
  officeLat: 27.7172,
  officeLng: 85.324,
  geofenceRadius: 200,
};

describe('resolveGeofenceConfig', () => {
  describe('falls back to org', () => {
    it('returns org config when branch is null', () => {
      expect(resolveGeofenceConfig(ORG, null)).toEqual(ORG);
    });

    it('returns org config when branch has no coordinates', () => {
      const branch: BranchGeofenceOverride = {
        officeLat: null,
        officeLng: null,
        geofenceRadius: 50,
      };
      // Even though the branch has its own radius, without coords the
      // org-level fence (including org radius) is what applies.
      expect(resolveGeofenceConfig(ORG, branch)).toEqual(ORG);
    });

    it('returns org config when only latitude is set on branch', () => {
      const branch: BranchGeofenceOverride = {
        officeLat: 28.21,
        officeLng: null,
        geofenceRadius: 50,
      };
      expect(resolveGeofenceConfig(ORG, branch)).toEqual(ORG);
    });

    it('returns org config when only longitude is set on branch', () => {
      const branch: BranchGeofenceOverride = {
        officeLat: null,
        officeLng: 83.99,
        geofenceRadius: 50,
      };
      expect(resolveGeofenceConfig(ORG, branch)).toEqual(ORG);
    });
  });

  describe('uses branch coordinates', () => {
    it('uses branch coords + branch radius when both are set', () => {
      const branch: BranchGeofenceOverride = {
        officeLat: 28.2096,
        officeLng: 83.9856,
        geofenceRadius: 50,
      };
      expect(resolveGeofenceConfig(ORG, branch)).toEqual({
        geofenceEnabled: true,
        officeLat: 28.2096,
        officeLng: 83.9856,
        geofenceRadius: 50,
      });
    });

    it('uses branch coords but falls back to org radius when branch radius is null', () => {
      const branch: BranchGeofenceOverride = {
        officeLat: 28.2096,
        officeLng: 83.9856,
        geofenceRadius: null,
      };
      expect(resolveGeofenceConfig(ORG, branch)).toEqual({
        geofenceEnabled: true,
        officeLat: 28.2096,
        officeLng: 83.9856,
        geofenceRadius: 200, // org's radius
      });
    });

    it('always sources geofenceEnabled from the org, never the branch', () => {
      const disabledOrg: OrgGeofenceConfig = { ...ORG, geofenceEnabled: false };
      const branch: BranchGeofenceOverride = {
        officeLat: 28.2096,
        officeLng: 83.9856,
        geofenceRadius: 50,
      };
      const result = resolveGeofenceConfig(disabledOrg, branch);
      expect(result.geofenceEnabled).toBe(false);
    });
  });

  describe('regression — pre-Phase-5 behaviour preserved', () => {
    it('with no branch, the resolved config is identical to the org config', () => {
      // This is the critical safety property: clients that have not yet
      // populated branches (or whose membership predates the migration's
      // backfill) must see the exact same geofence behaviour as before.
      const result = resolveGeofenceConfig(ORG, null);
      expect(result).toBe(ORG);
    });

    it('with a Main Branch backfilled from org values, behaviour is unchanged', () => {
      // Per the Phase 1 migration, every org gets a Main Branch with the same
      // lat/lng/radius as the org. Resolution should produce a config that
      // matches the org config (different object, same values).
      const mainBranch: BranchGeofenceOverride = {
        officeLat: ORG.officeLat,
        officeLng: ORG.officeLng,
        geofenceRadius: ORG.geofenceRadius,
      };
      expect(resolveGeofenceConfig(ORG, mainBranch)).toEqual(ORG);
    });
  });
});
