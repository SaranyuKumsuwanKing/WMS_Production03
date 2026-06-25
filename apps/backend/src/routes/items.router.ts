import { Router } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma, Decimal, type DecimalValue } from "@king-wms/database";
import { requireUser, requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { logAudit } from "../lib/audit";
import { ValidationError, NotFoundError } from "../lib/errors";
import { INVENTORY_TYPES } from "../lib/constants";
import { parseMaterialMaster } from "../lib/import";
import { upload } from "../lib/upload";

export const itemsRouter = Router();

// GET / + POST / -------------------------------------------------------------
itemsRouter.get(
  "/",
  wrap(async (req, res) => {
    await requireUser(req);
    const q =
      (typeof req.query.q === "string" ? req.query.q : "")?.trim() || undefined;
    const category =
      (typeof req.query.category === "string"
        ? req.query.category
        : ""
      )?.trim() || undefined;
    const where = {
      ...(q
        ? {
            OR: [
              { itemNumber: { contains: q } },
              { description: { contains: q } },
              { barcode: { contains: q } },
            ],
          }
        : {}),
      ...(category ? { category } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        orderBy: { itemNumber: "asc" },
        take: 300,
        include: { _count: { select: { lots: true } } },
      }),
      prisma.item.count({ where }),
    ]);
    return ok(res, { items, total, truncated: total > items.length });
  }),
);

const createSchema = z.object({
  itemNumber: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(160),
  uom: z.string().trim().min(1).max(12),
  category: z.string().trim().max(60).optional().nullable(),
  inventoryType: z.enum(INVENTORY_TYPES).optional().nullable(),
  minStock: z.string().trim().optional().nullable(),
  lotControlled: z.boolean().optional(),
});

function parseMinStock(v: string | null | undefined): DecimalValue | null {
  if (v == null || v === "") return null;
  try {
    const d = new Decimal(v);
    if (d.isNegative()) throw new Error();
    return d;
  } catch {
    throw new ValidationError("Min stock must be a non-negative number.");
  }
}

itemsRouter.post(
  "/",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const body = createSchema.parse(req.body);
    const itemNumber = body.itemNumber.toUpperCase();
    const item = await prisma.item.create({
      data: {
        itemNumber,
        description: body.description,
        uom: body.uom.toUpperCase(),
        category: body.category ?? null,
        inventoryType: body.inventoryType ?? null,
        minStock: parseMinStock(body.minStock),
        lotControlled: body.lotControlled ?? true,
        barcode: itemNumber,
      },
    });
    await logAudit({
      userId: admin.userId,
      action: "CREATE",
      entity: "Item",
      entityId: item.id,
      detail: { itemNumber },
    });
    return ok(res, { item }, 201);
  }),
);

// POST /import ---------------------------------------------------------------
function toMinStock(v: string | null): DecimalValue | null {
  if (!v) return null;
  try {
    const d = new Decimal(v);
    return d.isNegative() ? null : d;
  } catch {
    return null;
  }
}

itemsRouter.post(
  "/import",
  upload.single("file"),
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const file = req.file;
    if (!file) throw new ValidationError("No file uploaded.");

    const parsed = await parseMaterialMaster(file.buffer, file.originalname);

    if (parsed.missingColumns.length) {
      throw new ValidationError(
        `Could not find required column(s): ${parsed.missingColumns.join(", ")}. The file needs at least Item Number, Description and Unit of Measure columns.`,
      );
    }
    if (parsed.items.length > 50000)
      throw new ValidationError("File too large (over 50,000 rows).");

    let created = 0;
    let updated = 0;
    const skipped: { itemNumber: string; reason: string }[] = [];

    for (const row of parsed.items) {
      const minStock = toMinStock(row.minStock);
      const existing = await prisma.item.findUnique({
        where: { itemNumber: row.itemNumber },
      });
      if (!existing) {
        await prisma.item.create({
          data: {
            itemNumber: row.itemNumber,
            description: row.description,
            uom: row.uom,
            category: row.category,
            inventoryType: row.inventoryType,
            minStock,
            lotControlled: row.lotControlled ?? true,
            barcode: row.itemNumber,
          },
        });
        created++;
        continue;
      }
      const hasStock =
        (await prisma.stockLevel.findFirst({
          where: { itemId: existing.id, quantity: { not: 0 } },
        })) != null;
      const uomChanged = row.uom !== existing.uom;
      if (uomChanged && hasStock) {
        skipped.push({
          itemNumber: row.itemNumber,
          reason: `Kept UoM ${existing.uom} (item holds stock; ignored change to ${row.uom})`,
        });
      }
      await prisma.item.update({
        where: { id: existing.id },
        data: {
          description: row.description,
          uom: uomChanged && hasStock ? existing.uom : row.uom,
          category: row.category ?? existing.category,
          ...(row.inventoryType ? { inventoryType: row.inventoryType } : {}),
          ...(minStock !== null ? { minStock } : {}),
          ...(row.lotControlled !== null
            ? { lotControlled: row.lotControlled }
            : {}),
          active: true,
        },
      });
      updated++;
    }

    await logAudit({
      userId: admin.userId,
      action: "IMPORT",
      entity: "Item",
      detail: {
        file: file.originalname,
        created,
        updated,
        skipped: skipped.length,
        rowErrors: parsed.rowErrors.length,
      },
    });

    return ok(res, {
      created,
      updated,
      skipped,
      rowErrors: parsed.rowErrors,
      processed: parsed.items.length,
    });
  }),
);

// GET /template (CSV) --------------------------------------------------------
itemsRouter.get(
  "/template",
  wrap(async (req, res) => {
    await requireUser(req);
    const csv = [
      "Item Number,Description,Unit of Measure,Category,Inventory Type,Lot Controlled",
      "FOAM-1845,Foam Sheet 1845 High Density,EA,Foam,RM,Yes",
      "FAB-LIN-GR,Linen Fabric Grey,M,Fabric,RM,Yes",
      "WIP-SEAT-01,Sofa Seat Assembly,EA,Assembly,WIP,Yes",
      "FG-SOFA-3S,3-Seat Sofa,EA,Finished,FG,No",
    ].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="material-master-template.csv"',
    );
    return res.send(csv);
  }),
);

// GET /template/xlsx ---------------------------------------------------------
itemsRouter.get(
  "/template/xlsx",
  wrap(async (req, res) => {
    await requireUser(req);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Items");
    ws.columns = [
      { header: "Item Number", key: "itemNumber", width: 20 },
      { header: "Description", key: "description", width: 40 },
      { header: "Unit of Measure", key: "uom", width: 16 },
      { header: "Category", key: "category", width: 18 },
      { header: "Inventory Type", key: "invType", width: 16 },
      { header: "Lot Controlled", key: "lot", width: 16 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFEFEFEF" },
    };
    ws.addRow({
      itemNumber: "FOAM-1845",
      description: "Foam Sheet 1845 High Density",
      uom: "EA",
      category: "Foam",
      invType: "RM",
      lot: "Yes",
    });
    ws.addRow({
      itemNumber: "FAB-LIN-GR",
      description: "Linen Fabric Grey",
      uom: "M",
      category: "Fabric",
      invType: "RM",
      lot: "Yes",
    });
    ws.addRow({
      itemNumber: "WIP-SEAT-01",
      description: "Sofa Seat Assembly",
      uom: "EA",
      category: "Assembly",
      invType: "WIP",
      lot: "Yes",
    });
    ws.addRow({
      itemNumber: "FG-SOFA-3S",
      description: "3-Seat Sofa",
      uom: "EA",
      category: "Finished",
      invType: "FG",
      lot: "No",
    });

    const notes = wb.addWorksheet("Instructions");
    notes.columns = [{ width: 100 }];
    [
      "How to use this template:",
      "1. Fill the 'Items' sheet — one row per item. Delete the example rows.",
      "2. Required columns: Item Number, Description, Unit of Measure.",
      "3. Optional: Category; Inventory Type (RM = Raw Material, WIP = Work In Progress, FG = Finished Goods); Lot Controlled (Yes/No — Yes means the item tracks lot/batch numbers).",
      "4. Item Number is the unique key. Re-uploading updates existing items by Item Number.",
      "5. Save as .xlsx (or .csv) and upload via Items → Import.",
    ].forEach((t) => notes.addRow([t]));

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="material-master-template.xlsx"',
    );
    return res.send(Buffer.from(buf as ArrayBuffer));
  }),
);

// PATCH /:id -----------------------------------------------------------------
const updateSchema = z.object({
  description: z.string().trim().min(1).max(160).optional(),
  uom: z.string().trim().min(1).max(12).optional(),
  category: z.string().trim().max(60).optional().nullable(),
  inventoryType: z.enum(INVENTORY_TYPES).optional().nullable(),
  minStock: z.string().trim().optional().nullable(),
  lotControlled: z.boolean().optional(),
  active: z.boolean().optional(),
});

itemsRouter.patch(
  "/:id",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const itemId = Number(req.params.id);
    const body = updateSchema.parse(req.body);

    const item = await prisma.item.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundError("Item not found.");

    const hasStock =
      (await prisma.stockLevel.findFirst({
        where: { itemId, quantity: { not: 0 } },
      })) != null;

    if (body.uom && body.uom.toUpperCase() !== item.uom && hasStock) {
      throw new ValidationError(
        `Cannot change unit of measure: ${item.itemNumber} still holds stock.`,
      );
    }
    if (body.active === false && hasStock) {
      throw new ValidationError(
        `Cannot deactivate: ${item.itemNumber} still holds stock. Issue or move it first.`,
      );
    }

    let minStock: DecimalValue | null | undefined = undefined;
    if (body.minStock !== undefined) {
      if (body.minStock === null || body.minStock === "") minStock = null;
      else {
        try {
          const d = new Decimal(body.minStock);
          if (d.isNegative()) throw new Error();
          minStock = d;
        } catch {
          throw new ValidationError("Min stock must be a non-negative number.");
        }
      }
    }

    const updated = await prisma.item.update({
      where: { id: itemId },
      data: {
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.uom !== undefined ? { uom: body.uom.toUpperCase() } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.inventoryType !== undefined
          ? { inventoryType: body.inventoryType }
          : {}),
        ...(minStock !== undefined ? { minStock } : {}),
        ...(body.lotControlled !== undefined
          ? { lotControlled: body.lotControlled }
          : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
      },
    });
    await logAudit({
      userId: admin.userId,
      action: "UPDATE",
      entity: "Item",
      entityId: itemId,
      detail: body,
    });
    return ok(res, { item: updated });
  }),
);
