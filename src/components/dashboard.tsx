import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { loadSnapshot, type Snapshot } from "@/lib/dashboard";
import { listOutstandingDocuments, type OutstandingIntake } from "@/lib/intake";
import { formatMoney } from "@/lib/billing";
import { Card } from "@/components/ui";

type Go = {
  matters: () => void;
  tasks: () => void;
  diary: () => void;
  clients: () => void;
  /** Straight to one client's card, because chasing a document starts there. */
  client: (id: string) => void;
};

/**
 * The first thing a lawyer sees in the morning.
 *
 * Ordered by what it costs to miss. A hearing that has passed and a task that
 * is late come first, and they are the only things allowed to be red; a
 * questionnaire that came back is good news and wears the brand colour. The
 * counts sit underneath because they are worth a glance and not a decision.
 *
 * Every row goes somewhere. A number that names a problem and cannot be acted
 * on is a worse version of not showing it.
 */
export function Dashboard({ go }: { go: Go }) {
  const { membership, session } = useAuth();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [owed, setOwed] = useState<OutstandingIntake[]>([]);

  useEffect(() => {
    loadSnapshot()
      .then(setSnap)
      // The rest of the firm screen still works; a broken count is not worth
      // taking the page down for.
      .catch((e) => console.warn("dashboard unavailable", e));

    // Loaded separately so a failure here costs the list and not the screen.
    listOutstandingDocuments()
      .then(setOwed)
      .catch((e) => console.warn("outstanding documents unavailable", e));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "בוקר טוב" : hour < 18 ? "צהריים טובים" : "ערב טוב";
  const firstName = (session?.user.user_metadata?.full_name as string | undefined)?.split(" ")[0];

  const needs = snap
    ? [
        // Both wordings, because "1 משימות באיחור" is not Hebrew and this is
        // the line a lawyer reads first in the morning.
        {
          n: snap.diary.overdue,
          label: "מועדים שעברו ולא נסגרו",
          one: "מועד שעבר ולא נסגר",
          tone: "danger" as const,
          onClick: go.diary,
        },
        {
          n: snap.tasks.overdue,
          label: "משימות באיחור",
          one: "משימה באיחור",
          tone: "danger" as const,
          onClick: go.tasks,
        },
        {
          n: snap.intakes.arrived,
          label: "שאלונים שחזרו וטרם נקראו",
          one: "שאלון שחזר וטרם נקרא",
          tone: "good" as const,
          onClick: go.clients,
        },
        // The questionnaires missing documents are not counted here. A number
        // cannot be chased; the list below names the client and the documents.
        {
          n: snap.diary.soon,
          label: "מועדים בשבוע הקרוב",
          one: "מועד בשבוע הקרוב",
          tone: "warn" as const,
          onClick: go.diary,
        },
      ].filter((r) => r.n > 0)
    : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="text-sm text-muted">{membership?.org_name}</p>
      </div>

      {!snap ? (
        <Card className="text-sm text-muted">טוען...</Card>
      ) : (
        <>
          {needs.length > 0 ? (
            <Card className="flex flex-col gap-0 p-0">
              {needs.map((r, i) => (
                <button
                  key={r.label}
                  onClick={r.onClick}
                  className={`flex items-center gap-3 px-4 py-3 text-start hover:bg-ground ${
                    i > 0 ? "border-t border-rule" : ""
                  }`}
                >
                  {/* The number carries the weight, so it is the thing sized
                      and coloured — the words next to it are the caption. */}
                  <span
                    className={`w-10 shrink-0 text-2xl font-bold tabular-nums ${
                      r.tone === "danger"
                        ? "text-danger"
                        : r.tone === "good"
                          ? "text-brand"
                          : "text-warning"
                    }`}
                  >
                    {r.n}
                  </span>
                  <span className="flex-1 text-sm font-semibold">
                    {r.n === 1 ? r.one : r.label}
                  </span>
                  <span className="shrink-0 text-muted">←</span>
                </button>
              ))}
            </Card>
          ) : owed.length === 0 ? (
            <Card className="text-sm text-ink-soft">
              אין מועד שעבר, משימה באיחור או שאלון שממתין. הכל מטופל.
            </Card>
          ) : null}

          {/* Named, not counted.
              "1 questionnaires missing documents" is a number a firm can read
              and cannot act on: not which client, not what to ask for, not
              whether it is one document or four. Chasing a document means
              phoning somebody and saying its name, so the name is what this
              shows — and the row opens that client's card. */}
          {owed.length > 0 && (
            <div>
              <h2 className="mb-2 text-xs font-bold tracking-wide text-muted">
                מסמכים שהלקוח עוד לא שלח
              </h2>
              <Card className="flex flex-col gap-0 p-0">
                {owed.map((intake, i) => (
                  <button
                    key={intake.id}
                    onClick={() => intake.client && go.client(intake.client.id)}
                    className={`flex flex-col gap-1.5 px-4 py-3 text-start hover:bg-ground ${
                      i > 0 ? "border-t border-rule" : ""
                    }`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-bold">
                        {intake.client?.name ?? "לקוח"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">
                        {intake.form?.name}
                      </span>
                      <span className="shrink-0 text-muted">←</span>
                    </span>

                    <ul className="flex flex-col gap-0.5">
                      {intake.documents.map((label) => (
                        <li key={label} className="text-sm text-ink-soft">
                          <span aria-hidden className="text-warning">
                            •{" "}
                          </span>
                          {label}
                        </li>
                      ))}
                    </ul>
                  </button>
                ))}
              </Card>
            </div>
          )}

          <div>
            <h2 className="mb-2 text-xs font-bold tracking-wide text-muted">המשרד במספרים</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile n={snap.matters.open} label="תיקים פתוחים" onClick={go.matters} />
              <Tile n={snap.clients} label="לקוחות" onClick={go.clients} />
              <Tile n={snap.tasks.open} label="משימות פתוחות" onClick={go.tasks} />
              <Tile n={snap.intakes.waiting} label="שאלונים בהמתנה" onClick={go.clients} />
            </div>

            {(snap.matters.onHold > 0 || snap.matters.closed > 0) && (
              <p className="mt-2 text-xs text-muted">
                ועוד {snap.matters.onHold} מושהים ו־{snap.matters.closed} סגורים.
              </p>
            )}
          </div>

          {/* Money last, and only for whoever may see it. An intern gets the
              screen without the figures rather than a firm that looks broke. */}
          {snap.money && (
            <div>
              <h2 className="mb-2 text-xs font-bold tracking-wide text-muted">כסף</h2>
              <div className="grid grid-cols-2 gap-3">
                <Money
                  amount={snap.money.unbilled}
                  label="שעות שטרם חויבו"
                  hint="עבודה שנרשמה ואין עליה דרישת תשלום"
                />
                <Money
                  amount={snap.money.awaitingPayment}
                  label="דרישות שנשלחו וטרם שולמו"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col rounded-lg border border-rule bg-surface p-4 text-start
                 transition-colors hover:border-brand/40 hover:bg-ground"
    >
      <span className="text-3xl font-bold tabular-nums">{n}</span>
      <span className="mt-0.5 text-xs text-muted">{label}</span>
    </button>
  );
}

function Money({ amount, label, hint }: { amount: number; label: string; hint?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-rule bg-surface p-4">
      <span className="text-2xl font-bold tabular-nums">{formatMoney(amount)}</span>
      <span className="mt-0.5 text-xs text-muted">{label}</span>
      {hint && <span className="mt-1 text-xs text-muted">{hint}</span>}
    </div>
  );
}
