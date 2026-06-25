import { Router } from "express";
import { prisma } from "@king-wms/database";
import { requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";

export const auditRouter = Router();

auditRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireAdmin(req);
    const entity =
      typeof req.query.entity === "string" ? req.query.entity : null;
    const logs = await prisma.auditLog.findMany({
      where: entity ? { entity } : {},
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { user: { select: { fullName: true, username: true } } },
    });
    return ok(res, { logs });
  }),
);
