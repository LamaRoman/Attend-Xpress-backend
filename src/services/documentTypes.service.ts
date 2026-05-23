import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── List all document types for an org ──
export async function listDocumentTypes(organizationId: string, includeInactive = false) {
  return prisma.documentType.findMany({
    where: {
      organizationId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ isRequired: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      nameNp: true,
      description: true,
      isRequired: true,
      isActive: true,
      createdAt: true,
      _count: { select: { documents: true } },
    },
  });
}

// ── Create a document type ──
interface CreateDocTypeParams {
  organizationId: string;
  name: string;
  nameNp?: string;
  description?: string;
  isRequired?: boolean;
}

export async function createDocumentType(params: CreateDocTypeParams) {
  const { organizationId, name, nameNp, description, isRequired } = params;

  if (!name || name.trim().length === 0) {
    throw { status: 400, message: 'Document type name is required' };
  }

  // Check for duplicate name in the same org
  const existing = await prisma.documentType.findUnique({
    where: { organizationId_name: { organizationId, name: name.trim() } },
  });
  if (existing) {
    throw { status: 409, message: 'A document type with this name already exists' };
  }

  return prisma.documentType.create({
    data: {
      organizationId,
      name: name.trim(),
      nameNp: nameNp?.trim() || null,
      description: description?.trim() || null,
      isRequired: isRequired ?? false,
    },
  });
}

// ── Update a document type ──
interface UpdateDocTypeParams {
  id: string;
  organizationId: string;
  name?: string;
  nameNp?: string;
  description?: string;
  isRequired?: boolean;
  isActive?: boolean;
}

export async function updateDocumentType(params: UpdateDocTypeParams) {
  const { id, organizationId, ...updates } = params;

  const docType = await prisma.documentType.findUnique({ where: { id } });
  if (!docType || docType.organizationId !== organizationId) {
    throw { status: 404, message: 'Document type not found' };
  }

  // If renaming, check for duplicate
  if (updates.name && updates.name.trim() !== docType.name) {
    const existing = await prisma.documentType.findUnique({
      where: { organizationId_name: { organizationId, name: updates.name.trim() } },
    });
    if (existing) {
      throw { status: 409, message: 'A document type with this name already exists' };
    }
  }

  return prisma.documentType.update({
    where: { id },
    data: {
      ...(updates.name !== undefined && { name: updates.name.trim() }),
      ...(updates.nameNp !== undefined && { nameNp: updates.nameNp?.trim() || null }),
      ...(updates.description !== undefined && { description: updates.description?.trim() || null }),
      ...(updates.isRequired !== undefined && { isRequired: updates.isRequired }),
      ...(updates.isActive !== undefined && { isActive: updates.isActive }),
    },
  });
}

// ── Delete a document type (only if no documents reference it) ──
export async function deleteDocumentType(id: string, organizationId: string) {
  const docType = await prisma.documentType.findUnique({
    where: { id },
    include: { _count: { select: { documents: true } } },
  });

  if (!docType || docType.organizationId !== organizationId) {
    throw { status: 404, message: 'Document type not found' };
  }

  if (docType._count.documents > 0) {
    throw {
      status: 400,
      message: `Cannot delete: ${docType._count.documents} document(s) are using this type. Deactivate it instead.`,
    };
  }

  await prisma.documentType.delete({ where: { id } });
  return { success: true };
}

// ── Get compliance summary: which employees are missing required docs ──
export async function getComplianceSummary(organizationId: string) {
  const requiredTypes = await prisma.documentType.findMany({
    where: { organizationId, isRequired: true, isActive: true },
    select: { id: true, name: true, nameNp: true },
  });

  if (requiredTypes.length === 0) {
    return { requiredTypes: [], employees: [] };
  }

  // Query active employee memberships with their documents
  const memberships = await prisma.orgMembership.findMany({
    where: { organizationId, isActive: true, leftAt: null, role: 'EMPLOYEE' },
    select: {
      id: true,
      employeeId: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      documents: {
        where: { documentTypeId: { in: requiredTypes.map((t) => t.id) } },
        select: { documentTypeId: true },
      },
    },
  });

  const summary = memberships.map((m) => {
    const uploadedTypeIds = new Set(m.documents.map((d: { documentTypeId: string }) => d.documentTypeId));
    const missing = requiredTypes.filter((t) => !uploadedTypeIds.has(t.id));
    return {
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      employeeId: m.employeeId,
      totalRequired: requiredTypes.length,
      uploaded: requiredTypes.length - missing.length,
      missing: missing.map((t) => ({ id: t.id, name: t.name, nameNp: t.nameNp })),
    };
  });

  return { requiredTypes, employees: summary };
}