import { PrismaClient } from '@prisma/client';
import '../config/env.js';

export const prisma = new PrismaClient();

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

/**
 * Serialises limit checks for one environment. The row lock is held until the
 * transaction ends, so concurrent requests cannot both pass a count check.
 */
export async function lockEnvironment(tx: Tx, environmentId: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM AppEnvironment WHERE id = ${environmentId} FOR UPDATE`;
}
