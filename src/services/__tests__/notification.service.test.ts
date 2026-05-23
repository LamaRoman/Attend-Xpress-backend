import { NotificationService } from '../notification.service';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    notification: {
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    orgMembership: {
      findMany: jest.fn(),
    },
    organization: {
      findMany: jest.fn(),
    },
    systemConfig: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('../../logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import prisma from '../../lib/prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

function makeNotif(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    organizationId: 'org-1',
    type: 'LATE_ARRIVAL',
    title: 'Late Arrival: Jane',
    message: 'Jane arrived 15 minutes late at 09:15 AM',
    membershipId: 'mem-1',
    attendanceId: 'att-1',
    isRead: false,
    readAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

let service: NotificationService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new NotificationService();
});

// ─── createLateArrivalNotification ──────────────────────────────────────────

describe('createLateArrivalNotification', () => {
  it('builds title and message with correct minutesLate and formatted time', async () => {
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue(makeNotif());

    const checkIn = new Date('2026-01-15T09:15:00');
    await service.createLateArrivalNotification('org-1', 'mem-1', 'Jane Doe', 20, checkIn, 'att-1');

    const call = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
    expect(call.title).toBe('Late Arrival: Jane Doe');
    expect(call.message).toContain('20 minutes late');
    expect(call.type).toBe('LATE_ARRIVAL');
    expect(call.membershipId).toBe('mem-1');
    expect(call.attendanceId).toBe('att-1');
    expect(call.organizationId).toBe('org-1');
  });

  it('includes AM/PM formatted check-in time in the message', async () => {
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue(makeNotif());

    const checkIn = new Date('2026-01-15T14:30:00');
    await service.createLateArrivalNotification('org-1', 'mem-1', 'Bob', 5, checkIn, 'att-2');

    const { message } = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
    expect(message).toMatch(/02:30 PM|2:30 PM/i);
  });
});

// ─── notifyOrgStatusChanged ──────────────────────────────────────────────────

describe('notifyOrgStatusChanged', () => {
  it('creates one notification per admin with "Activated" copy when isActive=true', async () => {
    (mockPrisma.orgMembership.findMany as jest.Mock).mockResolvedValue([
      { id: 'mem-a' },
      { id: 'mem-b' },
    ]);
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue(makeNotif());

    await service.notifyOrgStatusChanged('org-1', true);

    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
    const firstCall = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
    expect(firstCall.title).toBe('Organization Activated');
    expect(firstCall.message).toContain('reactivated');
    expect(firstCall.type).toBe('ORG_STATUS_CHANGED');
  });

  it('uses "Deactivated" copy when isActive=false', async () => {
    (mockPrisma.orgMembership.findMany as jest.Mock).mockResolvedValue([{ id: 'mem-a' }]);
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue(makeNotif());

    await service.notifyOrgStatusChanged('org-1', false);

    const { title, message } = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
    expect(title).toBe('Organization Deactivated');
    expect(message).toContain('deactivated');
  });

  it('creates no notifications when org has no active admins', async () => {
    (mockPrisma.orgMembership.findMany as jest.Mock).mockResolvedValue([]);

    await service.notifyOrgStatusChanged('org-1', true);

    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
  });

  it('swallows errors and does not throw', async () => {
    (mockPrisma.orgMembership.findMany as jest.Mock).mockRejectedValue(new Error('db down'));

    await expect(service.notifyOrgStatusChanged('org-1', true)).resolves.toBeUndefined();
  });
});

// ─── notifyMasterHolidaysUpdated ─────────────────────────────────────────────

describe('notifyMasterHolidaysUpdated', () => {
  it('creates one notification per active org with the correct bsYear in title and message', async () => {
    (mockPrisma.organization.findMany as jest.Mock).mockResolvedValue([
      { id: 'org-1' },
      { id: 'org-2' },
      { id: 'org-3' },
    ]);
    (mockPrisma.notification.create as jest.Mock).mockResolvedValue(makeNotif());

    await service.notifyMasterHolidaysUpdated(2082);

    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(3);
    const call = (mockPrisma.notification.create as jest.Mock).mock.calls[0][0].data;
    expect(call.title).toContain('2082');
    expect(call.message).toContain('BS 2082');
    expect(call.type).toBe('MASTER_HOLIDAYS_UPDATED');
  });

  it('swallows errors and does not throw', async () => {
    (mockPrisma.organization.findMany as jest.Mock).mockRejectedValue(new Error('db down'));

    await expect(service.notifyMasterHolidaysUpdated(2082)).resolves.toBeUndefined();
  });
});

// ─── markAsRead (cross-org safety) ───────────────────────────────────────────

describe('markAsRead', () => {
  it('scopes update to both notificationId and organizationId', async () => {
    (mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    await service.markAsRead('notif-1', 'org-1');

    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'notif-1', organizationId: 'org-1' }),
      })
    );
  });

  it('a notification from another org is silently unaffected (count=0)', async () => {
    (mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    const result = await service.markAsRead('notif-other-org', 'org-1');

    expect((result as { count: number }).count).toBe(0);
  });
});

// ─── delete (cross-org safety) ───────────────────────────────────────────────

describe('delete', () => {
  it('scopes delete to both notificationId and organizationId', async () => {
    (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 1 });

    await service.delete('notif-1', 'org-1');

    expect(mockPrisma.notification.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'notif-1', organizationId: 'org-1' }),
      })
    );
  });
});

// ─── deleteOldNotifications ───────────────────────────────────────────────────

describe('deleteOldNotifications', () => {
  function setupOrgs(orgIds: string[], configValue?: string) {
    (mockPrisma.organization.findMany as jest.Mock).mockResolvedValue(
      orgIds.map((id) => ({ id }))
    );
    (mockPrisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(
      configValue !== undefined ? { value: configValue } : null
    );
    (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });
  }

  it('defaults to 30-day retention when no config exists', async () => {
    setupOrgs(['org-1']);

    await service.deleteOldNotifications();

    const where = (mockPrisma.notification.deleteMany as jest.Mock).mock.calls[0][0].where;
    const cutoff: Date = where.createdAt.lt;
    const daysAgo = Math.round((Date.now() - cutoff.getTime()) / 86_400_000);
    expect(daysAgo).toBeCloseTo(30, 0);
  });

  it('clamps retention to 7 days minimum even if config says 1', async () => {
    setupOrgs(['org-1'], '1');

    await service.deleteOldNotifications();

    const where = (mockPrisma.notification.deleteMany as jest.Mock).mock.calls[0][0].where;
    const daysAgo = Math.round((Date.now() - where.createdAt.lt.getTime()) / 86_400_000);
    expect(daysAgo).toBeCloseTo(7, 0);
  });

  it('clamps retention to 90 days maximum even if config says 999', async () => {
    setupOrgs(['org-1'], '999');

    await service.deleteOldNotifications();

    const where = (mockPrisma.notification.deleteMany as jest.Mock).mock.calls[0][0].where;
    const daysAgo = Math.round((Date.now() - where.createdAt.lt.getTime()) / 86_400_000);
    expect(daysAgo).toBeCloseTo(90, 0);
  });

  it('returns sum of deleted counts across all orgs', async () => {
    (mockPrisma.organization.findMany as jest.Mock).mockResolvedValue([
      { id: 'org-1' },
      { id: 'org-2' },
    ]);
    (mockPrisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);
    (mockPrisma.notification.deleteMany as jest.Mock)
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 7 });

    const total = await service.deleteOldNotifications();
    expect(total).toBe(10);
  });

  it('swallows top-level error and returns 0', async () => {
    (mockPrisma.organization.findMany as jest.Mock).mockRejectedValue(new Error('db down'));

    await expect(service.deleteOldNotifications()).resolves.toBe(0);
  });
});
