import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";
import { EXCEL_BOM, slug, toCsv } from "@/lib/csv";

/**
 * Taking the firm's data out.
 *
 * The brief puts this plainly: the client is not locked in with us. That is a
 * promise about leaving, and a promise about leaving is worth nothing unless it
 * works before anyone wants to leave — so this is a button, not a support
 * ticket.
 *
 * Every query below runs as the signed-in user, so row level security decides
 * what comes out. A firm exports its own data and could not reach another's
 * even if this file asked for it.
 */

/**
 * Read in pages rather than one request.
 *
 * PostgREST caps a response, and a cap that silently truncates an export is
 * the worst possible failure here: the file looks complete, nobody counts the
 * rows, and the gap is found years later by someone who needed it.
 */
async function readAll(table: string): Promise<unknown[]> {
  const PAGE = 1000;
  const rows: unknown[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${describeDbError(error)}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/**
 * Tables that hold the firm's own record.
 *
 * Deliberately not everything: matter_numbers and invoice_numbers are counters
 * the database keeps for itself, and active_timers is whatever happens to be
 * running this second. Neither is anybody's data.
 */
const TABLES = [
  "organizations",
  "org_members",
  "profiles",
  "clients",
  "conflict_checks",
  "matters",
  "matter_parties",
  "matter_activity",
  "documents",
  "events",
  "tasks",
  "fee_agreements",
  "time_entries",
  "invoices",
  "invoice_lines",
  "filing_bundles",
  "filing_bundle_items",
  "audit_log",
] as const;

export type ExportProgress = { table: string; done: number; total: number };

export type FirmExport = {
  exported_at: string;
  format: string;
  note: string;
  tables: Record<string, unknown[]>;
};

export async function buildExport(onProgress?: (p: ExportProgress) => void): Promise<FirmExport> {
  const tables: Record<string, unknown[]> = {};

  // One table at a time, so the screen can say which. An export of a working
  // firm takes long enough that silence reads as a hang.
  for (const [i, table] of TABLES.entries()) {
    onProgress?.({ table, done: i, total: TABLES.length });
    tables[table] = await readAll(table);
  }
  onProgress?.({ table: "", done: TABLES.length, total: TABLES.length });

  return {
    exported_at: new Date().toISOString(),
    format: "lexa-export-1",
    note:
      "כל נתוני המשרד. הקבצים עצמם אינם כלולים — הם נשמרים בנפרד, " +
      "וברשומות המסמכים יש את הנתיב ואת שם הקובץ המקורי.",
    tables,
  };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoked on the next tick: doing it immediately can cancel the download in
  // some browsers before it has started reading.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function downloadJson(data: FirmExport, firmName: string): void {
  download(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    `lexa-${slug(firmName)}-${stamp()}.json`,
  );
}

export function downloadCsv(rows: unknown[], name: string, firmName: string): void {
  download(
    new Blob([EXCEL_BOM + toCsv(rows)], { type: "text/csv;charset=utf-8" }),
    `lexa-${slug(firmName)}-${name}-${stamp()}.csv`,
  );
}

/** The tables a person actually opens in Excel, rather than all eighteen. */
export const SPREADSHEET_TABLES: Array<{ table: string; label: string }> = [
  { table: "clients", label: "לקוחות" },
  { table: "matters", label: "תיקים" },
  { table: "time_entries", label: "רישומי זמן" },
  { table: "invoices", label: "דרישות תשלום" },
  { table: "events", label: "יומן" },
  { table: "tasks", label: "משימות" },
];
