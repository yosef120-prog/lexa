import { useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  buildExport,
  downloadCsv,
  downloadJson,
  SPREADSHEET_TABLES,
  type ExportProgress,
  type FirmExport,
} from "@/lib/export";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * Taking the firm's data out.
 *
 * Built once and kept, so the spreadsheet buttons cost nothing after the first
 * read — and so the person deciding whether to leave can look at what they
 * would be taking before they take it.
 */
export function ExportPanel() {
  const { membership } = useAuth();
  const [data, setData] = useState<FirmExport | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const firmName = membership?.org_name ?? "";

  async function gather() {
    setError(null);
    setProgress({ table: "", done: 0, total: 1 });
    try {
      const built = await buildExport(setProgress);
      setData(built);
      downloadJson(built, firmName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  }

  const rowCount = data
    ? Object.values(data.tables).reduce((n, rows) => n + rows.length, 0)
    : 0;

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="font-bold">ייצוא נתוני המשרד</h2>
        <p className="mt-1 text-sm text-ink-soft">
          כל מה ששמור כאן, בקובץ אחד. אין נעילה — הנתונים שלך ואפשר לקחת אותם בכל רגע.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {progress ? (
        <p className="text-sm text-muted">
          אוסף... {progress.done}/{progress.total}
          {progress.table && ` · ${progress.table}`}
        </p>
      ) : (
        <Button onClick={gather} className="self-start">
          {data ? "ייצא שוב" : "ייצא הכל"}
        </Button>
      )}

      {data && (
        <>
          <p className="text-sm">
            הורדו <span className="font-semibold">{rowCount.toLocaleString("he-IL")}</span> רשומות
            מ־{Object.keys(data.tables).length} טבלאות.
          </p>

          <div className="border-t border-rule pt-3">
            <p className="mb-2 text-xs text-muted">
              לפתיחה באקסל — כל טבלה בנפרד, עם עברית תקינה:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SPREADSHEET_TABLES.map(({ table, label }) => {
                const rows = data.tables[table] ?? [];
                return (
                  <button
                    key={table}
                    onClick={() => downloadCsv(rows, table, firmName)}
                    disabled={rows.length === 0}
                    className="rounded-md bg-ground px-2.5 py-1.5 text-xs font-semibold text-ink-soft
                               hover:bg-rule/60 disabled:opacity-40"
                  >
                    {label} ({rows.length})
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Said here rather than discovered later by someone who assumed
          otherwise. The record comes out; the files are a separate download. */}
      <p className="border-t border-rule pt-3 text-xs text-muted">
        הקבצים עצמם אינם בתוך הייצוא — רק רשומות המסמכים, עם שם הקובץ המקורי והנתיב שלו. את
        הקבצים מורידים ממסך התיק.
      </p>
    </Card>
  );
}
