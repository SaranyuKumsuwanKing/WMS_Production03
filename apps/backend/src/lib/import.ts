import ExcelJS from "exceljs";

// Parse an uploaded Material Master (.xlsx or .csv) into normalized item rows.
// Header matching is flexible/case-insensitive so users don't have to rename
// their existing export columns.

const HEADER_ALIASES: Record<string, string[]> = {
  itemNumber: ["itemnumber", "itemno", "item", "material", "materialnumber", "sku", "code", "partnumber", "partno", "itemcode"],
  description: ["description", "desc", "name", "materialdescription", "itemdescription", "materialdesc"],
  uom: ["uom", "unit", "unitofmeasure", "unitofmeasurement", "baseunit", "uofm", "units"],
  category: ["category", "group", "itemgroup", "materialgroup", "class"],
  inventoryType: ["inventorytype", "invtype", "inventorycategory", "materialtype", "stocktype", "rmwipfg"],
  lotControlled: ["lotcontrolled", "lot", "batch", "lotmanaged", "batchmanaged", "lottracked"],
  minStock: ["minstock", "minimum", "min", "reorderpoint", "reorder", "safetystock", "minqty"],
};

const REQUIRED = ["itemNumber", "description", "uom"] as const;

export type ParsedItem = {
  rowNumber: number;
  itemNumber: string;
  description: string;
  uom: string;
  category: string | null;
  inventoryType: string | null;
  lotControlled: boolean | null;
  minStock: string | null;
};

export type ParseResult = {
  items: ParsedItem[];
  missingColumns: string[];
  rowErrors: { rowNumber: number; message: string }[];
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseInventoryType(v: string): string | null {
  const t = v.trim().toUpperCase();
  if (!t) return null;
  if (t === "RM" || t.startsWith("RAW")) return "RM";
  if (t === "WIP" || t.startsWith("WORK")) return "WIP";
  if (t === "FG" || t.startsWith("FIN")) return "FG";
  return null;
}

function parseBool(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (["y", "yes", "true", "1", "lot", "x"].includes(t)) return true;
  if (["n", "no", "false", "0"].includes(t)) return false;
  return null;
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((x) => x.trim() !== "")) rows.push(row);
  }
  return rows;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const v = value as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if (typeof v.text === "string") return v.text;
    if (v.result != null) return String(v.result);
    if (value instanceof Date) return value.toISOString();
    return "";
  }
  return String(value);
}

/** Read a .csv or .xlsx upload into a row-major string grid (first row = header). */
export async function readGrid(buffer: Buffer, filename: string): Promise<string[][]> {
  if (filename.toLowerCase().endsWith(".csv")) {
    return parseCsv(buffer.toString("utf8"));
  }
  const wb = new ExcelJS.Workbook();
  // exceljs's bundled Buffer type differs from Node 24's generic Buffer<…>;
  // the cast bridges the type skew (runtime accepts a Node Buffer fine).
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const grid: string[][] = [];
  if (ws) {
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => vals.push(cellText(cell.value).trim()));
      grid.push(vals);
    });
  }
  return grid;
}

export async function parseMaterialMaster(buffer: Buffer, filename: string): Promise<ParseResult> {
  const grid = await readGrid(buffer, filename);
  if (grid.length === 0) return { items: [], missingColumns: [...REQUIRED], rowErrors: [] };

  const header = grid[0].map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) colMap[field] = idx;
  }
  const missingColumns = REQUIRED.filter((f) => !(f in colMap));
  if (missingColumns.length) return { items: [], missingColumns, rowErrors: [] };

  const items: ParsedItem[] = [];
  const rowErrors: { rowNumber: number; message: string }[] = [];
  for (let r = 1; r < grid.length; r++) {
    const rowNumber = r + 1; // 1-based incl. header
    const cells = grid[r];
    const get = (f: string) => (colMap[f] != null ? (cells[colMap[f]] ?? "").trim() : "");
    const itemNumber = get("itemNumber");
    const description = get("description");
    const uom = get("uom");
    if (!itemNumber && !description && !uom) continue; // blank line
    if (!itemNumber) {
      rowErrors.push({ rowNumber, message: "Missing item number" });
      continue;
    }
    if (!uom) {
      rowErrors.push({ rowNumber, message: `Missing unit of measure for ${itemNumber}` });
      continue;
    }
    items.push({
      rowNumber,
      itemNumber: itemNumber.toUpperCase(),
      description: description || itemNumber,
      uom: uom.toUpperCase(),
      category: get("category") || null,
      inventoryType: parseInventoryType(get("inventoryType")),
      lotControlled: parseBool(get("lotControlled")),
      minStock: get("minStock") || null,
    });
  }
  return { items, missingColumns: [], rowErrors };
}

// ---------------------------------------------------------------------------
// Opening-stock upload (admin go-live). Columns: Item Number, Bin (barcode),
// Lot (optional), Quantity. Each row is posted as a goods receipt.
// ---------------------------------------------------------------------------
const STOCK_ALIASES: Record<string, string[]> = {
  itemNumber: ["itemnumber", "itemno", "item", "material", "sku", "code", "partnumber", "itemcode"],
  bin: ["bin", "binbarcode", "bincode", "location", "locationbarcode", "binlocation"],
  lot: ["lot", "lotcode", "batch", "batchno", "lotno", "lotnumber"],
  quantity: ["quantity", "qty", "quantityonhand", "onhand", "stock", "qtyonhand"],
};
const STOCK_REQUIRED = ["itemNumber", "bin", "quantity"] as const;

export type ParsedStockRow = {
  rowNumber: number;
  itemNumber: string;
  bin: string;
  lot: string | null;
  quantity: string;
};
export type StockParseResult = {
  rows: ParsedStockRow[];
  missingColumns: string[];
  rowErrors: { rowNumber: number; message: string }[];
};

export async function parseStockUpload(buffer: Buffer, filename: string): Promise<StockParseResult> {
  const grid = await readGrid(buffer, filename);
  if (grid.length === 0) return { rows: [], missingColumns: [...STOCK_REQUIRED], rowErrors: [] };

  const header = grid[0].map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(STOCK_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) colMap[field] = idx;
  }
  const missingColumns = STOCK_REQUIRED.filter((f) => !(f in colMap));
  if (missingColumns.length) return { rows: [], missingColumns, rowErrors: [] };

  const rows: ParsedStockRow[] = [];
  const rowErrors: { rowNumber: number; message: string }[] = [];
  for (let r = 1; r < grid.length; r++) {
    const rowNumber = r + 1;
    const cells = grid[r];
    const get = (f: string) => (colMap[f] != null ? (cells[colMap[f]] ?? "").trim() : "");
    const itemNumber = get("itemNumber");
    const bin = get("bin");
    const quantity = get("quantity");
    if (!itemNumber && !bin && !quantity) continue;
    if (!itemNumber) {
      rowErrors.push({ rowNumber, message: "Missing item number" });
      continue;
    }
    if (!bin) {
      rowErrors.push({ rowNumber, message: `Missing bin for ${itemNumber}` });
      continue;
    }
    const qn = Number(quantity);
    if (!quantity || !Number.isFinite(qn) || qn <= 0) {
      rowErrors.push({ rowNumber, message: `Invalid quantity for ${itemNumber}` });
      continue;
    }
    rows.push({ rowNumber, itemNumber: itemNumber.toUpperCase(), bin: bin.toUpperCase(), lot: get("lot") || null, quantity });
  }
  return { rows, missingColumns: [], rowErrors };
}

// ---------------------------------------------------------------------------
// Storage-bin upload. Columns: Warehouse (code), Bin Code, Type, Description.
// ---------------------------------------------------------------------------
const BIN_ALIASES: Record<string, string[]> = {
  warehouse: ["warehouse", "warehousecode", "wh", "whcode", "store", "storecode"],
  code: ["bincode", "bin", "code", "location", "locationcode", "binlocation"],
  type: ["type", "bintype", "locationtype", "kind"],
  description: ["description", "desc", "name", "label"],
};
const BIN_REQUIRED = ["warehouse", "code"] as const;

export type ParsedBinRow = {
  rowNumber: number;
  warehouse: string;
  code: string;
  type: string; // uppercased; route validates against BIN_TYPES, default STORAGE
  description: string | null;
};
export type BinParseResult = {
  rows: ParsedBinRow[];
  missingColumns: string[];
  rowErrors: { rowNumber: number; message: string }[];
};

export async function parseBinUpload(buffer: Buffer, filename: string): Promise<BinParseResult> {
  const grid = await readGrid(buffer, filename);
  if (grid.length === 0) return { rows: [], missingColumns: [...BIN_REQUIRED], rowErrors: [] };

  const header = grid[0].map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(BIN_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) colMap[field] = idx;
  }
  const missingColumns = BIN_REQUIRED.filter((f) => !(f in colMap));
  if (missingColumns.length) return { rows: [], missingColumns, rowErrors: [] };

  const rows: ParsedBinRow[] = [];
  const rowErrors: { rowNumber: number; message: string }[] = [];
  for (let r = 1; r < grid.length; r++) {
    const rowNumber = r + 1;
    const cells = grid[r];
    const get = (f: string) => (colMap[f] != null ? (cells[colMap[f]] ?? "").trim() : "");
    const warehouse = get("warehouse");
    const code = get("code");
    if (!warehouse && !code) continue;
    if (!warehouse) {
      rowErrors.push({ rowNumber, message: "Missing warehouse" });
      continue;
    }
    if (!code) {
      rowErrors.push({ rowNumber, message: "Missing bin code" });
      continue;
    }
    rows.push({
      rowNumber,
      warehouse: warehouse.toUpperCase(),
      code: code.toUpperCase(),
      type: get("type").toUpperCase(),
      description: get("description") || null,
    });
  }
  return { rows, missingColumns: [], rowErrors };
}
