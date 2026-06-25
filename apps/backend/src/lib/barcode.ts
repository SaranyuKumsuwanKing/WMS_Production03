// Canonical scannable code for a bin: "<WAREHOUSE>-<BIN>" (globally unique).
export function binBarcode(warehouseCode: string, binCode: string): string {
  return `${warehouseCode}-${binCode}`.toUpperCase();
}

// Zero-pad a number to a fixed width, e.g. pad(3, 2) -> "03".
export function pad(n: number, width: number): string {
  return String(n).padStart(Math.max(width, 0), "0");
}
