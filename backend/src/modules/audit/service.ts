import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import type { Actor } from '../../types.js';

interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | number;
  metadata?: Prisma.InputJsonValue;
}

export async function writeAudit(actor: Actor, entry: AuditEntry, tx: Tx = prisma): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.userId,
      actorLabel: actor.label,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      metadata: entry.metadata ?? Prisma.JsonNull,
      ipAddress: actor.ip ?? null,
    },
  });
}
