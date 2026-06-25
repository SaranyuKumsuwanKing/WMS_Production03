import { Router } from "express";
import ExcelJS from "exceljs";
import { prisma } from "@king-wms/database";
import { requireUser } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { summarizeMovement, type MovementView } from "../lib/movements";
import {
  MOVEMENT_LABELS,
  MOVEMENT_TYPES,
  type MovementType,
} from "../lib/constants";
import { parseFormat, toCsv, type ExportColumn } from "../lib/export";

export const movementsRouter = Router();

const COLUMNS: ExportColumn[] = [
  { header: "Date/Time", key: "ts", width: 20 },
  { header: "Type", key: "type", width: 14 },
  { header: "Item", key: "item", width: 18 },
  { header: "Bin", key: "bin", width: 16 },
  { header: "Lot", key: "lot", width: 16 },
  { header: "Qty Change", key: "qty", width: 12 },
  { header: "UoM", key: "uom", width: 8 },
  { header: "Reference", key: "ref", width: 16 },
  { header: "User", key: "user", width: 20 },
  { header: "Movement #", key: "mid", width: 12 },
];

const BASE = "stock-movements";

// GET /export — must be registered before GET / so it is not shadowed.
movementsRouter.get(
  "/export",
  wrap(async (req, res) => {
    await requireUser(req);
    const type = typeof req.query.type === "string" ? req.query.type : null;
    const format = parseFormat(
      typeof req.query.format === "string" ? req.query.format : null,
    );

    const movements = await prisma.stockMovement.findMany({
      where:
        type && (MOVEMENT_TYPES as readonly string[]).includes(type)
          ? { type }
          : {},
      orderBy: { createdAt: "desc" },
      take: 100000,
      include: {
        user: { select: { fullName: true } },
        lines: {
          include: {
            item: { select: { itemNumber: true, uom: true } },
            bin: { select: { barcode: true } },
            lot: { select: { lotCode: true } },
          },
        },
      },
    });

    const data: Record<string, unknown>[] = [];
    for (const m of movements) {
      for (const l of m.lines) {
        data.push({
          ts: new Date(m.createdAt).toLocaleString("en-GB"),
          type: m.type,
          item: l.item.itemNumber,
          bin: l.bin.barcode,
          lot: l.lot.lotCode,
          qty: Number(l.qtyDelta),
          uom: l.item.uom,
          ref: m.reference ?? "",
          user: m.user?.fullName ?? "",
          mid: m.id,
        });
      }
    }

    if (format === "csv" || format === "json") {
      const body =
        format === "csv"
          ? "﻿" + toCsv(COLUMNS, data) // BOM so Excel reads UTF-8 (Thai) correctly
          : JSON.stringify(data, null, 2);
      res.setHeader(
        "Content-Type",
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/json; charset=utf-8",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${BASE}.${format}"`,
      );
      res.send(body);
      return;
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Movements");
    ws.columns = COLUMNS;
    ws.getRow(1).font = { bold: true };
    for (const r of data) ws.addRow(r);

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${BASE}.xlsx"`);
    res.send(Buffer.from(buf as ArrayBuffer));
  }),
);

// GET / — list recent stock movements with optional filters.
movementsRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);
    const type = typeof req.query.type === "string" ? req.query.type : null;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const userId = Number(
      typeof req.query.userId === "string" ? req.query.userId : NaN,
    );
    const limit = Math.min(
      Number(typeof req.query.limit === "string" ? req.query.limit : NaN) ||
        200,
      1000,
    );

    const movements = await prisma.stockMovement.findMany({
      where: {
        ...(type && (MOVEMENT_TYPES as readonly string[]).includes(type)
          ? { type }
          : {}),
        ...(userId ? { userId } : {}),
        ...(q
          ? {
              OR: [
                { reference: { contains: q } },
                {
                  lines: {
                    some: {
                      item: { itemNumber: { contains: q.toUpperCase() } },
                    },
                  },
                },
                {
                  lines: {
                    some: { bin: { barcode: { contains: q.toUpperCase() } } },
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
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
    });

    const rows = movements.map((m) => {
      const view = m as unknown as MovementView;
      const s = summarizeMovement(view);
      return {
        id: m.id,
        type: m.type,
        typeLabel: MOVEMENT_LABELS[m.type as MovementType] ?? m.type,
        reference: m.reference,
        note: m.note,
        createdAt: m.createdAt,
        user: m.user?.fullName ?? null,
        itemNumber: s.itemNumber,
        qty: s.qty,
        uom: s.uom,
        location: s.location,
        lot: s.lot,
      };
    });
    return ok(res, { movements: rows });
  }),
);
