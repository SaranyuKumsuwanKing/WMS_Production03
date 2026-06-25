import { prisma, Prisma, Decimal, ensureDbReady, withRetry } from "@king-wms/database";
import {
  InsufficientStockError,
  ValidationError,
  NotFoundError,
} from "./errors";
import type { MovementType } from "./constants";

export type SignedLine = {
  itemId: number;
  binId: number;
  lotId: number;
  qtyDelta: Prisma.Decimal | number | string;
  // For positive (incoming) deltas: the arrival date to record as the stock's
  // age basis. Receipts leave this undefined (= now); put-away/transfer pass the
  // source location's firstReceivedAt so age survives the move (FIFO).
  arrivalAt?: Date | null;
};

export type PostMovementInput = {
  type: MovementType;
  userId: number;
  reference?: string | null;
  note?: string | null;
  clientRequestId?: string | null;
  // Allow zero-quantity lines (used by cycle counts to record a verified count
  // with no stock change). Quantity-changing operations guard positivity upstream.
  allowZeroDelta?: boolean;
  lines: SignedLine[];
};

type TxClient = Prisma.TransactionClient;

function dec(v: Prisma.Decimal | number | string): Prisma.Decimal {
  return v instanceof Prisma.Decimal ? v : new Decimal(v);
}

/**
 * Apply a single signed delta to the materialized StockLevel for (item, bin, lot).
 * All arithmetic is done with Decimal.js (exact) — never in SQL — to avoid
 * floating-point drift. This is a read-modify-write, so postMovement runs the
 * whole transaction at Serializable isolation; concurrent posts that would lose
 * an update fail with a serialization error and are retried by withRetry.
 */
async function applyStockDelta(
  tx: TxClient,
  line: SignedLine,
  allowZero = false,
): Promise<void> {
  const delta = dec(line.qtyDelta);
  if (delta.isZero()) {
    // A zero-delta line (e.g. a cycle count where counted == system) records the
    // movement but makes no stock change. Reject zero elsewhere as a safety net.
    if (allowZero) return;
    throw new ValidationError("Movement quantity cannot be zero.");
  }

  const key = {
    itemId_binId_lotId: {
      itemId: line.itemId,
      binId: line.binId,
      lotId: line.lotId,
    },
  };
  const existing = await tx.stockLevel.findUnique({ where: key });
  const current = existing ? dec(existing.quantity) : new Decimal(0);
  const next = current.plus(delta);

  if (next.isNegative()) {
    const loc = await describeLocation(tx, line);
    throw new InsufficientStockError(
      `Insufficient stock: only ${current.toString()} on hand at ${loc}, cannot remove ${delta.abs().toString()}.`,
    );
  }

  // Aging is only touched when stock ARRIVES (positive delta), never on issues.
  // The age basis is `arrivalAt` (now for receipts; the source's date for moves).
  // firstReceivedAt keeps the OLDEST stock in the location: reset when re-occupying
  // an empty location, otherwise the minimum of existing and the arriving date.
  const incoming = delta.greaterThan(0);
  const now = new Date();
  const arrivalAt = line.arrivalAt ?? now;
  if (existing) {
    const data: Prisma.StockLevelUpdateInput = { quantity: next };
    if (incoming) {
      data.lastReceivedAt = now;
      if (current.lessThanOrEqualTo(0) || !existing.firstReceivedAt) {
        data.firstReceivedAt = arrivalAt;
      } else if (arrivalAt < existing.firstReceivedAt) {
        data.firstReceivedAt = arrivalAt;
      }
    }
    await tx.stockLevel.update({ where: { id: existing.id }, data });
  } else {
    await tx.stockLevel.create({
      data: {
        itemId: line.itemId,
        binId: line.binId,
        lotId: line.lotId,
        quantity: next,
        ...(incoming
          ? { firstReceivedAt: arrivalAt, lastReceivedAt: now }
          : {}),
      },
    });
  }
}

async function describeLocation(
  tx: TxClient,
  line: SignedLine,
): Promise<string> {
  const [item, bin, lot] = await Promise.all([
    tx.item.findUnique({
      where: { id: line.itemId },
      select: { itemNumber: true },
    }),
    tx.bin.findUnique({ where: { id: line.binId }, select: { code: true } }),
    tx.lot.findUnique({ where: { id: line.lotId }, select: { lotCode: true } }),
  ]);
  return `${bin?.code ?? "bin?"} / ${item?.itemNumber ?? "item?"} / lot ${lot?.lotCode ?? "?"}`;
}

export type PostedMovement = Prisma.StockMovementGetPayload<{
  include: { lines: true };
}>;

/**
 * The single entry point for every stock movement. Writes the immutable header +
 * signed lines and updates StockLevel inside one transaction. Idempotent on
 * clientRequestId so a double-scan/double-tap cannot post twice.
 */
export async function postMovement(
  input: PostMovementInput,
): Promise<{ movement: PostedMovement; replay: boolean }> {
  if (!input.lines.length)
    throw new ValidationError("A movement needs at least one line.");
  await ensureDbReady();

  // Idempotency fast-path: return the prior movement if this request already posted.
  if (input.clientRequestId) {
    const prior = await prisma.stockMovement.findUnique({
      where: { clientRequestId: input.clientRequestId },
      include: { lines: true },
    });
    if (prior) return { movement: prior, replay: true };
  }

  try {
    const movement = await withRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const created = await tx.stockMovement.create({
            data: {
              type: input.type,
              reference: input.reference ?? null,
              note: input.note ?? null,
              userId: input.userId,
              clientRequestId: input.clientRequestId ?? null,
            },
          });
          for (const line of input.lines) {
            await tx.stockMovementLine.create({
              data: {
                movementId: created.id,
                itemId: line.itemId,
                binId: line.binId,
                lotId: line.lotId,
                qtyDelta: dec(line.qtyDelta),
              },
            });
            await applyStockDelta(tx, line, input.allowZeroDelta);
          }
          return tx.stockMovement.findUniqueOrThrow({
            where: { id: created.id },
            include: { lines: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
    return { movement, replay: false };
  } catch (err) {
    // Two identical requests raced past the fast-path: the unique constraint
    // caught the duplicate. Return the winner as a replay.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      input.clientRequestId
    ) {
      const prior = await prisma.stockMovement.findUnique({
        where: { clientRequestId: input.clientRequestId },
        include: { lines: true },
      });
      if (prior) return { movement: prior, replay: true };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// High-level operations used by the API. Each validates business rules, then
// builds signed lines and delegates to postMovement.
// ---------------------------------------------------------------------------

async function loadActiveTargets(
  itemId: number,
  lotId: number,
  binIds: number[],
) {
  const [item, lot, bins] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId } }),
    prisma.lot.findUnique({ where: { id: lotId } }),
    prisma.bin.findMany({ where: { id: { in: binIds } } }),
  ]);
  if (!item) throw new NotFoundError("Item not found.");
  if (!item.active)
    throw new ValidationError(`Item ${item.itemNumber} is inactive.`);
  if (!lot) throw new NotFoundError("Lot not found.");
  if (lot.itemId !== itemId)
    throw new ValidationError("Lot does not belong to this item.");
  if (!lot.active) throw new ValidationError(`Lot ${lot.lotCode} is inactive.`);
  for (const id of binIds) {
    const bin = bins.find((b) => b.id === id);
    if (!bin) throw new NotFoundError("Bin not found.");
    if (!bin.active) throw new ValidationError(`Bin ${bin.code} is inactive.`);
  }
  return { item, lot, bins };
}

function assertPositive(
  quantity: Prisma.Decimal | number | string,
): Prisma.Decimal {
  const q = dec(quantity);
  if (q.isNegative() || q.isZero())
    throw new ValidationError("Quantity must be greater than zero.");
  return q;
}

export type ReceiptInput = {
  itemId: number;
  lotId: number;
  binId: number;
  quantity: Prisma.Decimal | number | string;
  userId: number;
  reference?: string | null;
  note?: string | null;
  clientRequestId?: string | null;
  // "GR" = supplier goods receipt (default); "RETURN" = return from production.
  type?: Extract<MovementType, "GR" | "RETURN">;
};

export async function receiveGoods(input: ReceiptInput) {
  const q = assertPositive(input.quantity);
  await loadActiveTargets(input.itemId, input.lotId, [input.binId]);
  return postMovement({
    type: input.type ?? "GR",
    userId: input.userId,
    reference: input.reference,
    note: input.note,
    clientRequestId: input.clientRequestId,
    lines: [
      {
        itemId: input.itemId,
        binId: input.binId,
        lotId: input.lotId,
        qtyDelta: q,
      },
    ],
  });
}

export type IssueInput = ReceiptInput;

export async function issueGoods(input: IssueInput) {
  const q = assertPositive(input.quantity);
  await loadActiveTargets(input.itemId, input.lotId, [input.binId]);
  return postMovement({
    type: "GI",
    userId: input.userId,
    reference: input.reference,
    note: input.note,
    clientRequestId: input.clientRequestId,
    lines: [
      {
        itemId: input.itemId,
        binId: input.binId,
        lotId: input.lotId,
        qtyDelta: q.negated(),
      },
    ],
  });
}

export type MoveInput = {
  itemId: number;
  lotId: number;
  fromBinId: number;
  toBinId: number;
  quantity: Prisma.Decimal | number | string;
  userId: number;
  note?: string | null;
  clientRequestId?: string | null;
  type?: Extract<MovementType, "PUTAWAY" | "TRANSFER">;
};

export async function moveStock(input: MoveInput) {
  const q = assertPositive(input.quantity);
  if (input.fromBinId === input.toBinId) {
    throw new ValidationError("Source and destination bins must be different.");
  }
  await loadActiveTargets(input.itemId, input.lotId, [
    input.fromBinId,
    input.toBinId,
  ]);
  // Carry the source stock's arrival date onto the destination so the moved
  // stock keeps its true age (and its FIFO position) after a put-away/transfer.
  const src = await prisma.stockLevel.findUnique({
    where: {
      itemId_binId_lotId: {
        itemId: input.itemId,
        binId: input.fromBinId,
        lotId: input.lotId,
      },
    },
    select: { firstReceivedAt: true },
  });
  return postMovement({
    type: input.type ?? "PUTAWAY",
    userId: input.userId,
    note: input.note,
    clientRequestId: input.clientRequestId,
    lines: [
      {
        itemId: input.itemId,
        binId: input.fromBinId,
        lotId: input.lotId,
        qtyDelta: q.negated(),
      },
      {
        itemId: input.itemId,
        binId: input.toBinId,
        lotId: input.lotId,
        qtyDelta: q,
        arrivalAt: src?.firstReceivedAt ?? null,
      },
    ],
  });
}

export type AdjustInput = {
  itemId: number;
  lotId: number;
  binId: number;
  newQuantity: Prisma.Decimal | number | string;
  userId: number;
  reason: string;
  clientRequestId?: string | null;
};

/**
 * Ad-hoc stock correction (admin): set the on-hand at one item/bin/lot to the
 * entered actual quantity. Posts an ADJUST movement of the delta (zero if the
 * count already matched, so the correction is always recorded). Reason required.
 */
export async function adjustStock(input: AdjustInput) {
  const target = dec(input.newQuantity);
  if (target.isNegative())
    throw new ValidationError("Quantity cannot be negative.");
  await loadActiveTargets(input.itemId, input.lotId, [input.binId]);
  const existing = await prisma.stockLevel.findUnique({
    where: {
      itemId_binId_lotId: {
        itemId: input.itemId,
        binId: input.binId,
        lotId: input.lotId,
      },
    },
  });
  const current = existing ? dec(existing.quantity) : new Decimal(0);
  const delta = target.minus(current);
  return postMovement({
    type: "ADJUST",
    userId: input.userId,
    reference: "ADJUST",
    note: input.reason,
    allowZeroDelta: true,
    clientRequestId: input.clientRequestId,
    lines: [
      {
        itemId: input.itemId,
        binId: input.binId,
        lotId: input.lotId,
        qtyDelta: delta,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Reconciliation / recovery: rebuild every StockLevel from the ledger.
// StockLevel is a cache — this proves it can always be derived from the truth.
// ---------------------------------------------------------------------------
export async function recomputeStockFromLedger(): Promise<{
  rows: number;
  changed: number;
}> {
  await ensureDbReady();
  return withRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const sums = await tx.stockMovementLine.groupBy({
          by: ["itemId", "binId", "lotId"],
          _sum: { qtyDelta: true },
        });
        await tx.stockLevel.deleteMany({});
        let changed = 0;
        for (const s of sums) {
          const qty = dec(s._sum.qtyDelta ?? 0);
          // Re-derive aging from the ledger (earliest/latest positive receipt into
          // this location) so a recompute does not lose the Age / FIFO basis.
          const posLines = await tx.stockMovementLine.findMany({
            where: {
              itemId: s.itemId,
              binId: s.binId,
              lotId: s.lotId,
              qtyDelta: { gt: 0 },
            },
            include: { movement: { select: { createdAt: true } } },
            orderBy: [{ movement: { createdAt: "asc" } }, { id: "asc" }],
          });
          await tx.stockLevel.create({
            data: {
              itemId: s.itemId,
              binId: s.binId,
              lotId: s.lotId,
              quantity: qty,
              firstReceivedAt: posLines[0]?.movement.createdAt ?? null,
              lastReceivedAt:
                posLines[posLines.length - 1]?.movement.createdAt ?? null,
            },
          });
          changed++;
        }
        return { rows: sums.length, changed };
      },
      {
        timeout: 60_000,
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    ),
  );
}
