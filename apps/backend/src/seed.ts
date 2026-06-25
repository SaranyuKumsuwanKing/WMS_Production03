import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma, ensureDbReady } from "@king-wms/database";
import { receiveGoods } from "./lib/inventory";

// ---------------------------------------------------------------------------
// Seed data. Idempotent: master data is upserted; initial stock is only posted
// the first time (guarded by the absence of any stock movement).
// ---------------------------------------------------------------------------

const WAREHOUSES = [
  { code: "MAIN", name: "Main Store" },
  { code: "FOAM", name: "Foam Components" },
  { code: "FABRIC", name: "Fabric Warehouse" },
  { code: "LEATHER", name: "Leather Warehouse" },
  { code: "HARDWARE", name: "Hardware Store" },
  { code: "FINISHED", name: "Finished Goods" },
];

const STORAGE_BINS = ["A01", "A02", "A03", "A04", "B01", "B02"];

const ITEMS = [
  {
    itemNumber: "FOAM-1845",
    description: "Foam Sheet 1845 High Density",
    uom: "EA",
    category: "Foam",
    lotControlled: true,
  },
  {
    itemNumber: "FOAM-2050",
    description: "Foam Block 2050 Medium Density",
    uom: "EA",
    category: "Foam",
    lotControlled: true,
  },
  {
    itemNumber: "FAB-LIN-GR",
    description: "Linen Fabric Grey",
    uom: "M",
    category: "Fabric",
    lotControlled: true,
  },
  {
    itemNumber: "FAB-VEL-NV",
    description: "Velvet Fabric Navy",
    uom: "M",
    category: "Fabric",
    lotControlled: true,
  },
  {
    itemNumber: "LEA-FUL-TAN",
    description: "Full Grain Leather Tan",
    uom: "SQM",
    category: "Leather",
    lotControlled: true,
  },
  {
    itemNumber: "HW-SCR-40",
    description: "Wood Screw 40mm",
    uom: "EA",
    category: "Hardware",
    lotControlled: false,
  },
  {
    itemNumber: "HW-BRK-L",
    description: "Corner Bracket L",
    uom: "EA",
    category: "Hardware",
    lotControlled: false,
  },
];

const USERS = [
  {
    username: "admin",
    password: "admin123",
    fullName: "System Administrator",
    role: "ADMIN",
  },
  {
    username: "operator",
    password: "operator123",
    fullName: "Warehouse Operator",
    role: "OPERATOR",
  },
];

async function main() {
  await ensureDbReady();

  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      update: { fullName: u.fullName, role: u.role, active: true },
      create: {
        username: u.username,
        passwordHash,
        fullName: u.fullName,
        role: u.role,
      },
    });
  }
  const admin = await prisma.user.findUniqueOrThrow({
    where: { username: "admin" },
  });

  for (const w of WAREHOUSES) {
    const wh = await prisma.warehouse.upsert({
      where: { code: w.code },
      update: { name: w.name, active: true },
      create: { code: w.code, name: w.name },
    });
    const bins = [
      { code: "RECV", description: "Receiving / staging", type: "RECEIVING" },
      { code: "RET", description: "Returns from production", type: "RETURNS" },
      ...STORAGE_BINS.map((c) => ({
        code: c,
        description: `Storage bin ${c}`,
        type: "STORAGE",
      })),
    ];
    for (const b of bins) {
      await prisma.bin.upsert({
        where: { warehouseId_code: { warehouseId: wh.id, code: b.code } },
        update: { description: b.description, type: b.type, active: true },
        create: {
          warehouseId: wh.id,
          code: b.code,
          description: b.description,
          type: b.type,
          barcode: `${wh.code}-${b.code}`,
        },
      });
    }
  }

  for (const it of ITEMS) {
    await prisma.item.upsert({
      where: { itemNumber: it.itemNumber },
      update: {
        description: it.description,
        uom: it.uom,
        category: it.category,
        lotControlled: it.lotControlled,
        active: true,
      },
      create: { ...it, barcode: it.itemNumber },
    });
  }

  const movementCount = await prisma.stockMovement.count();
  if (movementCount === 0) {
    const initial: Array<{
      item: string;
      wh: string;
      bin: string;
      lot: string | null;
      qty: string;
      supplier?: string;
    }> = [
      {
        item: "FOAM-1845",
        wh: "FOAM",
        bin: "A01",
        lot: "LOT-F1845-A",
        qty: "50",
      },
      {
        item: "FOAM-2050",
        wh: "FOAM",
        bin: "A02",
        lot: "LOT-F2050-A",
        qty: "30",
      },
      {
        item: "FAB-LIN-GR",
        wh: "FABRIC",
        bin: "A01",
        lot: "DYE-2231",
        qty: "120.5",
        supplier: "Textiles Co",
      },
      {
        item: "FAB-VEL-NV",
        wh: "FABRIC",
        bin: "A02",
        lot: "DYE-5510",
        qty: "80",
        supplier: "Textiles Co",
      },
      {
        item: "LEA-FUL-TAN",
        wh: "LEATHER",
        bin: "A01",
        lot: "HIDE-9001",
        qty: "45.75",
        supplier: "Hide Supply",
      },
      { item: "HW-SCR-40", wh: "HARDWARE", bin: "A01", lot: null, qty: "5000" },
      { item: "HW-BRK-L", wh: "HARDWARE", bin: "A02", lot: null, qty: "1200" },
    ];
    for (const s of initial) {
      const item = await prisma.item.findUniqueOrThrow({
        where: { itemNumber: s.item },
      });
      const wh = await prisma.warehouse.findUniqueOrThrow({
        where: { code: s.wh },
      });
      const bin = await prisma.bin.findUniqueOrThrow({
        where: { warehouseId_code: { warehouseId: wh.id, code: s.bin } },
      });
      const lotCode = s.lot ?? "STD";
      const lot = await prisma.lot.upsert({
        where: { itemId_lotCode: { itemId: item.id, lotCode } },
        update: {},
        create: {
          itemId: item.id,
          lotCode,
          supplier: s.supplier ?? null,
          receivedDate: new Date(),
        },
      });
      await receiveGoods({
        itemId: item.id,
        lotId: lot.id,
        binId: bin.id,
        quantity: s.qty,
        userId: admin.id,
        reference: "SEED-OPENING",
        note: "Opening balance (seed)",
      });
    }
    console.log(`Seeded ${initial.length} opening stock receipts.`);
  } else {
    console.log(
      "Stock movements already exist — skipped opening-balance seeding.",
    );
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
