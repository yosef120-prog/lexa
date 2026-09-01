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
import { useAuth } from "@/lib/auth";
import { intakeMessage, toWhatsAppNumber, whatsAppLink } from "@/lib/whatsapp";
import { Button, Card, ErrorNote } from "@/components/ui";

const STATUS_LOOK: Record<ClientIntake["status"], string> = {
  sent: "bg-ground text-ink-soft",
  opened: "bg-warning/15 text-warning",
  // Partial is the state that needs a nudge, so it wears the warning colour
  // rather than the calm one: something is outstanding and somebody has to
  // either wait or ask.
  partial: "bg-warning/15 text-warning",
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
  clientName,
  clientPhone,
  intakes,
  onChanged,
  onEditForms,
}: {
  orgId: string;
  clientId: string;
  clientName: string;
  clientPhone: string | null;
  intakes: ClientIntake[];
  onChanged: () => void;
  /** Opens the questionnaires screen, where the questions are written. */
  onEditForms: () => void;
}) {
  const { membership } = useAuth();
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [sending, setSending] = useState(false);
  const [freshLink, setFreshLink] = useState<{
    url: string;
    reused: boolean;
    formName: string;
  } | null>(null);
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
      const { intake, reused } = await sendIntake(orgId, clientId, formId);
      const form = forms.find((f) => f.id === formId);
      // Shown immediately, because the link is the product of the click and
      // making someone hunt for it afterwards is how it does not get sent.
      setFreshLink({
        url: intakeLink(intake.token),
        reused,
        formName: form?.name ?? "שאלון",
      });
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

      {freshLink && (
        <div className="flex flex-col gap-2 rounded-md bg-brand/5 p-3">
          <p className="text-sm font-semibold">
            {freshLink.reused ? "כבר יש קישור פעיל ללקוח הזה" : "הקישור מוכן"}
          </p>
          <p className="text-xs text-ink-soft">
            {freshLink.reused
              ? "זה אותו קישור, לא חדש. שליחת שניים הייתה מפצלת את התשובות בין שניהם."
              : "הלקוח לא צריך חשבון או סיסמה — רק ללחוץ, למלא ולצרף."}
          </p>

          {/* The whole point: from here to the client's phone in one tap,
              rather than copy, switch app, find contact, paste. */}
          <a
            href={whatsAppLink(
              toWhatsAppNumber(clientPhone),
              intakeMessage({
                clientName,
                firmName: membership?.org_name ?? "",
                formName: freshLink.formName,
                link: freshLink.url,
              }),
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[#25D366]
                       px-4 py-2.5 text-sm font-semibold text-white hover:brightness-95"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M17.5 14.4c-.3-.2-1.7-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.2-.5-2.3-1.4-.9-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5 0-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.2.2 2 3.1 5 4.3.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.5-.3z" />
              <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2c-1.6 0-3.1-.4-4.4-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
            </svg>
            שלח בוואטסאפ
          </a>

          {!toWhatsAppNumber(clientPhone) && (
            // Said plainly: WhatsApp will still open, it just will not know
            // who to. Better than a button that silently does half its job.
            <p className="text-xs text-muted">
              אין מספר טלפון תקין בכרטיס, אז וואטסאפ ייפתח עם ההודעה מוכנה ויבקש לבחור נמען.
            </p>
          )}

          <CopyLink link={freshLink.url} />
          <button
            onClick={() => setFreshLink(null)}
            className="self-start text-xs text-brand underline underline-offset-2"
          >
            סגור
          </button>
        </div>
      )}

      {forms.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-ink-soft">עוד לא הוגדר שאלון.</p>
          <Button onClick={onEditForms}>הגדר שאלון</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Always here, whether or not a link was just made. A firm sending
              one questionnaire usually has a second in mind. */}
          <div className="flex flex-wrap gap-1.5">
            {forms.map((f) => (
              <Button key={f.id} onClick={() => send(f.id)} disabled={sending}>
                {sending ? "יוצר..." : `שלח: ${f.name}`}
              </Button>
            ))}
          </div>
          <button
            onClick={onEditForms}
            className="self-start text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
          >
            ערוך שאלונים, או צור חדש
          </button>
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

  const live =
    intake.status === "sent" || intake.status === "opened" || intake.status === "partial";
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
