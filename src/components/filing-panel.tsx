import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { formatSize, type DocumentGroup } from "@/lib/documents";
import {
  addAppendix,
  appendixLabel,
  bundleSize,
  createBundle,
  FILING_STATUS_LABEL,
  markSubmitted,
  moveAppendix,
  NET_HAMISHPAT_LIMIT,
  removeAppendix,
  type FilingBundle,
} from "@/lib/filing";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

export function FilingPanel({
  matterId,
  bundles,
  documents,
  onChanged,
}: {
  matterId: string;
  bundles: FilingBundle[];
  documents: DocumentGroup[];
  onChanged: () => void;
}) {
  const { membership } = useAuth();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [mainId, setMainId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the current version of each document is offered: filing last week's
  // draft by accident is a mistake nobody recovers from gracefully.
  const latest = documents.map((g) => g.latest);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      await createBundle({
        org_id: membership.org_id,
        matter_id: matterId,
        title,
        main_document_id: mainId || null,
      });
      setTitle("");
      setMainId("");
      setCreating(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">הגשה לבית משפט</h2>
        {!creating && latest.length > 0 && (
          <button
            onClick={() => setCreating(true)}
            className="text-sm font-semibold text-brand underline underline-offset-2"
          >
            הגשה חדשה
          </button>
        )}
      </div>

      {latest.length === 0 && (
        <p className="text-sm text-ink-soft">
          כדי להכין הגשה צריך קודם להעלות את כתב הטענות והנספחים למסמכי התיק.
        </p>
      )}

      {creating && (
        <form onSubmit={create} className="flex flex-col gap-3 border-b border-rule pb-3">
          <Field
            label="שם ההגשה"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="לדוגמה: כתב תביעה"
            autoFocus
            required
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">המסמך הראשי</span>
            <select
              value={mainId}
              onChange={(e) => setMainId(e.target.value)}
              className="rounded-md border border-rule bg-surface px-3 py-2 text-sm outline-none
                         focus:border-brand focus:ring-2 focus:ring-brand/20"
              required
            >
              <option value="">בחר מסמך</option>
              {latest.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !title.trim()}>
              צור
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              ביטול
            </Button>
          </div>
        </form>
      )}

      {bundles.map((b) => (
        <BundleView key={b.id} bundle={b} documents={latest} onChanged={onChanged} />
      ))}

      {bundles.length > 0 && (
        <p className="border-t border-rule pt-2 text-xs text-muted">
          הפקת קובץ ההגשה עוד לא זמינה. המערכת אינה מתחברת לנט המשפט — ההגשה עצמה
          נעשית על ידך, ותאריך ההגשה נרשם כאן ידנית.
        </p>
      )}
    </Card>
  );
}

function BundleView({
  bundle,
  documents,
  onChanged,
}: {
  bundle: FilingBundle;
  documents: Array<{ id: string; filename: string; size_bytes: number | null }>;
  onChanged: () => void;
}) {
  const { membership } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [filing, setFiling] = useState(false);

  const used = new Set([bundle.main_document_id, ...bundle.items.map((i) => i.document?.id)]);
  const available = documents.filter((d) => !used.has(d.id));
  const size = bundleSize(bundle);
  const tooBig = size > NET_HAMISHPAT_LIMIT;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-rule p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{bundle.title}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
            bundle.status === "submitted"
              ? "bg-brand/10 text-brand"
              : bundle.status === "failed"
                ? "bg-danger/10 text-danger"
                : "bg-ground text-ink-soft"
          }`}
        >
          {FILING_STATUS_LABEL[bundle.status]}
        </span>
      </div>

      <ol className="flex flex-col gap-1 text-sm">
        <li className="flex items-baseline gap-2">
          <span className="shrink-0 text-xs font-semibold text-muted">ראשי</span>
          <span>{bundle.main?.filename ?? "לא נבחר"}</span>
        </li>
        {bundle.items.map((item, i) => (
          <li key={item.id} className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs font-semibold text-muted">
              {appendixLabel(item.position)}
            </span>
            <span className="flex-1">{item.document?.filename}</span>
            {bundle.status === "draft" && (
              <span className="flex shrink-0 gap-1 text-xs">
                <button
                  disabled={busy || i === 0}
                  onClick={() => run(() => moveAppendix(bundle.items, item.id, -1))}
                  className="text-ink-soft disabled:opacity-30"
                  aria-label="הזז למעלה"
                >
                  ▲
                </button>
                <button
                  disabled={busy || i === bundle.items.length - 1}
                  onClick={() => run(() => moveAppendix(bundle.items, item.id, 1))}
                  className="text-ink-soft disabled:opacity-30"
                  aria-label="הזז למטה"
                >
                  ▼
                </button>
                <button
                  disabled={busy}
                  onClick={() => run(() => removeAppendix(item.id))}
                  className="text-danger"
                  aria-label="הסר"
                >
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>

      <div className="text-xs text-muted">
        {formatSize(size)}
        {/* The renderer will have to split it; saying so now beats a surprise
            at the courthouse. */}
        {tooBig && (
          <span className="text-warning"> · מעל 30 מ״ב, יידרש פיצול בהפקה</span>
        )}
        {bundle.items.length > 5 && <span> · יופק תוכן עניינים</span>}
      </div>

      {bundle.status === "draft" && available.length > 0 && (
        <select
          value=""
          disabled={busy}
          onChange={(e) =>
            membership &&
            e.target.value &&
            run(() =>
              addAppendix({
                org_id: membership.org_id,
                bundle_id: bundle.id,
                document_id: e.target.value,
                position: bundle.items.length + 1,
              }),
            )
          }
          className="rounded-md border border-rule bg-surface px-3 py-1.5 text-sm outline-none
                     focus:border-brand"
        >
          <option value="">הוסף נספח...</option>
          {available.map((d) => (
            <option key={d.id} value={d.id}>
              {d.filename}
            </option>
          ))}
        </select>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {bundle.status === "submitted" ? (
        <p className="text-xs text-ink-soft">
          הוגש {new Date(bundle.submitted_at!).toLocaleDateString("he-IL")}
          {bundle.submitted_note && ` · ${bundle.submitted_note}`}
        </p>
      ) : filing ? (
        <div className="flex flex-col gap-2">
          <Field
            label="מספר אישור / הערה"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="אישור נט 12345"
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              onClick={() => run(async () => { await markSubmitted(bundle.id, note); setFiling(false); })}
              disabled={busy}
            >
              רשום כהוגש
            </Button>
            <Button variant="ghost" onClick={() => setFiling(false)}>
              ביטול
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setFiling(true)}
          className="self-start text-xs text-brand underline underline-offset-2"
        >
          הגשתי — רשום תאריך
        </button>
      )}
    </div>
  );
}
