import { prisma, Prisma } from "@king-wms/database";
import { DEFAULT_LOT_CODE } from "./constants";
import { ValidationError } from "./errors";

type Client = Prisma.TransactionClient | typeof prisma;

/** Find an existing lot for an item by code, or create it. Codes are trimmed. */
export async function getOrCreateLot(
  itemId: number,
  lotCode: string,
  extra?: { supplier?: string | null; receivedDate?: Date | null; note?: string | null },
  client: Client = prisma,
) {
  const code = (lotCode ?? "").trim();
  if (!code) throw new ValidationError("Lot code is required.");
  const existing = await client.lot.findUnique({
    where: { itemId_lotCode: { itemId, lotCode: code } },
  });
  if (existing) return existing;
  return client.lot.create({
    data: {
      itemId,
      lotCode: code,
      supplier: extra?.supplier ?? null,
      receivedDate: extra?.receivedDate ?? null,
      note: extra?.note ?? null,
    },
  });
}

/** The single standing lot used for items that are not lot-controlled. */
export async function getDefaultLot(itemId: number, client: Client = prisma) {
  return getOrCreateLot(itemId, DEFAULT_LOT_CODE, undefined, client);
}

/**
 * Resolve the lot to use for a receipt given the item's lot-control setting.
 * Lot-controlled items require a supplier lot code; others use the default lot.
 */
export async function resolveReceiptLot(
  item: { id: number; lotControlled: boolean },
  lotCode: string | null | undefined,
  extra?: { supplier?: string | null; receivedDate?: Date | null },
) {
  if (item.lotControlled) {
    if (!lotCode || !lotCode.trim()) {
      throw new ValidationError("This item is lot-controlled — a lot/batch number is required.");
    }
    return getOrCreateLot(item.id, lotCode, extra);
  }
  return getDefaultLot(item.id);
}
