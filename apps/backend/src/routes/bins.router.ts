import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "@king-wms/database";
import { requireUser, requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { logAudit } from "../lib/audit";
import { NotFoundError, ValidationError } from "../lib/errors";
import { binBarcode, pad } from "../lib/barcode";
import { BIN_TYPES, isBinType } from "../lib/constants";
import { parseBinUpload } from "../lib/import";
import { upload } from "../lib/upload";

export const binsRouter = Router();

// GET / + POST / -------------------------------------------------------------
binsRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);
    const warehouseId =
      typeof req.query.warehouseId === "string"
        ? req.query.warehouseId
        : undefined;
    const type =
      (typeof req.query.type === "string" ? req.query.type : "")?.trim() ||
      undefined;
    const q =
      (typeof req.query.q === "string" ? req.query.q : "")?.trim() || undefined;
    const bins = await prisma.bin.findMany({
      where: {
        ...(warehouseId ? { warehouseId: Number(warehouseId) } : {}),
        ...(type && isBinType(type) ? { type } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q } },
                { barcode: { contains: q } },
                { description: { contains: q } },
              ],
            }
          : {}),
      },
      include: { warehouse: { select: { code: true, name: true } } },
      orderBy: [{ warehouseId: "asc" }, { code: "asc" }],
    });
    return ok(res, { bins });
  }),
);

const createSchema = z.object({
  warehouseId: z.number().int().positive(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Code: letters, numbers, - or _ only"),
  description: z.string().trim().max(120).optional().nullable(),
  type: z.enum(BIN_TYPES).default("STORAGE"),
});

binsRouter.post(
  "/",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const body = createSchema.parse(req.body);
    const wh = await prisma.warehouse.findUnique({
      where: { id: body.warehouseId },
    });
    if (!wh) throw new NotFoundError("Warehouse not found.");
    const code = body.code.toUpperCase();
    const bin = await prisma.bin.create({
      data: {
        warehouseId: body.warehouseId,
        code,
        description: body.description ?? null,
        type: body.type,
        barcode: binBarcode(wh.code, code),
      },
    });
    await logAudit({
      userId: admin.userId,
      action: "CREATE",
      entity: "Bin",
      entityId: bin.id,
      detail: bin,
    });
    return ok(res, { bin }, 201);
  }),
);

// POST /bulk -----------------------------------------------------------------
const bulkSchema = z.object({
  warehouseId: z.number().int().positive(),
  type: z.enum(BIN_TYPES).default("STORAGE"),
  prefix: z
    .string()
    .trim()
    .max(16)
    .regex(/^[A-Za-z0-9_-]*$/, "Prefix: letters, numbers, - or _ only"),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  padding: z.number().int().min(0).max(6).default(2),
});

binsRouter.post(
  "/bulk",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const body = bulkSchema.parse(req.body);
    if (body.end < body.start)
      throw new ValidationError("End must be greater than or equal to start.");
    if (body.end - body.start + 1 > 1000)
      throw new ValidationError("Cannot create more than 1000 bins at once.");

    const wh = await prisma.warehouse.findUnique({
      where: { id: body.warehouseId },
    });
    if (!wh) throw new NotFoundError("Warehouse not found.");

    const prefix = body.prefix.toUpperCase();
    const existing = new Set(
      (
        await prisma.bin.findMany({
          where: { warehouseId: body.warehouseId },
          select: { code: true },
        })
      ).map((b) => b.code),
    );

    const toCreate: {
      warehouseId: number;
      code: string;
      type: string;
      barcode: string;
    }[] = [];
    for (let i = body.start; i <= body.end; i++) {
      const code = `${prefix}${pad(i, body.padding)}`;
      if (existing.has(code)) continue;
      toCreate.push({
        warehouseId: body.warehouseId,
        code,
        type: body.type,
        barcode: binBarcode(wh.code, code),
      });
    }

    if (toCreate.length) {
      await prisma.bin.createMany({ data: toCreate });
    }
    await logAudit({
      userId: admin.userId,
      action: "BULK_CREATE",
      entity: "Bin",
      entityId: body.warehouseId,
      detail: {
        created: toCreate.length,
        skipped: body.end - body.start + 1 - toCreate.length,
        prefix,
      },
    });
    return ok(res, {
      created: toCreate.length,
      skipped: body.end - body.start + 1 - toCreate.length,
    });
  }),
);

// POST /import ---------------------------------------------------------------
binsRouter.post(
  "/import",
  upload.single("file"),
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const file = req.file;
    if (!file) throw new ValidationError("No file uploaded.");

    const parsed = await parseBinUpload(file.buffer, file.originalname);
    if (parsed.missingColumns.length) {
      throw new ValidationError(
        `Could not find required column(s): ${parsed.missingColumns.join(", ")}. The file needs Warehouse and Bin Code columns.`,
      );
    }
    if (parsed.rows.length > 50000)
      throw new ValidationError("File too large (over 50,000 rows).");

    const warehouses = await prisma.warehouse.findMany();
    const whByCode = new Map(warehouses.map((w) => [w.code, w]));

    let created = 0;
    const skipped: { code: string; reason: string }[] = [];
    const errors: { rowNumber: number; message: string }[] = [
      ...parsed.rowErrors,
    ];

    for (const row of parsed.rows) {
      const wh = whByCode.get(row.warehouse);
      if (!wh) {
        errors.push({
          rowNumber: row.rowNumber,
          message: `Warehouse ${row.warehouse} not found`,
        });
        continue;
      }
      const type = isBinType(row.type) ? row.type : "STORAGE";
      const existing = await prisma.bin.findUnique({
        where: { warehouseId_code: { warehouseId: wh.id, code: row.code } },
      });
      if (existing) {
        skipped.push({
          code: `${row.warehouse}-${row.code}`,
          reason: "already exists",
        });
        continue;
      }
      await prisma.bin.create({
        data: {
          warehouseId: wh.id,
          code: row.code,
          type,
          description: row.description,
          barcode: binBarcode(wh.code, row.code),
        },
      });
      created++;
    }

    await logAudit({
      userId: admin.userId,
      action: "BIN_UPLOAD",
      entity: "Bin",
      detail: {
        file: file.originalname,
        created,
        skipped: skipped.length,
        errors: errors.length,
      },
    });
    return ok(res, { created, skipped, errors, processed: parsed.rows.length });
  }),
);

// GET /template (CSV) --------------------------------------------------------
binsRouter.get(
  "/template",
  wrap(async (req, res) => {
    await requireUser(req);
    const csv = [
      "Warehouse,Bin Code,Type,Description",
      "FOAM,A05,STORAGE,Storage bin A05",
      "FOAM,B03,STORAGE,Storage bin B03",
      "FABRIC,RECV,RECEIVING,Receiving area",
      "FABRIC,RET,RETURNS,Returns from production",
    ].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bins-template.csv"',
    );
    return res.send(csv);
  }),
);

// GET /template/xlsx ---------------------------------------------------------
binsRouter.get(
  "/template/xlsx",
  wrap(async (req, res) => {
    await requireUser(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Bins");
    ws.columns = [
      { header: "Warehouse", key: "warehouse", width: 16 },
      { header: "Bin Code", key: "code", width: 16 },
      { header: "Type", key: "type", width: 16 },
      { header: "Description", key: "description", width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFEFEF" },
    };
    ws.addRow({
      warehouse: "FOAM",
      code: "A05",
      type: "STORAGE",
      description: "Storage bin A05",
    });
    ws.addRow({
      warehouse: "FOAM",
      code: "B03",
      type: "STORAGE",
      description: "Storage bin B03",
    });
    ws.addRow({
      warehouse: "FABRIC",
      code: "RECV",
      type: "RECEIVING",
      description: "Receiving area",
    });

    const notes = wb.addWorksheet("Instructions");
    notes.columns = [{ width: 100 }];
    [
      "Storage-bin upload — how to use:",
      "1. One row per bin. Delete the example rows.",
      "2. Required: Warehouse (the warehouse CODE, e.g. FOAM), Bin Code (e.g. A05).",
      `3. Type (optional, default STORAGE): one of ${BIN_TYPES.join(", ")}.`,
      "4. The barcode is generated automatically as WAREHOUSE-BINCODE (e.g. FOAM-A05).",
      "5. Existing bins (same warehouse + code) are skipped.",
    ].forEach((t) => notes.addRow([t]));

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bins-template.xlsx"',
    );
    return res.send(Buffer.from(buf as ArrayBuffer));
  }),
);

// PATCH /:id -----------------------------------------------------------------
const updateSchema = z.object({
  description: z.string().trim().max(120).optional().nullable(),
  type: z.enum(BIN_TYPES).optional(),
  active: z.boolean().optional(),
});

binsRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const binId = Number(req.params.id);
    const body = updateSchema.parse(req.body);

    if (body.active === false) {
      const stock = await prisma.stockLevel.findFirst({
        where: { binId, quantity: { not: 0 } },
      });
      if (stock)
        throw new ValidationError(
          "Cannot deactivate: this bin still holds stock. Move or issue it first.",
        );
    }

    const bin = await prisma.bin.update({ where: { id: binId }, data: body });
    await logAudit({
      userId: admin.userId,
      action: "UPDATE",
      entity: "Bin",
      entityId: binId,
      detail: body,
    });
    return ok(res, { bin });
  }),
);
