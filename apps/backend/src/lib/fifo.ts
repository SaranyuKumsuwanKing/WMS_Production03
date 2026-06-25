import { prisma, Decimal, type DecimalValue } from "@king-wms/database";

export type PickAllocation = {
  stockLevelId: number;
  binId: number;
  binCode: string;
  warehouseCode: string;
  lotId: number;
  lotCode: string;
  available: string;
  take: string;
  firstReceivedAt: string | null;
};

export type FifoResult = {
  allocations: PickAllocation[];
  requested: string;
  allocated: string;
  shortfall: string;
};

/**
 * FIFO allocation: draw the requested quantity from the oldest stock first
 * (earliest firstReceivedAt), across bins and lots, skipping QUARANTINE and
 * inactive bins. Pure read — does NOT move stock; callers post the issue.
 */
export async function fifoAllocate(
  itemId: number,
  quantity: DecimalValue | number | string,
): Promise<FifoResult> {
  const requested = quantity instanceof Decimal ? quantity : new Decimal(quantity);
  const levels = await prisma.stockLevel.findMany({
    where: {
      itemId,
      quantity: { gt: 0 },
      // Never pick from a deactivated item/lot (e.g. a recalled/blocked lot) or a
      // quarantine/inactive bin — mirrors the active-target checks on other moves.
      item: { active: true },
      lot: { active: true },
      bin: { active: true, type: { not: "QUARANTINE" } },
    },
    include: {
      bin: { select: { code: true, warehouse: { select: { code: true } } } },
      lot: { select: { lotCode: true } },
    },
    // Oldest first. (SQLite sorts NULLs first in ASC, so any un-dated stock is
    // treated as oldest and cleared first — backfill keeps existing stock dated.)
    orderBy: [{ firstReceivedAt: "asc" }, { id: "asc" }],
  });

  let remaining = requested;
  const allocations: PickAllocation[] = [];
  for (const l of levels) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const avail = new Decimal(l.quantity);
    const take = avail.greaterThan(remaining) ? remaining : avail;
    if (take.lessThanOrEqualTo(0)) continue;
    allocations.push({
      stockLevelId: l.id,
      binId: l.binId,
      binCode: l.bin.code,
      warehouseCode: l.bin.warehouse.code,
      lotId: l.lotId,
      lotCode: l.lot.lotCode,
      available: avail.toString(),
      take: take.toString(),
      firstReceivedAt: l.firstReceivedAt ? l.firstReceivedAt.toISOString() : null,
    });
    remaining = remaining.minus(take);
  }

  return {
    allocations,
    requested: requested.toString(),
    allocated: requested.minus(remaining).toString(),
    shortfall: remaining.greaterThan(0) ? remaining.toString() : "0",
  };
}

export type PickableLine = {
  binCode: string;
  warehouseCode: string;
  lotCode: string;
  quantity: string;
  ageDays: number | null;
};

/** All pickable stock for an item (oldest first) + the total available, so the
 *  Pick screen can show availability before a quantity is entered. */
export async function getPickableStock(
  itemId: number,
): Promise<{ total: string; lines: PickableLine[] }> {
  const levels = await prisma.stockLevel.findMany({
    where: {
      itemId,
      quantity: { gt: 0 },
      item: { active: true },
      lot: { active: true },
      bin: { active: true, type: { not: "QUARANTINE" } },
    },
    include: {
      bin: { select: { code: true, warehouse: { select: { code: true } } } },
      lot: { select: { lotCode: true } },
    },
    orderBy: [{ firstReceivedAt: "asc" }, { id: "asc" }],
  });

  let total = new Decimal(0);
  const lines = levels.map((l) => {
    total = total.plus(new Decimal(l.quantity));
    return {
      binCode: l.bin.code,
      warehouseCode: l.bin.warehouse.code,
      lotCode: l.lot.lotCode,
      quantity: new Decimal(l.quantity).toString(),
      ageDays: l.firstReceivedAt ? Math.floor((Date.now() - l.firstReceivedAt.getTime()) / 86_400_000) : null,
    };
  });
  return { total: total.toString(), lines };
}
