import { prisma } from "@king-wms/database";

/**
 * Record a non-movement admin action (item/bin/user edits, deactivations,
 * imports, count posting, etc.). Stock movements carry their own audit via the
 * StockMovement ledger. Failures here never break the underlying operation.
 */
export async function logAudit(entry: {
  userId?: number | null;
  action: string;
  entity: string;
  entityId?: string | number | null;
  detail?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId != null ? String(entry.entityId) : null,
        detail: entry.detail != null ? JSON.stringify(entry.detail) : null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}
