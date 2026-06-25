// Shared multi-format tabular export helpers. Routes build a `columns`
// definition + an array of plain row objects, then hand off here to emit the
// format the user picked (?format=csv|xlsx|json). XLSX stays the default so
// existing links keep working.

export const EXPORT_FORMATS = ["xlsx", "csv", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function parseFormat(v: string | null | undefined): ExportFormat {
  return v === "csv" || v === "json" ? v : "xlsx";
}

export type ExportColumn = { header: string; key: string; width?: number };
export type ExportRow = Record<string, unknown>;

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toLocaleString("en-GB");
  return String(v);
}

function csvCell(v: unknown): string {
  const s = cellText(v);
  // Quote fields containing a delimiter, quote, or newline; double inner quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC-4180-ish CSV with CRLF line endings. Caller should prepend a UTF-8 BOM. */
export function toCsv(columns: ExportColumn[], rows: ExportRow[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(",")).join("\r\n");
  return body ? `${head}\r\n${body}` : head;
}

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function disposition(baseName: string, format: ExportFormat): Record<string, string> {
  return {
    "Content-Type": CONTENT_TYPE[format],
    "Content-Disposition": `attachment; filename="${baseName}.${format}"`,
  };
}

/**
 * Build a downloadable Response for CSV or JSON. XLSX is produced in the route
 * itself (needs ExcelJS column/width styling), so this only covers the two
 * text formats.
 */
export function textExportResponse(
  format: "csv" | "json",
  baseName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): Response {
  const body =
    format === "csv"
      ? "﻿" + toCsv(columns, rows) // BOM so Excel reads UTF-8 (Thai) correctly
      : JSON.stringify(rows, null, 2);
  return new Response(body, { headers: disposition(baseName, format) });
}

export function xlsxHeaders(baseName: string): Record<string, string> {
  return disposition(baseName, "xlsx");
}
