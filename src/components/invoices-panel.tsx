import { useState } from "react";
import {
  cancelInvoice,
  createInvoiceFromUnbilled,
  INVOICE_STATUS_LABEL,
  linkExternalInvoice,
  listInvoiceLines,
  markInvoice,
  type Invoice,
  type InvoiceLine,
} from "@/lib/invoices";
import { formatMoney, formatMoneyExact, lineValue, type TimeEntry } from "@/lib/billing";
import { Button, Card, ErrorNote } from "@/components/ui";

const STATUS_LOOK: Record<Invoice["status"], string> = {
  draft: "bg-ground text-ink-soft",
  issued: "bg-brand/15 text-brand",
  paid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-danger/10 text-danger line-through",
};

/**
 * Payment demands on a matter.
 *
 * A demand, not a tax invoice: the real one still comes out of Morning, and
 * this says so on screen rather than letting anyone assume otherwise. What it
 * does is the arithmetic and the record of what was asked for.
 */
export function InvoicesPanel({
  matterId,
  invoices,
  entries,
  onChanged,
}: {
  matterId: string;
  invoices: Invoice[];
  entries: TimeEntry[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What a new demand would come to, computed from the same entries the
  // function will pick up, so the button can say the number before it is
  // pressed rather than after.
  const unbilled = entries.filter((e) => !e.invoice_id && lineValue(e) !== null);
  const pending = unbilled.reduce((sum, e) => sum + (lineValue(e) ?? 0), 0);

  async function assemble() {
    setBusy(true);
    setError(null);
    try {
      await createInvoiceFromUnbilled(matterId, 18);
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
        <h2 className="font-bold">דרישות תשלום</h2>
        <span className="text-xs text-muted">{invoices.length}</span>
      </div>

      {unbilled.length > 0 && (
        <div className="rounded-md bg-ground px-3 py-2.5 text-sm">
          <p>
            <span className="font-semibold">{formatMoney(pending)}</span> לפני מע״מ, מתוך{" "}
            {unbilled.length} רישומי זמן שטרם חויבו.
          </p>
          <Button className="mt-2 w-full" onClick={assemble} disabled={busy}>
            {busy ? "מרכיב..." : "הפק דרישת תשלום"}
          </Button>
        </div>
      )}

      {unbilled.length === 0 && invoices.length === 0 && (
        <p className="text-sm text-ink-soft">
          אין שעות מתומחרות שטרם חויבו. דרישה מורכבת מרישומי זמן עם תעריף.
        </p>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <ul className="flex flex-col divide-y divide-rule">
        {invoices.map((inv) => (
          <InvoiceRow key={inv.id} invoice={inv} onChanged={onChanged} />
        ))}
      </ul>

      {invoices.length > 0 && (
        // Said where the number is, not in a help page nobody opens.
        <p className="border-t border-rule pt-2 text-xs text-muted">
          זו דרישת תשלום, לא חשבונית מס. את החשבונית מפיקים במורנינג או ב‑iCount, ואפשר לרשום
          כאן את מספרה כדי שהשתיים יהיו מקושרות.
        </p>
      )}
    </Card>
  );
}

function InvoiceRow({ invoice, onChanged }: { invoice: Invoice; onChanged: () => void }) {
  const [lines, setLines] = useState<InvoiceLine[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function expand() {
    const next = !open;
    setOpen(next);
    if (next && lines === null) {
      try {
        setLines(await listInvoiceLines(invoice.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <button onClick={expand} className="flex items-baseline justify-between gap-2 text-start">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-muted">#{invoice.number}</span>
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_LOOK[invoice.status]}`}>
            {INVOICE_STATUS_LABEL[invoice.status]}
          </span>
        </span>
        <span className="font-semibold tabular-nums">{formatMoneyExact(invoice.total)}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 rounded-md bg-ground px-3 py-2.5 text-xs">
          {lines === null ? (
            <span className="text-muted">טוען...</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3">
                  <span className="min-w-0 flex-1 truncate">{l.description}</span>
                  <span className="shrink-0 tabular-nums text-muted">
                    {l.quantity} ש׳ × {formatMoneyExact(l.unit_price)}
                  </span>
                  <span className="shrink-0 tabular-nums font-semibold">{formatMoneyExact(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="flex flex-col gap-0.5 border-t border-rule pt-1.5">
            <Row label="לפני מע״מ" value={formatMoneyExact(invoice.subtotal)} />
            <Row label={`מע״מ ${invoice.vat_rate}%`} value={formatMoneyExact(invoice.vat)} />
            <Row label="סה״כ" value={formatMoneyExact(invoice.total)} strong />
          </dl>

          {invoice.status !== "cancelled" && (
            <div className="flex flex-wrap gap-1.5 border-t border-rule pt-2">
              {invoice.status === "draft" && (
                <Small onClick={() => act(() => markInvoice(invoice.id, "issued"))} disabled={busy}>
                  סמן כנשלחה
                </Small>
              )}
              {invoice.status !== "paid" && (
                <Small onClick={() => act(() => markInvoice(invoice.id, "paid"))} disabled={busy}>
                  סמן כשולמה
                </Small>
              )}
              {invoice.status !== "paid" && (
                <Small onClick={() => act(() => cancelInvoice(invoice.id))} disabled={busy} danger>
                  בטל ושחרר שעות
                </Small>
              )}
              {!linking && (
                <Small onClick={() => setLinking(true)} disabled={busy}>
                  {invoice.external_invoice_id ? "ערוך קישור לחשבונית" : "קשר לחשבונית מס"}
                </Small>
              )}
            </div>
          )}

          {/* Where the real invoice ended up. The demand and the tax invoice
              are two documents, and the pair is what an accountant asks for at
              the end of the year. */}
          {invoice.external_invoice_id && !linking && (
            <p className="border-t border-rule pt-1.5">
              חשבונית מס{" "}
              {invoice.external_url ? (
                <a
                  href={invoice.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-brand underline underline-offset-2"
                >
                  {invoice.external_invoice_id}
                </a>
              ) : (
                <span className="font-semibold">{invoice.external_invoice_id}</span>
              )}
            </p>
          )}

          {linking && (
            <ExternalInvoiceForm
              invoice={invoice}
              onDone={() => {
                setLinking(false);
                onChanged();
              }}
              onCancel={() => setLinking(false)}
            />
          )}
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}

/**
 * Recording the tax invoice, not issuing one.
 *
 * Issuing is a regulated act and belongs to Morning or iCount, exactly as the
 * brief says. What was missing was the other half: once it has been issued
 * there, nothing here knew about it, so the demand and the invoice lived in
 * two systems that never referred to each other. An accountant asking "which
 * invoice covers this?" had no answer on this screen.
 */
function ExternalInvoiceForm({
  invoice,
  onDone,
  onCancel,
}: {
  invoice: Invoice;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [number, setNumber] = useState(invoice.external_invoice_id ?? "");
  const [url, setUrl] = useState(invoice.external_url ?? "");
  const [provider, setProvider] = useState("morning");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await linkExternalInvoice(invoice.id, provider, number, url);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-2">
      <div className="flex flex-wrap gap-1.5">
        {(["morning", "icount", "other"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProvider(p)}
            className={`rounded px-2 py-0.5 text-xs font-semibold ${
              provider === p ? "bg-brand text-white" : "bg-surface text-ink-soft"
            }`}
          >
            {p === "morning" ? "מורנינג" : p === "icount" ? "iCount" : "אחר"}
          </button>
        ))}
      </div>

      <input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        placeholder="מספר חשבונית"
        dir="ltr"
        className="rounded-md border border-rule bg-surface px-2 py-1.5 text-xs
                   outline-none focus:border-brand"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="קישור לחשבונית (לא חובה)"
        dir="ltr"
        className="rounded-md border border-rule bg-surface px-2 py-1.5 text-xs
                   outline-none focus:border-brand"
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-1.5">
        <Small onClick={save} disabled={busy || !number.trim()}>
          {busy ? "שומר..." : "שמור"}
        </Small>
        <Small onClick={onCancel} disabled={busy}>
          ביטול
        </Small>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold" : ""}`}>{value}</dd>
    </div>
  );
}

function Small({
  children,
  danger,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      className={`rounded px-2 py-1 text-xs font-semibold disabled:opacity-50 ${
        danger ? "text-danger hover:bg-danger/10" : "text-brand hover:bg-brand/10"
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}
