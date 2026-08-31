import { useCallback, useEffect, useState } from "react";
import {
  answerText,
  INTAKE_STATUS_LABEL,
  intakeLink,
  listAnswers,
  listForms,
  listQuestions,
  revokeIntake,
  sendIntake,
  type ClientIntake,
  type IntakeAnswer,
  type IntakeForm,
  type IntakeQuestion,
} from "@/lib/intake";
import { Button, Card, ErrorNote } from "@/components/ui";

const STATUS_LOOK: Record<ClientIntake["status"], string> = {
  sent: "bg-ground text-ink-soft",
  opened: "bg-warning/15 text-warning",
  submitted: "bg-brand/15 text-brand",
  revoked: "bg-danger/10 text-danger line-through",
};

/**
 * Asking a client for what you need, and seeing what came back.
 *
 * The brief calls chasing clients for documents the most annoying part of the
 * day. This is the answer to that: one link, no account, and what arrives lands
 * on the card by itself.
 */
export function IntakePanel({
  orgId,
  clientId,
  intakes,
  onChanged,
}: {
  orgId: string;
  clientId: string;
  intakes: ClientIntake[];
  onChanged: () => void;
}) {
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [sending, setSending] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listForms()
      .then(setForms)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function send(formId: string) {
    setSending(true);
    setError(null);
    try {
      const created = await sendIntake(orgId, clientId, formId);
      // Shown immediately, because the link is the product of the click and
      // making someone hunt for it afterwards is how it does not get sent.
      setFreshLink(intakeLink(created.token));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">שאלונים</h2>
        <span className="text-xs text-muted">{intakes.length}</span>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {freshLink ? (
        <div className="flex flex-col gap-2 rounded-md bg-brand/5 p-3">
          <p className="text-sm font-semibold">הקישור מוכן</p>
          <p className="text-xs text-ink-soft">
            שלח אותו ללקוח בוואטסאפ או במייל. הוא לא צריך חשבון או סיסמה — רק ללחוץ, למלא ולצרף.
          </p>
          <CopyLink link={freshLink} />
          <button
            onClick={() => setFreshLink(null)}
            className="self-start text-xs text-brand underline underline-offset-2"
          >
            סגור
          </button>
        </div>
      ) : forms.length === 0 ? (
        <p className="text-sm text-ink-soft">
          עוד לא הוגדר שאלון. אפשר להגדיר אחד במסך המשרד, והוא ישמש את כל הלקוחות.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {forms.map((f) => (
            <Button key={f.id} onClick={() => send(f.id)} disabled={sending}>
              {sending ? "יוצר..." : `שלח: ${f.name}`}
            </Button>
          ))}
        </div>
      )}

      {intakes.length > 0 && (
        <ul className="flex flex-col divide-y divide-rule border-t border-rule">
          {intakes.map((i) => (
            <IntakeRow key={i.id} intake={i} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function IntakeRow({ intake, onChanged }: { intake: ClientIntake; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<IntakeQuestion[] | null>(null);
  const [answers, setAnswers] = useState<IntakeAnswer[]>([]);
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = intake.status === "sent" || intake.status === "opened";
  const daysLeft = Math.ceil((new Date(intake.expires_at).getTime() - Date.now()) / 86_400_000);

  const load = useCallback(async () => {
    if (!intake.form) return;
    try {
      const [qs, as] = await Promise.all([listQuestions(intake.form.id), listAnswers(intake.id)]);
      setQuestions(qs);
      setAnswers(as);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [intake]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && questions === null) await load();
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeIntake(intake.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <button onClick={toggle} className="flex min-w-0 flex-1 items-baseline gap-2 text-start">
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${STATUS_LOOK[intake.status]}`}
          >
            {INTAKE_STATUS_LABEL[intake.status]}
          </span>
          <span className="truncate text-sm font-semibold">{intake.form?.name ?? "שאלון"}</span>
        </button>

        <div className="flex shrink-0 gap-1">
          {live && (
            <>
              <button
                onClick={() => setShowLink((s) => !s)}
                className="rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
              >
                {showLink ? "הסתר" : "קישור"}
              </button>
              <button
                onClick={revoke}
                disabled={busy}
                className="rounded px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-50"
              >
                בטל
              </button>
            </>
          )}
        </div>
      </div>

      {/* The two dates worth seeing at a glance: whether they looked, and how
          long the link has left. Silence after opening means something
          different from silence before it. */}
      <span className="text-xs text-muted">
        נשלח {new Date(intake.created_at).toLocaleDateString("he-IL")}
        {intake.opened_at && ` · נפתח ${new Date(intake.opened_at).toLocaleDateString("he-IL")}`}
        {intake.submitted_at && ` · הוגש ${new Date(intake.submitted_at).toLocaleDateString("he-IL")}`}
        {live && ` · ${daysLeft > 0 ? `תקף עוד ${daysLeft} ימים` : "פג"}`}
      </span>

      {showLink && <CopyLink link={intakeLink(intake.token)} />}
      {error && <ErrorNote>{error}</ErrorNote>}

      {open && (
        <div className="rounded-md bg-ground p-3 text-sm">
          {questions === null ? (
            <span className="text-muted">טוען...</span>
          ) : intake.status !== "submitted" ? (
            <span className="text-ink-soft">עוד לא הוגש. אלה השאלות שנשלחו:</span>
          ) : null}

          <dl className="mt-1 flex flex-col gap-2">
            {(questions ?? []).map((q) => (
              <div key={q.id} className="flex flex-col">
                <dt className="text-xs text-muted">{q.label}</dt>
                <dd className="font-semibold">
                  {answerText(q, answers.find((a) => a.question_id === q.id))}
                </dd>
              </div>
            ))}
          </dl>

          {intake.status === "submitted" && (
            <p className="mt-2 border-t border-rule pt-2 text-xs text-muted">
              הקבצים שצורפו נמצאים ברשימת מסמכי הלקוח.
            </p>
          )}
        </div>
      )}
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
    <div className="flex items-center gap-2 rounded-md bg-surface p-2">
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
