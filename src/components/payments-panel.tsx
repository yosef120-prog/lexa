import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  addMilestone,
  formatAmount,
  isOverdue,
  listMilestones,
  removeMilestone,
  setPaid,
  updateMilestone,
  type Milestone,
} from "@/lib/payments";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * The agreed payment schedule, on the deal it was agreed in.
 *
 * Entered once here. Both sides' cards read it from the matter, so the buyer
 * and the seller are looking at the same dates rather than at two copies that
 * quietly diverge the first time one is corrected.
 */
export function PaymentsPanel({ matterId }: { matterId: string }) {
  const { membership } = useAuth();
  const [rows, setRows] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await listMilestones(matterId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const owed = rows.filter((r) => !r.paid_at).reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-bold">לוח תשלומים</h2>
        {owed > 0 && <span className="text-xs text-muted">נותר {formatAmount(owed)}</span>}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {loading ? (
        <p className="text-sm text-muted">טוען...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">
          עוד לא הוזן לוח תשלומים. מה שתזין כאן יופיע גם בכרטיסי הלקוחות שקשורים לתיק.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-t border-rule">
          {rows.map((m) => (
            <MilestoneRow key={m.id} milestone={m} onChanged={reload} />
          ))}
        </ul>
      )}

      {adding ? (
        <NewMilestone
          orgId={membership?.org_id ?? ""}
          matterId={matterId}
          onDone={async () => {
            setAdding(false);
            await reload();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button onClick={() => setAdding(true)}>הוסף מועד תשלום</Button>
      )}
    </Card>
  );
}

function MilestoneRow({
  milestone: m,
  onChanged,
}: {
  milestone: Milestone;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const late = isOverdue(m);

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="py-2.5">
        <NewMilestone
          orgId=""
          matterId={m.matter_id}
          existing={m}
          onDone={async () => {
            setEditing(false);
            await onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">{m.label}</span>
        {m.amount !== null && (
          <span className="text-sm font-bold tabular-nums">{formatAmount(m.amount)}</span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
        {/* Late is the only thing here allowed to be red. A schedule where
            every row shouts is a schedule nobody reads. */}
        <span className={late ? "font-semibold text-danger" : "text-muted"}>
          {new Date(`${m.due_date}T00:00:00`).toLocaleDateString("he-IL")}
          {late && " · באיחור"}
        </span>
        {m.paid_at && (
          <span className="font-semibold text-brand">
            שולם {new Date(`${m.paid_at}T00:00:00`).toLocaleDateString("he-IL")}
          </span>
        )}
      </div>

      {m.note && <p className="text-xs text-ink-soft">{m.note}</p>}

      <div className="flex flex-wrap gap-x-3 text-xs">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            act(() => setPaid(m.id, m.paid_at ? null : new Date().toISOString().slice(0, 10)))
          }
          className="font-semibold text-brand underline underline-offset-2 disabled:opacity-50"
        >
          {m.paid_at ? "בטל סימון תשלום" : "סמן כשולם"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-ink-soft underline underline-offset-2"
        >
          ערוך
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act(() => removeMilestone(m.id))}
          className="text-danger underline underline-offset-2 disabled:opacity-50"
        >
          הסר
        </button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}

function NewMilestone({
  orgId,
  matterId,
  existing,
  onDone,
  onCancel,
}: {
  orgId: string;
  matterId: string;
  existing?: Milestone;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(existing?.label ?? "");
  const [amount, setAmount] = useState(existing?.amount === null ? "" : String(existing?.amount ?? ""));
  const [dueDate, setDueDate] = useState(existing?.due_date ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Empty is a real answer: a date can be agreed before the sum is.
      const sum = amount.trim() === "" ? null : Number(amount);
      if (sum !== null && Number.isNaN(sum)) throw new Error("הסכום אינו מספר.");

      if (existing) {
        await updateMilestone(existing.id, { label, amount: sum, dueDate, note });
      } else {
        await addMilestone({ orgId, matterId, label, amount: sum, dueDate, note });
      }
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md bg-ground p-3">
      <Field
        label="מה סוכם"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="תשלום ראשון במעמד החתימה"
        required
      />
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">סכום</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="אפשר להשאיר ריק"
            className="w-40 rounded-md border border-rule bg-surface px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">מועד</span>
          <input
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-md border border-rule bg-surface px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      <Field
        label="הערה"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="למשל: כנגד מסירת החזקה"
      />

      {/* Said where the date is typed. A firm entering a schedule should know
          it is also entering diary entries. */}
      <p className="text-xs text-muted">
        כל מועד שטרם שולם נכנס ליומן ושולח תזכורת שלושה ימים לפני.
      </p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !label.trim() || !dueDate}>
          {busy ? "שומר..." : existing ? "עדכן" : "הוסף"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

/**
 * The same schedule, seen from a person's card.
 *
 * Read-only on purpose. The schedule belongs to the deal, and letting it be
 * edited from either side's card is how the seller's copy and the buyer's stop
 * agreeing. From here you go to the matter.
 */
export function ClientPayments({
  rows,
  onOpenMatter,
}: {
  rows: Array<Milestone & { matter_name: string }>;
  onOpenMatter: (id: string) => void;
}) {
  if (rows.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">מועדי תשלום</h2>
      <ul className="flex flex-col divide-y divide-rule border-t border-rule">
        {rows.map((m) => {
          const late = isOverdue(m);
          return (
            <li key={m.id} className="flex flex-col gap-1 py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold">{m.label}</span>
                {m.amount !== null && (
                  <span className="text-sm font-bold tabular-nums">{formatAmount(m.amount)}</span>
                )}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className={late ? "font-semibold text-danger" : "text-muted"}>
                  {new Date(`${m.due_date}T00:00:00`).toLocaleDateString("he-IL")}
                  {late && " · באיחור"}
                </span>
                {m.paid_at && <span className="font-semibold text-brand">שולם</span>}
                <button
                  type="button"
                  onClick={() => onOpenMatter(m.matter_id)}
                  className="text-muted underline underline-offset-2"
                >
                  {m.matter_name}
                </button>
              </div>
              {m.note && <p className="text-xs text-ink-soft">{m.note}</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
