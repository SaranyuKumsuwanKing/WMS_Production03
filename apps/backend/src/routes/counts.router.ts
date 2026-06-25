import { Router } from "express";
import { z } from "zod";
import { prisma, Decimal, type DecimalValue } from "@king-wms/database";
import { requireUser } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import {
  NotFoundError,
  ValidationError,
  InsufficientStockError,
} from "../lib/errors";
import { postMovement } from "../lib/inventory";
import { logAudit } from "../lib/audit";

export const countsRouter = Router();

// GET / — list recent count sessions.
countsRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);
    const sessions = await prisma.countSession.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        warehouse: { select: { code: true, name: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { lines: true } },
      },
    });
    return ok(res, { sessions });
  }),
);

const createSchema = z.object({
  scope: z.enum(["WAREHOUSE", "BIN", "ITEM"]),
  warehouseId: z.number().int().positive().optional().nullable(),
  binId: z.number().int().positive().optional().nullable(),
  itemId: z.number().int().positive().optional().nullable(),
  note: z.string().trim().max(160).optional().nullable(),
});

// POST / — create a count session by snapshotting on-hand stock in scope.
countsRouter.post(
  "/",
  wrap(async (req, res) => {
    const user = await requireUser(req);
    const body = createSchema.parse(req.body);

    // Resolve scope -> the snapshot filter, the session's warehouse, and a label.
    let where: Record<string, unknown>;
    let sessionWarehouseId: number | null = null;
    let scopeNote = body.note ?? null;

    if (body.scope === "BIN") {
      if (!body.binId) throw new ValidationError("Select a bin.");
      const bin = await prisma.bin.findUnique({ where: { id: body.binId } });
      if (!bin) throw new NotFoundError("Bin not found.");
      where = { quantity: { gt: 0 }, binId: body.binId };
      sessionWarehouseId = bin.warehouseId;
    } else if (body.scope === "ITEM") {
      if (!body.itemId) throw new ValidationError("Select an item.");
      const item = await prisma.item.findUnique({ where: { id: body.itemId } });
      if (!item) throw new NotFoundError("Item not found.");
      where = {
        quantity: { gt: 0 },
        itemId: body.itemId,
        ...(body.warehouseId ? { bin: { warehouseId: body.warehouseId } } : {}),
      };
      sessionWarehouseId = body.warehouseId ?? null;
      scopeNote = `Item: ${item.itemNumber}${body.note ? ` · ${body.note}` : ""}`;
    } else {
      if (!body.warehouseId) throw new ValidationError("Select a warehouse.");
      const wh = await prisma.warehouse.findUnique({
        where: { id: body.warehouseId },
      });
      if (!wh) throw new NotFoundError("Warehouse not found.");
      where = { quantity: { gt: 0 }, bin: { warehouseId: body.warehouseId } };
      sessionWarehouseId = body.warehouseId;
    }

    // Snapshot every on-hand line in scope at this instant.
    const levels = await prisma.stockLevel.findMany({ where });

    const session = await prisma.countSession.create({
      data: {
        warehouseId: sessionWarehouseId,
        status: "OPEN",
        note: scopeNote,
        createdById: user.userId,
        lines: {
          create: levels.map((l) => ({
            itemId: l.itemId,
            binId: l.binId,
            lotId: l.lotId,
            systemQty: l.quantity,
            status: "PENDING",
          })),
        },
      },
      include: { _count: { select: { lines: true } } },
    });

    await logAudit({
      userId: user.userId,
      action: "CREATE",
      entity: "CountSession",
      entityId: session.id,
      detail: {
        scope: body.scope,
        warehouseId: body.warehouseId,
        binId: body.binId,
        itemId: body.itemId,
        lines: session._count.lines,
      },
    });
    return ok(res, { id: session.id, lines: session._count.lines }, 201);
  }),
);

// GET /:id — full count session detail with lines.
countsRouter.get(
  "/:id",
  wrap(async (req, res) => {
    await requireUser(req);
    const id = Number(req.params.id);
    if (Number.isNaN(id)) throw new ValidationError("Invalid id.");
    const session = await prisma.countSession.findUnique({
      where: { id },
      include: {
        warehouse: { select: { code: true, name: true } },
        createdBy: { select: { fullName: true } },
        postedBy: { select: { fullName: true } },
        lines: {
          include: {
            item: {
              select: { itemNumber: true, description: true, uom: true },
            },
            bin: { select: { code: true, barcode: true } },
            lot: { select: { lotCode: true } },
          },
          orderBy: [
            { bin: { barcode: "asc" } },
            { item: { itemNumber: "asc" } },
          ],
        },
      },
    });
    if (!session) throw new NotFoundError("Count session not found.");

    const lines = session.lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      binId: l.binId,
      lotId: l.lotId,
      itemNumber: l.item.itemNumber,
      description: l.item.description,
      uom: l.item.uom,
      binCode: l.bin.code,
      binBarcode: l.bin.barcode,
      lotCode: l.lot.lotCode,
      systemQty: new Decimal(l.systemQty).toString(),
      countedQty:
        l.countedQty != null ? new Decimal(l.countedQty).toString() : null,
      variance: l.variance != null ? new Decimal(l.variance).toString() : null,
      status: l.status,
    }));

    return ok(res, {
      session: {
        id: session.id,
        status: session.status,
        note: session.note,
        warehouse: session.warehouse,
        createdBy: session.createdBy?.fullName ?? null,
        postedBy: session.postedBy?.fullName ?? null,
        createdAt: session.createdAt,
        postedAt: session.postedAt,
        lines,
      },
    });
  }),
);

const patchSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.number().int().positive(),
        countedQty: z.string().nullable(),
      }),
    )
    .min(1),
});

// PATCH /:id/lines — save counted quantities for one or more lines.
countsRouter.patch(
  "/:id/lines",
  wrap(async (req, res) => {
    await requireUser(req);
    const sessionId = Number(req.params.id);
    if (Number.isNaN(sessionId)) throw new ValidationError("Invalid id.");
    const body = patchSchema.parse(req.body);

    const session = await prisma.countSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundError("Count session not found.");
    if (session.status === "COMPLETED")
      throw new ValidationError("This count is completed and locked.");

    const lines = await prisma.countLine.findMany({
      where: { id: { in: body.lines.map((l) => l.lineId) }, sessionId },
    });
    const byId = new Map(lines.map((l) => [l.id, l]));

    await prisma.$transaction(async (tx) => {
      for (const upd of body.lines) {
        const line = byId.get(upd.lineId);
        if (!line || line.status === "POSTED") continue; // ignore foreign / already-posted lines
        if (upd.countedQty == null || upd.countedQty.trim() === "") {
          await tx.countLine.update({
            where: { id: line.id },
            data: {
              countedQty: null,
              variance: null,
              status: "PENDING",
              countedAt: null,
            },
          });
          continue;
        }
        let counted: DecimalValue;
        try {
          counted = new Decimal(upd.countedQty);
          if (counted.isNegative()) throw new Error();
        } catch {
          throw new ValidationError(
            `Counted quantity must be a non-negative number (line ${line.id}).`,
          );
        }
        const variance = counted.minus(new Decimal(line.systemQty));
        await tx.countLine.update({
          where: { id: line.id },
          data: {
            countedQty: counted,
            variance,
            status: "COUNTED",
            countedAt: new Date(),
          },
        });
      }
      if (session.status === "OPEN") {
        await tx.countSession.update({
          where: { id: sessionId },
          data: { status: "COUNTING" },
        });
      }
    });

    return ok(res, { ok: true });
  }),
);

const addSchema = z.object({
  binId: z.number().int().positive(),
  itemId: z.number().int().positive(),
  lotId: z.number().int().positive(),
});

// POST /:id/lines — add a line for stock found that wasn't in the snapshot.
countsRouter.post(
  "/:id/lines",
  wrap(async (req, res) => {
    await requireUser(req);
    const sessionId = Number(req.params.id);
    if (Number.isNaN(sessionId)) throw new ValidationError("Invalid id.");
    const body = addSchema.parse(req.body);

    const session = await prisma.countSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundError("Count session not found.");
    if (session.status === "COMPLETED")
      throw new ValidationError("This count is completed and locked.");

    const existing = await prisma.countLine.findUnique({
      where: {
        sessionId_itemId_binId_lotId: {
          sessionId,
          itemId: body.itemId,
          binId: body.binId,
          lotId: body.lotId,
        },
      },
    });
    if (existing) return ok(res, { lineId: existing.id, existed: true });

    const level = await prisma.stockLevel.findUnique({
      where: {
        itemId_binId_lotId: {
          itemId: body.itemId,
          binId: body.binId,
          lotId: body.lotId,
        },
      },
    });
    const line = await prisma.countLine.create({
      data: {
        sessionId,
        itemId: body.itemId,
        binId: body.binId,
        lotId: body.lotId,
        systemQty: level ? level.quantity : new Decimal(0),
        status: "PENDING",
      },
    });
    return ok(res, { lineId: line.id, existed: false }, 201);
  }),
);

/**
 * POST /:id/post — post a cycle count. For each counted line we apply delta =
 * countedQty − systemQtySnapshot as a COUNT_ADJUST against CURRENT stock, which
 * preserves any legitimate movement that happened mid-count. If the adjustment
 * can't apply (would drive stock negative due to a concurrent issue), the line is
 * flagged RECOUNT instead. POSTED lines are never reprocessed, so re-posting is safe.
 */
countsRouter.post(
  "/:id/post",
  wrap(async (req, res) => {
    const user = await requireUser(req);
    const sessionId = Number(req.params.id);
    if (Number.isNaN(sessionId)) throw new ValidationError("Invalid id.");

    const session = await prisma.countSession.findUnique({
      where: { id: sessionId },
      include: { lines: true },
    });
    if (!session) throw new NotFoundError("Count session not found.");
    if (session.status === "COMPLETED")
      throw new ValidationError("This count is already completed.");

    let posted = 0;
    let noChange = 0;
    let recount = 0;
    let pending = 0;

    for (const line of session.lines) {
      if (line.status === "POSTED") continue;
      if (line.countedQty == null) {
        pending++;
        continue;
      }
      const delta = new Decimal(line.countedQty).minus(
        new Decimal(line.systemQty),
      );
      try {
        // Always record a COUNT_ADJUST movement — even when delta is 0 (verified
        // count, no stock change) — so every count leaves a transaction to audit.
        await postMovement({
          type: "COUNT_ADJUST",
          userId: user.userId,
          reference: `COUNT-${sessionId}`,
          note: delta.isZero()
            ? "Cycle count — verified, no change"
            : "Cycle count adjustment",
          allowZeroDelta: true,
          // Stable per-line key: a double-tapped or retried post replays instead
          // of double-applying the adjustment.
          clientRequestId: `count-${sessionId}-line-${line.id}`,
          lines: [
            {
              itemId: line.itemId,
              binId: line.binId,
              lotId: line.lotId,
              qtyDelta: delta,
            },
          ],
        });
        await prisma.countLine.update({
          where: { id: line.id },
          data: { status: "POSTED" },
        });
        if (delta.isZero()) noChange++;
        else posted++;
      } catch (err) {
        if (err instanceof InsufficientStockError) {
          await prisma.countLine.update({
            where: { id: line.id },
            data: { status: "RECOUNT" },
          });
          recount++;
        } else {
          throw err;
        }
      }
    }

    const completed = recount === 0;
    await prisma.countSession.update({
      where: { id: sessionId },
      data: {
        status: completed ? "COMPLETED" : "COUNTING",
        postedById: user.userId,
        postedAt: new Date(),
      },
    });
    await logAudit({
      userId: user.userId,
      action: "POST",
      entity: "CountSession",
      entityId: sessionId,
      detail: { posted, noChange, recount, pending },
    });

    return ok(res, { posted, noChange, recount, pending, completed });
  }),
);
