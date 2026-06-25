import { Router } from "express";
import { prisma } from "@king-wms/database";
import { requireUser } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import {
  getDashboardStats,
  getOldestStock,
  getCountStats,
  getMovementTrend,
  getStockByInventoryType,
} from "../lib/stock";
import { summarizeMovement, type MovementView } from "../lib/movements";
import { MOVEMENT_LABELS, type MovementType } from "../lib/constants";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);

    const [stats, oldest, countStats, movementTrend, stockByType, movements] =
      await Promise.all([
        getDashboardStats(),
        getOldestStock(8),
        getCountStats(21),
        getMovementTrend(14),
        getStockByInventoryType(),
        prisma.stockMovement.findMany({
          take: 8,
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { fullName: true, username: true } },
            lines: {
              include: {
                item: { select: { itemNumber: true, uom: true } },
                bin: { select: { code: true, barcode: true } },
                lot: { select: { lotCode: true } },
              },
            },
          },
        }),
      ]);

    // Flatten each movement to the exact fields the dashboard row renders,
    // resolving the one-line summary + display label server-side so the static
    // client never needs the server-only summarizeMovement helper.
    const recentMovements = movements.map((m) => {
      const summary = summarizeMovement(m as unknown as MovementView);
      const type = m.type as MovementType;
      return {
        id: m.id,
        type: m.type,
        typeLabel: MOVEMENT_LABELS[type] ?? m.type,
        createdAt: m.createdAt.toISOString(),
        user: m.user?.fullName ?? null,
        itemNumber: summary.itemNumber,
        text: summary.text,
      };
    });

    return ok(res, {
      stats,
      oldest,
      countStats,
      movementTrend,
      stockByType,
      recentMovements,
    });
  }),
);
