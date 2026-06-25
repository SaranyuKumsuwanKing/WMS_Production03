import { Router } from "express";
import { prisma, Decimal } from "@king-wms/database";
import { requireUser } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { NotFoundError, ValidationError } from "../lib/errors";
import {
  findItem,
  findBin,
  binContents,
  stockForItemInBin,
} from "../lib/lookup";

export const lookupRouter = Router();

lookupRouter.get(
  "/item",
  wrap(async (req, res) => {
    await requireUser(req);
    const code = (req.query.code as string | undefined) ?? "";
    const item = await findItem(code);
    if (!item) throw new NotFoundError(`No item found for "${code}".`);
    if (!item.active)
      throw new NotFoundError(`Item ${item.itemNumber} is inactive.`);
    const lots = await prisma.lot.findMany({
      where: { itemId: item.id, active: true },
      orderBy: { lotCode: "asc" },
      select: { id: true, lotCode: true, supplier: true },
    });
    // Total on-hand per lot (summed across all bins) so the scan screen can show
    // a quantity next to each lot's batch + vendor.
    const sums = lots.length
      ? await prisma.stockLevel.groupBy({
          by: ["lotId"],
          where: { lotId: { in: lots.map((l) => l.id) }, quantity: { gt: 0 } },
          _sum: { quantity: true },
        })
      : [];
    const qtyByLot = new Map(sums.map((s) => [s.lotId, s._sum.quantity]));
    const lotsWithQty = lots.map((l) => ({
      ...l,
      quantity: new Decimal(qtyByLot.get(l.id) ?? 0).toString(),
    }));
    return ok(res, { item, lots: lotsWithQty });
  }),
);

lookupRouter.get(
  "/bin",
  wrap(async (req, res) => {
    await requireUser(req);
    const code = (req.query.code as string | undefined) ?? "";
    const bin = await findBin(code);
    if (!bin) throw new NotFoundError(`No bin found for "${code}".`);
    if (!bin.active) throw new NotFoundError(`Bin ${bin.barcode} is inactive.`);
    const contents = await binContents(bin.id);
    return ok(res, { bin, contents });
  }),
);

lookupRouter.get(
  "/stock",
  wrap(async (req, res) => {
    await requireUser(req);
    const binId = Number(req.query.binId);
    const itemId = Number(req.query.itemId);
    if (!binId || !itemId)
      throw new ValidationError("binId and itemId are required.");
    const lots = await stockForItemInBin(binId, itemId);
    return ok(res, { lots });
  }),
);
