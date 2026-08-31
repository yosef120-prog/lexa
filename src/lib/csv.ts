/**
 * Turning rows into a spreadsheet.
 *
 * Free of any Supabase or React import, like the diary's date handling, so it
 * can be tested on its own — this decides whether a comma inside a client's
 * address quietly splits a row in two, which is the kind of fault nobody finds
 * until the file is already in somebody else's hands.
 */

/**
 * Not decoration: without it Excel reads UTF-8 as the local codepage and every
 * Hebrew name in the file becomes rubbish. The export exists to be opened, so
 * it opens.
 */
export const EXCEL_BOM = "﻿";

export function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return "";

  // The union of every row's keys, not the first row's: a column that happens
  // to be null on the first record and set on the hundredth still belongs in
  // the file.
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];

  return [
    keys.map(cell).join(","),
    ...rows.map((r) => keys.map((k) => cell((r as Record<string, unknown>)[k])).join(",")),
  ].join("\r\n");
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  // Quotes are doubled, and anything holding a comma, a quote or a line break
  // is wrapped. A line break inside a note is ordinary in a law office.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A filename someone can find again, from a Hebrew firm name. */
export function slug(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40) || "export"
  );
}
