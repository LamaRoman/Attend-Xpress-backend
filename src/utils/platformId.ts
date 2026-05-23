import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function generatePlatformId(): Promise<string> {
  while (true) {
    const id = String(Math.floor(10000000 + Math.random() * 90000000));
    const existing = await prisma.user.findUnique({ where: { platformId: id } });
    if (!existing) return id;
  }
}