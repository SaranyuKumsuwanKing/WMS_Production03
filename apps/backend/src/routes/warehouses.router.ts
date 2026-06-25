import { Router } from "express";
import { z } from "zod";
import { prisma } from "@king-wms/database";
import { requireUser, requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { logAudit } from "../lib/audit";
import { ValidationError } from "../lib/errors";

export const warehousesRouter = Router();

warehousesRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);
    const warehouses = await prisma.warehouse.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { bins: true } } },
    });
    return ok(res, { warehouses });
  }),
);

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Code: letters, numbers, - or _ only"),
  name: z.string().trim().min(1).max(80),
});

warehousesRouter.post(
  "/",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const body = createSchema.parse(req.body);
    const wh = await prisma.warehouse.create({
      data: { code: body.code.toUpperCase(), name: body.name },
    });
    await logAudit({
      userId: admin.userId,
      action: "CREATE",
      entity: "Warehouse",
      entityId: wh.id,
      detail: wh,
    });
    return ok(res, { warehouse: wh }, 201);
  }),
);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
});

warehousesRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const wid = Number(req.params.id);
    const body = updateSchema.parse(req.body);

    if (body.active === false) {
      const stock = await prisma.stockLevel.findFirst({
        where: { bin: { warehouseId: wid }, quantity: { not: 0 } },
      });
      if (stock) {
        throw new ValidationError(
          "Cannot deactivate: stock still exists in this warehouse. Move or issue it first.",
        );
      }
    }

    const wh = await prisma.warehouse.update({
      where: { id: wid },
      data: body,
    });
    await logAudit({
      userId: admin.userId,
      action: "UPDATE",
      entity: "Warehouse",
      entityId: wid,
      detail: body,
    });
    return ok(res, { warehouse: wh });
  }),
);
