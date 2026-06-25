import { Router } from "express";
import { requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { runBackup } from "../lib/backup";
import { recomputeStockFromLedger } from "../lib/inventory";
import { logAudit } from "../lib/audit";

export const adminRouter = Router();

adminRouter.post(
  "/backup",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const result = await runBackup(stamp);
    await logAudit({
      userId: admin.userId,
      action: "BACKUP",
      entity: "Database",
      detail: result,
    });
    return ok(res, result);
  }),
);

// Rebuild every StockLevel from the StockMovementLine ledger. The ledger is the
// source of truth, so this safely reconciles the materialized on-hand cache.
adminRouter.post(
  "/recompute",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const result = await recomputeStockFromLedger();
    await logAudit({
      userId: admin.userId,
      action: "RECOMPUTE_STOCK",
      entity: "StockLevel",
      detail: result,
    });
    return ok(res, result);
  }),
);
