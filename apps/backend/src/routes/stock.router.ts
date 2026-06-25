import { Router } from "express";
import ExcelJS from "exceljs";
import { prisma } from "@king-wms/database";
import { requireUser, requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { ValidationError } from "../lib/errors";
import { logAudit } from "../lib/audit";
import { getStockRows } from "../lib/stock";
import { isBinType } from "../lib/constants";
import { parseStockUpload } from "../lib/import";
import { findBin } from "../lib/lookup";
import { resolveReceiptLot } from "../lib/lots";
import { receiveGoods } from "../lib/inventory";
import { upload } from "../lib/upload";
import {
  parseFormat,
  toCsv,
  xlsxHeaders,
  type ExportColumn,
} from "../lib/export";

export const stockRouter = Router();

function num(v: unknown): number | undefined {
  const s = typeof v === "string" ? v : v == null ? null : String(v);
  const n = Number(s);
  return s && Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// ---- GET / (stock-on-hand list) ----
stockRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);
    const type = str(req.query.type);
    const { rows, total } = await getStockRows({
      q: str(req.query.q) ?? undefined,
      warehouseId: num(req.query.warehouseId),
      binId: num(req.query.binId),
      itemId: num(req.query.itemId),
      binType: type && isBinType(type) ? type : undefined,
    });
    return ok(res, { rows, total, truncated: total > rows.length });
  }),
);

// ---- GET /export (xlsx | csv | json) ----
const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Item Number", key: "itemNumber", width: 18 },
  { header: "Description", key: "description", width: 38 },
  { header: "Category", key: "category", width: 16 },
  { header: "Inventory Type", key: "inventoryType", width: 14 },
  { header: "Warehouse", key: "warehouseCode", width: 12 },
  { header: "Bin", key: "binCode", width: 12 },
  { header: "Bin Barcode", key: "binBarcode", width: 18 },
  { header: "Bin Type", key: "binType", width: 12 },
  { header: "Lot", key: "lotCode", width: 16 },
  { header: "Reference", key: "reference", width: 18 },
  { header: "Quantity", key: "quantity", width: 12 },
  { header: "UoM", key: "uom", width: 8 },
  { header: "Age (days)", key: "ageDays", width: 10 },
  { header: "Last Received", key: "lastReceivedAt", width: 18 },
];

const EXPORT_BASE = "stock-on-hand";

stockRouter.get(
  "/export",
  wrap(async (req, res) => {
    await requireUser(req);
    const type = str(req.query.type);
    const format = parseFormat(str(req.query.format));
    const { rows } = await getStockRows(
      {
        q: str(req.query.q) ?? undefined,
        warehouseId: num(req.query.warehouseId),
        binId: num(req.query.binId),
        itemId: num(req.query.itemId),
        binType: type && isBinType(type) ? type : undefined,
      },
      100000,
    );

    const data = rows.map((r) => ({
      itemNumber: r.itemNumber,
      description: r.description,
      category: r.category ?? "",
      inventoryType: r.inventoryType ?? "",
      warehouseCode: r.warehouseCode,
      binCode: r.binCode,
      binBarcode: r.binBarcode,
      binType: r.binType,
      lotCode: r.lotCode,
      reference: r.reference ?? "",
      quantity: Number(r.quantity),
      uom: r.uom,
      ageDays: r.ageDays ?? "",
      lastReceivedAt: r.lastReceivedAt ? new Date(r.lastReceivedAt) : "",
    }));

    if (format === "csv" || format === "json") {
      // Mirror lib/export.textExportResponse() exactly (it builds a web Response
      // we can't return from Express): same body + Content-Type/Disposition.
      const body =
        format === "csv"
          ? "﻿" + toCsv(EXPORT_COLUMNS, data) // BOM so Excel reads UTF-8 (Thai)
          : JSON.stringify(data, null, 2);
      res.setHeader(
        "Content-Type",
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/json; charset=utf-8",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${EXPORT_BASE}.${format}"`,
      );
      return res.send(body);
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Stock on hand");
    ws.columns = EXPORT_COLUMNS;
    ws.getRow(1).font = { bold: true };
    for (const r of data) ws.addRow(r);

    const buf = await wb.xlsx.writeBuffer();
    const headers = xlsxHeaders(EXPORT_BASE);
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res.send(Buffer.from(buf as ArrayBuffer));
  }),
);

// ---- POST /import (admin opening-stock mass upload) ----
// Accepts multipart/form-data with a single `file` field (the parser reads the
// filename to pick CSV vs XLSX). Handled by multer (memory storage).
stockRouter.post(
  "/import",
  upload.single("file"),
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const file = req.file;
    if (!file || file.size === 0)
      throw new ValidationError("No file uploaded.");

    const parsed = await parseStockUpload(file.buffer, file.originalname);
    if (parsed.missingColumns.length) {
      throw new ValidationError(
        `Could not find required column(s): ${parsed.missingColumns.join(", ")}. The file needs Item Number, Bin and Quantity columns.`,
      );
    }
    if (parsed.rows.length > 50000)
      throw new ValidationError("File too large (over 50,000 rows).");

    let posted = 0;
    const errors: { rowNumber: number; message: string }[] = [
      ...parsed.rowErrors,
    ];

    for (const row of parsed.rows) {
      try {
        const item = await prisma.item.findUnique({
          where: { itemNumber: row.itemNumber },
        });
        if (!item) {
          errors.push({
            rowNumber: row.rowNumber,
            message: `Item ${row.itemNumber} not found`,
          });
          continue;
        }
        const bin = await findBin(row.bin);
        if (!bin) {
          errors.push({
            rowNumber: row.rowNumber,
            message: `Bin ${row.bin} not found`,
          });
          continue;
        }
        const lot = await resolveReceiptLot(item, row.lot);
        await receiveGoods({
          itemId: item.id,
          lotId: lot.id,
          binId: bin.id,
          quantity: row.quantity,
          userId: admin.userId,
          reference: "OPENING",
          note: "Opening stock upload",
        });
        posted++;
      } catch (e) {
        errors.push({
          rowNumber: row.rowNumber,
          message: e instanceof Error ? e.message : "Failed",
        });
      }
    }

    await logAudit({
      userId: admin.userId,
      action: "STOCK_UPLOAD",
      entity: "StockLevel",
      detail: { file: file.originalname, posted, errors: errors.length },
    });
    return ok(res, { posted, errors, processed: parsed.rows.length });
  }),
);

// ---- GET /template (CSV) ----
stockRouter.get(
  "/template",
  wrap(async (req, res) => {
    await requireUser(req);
    const csv = [
      "Item Number,Bin Barcode,Lot,Quantity",
      "FOAM-1845,FOAM-A01,LOT-F1845-A,50",
      "FAB-LIN-GR,FABRIC-A01,DYE-2231,120.5",
      "HW-SCR-40,HARDWARE-A01,,5000",
    ].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="opening-stock-template.csv"',
    );
    return res.send(csv);
  }),
);

// ---- GET /template/xlsx ----
stockRouter.get(
  "/template/xlsx",
  wrap(async (req, res) => {
    await requireUser(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Opening Stock");
    ws.columns = [
      { header: "Item Number", key: "itemNumber", width: 20 },
      { header: "Bin Barcode", key: "bin", width: 18 },
      { header: "Lot", key: "lot", width: 18 },
      { header: "Quantity", key: "qty", width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFEFEF" },
    };
    ws.addRow({
      itemNumber: "FOAM-1845",
      bin: "FOAM-A01",
      lot: "LOT-F1845-A",
      qty: 50,
    });
    ws.addRow({
      itemNumber: "FAB-LIN-GR",
      bin: "FABRIC-A01",
      lot: "DYE-2231",
      qty: 120.5,
    });
    ws.addRow({
      itemNumber: "HW-SCR-40",
      bin: "HARDWARE-A01",
      lot: "",
      qty: 5000,
    });

    const notes = wb.addWorksheet("Instructions");
    notes.columns = [{ width: 100 }];
    [
      "Opening stock upload — how to use:",
      "1. One row per item + bin + lot. Delete the example rows.",
      "2. Required: Item Number, Bin Barcode (the scannable code, e.g. FOAM-A01), Quantity (> 0).",
      "3. Lot is required for lot-controlled items; leave blank for non-lot items.",
      "4. The item and bin must already exist (load the Material Master and create bins first).",
      "5. Each row posts a goods receipt. This is ADDITIVE — uploading the same file twice adds the stock twice.",
    ].forEach((t) => notes.addRow([t]));

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="opening-stock-template.xlsx"',
    );
    return res.send(Buffer.from(buf as ArrayBuffer));
  }),
);
