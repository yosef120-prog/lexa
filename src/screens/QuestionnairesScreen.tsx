import { useCallback, useEffect, useState } from "react";
import {
  INTAKE_STATUS_LABEL,
  intakeLink,
  listAllIntakes,
  listOutstandingDocuments,
  markIntakeReviewed,
  revokeIntake,
  type IntakeOverview,
  type IntakeStatus,
} from "@/lib/intake";
import { IntakeBuilder } from "@/components/intake-builder";
import { Card, ErrorNote } from "@/components/ui";

const STATUS_LOOK: Record<IntakeStatus, string> = {
  sent: "bg-ground text-ink-soft",
  opened: "bg-warning/15 text-warning",
  partial: "bg-warning/15 text-warning",
  submitted: "bg-brand/15 text-brand",
  revoked: "bg-danger/10 text-danger line-through",
};

/**
 * Questionnaires, as a place rather than a setting.
 *
 * Two halves, in the order somebody arrives with them. First: who owes what,
 * which is the question that brings anyone here. Second: what we ask, which is
 * edited far less often but is the reason the first half looks the way it does.
 */
export function QuestionnairesScreen({ onOpenClient }: { onOpenClient: (id: string) => void }) {
  const [intakes, setIntakes] = useState<IntakeOverview[]>([]);
  // Which documents each partial questionnaire is still waiting on. Fetched
  // once for the whole screen rather than per row: "חסרים מסמכים" without
  // saying which is the state this screen exists to resolve.
  const [owed, setOwed] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [all, outstanding] = await Promise.all([
        listAllIntakes(),
        listOutstandingDocuments(),
      ]);
      setIntakes(all);
      setOwed(new Map(outstanding.map((o) => [o.id, o.documents])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Grouped by what the firm has to do about each, not by date. Nothing is a
  // group of its own until it has something in it.
  const groups: Array<{ label: string; rows: IntakeOverview[]; tone?: "good" | "warn" }> = [
    {
      label: "חזרו — ממתינים לך",
      rows: intakes.filter((i) => i.status === "submitted"),
      tone: "good" as const,
    },
    {
      label: "חסרים מסמכים",
      rows: intakes.filter((i) => i.status === "partial"),
      tone: "warn" as const,
    },
    {
      label: "אצל הלקוח",
      rows: intakes.filter((i) => i.status === "sent" || i.status === "opened"),
    },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">שאלונים</h1>
        <p className="text-sm text-muted">
          {loading ? "טוען..." : `${intakes.length} נשלחו מאז ומעולם`}
        </p>
      </div>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {!loading && intakes.length === 0 && (
        <Card className="mb-5 text-sm text-ink-soft">
          עוד לא נשלח שאלון. שולחים אחד מכרטיס הלקוח, והוא נוחת כאן.
        </Card>
      )}

      {groups.map((g) => (
        <section key={g.label} className="mb-5">
          <h2
            className={`mb-1.5 text-xs font-bold tracking-wide ${
              g.tone === "good" ? "text-brand" : g.tone === "warn" ? "text-warning" : "text-muted"
            }`}
          >
            {g.label}
          </h2>
          <Card className="p-0">
            <ul className="flex flex-col divide-y divide-rule">
              {g.rows.map((i) => (
                <Row
                  key={i.id}
                  intake={i}
                  documents={owed.get(i.id) ?? []}
                  onOpenClient={onOpenClient}
                  onChanged={reload}
                />
              ))}
            </ul>
          </Card>
        </section>
      ))}

      <IntakeBuilder />
    </div>
  );
}

function Row({
  intake,
  documents,
  onOpenClient,
  onChanged,
}: {
  intake: IntakeOverview;
  /** What this questionnaire is still waiting on, if anything. */
  documents: string[];
  onOpenClient: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live =
    intake.status === "sent" || intake.status === "opened" || intake.status === "partial";
  const daysLeft = Math.ceil((new Date(intake.expires_at).getTime() - Date.now()) / 86_400_000);

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await run();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_LOOK[intake.status]}`}
          >
            {INTAKE_STATUS_LABEL[intake.status]}
          </span>
          {intake.client && (
            <button
              onClick={() => onOpenClient(intake.client!.id)}
              className="truncate text-sm font-semibold underline-offset-2 hover:underline"
            >
              {intake.client.name}
            </button>
          )}
          <span className="truncate text-xs text-muted">{intake.form?.name}</span>
        </div>

        <div className="flex shrink-0 gap-1">
          {intake.status === "submitted" && (
            <button
              onClick={() => act(() => markIntakeReviewed(intake.id))}
              disabled={busy}
              className="rounded px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-rule/50 disabled:opacity-50"
            >
              ראיתי
            </button>
          )}
          {live && (
            <>
              <button
                onClick={() => setShowLink((s) => !s)}
                className="rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
              >
                {showLink ? "הסתר" : "קישור"}
              </button>
              <button
                onClick={() => act(() => revokeIntake(intake.id))}
                disabled={busy}
                className="rounded px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                בטל
              </button>
            </>
          )}
        </div>
      </div>

      <span className="text-xs text-muted">
        נשלח {new Date(intake.created_at).toLocaleDateString("he-IL")}
        {intake.opened_at && ` · נפתח ${new Date(intake.opened_at).toLocaleDateString("he-IL")}`}
        {intake.submitted_at &&
          ` · הוגש ${new Date(intake.submitted_at).toLocaleDateString("he-IL")}`}
        {live && ` · ${daysLeft > 0 ? `תקף עוד ${daysLeft} ימים` : "פג"}`}
      </span>

      {intake.status === "partial" && documents.length > 0 && (
        <div className="rounded-md bg-warning/10 p-2.5">
          <p className="text-xs font-semibold text-ink-soft">
            {documents.length === 1 ? "מסמך שעוד לא הגיע:" : "מסמכים שעוד לא הגיעו:"}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {documents.map((label) => (
              <li key={label} className="text-sm">
                <span aria-hidden className="text-warning">
                  •{" "}
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {intake.status === "partial" && (
        <span className="text-xs text-ink-soft">
          הלקוח יכול להשלים באותו קישור — שלח לו אותו שוב.
        </span>
      )}

      {showLink && <CopyLink link={intakeLink(intake.token)} />}
      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen and selectable either way.
      setCopied(false);
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md bg-ground p-2">
      <code className="min-w-0 flex-1 truncate text-xs" dir="ltr">
        {link}
      </code>
      <button
        onClick={copy}
        className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
      >
        {copied ? "הועתק" : "העתק"}
      </button>
    </div>
  );
}
