import { prisma, Decimal } from "@king-wms/database";

export type StockFilters = {
  q?: string;
  warehouseId?: number;
  binId?: number;
  itemId?: number;
  binType?: string; // RECEIVING | STORAGE | QUARANTINE | RETURNS
};

function buildWhere(f: StockFilters) {
  const q = f.q?.trim();
  const binFilter = {
    ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    ...(f.binType ? { type: f.binType } : {}),
  };
  return {
    quantity: { gt: 0 },
    ...(Object.keys(binFilter).length ? { bin: binFilter } : {}),
    ...(f.binId ? { binId: f.binId } : {}),
    ...(f.itemId ? { itemId: f.itemId } : {}),
    ...(q
      ? {
          OR: [
            { item: { itemNumber: { contains: q } } },
            { item: { description: { contains: q } } },
            { bin: { barcode: { contains: q.toUpperCase() } } },
            { lot: { lotCode: { contains: q } } },
          ],
        }
      : {}),
  };
}

export type StockRow = {
  id: number;
  itemNumber: string;
  description: string;
  category: string | null;
  inventoryType: string | null;
  uom: string;
  warehouseCode: string;
  warehouseName: string;
  binCode: string;
  binBarcode: string;
  binType: string;
  lotCode: string;
  reference: string | null;
  quantity: string;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  ageDays: number | null;
};

function daysSince(d: Date | null): number | null {
  return d ? Math.floor((Date.now() - d.getTime()) / 86_400_000) : null;
}

export async function getStockRows(
  f: StockFilters,
  take = 1000,
): Promise<{ rows: StockRow[]; total: number }> {
  const where = buildWhere(f);
  const [levels, total] = await Promise.all([
    prisma.stockLevel.findMany({
      where,
      take,
      include: {
        item: {
          select: {
            itemNumber: true,
            description: true,
            uom: true,
            category: true,
            inventoryType: true,
          },
        },
        bin: {
          select: {
            code: true,
            barcode: true,
            type: true,
            warehouse: { select: { code: true, name: true } },
          },
        },
        lot: { select: { lotCode: true } },
      },
      orderBy: [{ item: { itemNumber: "asc" } }, { bin: { barcode: "asc" } }],
    }),
    prisma.stockLevel.count({ where }),
  ]);

  // Reference per stock line = the reference typed into the most recent movement
  // (Receive / Return / Pick …) that touched this exact item+bin+lot. Derived in
  // two bounded queries (groupBy + fetch) rather than per-row. Higher movementId
  // = later movement (autoincrement), so _max(movementId) is the latest one.
  const refByTuple = new Map<string, string | null>();
  if (levels.length) {
    const groups = await prisma.stockMovementLine.groupBy({
      by: ["itemId", "binId", "lotId"],
      where: {
        itemId: { in: [...new Set(levels.map((l) => l.itemId))] },
        binId: { in: [...new Set(levels.map((l) => l.binId))] },
        lotId: { in: [...new Set(levels.map((l) => l.lotId))] },
      },
      _max: { movementId: true },
    });
    const movementIds = groups
      .map((g) => g._max.movementId)
      .filter((x): x is number => x != null);
    const movements = movementIds.length
      ? await prisma.stockMovement.findMany({
          where: { id: { in: movementIds } },
          select: { id: true, reference: true },
        })
      : [];
    const refByMovement = new Map(movements.map((m) => [m.id, m.reference]));
    for (const g of groups) {
      const mid = g._max.movementId;
      refByTuple.set(
        `${g.itemId}-${g.binId}-${g.lotId}`,
        mid != null ? (refByMovement.get(mid) ?? null) : null,
      );
    }
  }

  const rows = levels.map((l) => ({
    id: l.id,
    itemNumber: l.item.itemNumber,
    description: l.item.description,
    category: l.item.category,
    inventoryType: l.item.inventoryType,
    uom: l.item.uom,
    warehouseCode: l.bin.warehouse.code,
    warehouseName: l.bin.warehouse.name,
    binCode: l.bin.code,
    binBarcode: l.bin.barcode,
    binType: l.bin.type,
    lotCode: l.lot.lotCode,
    reference: refByTuple.get(`${l.itemId}-${l.binId}-${l.lotId}`) ?? null,
    quantity: new Decimal(l.quantity).toString(),
    firstReceivedAt: l.firstReceivedAt ? l.firstReceivedAt.toISOString() : null,
    lastReceivedAt: l.lastReceivedAt ? l.lastReceivedAt.toISOString() : null,
    ageDays: daysSince(l.firstReceivedAt),
  }));
  return { rows, total };
}

export type OldestStockRow = {
  itemNumber: string;
  description: string;
  uom: string;
  warehouseCode: string;
  binCode: string;
  lotCode: string;
  quantity: string;
  ageDays: number | null;
};

/** Stock that has sat the longest (oldest firstReceivedAt) — surfaces aging. */
export async function getOldestStock(limit = 8): Promise<OldestStockRow[]> {
  const levels = await prisma.stockLevel.findMany({
    where: { quantity: { gt: 0 }, firstReceivedAt: { not: null } },
    include: {
      item: { select: { itemNumber: true, description: true, uom: true } },
      bin: { select: { code: true, warehouse: { select: { code: true } } } },
      lot: { select: { lotCode: true } },
    },
    orderBy: [{ firstReceivedAt: "asc" }],
    take: limit,
  });
  return levels.map((l) => ({
    itemNumber: l.item.itemNumber,
    description: l.item.description,
    uom: l.item.uom,
    warehouseCode: l.bin.warehouse.code,
    binCode: l.bin.code,
    lotCode: l.lot.lotCode,
    quantity: new Decimal(l.quantity).toString(),
    ageDays: daysSince(l.firstReceivedAt),
  }));
}

// ---------------------------------------------------------------------------
// Cycle-count evaluation. Every counted line (correct or not) is recorded on
// CountLine with its variance, so accuracy is derived from those records — a
// zero-variance ("correct") count needs no stock movement to still be counted.
// ---------------------------------------------------------------------------
export type Slice = { key: string; label: string; value: number };

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
function midnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export type CountStats = {
  totals: {
    counted: number;
    correct: number;
    incorrect: number;
    accuracy: number;
  };
  // Rolling daily series: lines counted that day + that day's accuracy %
  // (null on days with no counts, so the line chart can leave a gap).
  days: { label: string; counted: number; accuracy: number | null }[];
};

/** Cycle-count accuracy + a rolling daily series of counts and per-day accuracy. */
export async function getCountStats(days = 21): Promise<CountStats> {
  const start = midnight();
  start.setDate(start.getDate() - (days - 1));
  const lines = await prisma.countLine.findMany({
    where: { countedAt: { gte: start } },
    select: { variance: true, countedAt: true },
  });

  let correct = 0;
  const countedByDay = new Map<string, number>();
  const correctByDay = new Map<string, number>();
  for (const l of lines) {
    if (!l.countedAt) continue;
    const isCorrect = l.variance != null && new Decimal(l.variance).isZero();
    if (isCorrect) correct++;
    const key = dayKey(new Date(l.countedAt));
    countedByDay.set(key, (countedByDay.get(key) ?? 0) + 1);
    if (isCorrect) correctByDay.set(key, (correctByDay.get(key) ?? 0) + 1);
  }

  const series: { label: string; counted: number; accuracy: number | null }[] =
    [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    const c = countedByDay.get(key) ?? 0;
    const ok = correctByDay.get(key) ?? 0;
    series.push({
      label: dayLabel(d),
      counted: c,
      accuracy: c ? Math.round((ok / c) * 100) : null,
    });
  }

  const counted = lines.length;
  return {
    totals: {
      counted,
      correct,
      incorrect: counted - correct,
      accuracy: counted ? Math.round((correct / counted) * 100) : 0,
    },
    days: series,
  };
}

/** Inbound (GR + Return) vs outbound (GI) movements per day, rolling window. */
export async function getMovementTrend(
  days = 14,
): Promise<{ label: string; a: number; b: number }[]> {
  const start = midnight();
  start.setDate(start.getDate() - (days - 1));
  const mv = await prisma.stockMovement.findMany({
    where: { createdAt: { gte: start } },
    select: { type: true, createdAt: true },
  });
  const inByDay = new Map<string, number>();
  const outByDay = new Map<string, number>();
  for (const m of mv) {
    const key = dayKey(new Date(m.createdAt));
    if (m.type === "GR" || m.type === "RETURN")
      inByDay.set(key, (inByDay.get(key) ?? 0) + 1);
    else if (m.type === "GI") outByDay.set(key, (outByDay.get(key) ?? 0) + 1);
  }
  const out: { label: string; a: number; b: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dayKey(d);
    out.push({
      label: dayLabel(d),
      a: inByDay.get(key) ?? 0,
      b: outByDay.get(key) ?? 0,
    });
  }
  return out;
}

/** Stock lines (qty > 0) grouped by item inventory type. */
export async function getStockByInventoryType(): Promise<Slice[]> {
  const base = { quantity: { gt: 0 } } as const;
  const [rm, wip, fg, unset] = await Promise.all([
    prisma.stockLevel.count({
      where: { ...base, item: { inventoryType: "RM" } },
    }),
    prisma.stockLevel.count({
      where: { ...base, item: { inventoryType: "WIP" } },
    }),
    prisma.stockLevel.count({
      where: { ...base, item: { inventoryType: "FG" } },
    }),
    prisma.stockLevel.count({
      where: { ...base, item: { inventoryType: null } },
    }),
  ]);
  return [
    { key: "RM", label: "Raw Material", value: rm },
    { key: "WIP", label: "Work In Progress", value: wip },
    { key: "FG", label: "Finished Goods", value: fg },
    { key: "UNSET", label: "Unclassified", value: unset },
  ];
}

export async function getDashboardStats() {
  const [activeItems, bins, warehouses, stockLines, openCounts] =
    await Promise.all([
      prisma.item.count({ where: { active: true } }),
      prisma.bin.count({ where: { active: true } }),
      prisma.warehouse.count({ where: { active: true } }),
      prisma.stockLevel.count({ where: { quantity: { gt: 0 } } }),
      prisma.countSession.count({ where: { status: { not: "COMPLETED" } } }),
    ]);
  return { activeItems, bins, warehouses, stockLines, openCounts };
}
