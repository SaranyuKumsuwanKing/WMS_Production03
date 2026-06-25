import { Router } from "express";
import { z } from "zod";
import { prisma, Decimal } from "@king-wms/database";
import { requireUser, requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { logAudit } from "../lib/audit";
import { NotFoundError, ValidationError } from "../lib/errors";

export const lotsRouter = Router();

lotsRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);
    const itemId = req.query.itemId;
    if (!itemId) return ok(res, { lots: [] });
    const lots = await prisma.lot.findMany({
      where: { itemId: Number(itemId) },
      orderBy: { lotCode: "asc" },
      include: { stockLevels: { select: { quantity: true } } },
    });
    const withTotals = lots.map((l) => {
      const onHand = l.stockLevels.reduce(
        (acc, s) => acc.plus(new Decimal(s.quantity)),
        new Decimal(0),
      );
      const { stockLevels, ...rest } = l;
      void stockLevels;
      return { ...rest, onHand: onHand.toString() };
    });
    return ok(res, { lots: withTotals });
  }),
);

const createSchema = z.object({
  itemId: z.number().int().positive(),
  lotCode: z.string().trim().min(1).max(40),
  supplier: z.string().trim().max(80).optional().nullable(),
  receivedDate: z.string().trim().optional().nullable(),
  note: z.string().trim().max(160).optional().nullable(),
});

lotsRouter.post(
  "/",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const body = createSchema.parse(req.body);
    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) throw new NotFoundError("Item not found.");
    const lot = await prisma.lot.create({
      data: {
        itemId: body.itemId,
        lotCode: body.lotCode,
        supplier: body.supplier ?? null,
        receivedDate: body.receivedDate ? new Date(body.receivedDate) : null,
        note: body.note ?? null,
      },
    });
    await logAudit({
      userId: admin.userId,
      action: "CREATE",
      entity: "Lot",
      entityId: lot.id,
      detail: lot,
    });
    return ok(res, { lot }, 201);
  }),
);

const updateSchema = z.object({
  supplier: z.string().trim().max(80).optional().nullable(),
  note: z.string().trim().max(160).optional().nullable(),
  receivedDate: z.string().trim().optional().nullable(),
  active: z.boolean().optional(),
});

lotsRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const lotId = Number(req.params.id);
    if (Number.isNaN(lotId)) throw new ValidationError("Invalid lot id.");
    const body = updateSchema.parse(req.body);

    if (body.active === false) {
      const stock = await prisma.stockLevel.findFirst({
        where: { lotId, quantity: { not: 0 } },
      });
      if (stock)
        throw new ValidationError(
          "Cannot deactivate: this lot still holds stock.",
        );
    }

    const lot = await prisma.lot.update({
      where: { id: lotId },
      data: {
        ...(body.supplier !== undefined ? { supplier: body.supplier } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        ...(body.receivedDate !== undefined
          ? {
              receivedDate: body.receivedDate
                ? new Date(body.receivedDate)
                : null,
            }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    await logAudit({
      userId: admin.userId,
      action: "UPDATE",
      entity: "Lot",
      entityId: lotId,
      detail: body,
    });
    return ok(res, { lot });
  }),
);
