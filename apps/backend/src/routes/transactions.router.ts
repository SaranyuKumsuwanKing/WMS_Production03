import { Router } from "express";
import { z } from "zod";
import { prisma } from "@king-wms/database";
import { requireUser, requireAdmin } from "../lib/auth";
import { ok, wrap } from "../lib/http";
import { NotFoundError } from "../lib/errors";
import {
  receiveGoods,
  issueGoods,
  moveStock,
  adjustStock,
} from "../lib/inventory";
import { resolveReceiptLot } from "../lib/lots";

export const transactionsRouter = Router();

// ---- /receive ----
const receiveSchema = z.object({
  itemId: z.number().int().positive(),
  lotCode: z.string().trim().max(40).optional().nullable(),
  supplier: z.string().trim().max(80).optional().nullable(),
  binId: z.number().int().positive(),
  quantity: z.union([z.string(), z.number()]).transform((v) => String(v)),
  reference: z.string().trim().max(60).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
  type: z.enum(["GR", "RETURN"]).optional(),
  clientRequestId: z.string().max(64).optional().nullable(),
});

transactionsRouter.post(
  "/receive",
  wrap(async (req, res) => {
    const user = await requireUser(req);
    const body = receiveSchema.parse(req.body);

    const item = await prisma.item.findUnique({ where: { id: body.itemId } });
    if (!item) throw new NotFoundError("Item not found.");
    const lot = await resolveReceiptLot(item, body.lotCode, {
      supplier: body.supplier,
    });

    const result = await receiveGoods({
      itemId: item.id,
      lotId: lot.id,
      binId: body.binId,
      quantity: body.quantity,
      userId: user.userId,
      reference: body.reference,
      note: body.note,
      type: body.type,
      clientRequestId: body.clientRequestId,
    });
    return ok(res, {
      movementId: result.movement.id,
      replay: result.replay,
      lotCode: lot.lotCode,
    });
  }),
);

// ---- /issue ----
const issueSchema = z.object({
  itemId: z.number().int().positive(),
  lotId: z.number().int().positive(),
  binId: z.number().int().positive(),
  quantity: z.union([z.string(), z.number()]).transform((v) => String(v)),
  reference: z.string().trim().max(60).optional().nullable(),
  note: z.string().trim().max(200).optional().nullable(),
  clientRequestId: z.string().max(64).optional().nullable(),
});

transactionsRouter.post(
  "/issue",
  wrap(async (req, res) => {
    const user = await requireUser(req);
    const body = issueSchema.parse(req.body);
    const result = await issueGoods({
      itemId: body.itemId,
      lotId: body.lotId,
      binId: body.binId,
      quantity: body.quantity,
      userId: user.userId,
      reference: body.reference,
      note: body.note,
      clientRequestId: body.clientRequestId,
    });
    return ok(res, { movementId: result.movement.id, replay: result.replay });
  }),
);

// ---- /move ----
const moveSchema = z.object({
  itemId: z.number().int().positive(),
  lotId: z.number().int().positive(),
  fromBinId: z.number().int().positive(),
  toBinId: z.number().int().positive(),
  quantity: z.union([z.string(), z.number()]).transform((v) => String(v)),
  note: z.string().trim().max(200).optional().nullable(),
  type: z.enum(["PUTAWAY", "TRANSFER"]).optional(),
  clientRequestId: z.string().max(64).optional().nullable(),
});

transactionsRouter.post(
  "/move",
  wrap(async (req, res) => {
    const user = await requireUser(req);
    const body = moveSchema.parse(req.body);
    const result = await moveStock({
      itemId: body.itemId,
      lotId: body.lotId,
      fromBinId: body.fromBinId,
      toBinId: body.toBinId,
      quantity: body.quantity,
      userId: user.userId,
      note: body.note,
      type: body.type,
      clientRequestId: body.clientRequestId,
    });
    return ok(res, { movementId: result.movement.id, replay: result.replay });
  }),
);

// ---- /adjust (admin-only ad-hoc stock correction) ----
const adjustSchema = z.object({
  itemId: z.number().int().positive(),
  lotId: z.number().int().positive(),
  binId: z.number().int().positive(),
  newQuantity: z.union([z.string(), z.number()]).transform((v) => String(v)),
  reason: z.string().trim().min(1, "A reason is required").max(200),
  clientRequestId: z.string().max(64).optional().nullable(),
});

transactionsRouter.post(
  "/adjust",
  wrap(async (req, res) => {
    const admin = await requireAdmin(req);
    const body = adjustSchema.parse(req.body);
    const result = await adjustStock({
      itemId: body.itemId,
      lotId: body.lotId,
      binId: body.binId,
      newQuantity: body.newQuantity,
      reason: body.reason,
      userId: admin.userId,
      clientRequestId: body.clientRequestId,
    });
    return ok(res, { movementId: result.movement.id, replay: result.replay });
  }),
);
