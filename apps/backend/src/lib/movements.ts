import { Decimal } from "@king-wms/database";
import type { MovementType } from "./constants";

export type MovementLineView = {
  qtyDelta: string;
  item: { itemNumber: string; uom: string };
  bin: { code: string; barcode: string };
  lot: { lotCode: string };
};
export type MovementView = {
  id: number;
  type: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
  user: { fullName: string; username: string } | null;
  lines: MovementLineView[];
};

export type MovementSummary = {
  itemNumber: string;
  uom: string;
  qty: string; // signed quantity, no uom (e.g. "+50", "−12.5", "0")
  location: string; // bin code, or "from → to" for moves
  lot: string;
  text: string; // one-line human summary (dashboard recent activity)
};

/** Build structured + one-line summary of a movement from its signed lines. */
export function summarizeMovement(m: MovementView): MovementSummary {
  const lines = m.lines;
  const first = lines[0];
  const itemNumber = first?.item.itemNumber ?? "—";
  const uom = first?.item.uom ?? "";
  const lot = first?.lot.lotCode ?? "";
  const type = m.type as MovementType;

  const pos = lines.find((l) => new Decimal(l.qtyDelta).greaterThan(0));
  const neg = lines.find((l) => new Decimal(l.qtyDelta).lessThan(0));

  let qty = "";
  let location = first?.bin.code ?? "";

  if ((type === "GR" || type === "RETURN") && pos) {
    qty = `+${abs(pos.qtyDelta)}`;
    location = pos.bin.code;
  } else if (type === "GI" && neg) {
    qty = `−${abs(neg.qtyDelta)}`;
    location = lines.length > 1 ? "multiple bins" : neg.bin.code;
  } else if ((type === "PUTAWAY" || type === "TRANSFER") && pos && neg) {
    qty = abs(pos.qtyDelta);
    location = `${neg.bin.code} → ${pos.bin.code}`;
  } else if ((type === "COUNT_ADJUST" || type === "ADJUST") && first) {
    const d = new Decimal(first.qtyDelta);
    qty = d.isZero() ? "0" : d.greaterThan(0) ? `+${abs(first.qtyDelta)}` : `−${abs(first.qtyDelta)}`;
    location = first.bin.code;
  } else if (first) {
    qty = new Decimal(first.qtyDelta).toString();
  }

  const zeroAdj = (type === "COUNT_ADJUST" || type === "ADJUST") && first && new Decimal(first.qtyDelta).isZero();
  const text = zeroAdj
    ? `verified, no change · ${location}${lot ? ` · lot ${lot}` : ""}`
    : `${qty} ${uom} · ${location}${lot ? ` · lot ${lot}` : ""}`;

  return { itemNumber, uom, qty, location, lot, text };
}

function abs(v: string): string {
  return new Decimal(v).abs().toString();
}
