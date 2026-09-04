import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  cancelTimer,
  FEE_KIND_LABEL,
  formatMinutes,
  formatMoney,
  lineValue,
  startTimer,
  stopTimer,
  type FeeAgreement,
  type FeeKind,
  type RunningTimer,
  type TimeEntry,
} from "@/lib/billing";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/** Ticks while a timer runs, so the number on screen is the real elapsed time. */
function useElapsedMinutes(startedAt: string | null): number {
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () =>
      setMinutes(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [startedAt]);
  return minutes;
}

export function BillingPanel({
  matterId,
  fee,
  entries,
  timer,
  onChanged,
}: {
  matterId: string;
  fee: FeeAgreement | null;
  entries: TimeEntry[];
  timer: RunningTimer | null;
  onChanged: () => void;
}) {
  const runningHere = timer?.matter_id === matterId ? timer : null;
  const runningElsewhere = timer && timer.matter_id !== matterId;

  const unbilled = entries.filter((e) => e.invoice_id === null && e.billable);
  const unbilledMinutes = unbilled.reduce((sum, e) => sum + e.minutes, 0);
  const unbilledValue = unbilled.reduce((sum, e) => sum + (lineValue(e) ?? 0), 0);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">זמן וחיוב</h2>
        <FeeSummary matterId={matterId} fee={fee} onSaved={onChanged} />
      </div>

      <TimerControls
        matterId={matterId}
        running={runningHere}
        blockedByOther={!!runningElsewhere}
        onChanged={onChanged}
      />

      {unbilled.length > 0 && (
        <div className="rounded-md bg-ground px-3 py-2 text-sm">
          <span className="font-semibold">{formatMinutes(unbilledMinutes)}</span> שטרם חויבו
          {unbilledValue > 0 && (
            <span className="text-ink-soft"> · {formatMoney(unbilledValue, fee?.currency)}</span>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-ink-soft">עוד לא נרשם זמן בתיק הזה.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule text-sm">
          {entries.slice(0, 6).map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-3 py-2">
              <div className="flex flex-col">
                <span>{e.description || "ללא תיאור"}</span>
                <span className="text-xs text-muted">
                  {new Date(e.started_at).toLocaleDateString("he-IL")}
                  {e.user?.full_name && ` · ${e.user.full_name}`}
                  {e.invoice_id && " · חויב"}
                </span>
              </div>
              <span className="shrink-0 font-semibold">{formatMinutes(e.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TimerControls({
  matterId,
  running,
  blockedByOther,
  onChanged,
}: {
  matterId: string;
  running: RunningTimer | null;
  blockedByOther: boolean;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsedMinutes(running?.started_at ?? null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNote("");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (blockedByOther) {
    return (
      <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-ink-soft">
        טיימר שלך רץ כרגע בתיק אחר. אפשר להפעיל רק אחד בכל רגע.
      </p>
    );
  }

  if (running) {
    return (
      <div className="flex flex-col gap-2 rounded-md bg-brand/10 px-3 py-3">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-brand">טיימר רץ</span>
          <span className="font-mono text-lg font-bold tabular-nums text-brand">
            {formatMinutes(elapsed)}
          </span>
        </div>
        {running.note && <span className="text-xs text-ink-soft">{running.note}</span>}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="על מה עבדת?"
          className="rounded-md border border-rule bg-surface px-3 py-2 text-sm outline-none
                     focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex gap-2">
          <Button onClick={() => run(() => stopTimer(note))} disabled={busy}>
            עצור ורשום
          </Button>
          <Button variant="ghost" onClick={() => run(cancelTimer)} disabled={busy}>
            בטל בלי לרשום
          </Button>
        </div>
        {/* The reassurance that makes people trust it enough to use it. */}
        <span className="text-xs text-muted">הטיימר נשמר בשרת. רענון הדף לא יאבד אותו.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="על מה תעבוד?"
          className="min-w-0 flex-1 rounded-md border border-rule bg-surface px-3 py-2 text-sm
                     outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button onClick={() => run(() => startTimer(matterId, note))} disabled={busy}>
          התחל
        </Button>
      </div>
    </div>
  );
}

function FeeSummary({
  matterId,
  fee,
  onSaved,
}: {
  matterId: string;
  fee: FeeAgreement | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);

  const summary = !fee
    ? "לא הוגדר"
    : fee.kind === "hourly"
      ? `${formatMoney(Number(fee.hourly_rate), fee.currency)} לשעה`
      : fee.kind === "retainer"
        ? `ריטיינר ${formatMoney(Number(fee.retainer_amount ?? 0), fee.currency)}`
        : fee.percent !== null
          ? `${fee.percent}% מהעסקה`
          : formatMoney(Number(fee.fixed_amount ?? 0), fee.currency);

  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-xs text-brand underline underline-offset-2"
      >
        {summary}
      </button>
      {editing && (
        <FeeDialog
          matterId={matterId}
          fee={fee}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
    </>
  );
}

function FeeDialog({
  matterId,
  fee,
  onClose,
  onSaved,
}: {
  matterId: string;
  fee: FeeAgreement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { membership } = useAuth();
  const [kind, setKind] = useState<FeeKind>(fee?.kind ?? "hourly");
  const [hourly, setHourly] = useState(fee?.hourly_rate?.toString() ?? "");
  const [amount, setAmount] = useState(
    (fee?.fixed_amount ?? fee?.retainer_amount)?.toString() ?? "",
  );
  const [percent, setPercent] = useState(fee?.percent?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      const { saveFeeAgreement } = await import("@/lib/billing");
      await saveFeeAgreement({
        org_id: membership.org_id,
        matter_id: matterId,
        existingId: fee?.id,
        kind,
        hourly_rate: hourly,
        fixed_amount: amount,
        percent,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <Card className="w-full max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <h3 className="text-lg font-bold">הסכם שכר טרחה</h3>

          <div className="flex flex-wrap gap-1.5">
            {(["hourly", "fixed", "retainer"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  kind === k ? "bg-brand text-white" : "bg-ground text-ink-soft"
                }`}
              >
                {FEE_KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {kind === "hourly" && (
            <Field
              label="תעריף שעתי (₪)"
              type="number"
              min="0"
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
              autoFocus
              required
            />
          )}

          {kind === "fixed" && (
            <>
              <Field
                label="אחוז מהעסקה"
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                hint="השאר ריק אם סוכם סכום קבוע."
              />
              <Field
                label="או סכום קבוע (₪)"
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </>
          )}

          {kind === "retainer" && (
            <Field
              label="ריטיינר חודשי (₪)"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              required
            />
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "שומר..." : "שמור"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              ביטול
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
