/**
 * documents.service tests
 *
 * The most security-critical of the service test suite. Per the
 * 2026-05-02 code review: every function in here makes per-org and
 * per-employee access decisions, and a leak in any of them is a data
 * breach (employees seeing each other's documents, admins from one
 * org accessing another org's files).
 *
 * Coverage focus:
 *   - Cross-org isolation: every function rejects (with 404, never 403)
 *     when the document or target user belongs to a different org.
 *   - EMPLOYEE role: can only act on their own documents (membershipId
 *     match), 403 otherwise.
 *   - Magic-byte validation: declared MIME must match file content.
 *     Rejecting a "PNG" with PDF bytes is the canonical defence.
 *   - Quota enforcement: per-employee 20MB cap aggregated correctly.
 *   - Best-effort S3 cleanup on delete: DB row gets removed even when
 *     S3 errors, so we don't end up with orphan DB rows.
 *
 * Strategy: prisma, s3Client, getSignedUrl, and fs are all mocked.
 * No actual disk I/O or network calls.
 */

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    orgMembership: {
      findFirst: jest.fn(),
    },
    documentType: {
      findUnique: jest.fn(),
    },
    employeeDocument: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock('../../lib/s3', () => ({
  s3Client: { send: jest.fn() },
  S3_BUCKET: 'test-bucket',
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

jest.mock('fs', () => {
  const fns = {
    readFileSync: jest.fn(),
    existsSync: jest.fn().mockReturnValue(true),
    unlinkSync: jest.fn(),
  };
  return {
    __esModule: true,
    default: fns,
    ...fns,
  };
});

jest.mock('uuid', () => ({
  v4: jest.fn().mockReturnValue('00000000-0000-0000-0000-000000000000'),
}));

import {
  uploadDocument,
  listDocuments,
  getDocumentForDownload,
  deleteDocument,
} from '../documents.service';

// ── Constants & helpers ─────────────────────────────────────

const ORG_ID = 'org-1';
const OTHER_ORG_ID = 'org-2';
const TARGET_USER_ID = 'user-target';
const TARGET_MEMBERSHIP_ID = 'mem-target';
const ADMIN_ID = 'user-admin';
const EMPLOYEE_ID = 'user-employee';
const EMPLOYEE_MEMBERSHIP_ID = 'mem-employee';
const DOC_TYPE_ID = 'doctype-1';
const DOC_ID = 'doc-1';

// File magic-byte signatures (matching the source)
const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function makeFile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    path: '/tmp/upload-abc',
    originalname: 'document.pdf',
    mimetype: 'application/pdf',
    size: 1024,
    ...overrides,
  } as any;
}

function makeUploadParams(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: TARGET_USER_ID,
    uploaderId: ADMIN_ID,
    uploaderRole: 'ORG_ADMIN' as any,
    uploaderOrgId: ORG_ID,
    file: makeFile(),
    documentTypeId: DOC_TYPE_ID,
    description: 'Test',
    ...overrides,
  };
}

let mockPrisma: any;
let mockS3: any;
let mockSigner: any;
let mockFs: any;

beforeEach(() => {
  jest.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockPrisma = require('@/lib/prisma').default;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockS3 = require('../../lib/s3').s3Client;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockSigner = require('@aws-sdk/s3-request-presigner');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mockFs = require('fs').default;
});

// ── uploadDocument ──────────────────────────────────────────

describe('uploadDocument', () => {
  beforeEach(() => {
    mockPrisma.orgMembership.findFirst.mockResolvedValue({
      id: TARGET_MEMBERSHIP_ID,
      userId: TARGET_USER_ID,
    });
    mockPrisma.documentType.findUnique.mockResolvedValue({
      id: DOC_TYPE_ID,
      organizationId: ORG_ID,
      isActive: true,
    });
    mockPrisma.employeeDocument.aggregate.mockResolvedValue({ _sum: { fileSize: 0 } });
    mockPrisma.employeeDocument.create.mockResolvedValue({
      id: DOC_ID,
      originalName: 'document.pdf',
    });
    mockS3.send.mockResolvedValue({});
    mockFs.readFileSync.mockReturnValue(PDF_BYTES);
  });

  it('rejects with 404 when target user does not exist in this org', async () => {
    // Cross-org leak protection: findFirst is scoped to the uploader's
    // org, so a userId from another org will return null even if the
    // user exists in the system.
    mockPrisma.orgMembership.findFirst.mockResolvedValue(null);

    await expect(uploadDocument(makeUploadParams())).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('not found'),
    });
  });

  it('rejects with 403 when EMPLOYEE tries to upload for someone else', async () => {
    await expect(
      uploadDocument(makeUploadParams({
        uploaderRole: 'EMPLOYEE',
        uploaderId: EMPLOYEE_ID,
        uploaderMembershipId: EMPLOYEE_MEMBERSHIP_ID,
        // userId resolves to TARGET_MEMBERSHIP_ID, not EMPLOYEE_MEMBERSHIP_ID
      }))
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows EMPLOYEE to upload for themselves', async () => {
    mockPrisma.orgMembership.findFirst.mockResolvedValue({
      id: EMPLOYEE_MEMBERSHIP_ID,
      userId: EMPLOYEE_ID,
    });

    const result = await uploadDocument(makeUploadParams({
      userId: EMPLOYEE_ID,
      uploaderRole: 'EMPLOYEE',
      uploaderId: EMPLOYEE_ID,
      uploaderMembershipId: EMPLOYEE_MEMBERSHIP_ID,
    }));

    expect(result).toBeDefined();
    expect(mockS3.send).toHaveBeenCalled();
  });

  it('rejects when document type belongs to a different org (cross-org)', async () => {
    mockPrisma.documentType.findUnique.mockResolvedValue({
      id: DOC_TYPE_ID,
      organizationId: OTHER_ORG_ID, // different org
      isActive: true,
    });

    await expect(uploadDocument(makeUploadParams())).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('Invalid document type'),
    });
  });

  it('rejects inactive document type', async () => {
    mockPrisma.documentType.findUnique.mockResolvedValue({
      id: DOC_TYPE_ID,
      organizationId: ORG_ID,
      isActive: false,
    });

    await expect(uploadDocument(makeUploadParams())).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('no longer active'),
    });
  });

  it('rejects disallowed mime types', async () => {
    await expect(
      uploadDocument(makeUploadParams({
        file: makeFile({ mimetype: 'application/x-msdownload' }),
      }))
    ).rejects.toMatchObject({ status: 400 });
    expect(mockFs.unlinkSync).toHaveBeenCalled(); // temp file cleaned up
  });

  it('rejects when magic bytes do not match declared MIME (PDF claimed, PNG bytes)', async () => {
    // The canonical attack: a malicious user uploads a PNG (or executable)
    // with a .pdf filename + application/pdf MIME. Magic-byte check is
    // the only thing standing between that and S3.
    mockFs.readFileSync.mockReturnValue(PNG_BYTES);

    await expect(
      uploadDocument(makeUploadParams({
        file: makeFile({ mimetype: 'application/pdf' }),
      }))
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('does not match'),
    });
    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.employeeDocument.create).not.toHaveBeenCalled();
  });

  it('accepts PNG with correct magic bytes', async () => {
    mockFs.readFileSync.mockReturnValue(PNG_BYTES);
    await expect(
      uploadDocument(makeUploadParams({
        file: makeFile({ mimetype: 'image/png', originalname: 'photo.png' }),
      }))
    ).resolves.toBeDefined();
    expect(mockS3.send).toHaveBeenCalled();
  });

  it('accepts JPEG with correct magic bytes', async () => {
    mockFs.readFileSync.mockReturnValue(JPEG_BYTES);
    await expect(
      uploadDocument(makeUploadParams({
        file: makeFile({ mimetype: 'image/jpeg', originalname: 'photo.jpg' }),
      }))
    ).resolves.toBeDefined();
  });

  it('rejects file larger than 5MB', async () => {
    await expect(
      uploadDocument(makeUploadParams({
        file: makeFile({ size: 6 * 1024 * 1024 }),
      }))
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('5MB'),
    });
  });

  it('rejects when employee total storage would exceed 20MB cap', async () => {
    mockPrisma.employeeDocument.aggregate.mockResolvedValue({
      _sum: { fileSize: 19 * 1024 * 1024 },
    });
    await expect(
      uploadDocument(makeUploadParams({
        file: makeFile({ size: 2 * 1024 * 1024 }), // 19 + 2 = 21MB > 20MB cap
      }))
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('20MB'),
    });
  });

  it('cleans up temp file and rejects when S3 upload fails', async () => {
    mockS3.send.mockRejectedValue(new Error('S3 unreachable'));

    await expect(uploadDocument(makeUploadParams())).rejects.toMatchObject({
      status: 500,
    });
    expect(mockFs.unlinkSync).toHaveBeenCalled();
    expect(mockPrisma.employeeDocument.create).not.toHaveBeenCalled();
  });

  it('writes the S3 key as fileName, never the user-provided original name', async () => {
    // Sanity check: the S3 key (which is what the DB stores in fileName)
    // must include sanitized characters and the orgId/membershipId
    // path prefix. Storing the raw original name would let attackers
    // write to arbitrary keys.
    await uploadDocument(makeUploadParams({
      file: makeFile({ originalname: '../../etc/passwd' }),
    }));

    const createArg = mockPrisma.employeeDocument.create.mock.calls[0][0];
    expect(createArg.data.fileName).toMatch(
      new RegExp(`^${ORG_ID}/documents/${TARGET_MEMBERSHIP_ID}/`)
    );
    // Path-traversal chars must not survive sanitization
    expect(createArg.data.fileName).not.toContain('..');
    expect(createArg.data.fileName).not.toContain('/etc/');
    // Original name preserved separately for display
    expect(createArg.data.originalName).toBe('../../etc/passwd');
  });
});

// ── listDocuments ───────────────────────────────────────────

describe('listDocuments', () => {
  beforeEach(() => {
    mockPrisma.orgMembership.findFirst.mockResolvedValue({
      id: TARGET_MEMBERSHIP_ID,
    });
    mockPrisma.employeeDocument.findMany.mockResolvedValue([]);
  });

  it('rejects with 404 when target user is not in requester org', async () => {
    mockPrisma.orgMembership.findFirst.mockResolvedValue(null);

    await expect(
      listDocuments({
        userId: TARGET_USER_ID,
        requesterRole: 'ORG_ADMIN' as any,
        requesterOrgId: ORG_ID,
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('rejects with 403 when EMPLOYEE views another employee', async () => {
    await expect(
      listDocuments({
        userId: TARGET_USER_ID,
        requesterRole: 'EMPLOYEE' as any,
        requesterOrgId: ORG_ID,
        requesterMembershipId: EMPLOYEE_MEMBERSHIP_ID,
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('allows EMPLOYEE to view their own documents', async () => {
    mockPrisma.orgMembership.findFirst.mockResolvedValue({
      id: EMPLOYEE_MEMBERSHIP_ID,
    });

    await expect(
      listDocuments({
        userId: EMPLOYEE_ID,
        requesterRole: 'EMPLOYEE' as any,
        requesterOrgId: ORG_ID,
        requesterMembershipId: EMPLOYEE_MEMBERSHIP_ID,
      })
    ).resolves.toEqual([]);
  });

  it('scopes the DB query to both membershipId and organizationId', async () => {
    // Defence in depth: even if membershipId resolution is wrong, the
    // org filter on the document query keeps cross-org reads impossible.
    await listDocuments({
      userId: TARGET_USER_ID,
      requesterRole: 'ORG_ADMIN' as any,
      requesterOrgId: ORG_ID,
    });

    const queryArg = mockPrisma.employeeDocument.findMany.mock.calls[0][0];
    expect(queryArg.where).toMatchObject({
      membershipId: TARGET_MEMBERSHIP_ID,
      organizationId: ORG_ID,
    });
  });
});

// ── getDocumentForDownload ──────────────────────────────────

describe('getDocumentForDownload', () => {
  const docFromOrg1 = {
    id: DOC_ID,
    organizationId: ORG_ID,
    membershipId: TARGET_MEMBERSHIP_ID,
    fileName: 'org-1/documents/mem-target/abc-photo.pdf',
    originalName: 'photo.pdf',
    mimeType: 'application/pdf',
  };

  beforeEach(() => {
    mockPrisma.employeeDocument.findUnique.mockResolvedValue(docFromOrg1);
    mockSigner.getSignedUrl.mockResolvedValue('https://s3.amazonaws.com/signed?token=x');
  });

  it('returns 404 when document does not exist', async () => {
    mockPrisma.employeeDocument.findUnique.mockResolvedValue(null);

    await expect(
      getDocumentForDownload({
        documentId: DOC_ID,
        requesterRole: 'ORG_ADMIN' as any,
        requesterOrgId: ORG_ID,
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 (not 403) when document belongs to another org', async () => {
    // 404 not 403 — never confirm existence of cross-org documents.
    mockPrisma.employeeDocument.findUnique.mockResolvedValue({
      ...docFromOrg1,
      organizationId: OTHER_ORG_ID,
    });

    await expect(
      getDocumentForDownload({
        documentId: DOC_ID,
        requesterRole: 'ORG_ADMIN' as any,
        requesterOrgId: ORG_ID,
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockSigner.getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns 403 when EMPLOYEE tries to download another employee\'s doc', async () => {
    await expect(
      getDocumentForDownload({
        documentId: DOC_ID,
        requesterRole: 'EMPLOYEE' as any,
        requesterOrgId: ORG_ID,
        requesterMembershipId: EMPLOYEE_MEMBERSHIP_ID,
      })
    ).rejects.toMatchObject({ status: 403 });
    expect(mockSigner.getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns a pre-signed URL for the doc owner', async () => {
    const result = await getDocumentForDownload({
      documentId: DOC_ID,
      requesterRole: 'EMPLOYEE' as any,
      requesterOrgId: ORG_ID,
      requesterMembershipId: TARGET_MEMBERSHIP_ID,
    });

    expect(result).toMatchObject({
      url: expect.stringContaining('https://'),
      originalName: 'photo.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('returns 500 when pre-signing fails', async () => {
    mockSigner.getSignedUrl.mockRejectedValue(new Error('AWS borked'));

    await expect(
      getDocumentForDownload({
        documentId: DOC_ID,
        requesterRole: 'ORG_ADMIN' as any,
        requesterOrgId: ORG_ID,
      })
    ).rejects.toMatchObject({ status: 500 });
  });
});

// ── deleteDocument ──────────────────────────────────────────

describe('deleteDocument', () => {
  const docFromOrg1 = {
    id: DOC_ID,
    organizationId: ORG_ID,
    membershipId: TARGET_MEMBERSHIP_ID,
    fileName: 'org-1/documents/mem-target/abc.pdf',
  };

  beforeEach(() => {
    mockPrisma.employeeDocument.findUnique.mockResolvedValue(docFromOrg1);
    mockPrisma.employeeDocument.delete.mockResolvedValue(undefined);
    mockS3.send.mockResolvedValue({});
  });

  it('returns 404 when document does not exist', async () => {
    mockPrisma.employeeDocument.findUnique.mockResolvedValue(null);

    await expect(
      deleteDocument({
        documentId: DOC_ID,
        requesterRole: 'ORG_ADMIN' as any,
        requesterOrgId: ORG_ID,
      })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns 404 when document belongs to another org', async () => {
    mockPrisma.employeeDocument.findUnique.mockResolvedValue({
      ...docFromOrg1,
      organizationId: OTHER_ORG_ID,
    });

    await expect(
      deleteDocument({
        documentId: DOC_ID,
        requesterRole: 'ORG_ADMIN' as any,
        requesterOrgId: ORG_ID,
      })
    ).rejects.toMatchObject({ status: 404 });
    expect(mockS3.send).not.toHaveBeenCalled();
    expect(mockPrisma.employeeDocument.delete).not.toHaveBeenCalled();
  });

  it('returns 403 when EMPLOYEE tries to delete another employee\'s doc', async () => {
    await expect(
      deleteDocument({
        documentId: DOC_ID,
        requesterRole: 'EMPLOYEE' as any,
        requesterOrgId: ORG_ID,
        requesterMembershipId: EMPLOYEE_MEMBERSHIP_ID,
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('deletes from both S3 and DB on the happy path', async () => {
    await deleteDocument({
      documentId: DOC_ID,
      requesterRole: 'ORG_ADMIN' as any,
      requesterOrgId: ORG_ID,
    });

    expect(mockS3.send).toHaveBeenCalled();
    expect(mockPrisma.employeeDocument.delete).toHaveBeenCalledWith({
      where: { id: DOC_ID },
    });
  });

  it('still removes the DB row when S3 delete fails (orphan-prevention)', async () => {
    // We'd rather have an orphan S3 object than an orphan DB row that
    // returns 500s forever. The source explicitly logs and continues.
    mockS3.send.mockRejectedValue(new Error('S3 down'));

    await expect(
      deleteDocument({
        documentId: DOC_ID,
        requesterRole: 'ORG_ADMIN' as any,
        requesterOrgId: ORG_ID,
      })
    ).resolves.toEqual({ success: true });

    expect(mockPrisma.employeeDocument.delete).toHaveBeenCalled();
  });
});
