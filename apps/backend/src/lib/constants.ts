// Shared domain constants. SQLite (Prisma) has no enum type, so these are the
// canonical allowed values for the String fields in the schema.

export const ROLES = ["ADMIN", "OPERATOR"] as const;
export type Role = (typeof ROLES)[number];

export const BIN_TYPES = ["RECEIVING", "STORAGE", "QUARANTINE", "RETURNS"] as const;
export type BinType = (typeof BIN_TYPES)[number];

// Inventory type on the item master: Raw Material / Work In Progress / Finished Goods.
export const INVENTORY_TYPES = ["RM", "WIP", "FG"] as const;
export type InventoryType = (typeof INVENTORY_TYPES)[number];
export const INVENTORY_TYPE_LABELS: Record<InventoryType, string> = {
  RM: "Raw Material",
  WIP: "Work In Progress",
  FG: "Finished Goods",
};

export const MOVEMENT_TYPES = ["GR", "GI", "PUTAWAY", "TRANSFER", "COUNT_ADJUST", "ADJUST", "RETURN"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  GR: "Goods Receipt",
  GI: "Goods Issue",
  PUTAWAY: "Put-away",
  TRANSFER: "Transfer",
  COUNT_ADJUST: "Count adjustment",
  ADJUST: "Stock adjustment",
  RETURN: "Return from production",
};

export const COUNT_SESSION_STATUS = ["OPEN", "COUNTING", "COMPLETED"] as const;
export type CountSessionStatus = (typeof COUNT_SESSION_STATUS)[number];

export const COUNT_LINE_STATUS = ["PENDING", "COUNTED", "POSTED", "RECOUNT"] as const;
export type CountLineStatus = (typeof COUNT_LINE_STATUS)[number];

// Standing lot code used for items that are not lot-controlled, so the
// item + bin + lot stock grain stays uniform across all items.
export const DEFAULT_LOT_CODE = "STD";

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}
export function isBinType(v: unknown): v is BinType {
  return typeof v === "string" && (BIN_TYPES as readonly string[]).includes(v);
}
