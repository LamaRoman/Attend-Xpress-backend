import { Role } from '@prisma/client';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, S3_BUCKET } from '../lib/s3';
import { createLogger } from '../logger';
import prisma from '../lib/prisma';

const log = createLogger('documents');

// ── File validation ──
const MAGIC_BYTES: Record<string, Buffer[]> = {
  'application/pdf': [Buffer.from([0x25, 0x50, 0x44, 0x46])],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
};

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;    // 5MB per file
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;  // 20MB per employee

function validateMagicBytes(buffer: Buffer, declaredMimeType: string): boolean {
  const signatures = MAGIC_BYTES[declaredMimeType];
  if (!signatures) return false;
  return signatures.some((sig) => {
    if (buffer.length < sig.length) return false;
    return sig.every((byte, i) => buffer[i] === byte);
  });
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .substring(0, 200);
}

/**
 * Build the S3 key for a document.
 * Structure: {orgId}/documents/{membershipId}/{storedFileName}
 * NOTE: New uploads use membershipId in the path.
 * Existing files with userId in path continue to work via their stored fileName (S3 key).
 */
function buildS3Key(orgId: string, membershipId: string, fileName: string): string {
  return `${orgId}/documents/${membershipId}/${fileName}`;
}

// ── Upload ──

interface UploadDocumentParams {
  /** Target user's userId — we resolve to membership internally */
  userId: string;
  /** Uploader's userId — for audit trail (uploadedBy stays as plain string) */
  uploaderId: string;
  /** Uploader's role (from JWT, sourced from membership) */
  uploaderRole: Role;
  /** Uploader's org */
  uploaderOrgId: string;
  /** Uploader's membershipId — for employee self-upload check */
  uploaderMembershipId?: string;
  file: Express.Multer.File;
  documentTypeId: string;
  description?: string;
}

export async function uploadDocument(params: UploadDocumentParams) {
  const { userId, uploaderId, uploaderRole, uploaderOrgId, uploaderMembershipId, file, documentTypeId, description } = params;

  // 1. Resolve target user to their membership in this org
  const targetMembership = await prisma.orgMembership.findFirst({
    where: { userId, organizationId: uploaderOrgId },
    select: { id: true, userId: true },
  });
  if (!targetMembership) {
    throw { status: 404, message: 'User not found in your organization' };
  }

  // 2. Employee can only upload for self (compare membershipId)
  if (uploaderRole === 'EMPLOYEE' && targetMembership.id !== uploaderMembershipId) {
    throw { status: 403, message: 'You can only upload documents for yourself' };
  }

  // 3. Verify document type belongs to same org and is active
  const docType = await prisma.documentType.findUnique({
    where: { id: documentTypeId },
  });
  if (!docType || docType.organizationId !== uploaderOrgId) {
    throw { status: 400, message: 'Invalid document type' };
  }
  if (!docType.isActive) {
    throw { status: 400, message: 'This document type is no longer active' };
  }

  // 4. Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cleanupTempFile(file.path);
    throw { status: 400, message: 'Invalid file type. Only PDF, JPG, and PNG are allowed.' };
  }

  // 5. Validate magic bytes
  const fileBuffer = fs.readFileSync(file.path);
  if (!validateMagicBytes(fileBuffer, file.mimetype)) {
    cleanupTempFile(file.path);
    throw { status: 400, message: 'File content does not match its declared type.' };
  }

  // 6. Check file size
  if (file.size > MAX_FILE_SIZE) {
    cleanupTempFile(file.path);
    throw { status: 400, message: 'File size exceeds 5MB limit.' };
  }

  // 7. Check total storage per employee (scoped to membershipId)
  const existingDocs = await prisma.employeeDocument.aggregate({
    where: { membershipId: targetMembership.id },
    _sum: { fileSize: true },
  });
  const currentTotal = existingDocs._sum.fileSize || 0;
  if (currentTotal + file.size > MAX_TOTAL_SIZE) {
    cleanupTempFile(file.path);
    throw { status: 400, message: 'Total document storage exceeds 20MB limit for this employee.' };
  }

  // 8. Upload to S3
  const sanitized = sanitizeFileName(file.originalname);
  const storedName = `${uuidv4()}-${sanitized}`;
  const s3Key = buildS3Key(uploaderOrgId, targetMembership.id, storedName);

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: file.mimetype,
        ServerSideEncryption: 'AES256',
        Metadata: {
          'original-name': encodeURIComponent(file.originalname),
          'uploaded-by': uploaderId,
          'organization-id': uploaderOrgId,
          'membership-id': targetMembership.id,
        },
      })
    );
    log.info({ s3Key, membershipId: targetMembership.id, uploaderId }, 'Document uploaded to S3');
  } catch (err) {
    log.error({ err, s3Key }, 'Failed to upload to S3');
    cleanupTempFile(file.path);
    throw { status: 500, message: 'Failed to upload document. Please try again.' };
  }

  // 9. Cleanup temp file
  cleanupTempFile(file.path);

  // 10. Create DB record with membershipId
  const document = await prisma.employeeDocument.create({
    data: {
      membershipId: targetMembership.id,
      organizationId: uploaderOrgId,
      documentTypeId,
      fileName: s3Key,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileSize: file.size,
      description: description || null,
      uploadedBy: uploaderId, // Plain string userId for audit trail
    },
    include: {
      documentType: { select: { id: true, name: true, nameNp: true } },
    },
  });

  return document;
}

// ── List ──

interface ListDocumentsParams {
  /** Target user's userId — resolved to membership */
  userId: string;
  requesterMembershipId?: string;
  requesterRole: Role;
  requesterOrgId: string;
}

export async function listDocuments(params: ListDocumentsParams) {
  const { userId, requesterMembershipId, requesterRole, requesterOrgId } = params;

  // Resolve userId to membership in this org
  const targetMembership = await prisma.orgMembership.findFirst({
    where: { userId, organizationId: requesterOrgId },
    select: { id: true },
  });
  if (!targetMembership) {
    throw { status: 404, message: 'User not found in your organization' };
  }

  // Employee can only list own documents
  if (requesterRole === 'EMPLOYEE' && targetMembership.id !== requesterMembershipId) {
    throw { status: 403, message: 'Access denied' };
  }

  return prisma.employeeDocument.findMany({
    where: { membershipId: targetMembership.id, organizationId: requesterOrgId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      description: true,
      createdAt: true,
      documentType: { select: { id: true, name: true, nameNp: true } },
    },
  });
}

// ── Download (pre-signed URL) ──

interface DownloadDocumentParams {
  documentId: string;
  requesterMembershipId?: string;
  requesterRole: Role;
  requesterOrgId: string;
}

export async function getDocumentForDownload(params: DownloadDocumentParams) {
  const { documentId, requesterMembershipId, requesterRole, requesterOrgId } = params;

  const doc = await prisma.employeeDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.organizationId !== requesterOrgId) {
    throw { status: 404, message: 'Document not found' };
  }

  // Employee can only download own documents (compare membershipId)
  if (requesterRole === 'EMPLOYEE' && doc.membershipId !== requesterMembershipId) {
    throw { status: 403, message: 'Access denied' };
  }

  // Generate a pre-signed URL that expires in 15 minutes
  try {
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: doc.fileName, // fileName stores the S3 key
        ResponseContentDisposition: `inline; filename="${encodeURIComponent(doc.originalName)}"`,
        ResponseContentType: doc.mimeType,
      }),
      { expiresIn: 900 } // 15 minutes
    );

    return { url, originalName: doc.originalName, mimeType: doc.mimeType };
  } catch (err) {
    log.error({ err, documentId }, 'Failed to generate pre-signed URL');
    throw { status: 500, message: 'Failed to generate download link.' };
  }
}

// ── Delete ──

interface DeleteDocumentParams {
  documentId: string;
  requesterMembershipId?: string;
  requesterRole: Role;
  requesterOrgId: string;
}

export async function deleteDocument(params: DeleteDocumentParams) {
  const { documentId, requesterMembershipId, requesterRole, requesterOrgId } = params;

  const doc = await prisma.employeeDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.organizationId !== requesterOrgId) {
    throw { status: 404, message: 'Document not found' };
  }

  // Employee can only delete own documents
  if (requesterRole === 'EMPLOYEE' && doc.membershipId !== requesterMembershipId) {
    throw { status: 403, message: 'Access denied' };
  }

  // Delete from S3
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: doc.fileName,
      })
    );
    log.info({ s3Key: doc.fileName, documentId }, 'Document deleted from S3');
  } catch (err) {
    log.error({ err, documentId }, 'Failed to delete from S3 — removing DB record anyway');
  }

  await prisma.employeeDocument.delete({ where: { id: documentId } });
  return { success: true };
}

// ── Helpers ──

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}