import { Router } from "express";
import { requireUser } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { ValidationError } from "../lib/errors";
import { getPickableStock } from "../lib/fifo";

export const pickRouter = Router();

pickRouter.get(
  "/available",
  wrap(async (req, res) => {
    await requireUser(req);
    const itemId = Number(req.query.itemId);
    if (!itemId) throw new ValidationError("itemId is required.");
    return ok(res, await getPickableStock(itemId));
  }),
);
