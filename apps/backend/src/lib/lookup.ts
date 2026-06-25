import { prisma, Decimal } from "@king-wms/database";

// Scan resolution + stock lookups shared by the lookup APIs and the transaction
// routes. Scanned/typed codes are matched case-insensitively against barcodes.

export async function findBin(code: string) {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return prisma.bin.findFirst({
    where: { barcode: c },
    include: { warehouse: { select: { id: true, code: true, name: true } } },
  });
}

export async function findItem(code: string) {
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return prisma.item.findFirst({ where: { OR: [{ barcode: c }, { itemNumber: c }] } });
}

/** Lots (with qty > 0) of a given item currently sitting in a given bin. */
export async function stockForItemInBin(binId: number, itemId: number) {
  const levels = await prisma.stockLevel.findMany({
    where: { binId, itemId, quantity: { gt: 0 } },
    include: { lot: { select: { id: true, lotCode: true, supplier: true } } },
    orderBy: { lot: { lotCode: "asc" } },
  });
  return levels.map((l) => ({
    lotId: l.lotId,
    lotCode: l.lot.lotCode,
    supplier: l.lot.supplier,
    quantity: new Decimal(l.quantity).toString(),
  }));
}

/** Everything currently in a bin (qty > 0), for put-away/issue "what's here". */
export async function binContents(binId: number) {
  const levels = await prisma.stockLevel.findMany({
    where: { binId, quantity: { gt: 0 } },
    include: {
      item: { select: { id: true, itemNumber: true, description: true, uom: true } },
      lot: { select: { id: true, lotCode: true } },
    },
    orderBy: [{ item: { itemNumber: "asc" } }, { lot: { lotCode: "asc" } }],
  });
  return levels.map((l) => ({
    itemId: l.itemId,
    itemNumber: l.item.itemNumber,
    description: l.item.description,
    uom: l.item.uom,
    lotId: l.lotId,
    lotCode: l.lot.lotCode,
    quantity: new Decimal(l.quantity).toString(),
  }));
}
