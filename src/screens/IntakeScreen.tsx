import { useEffect, useState, type FormEvent } from "react";
import {
  describeTrouble,
  isVisible,
  openIntake,
  submitIntake,
  uploadIntakeFile,
  uploadSignature,
  type AnswerPayload,
  type FileStatus,
  type PublicIntake,
  type PublicQuestion,
  type UploadedFile,
} from "@/lib/intake-public";
import { SignaturePad } from "@/components/signature-pad";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * What the client sees.
 *
 * The only screen in LEXA shown to somebody who is not a member of a firm, and
 * it is written for the hardest case: a person on a phone, photographing an
 * identity card, who has never seen this software and never will again.
 *
 * So: no account, no password, no jargon, and no chrome. One question after
 * another, and a button.
 */
export function IntakeScreen({ token, onLeave }: { token: string; onLeave: () => void }) {
  const [intake, setIntake] = useState<PublicIntake | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [files, setFiles] = useState<Record<string, UploadedFile[]>>({});
  // Per document question: attached, coming later, or not applicable.
  const [fileStatus, setFileStatus] = useState<Record<string, FileStatus>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [stillOwed, setStillOwed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    openIntake(token)
      .then(setIntake)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  if (error && !intake) return <Frame><ErrorNote>{error}</ErrorNote></Frame>;
  if (!intake) return <Frame><p className="text-sm text-muted">טוען...</p></Frame>;

  if (!intake.valid) {
    return (
      <Frame>
        <h1 className="text-xl font-bold">{describeTrouble(intake.reason)}</h1>
        {intake.reason === "ALREADY_SUBMITTED" && (
          <p className="text-sm text-ink-soft">אם צריך לשלוח משהו נוסף, פנה למשרד.</p>
        )}
      </Frame>
    );
  }

  if (done) {
    return (
      <Frame>
        <h1 className="text-xl font-bold">קיבלנו, תודה.</h1>
        {/* Truthful about what happens next. Somebody who said "I will send it
            later" has something left to do, and telling them otherwise is how
            it never arrives. */}
        <p className="text-sm text-ink-soft">
          {stillOwed
            ? `מה ששלחת הגיע ל${intake.org_name}. כשהמסמכים החסרים יהיו אצלך — פתח שוב את אותו קישור והעלה רק אותם.`
            : `התשובות והמסמכים הגיעו ל${intake.org_name}. אין צורך לעשות שום דבר נוסף.`}
        </p>
      </Frame>
    );
  }

  // Only what is on screen. A question hidden by its condition is not missing,
  // and demanding it would leave somebody staring at a button that never
  // enables with nothing to click.
  const asked = intake.questions.filter((q) => isVisible(q, values));

  const missing = asked.filter((q) => {
    if (!q.required) return false;
    // A document is answered either by attaching it or by saying why it is not
    // here. Both are answers; only silence is missing.
    if (q.type === "file") {
      return (files[q.id] ?? []).length === 0 && !fileStatus[q.id];
    }
    if (q.type === "signature") return (files[q.id] ?? []).length === 0;
    const v = values[q.id];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!intake) return;
    setBusy(true);
    setError(null);
    try {
      // Only the questions that were shown. Sending an answer to a hidden one
      // would record something the client never saw.
      const payload: AnswerPayload[] = asked.map((q) => {
        const v = values[q.id];
        switch (q.type) {
          case "number":
            return { question_id: q.id, number: v === undefined || v === "" ? null : Number(v) };
          case "date":
            return { question_id: q.id, date: (v as string) || null };
          case "multi_choice":
            return { question_id: q.id, json: (v as string[]) ?? [] };
          case "file": {
            const attached = files[q.id] ?? [];
            return {
              question_id: q.id,
              json: attached,
              status: attached.length > 0 ? "provided" : (fileStatus[q.id] ?? "later"),
            };
          }
          case "signature":
            return { question_id: q.id, json: files[q.id] ?? [] };
          case "consent":
            // Recorded as the text they agreed to, not as "true". A year from
            // now the wording may have changed, and the question is what this
            // client accepted.
            return { question_id: q.id, text: v === "agreed" ? q.body : null };
          default:
            return { question_id: q.id, text: (v as string) ?? null };
        }
      });
      await submitIntake(token, payload);
      setStillOwed(payload.some((a) => a.status === "later"));
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg p-4 sm:p-6">
      <div className="mb-5">
        <span className="text-sm font-bold tracking-tight text-brand">LEXA</span>
        <h1 className="mt-1 text-2xl font-bold">{intake.form_name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {intake.client_name} · {intake.org_name}
        </p>
        {intake.is_return ? (
          // Somebody who came back holding one piece of paper should be told
          // immediately that this is short, not made to scroll for it.
          <p className="mt-3 rounded-md bg-brand/10 p-3 text-sm">
            נשאר רק להשלים את המסמכים שלא היו לך קודם. כל השאר כבר התקבל.
          </p>
        ) : (
          intake.intro && <p className="mt-3 text-sm">{intake.intro}</p>
        )}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        {asked.map((q) => (
          <Card key={q.id}>
            <Question
              question={q}
              value={values[q.id]}
              files={files[q.id] ?? []}
              fileStatus={fileStatus[q.id]}
              token={token}
              onValue={(v) => setValues((s) => ({ ...s, [q.id]: v }))}
              onFiles={(f) => {
                setFiles((s) => ({ ...s, [q.id]: f }));
                // Attaching something answers the question; the excuse goes.
                if (f.length > 0) setFileStatus((s) => ({ ...s, [q.id]: "provided" }));
              }}
              onFileStatus={(st) => {
                setFileStatus((s) => ({ ...s, [q.id]: st }));
                if (st !== "provided") setFiles((s) => ({ ...s, [q.id]: [] }));
              }}
              onError={setError}
            />
          </Card>
        ))}

        {error && <ErrorNote>{error}</ErrorNote>}

        <Button type="submit" disabled={busy || missing.length > 0}>
          {busy ? "שולח..." : "שלח למשרד"}
        </Button>

        {missing.length > 0 && (
          <p className="text-center text-xs text-muted">
            נשאר למלא: {missing.map((q) => q.label).join(", ")}
          </p>
        )}

        {/* Said once, at the bottom, where somebody is about to send documents
            about themselves to a firm. */}
        <p className="text-center text-xs text-muted">
          המידע נשלח ישירות ל{intake.org_name} ואינו נגלה לאף אחד אחר.
        </p>

        <button
          type="button"
          onClick={onLeave}
          className="self-center text-xs text-muted underline underline-offset-2"
        >
          לא עכשיו
        </button>
      </form>
    </div>
  );
}

function Question({
  question: q,
  value,
  files,
  fileStatus,
  token,
  onValue,
  onFiles,
  onFileStatus,
  onError,
}: {
  question: PublicQuestion;
  value: unknown;
  files: UploadedFile[];
  fileStatus: FileStatus | undefined;
  token: string;
  onValue: (v: unknown) => void;
  onFiles: (f: UploadedFile[]) => void;
  onFileStatus: (s: FileStatus) => void;
  onError: (e: string) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const label = (
    <div className="mb-2">
      <span className="text-sm font-semibold">
        {q.label}
        {q.required && <span className="text-danger"> *</span>}
      </span>
      {q.help && <p className="text-xs text-muted">{q.help}</p>}
    </div>
  );

  const box =
    "w-full rounded-md border border-rule bg-surface px-3 py-2.5 text-base outline-none " +
    "focus:border-brand focus:ring-2 focus:ring-brand/20";

  switch (q.type) {
    case "long_text":
      return (
        <div>
          {label}
          <textarea
            rows={4}
            value={(value as string) ?? ""}
            onChange={(e) => onValue(e.target.value)}
            className={`${box} resize-y`}
          />
        </div>
      );

    case "number":
      return (
        <div>
          {label}
          <input
            type="number"
            inputMode="decimal"
            value={(value as string) ?? ""}
            onChange={(e) => onValue(e.target.value)}
            className={box}
          />
        </div>
      );

    case "date":
      return (
        <div>
          {label}
          <input
            type="date"
            value={(value as string) ?? ""}
            onChange={(e) => onValue(e.target.value)}
            className={box}
          />
        </div>
      );

    case "yes_no":
      return (
        <div>
          {label}
          <div className="flex gap-2">
            {(["yes", "no"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onValue(v)}
                className={`flex-1 rounded-md px-3 py-2.5 text-sm font-semibold ${
                  value === v ? "bg-brand text-white" : "bg-ground text-ink-soft"
                }`}
              >
                {v === "yes" ? "כן" : "לא"}
              </button>
            ))}
          </div>
        </div>
      );

    case "single_choice":
      return (
        <div>
          {label}
          <div className="flex flex-col gap-1.5">
            {(q.options ?? []).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onValue(o)}
                className={`rounded-md px-3 py-2.5 text-start text-sm font-semibold ${
                  value === o ? "bg-brand text-white" : "bg-ground text-ink-soft"
                }`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );

    case "multi_choice": {
      const chosen = (value as string[]) ?? [];
      return (
        <div>
          {label}
          <div className="flex flex-col gap-1.5">
            {(q.options ?? []).map((o) => {
              const on = chosen.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => onValue(on ? chosen.filter((c) => c !== o) : [...chosen, o])}
                  className={`rounded-md px-3 py-2.5 text-start text-sm font-semibold ${
                    on ? "bg-brand text-white" : "bg-ground text-ink-soft"
                  }`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    case "signature":
      return (
        <div>
          {label}
          <SignaturePad
            onChange={async (png) => {
              if (!png) {
                onFiles([]);
                return;
              }
              setUploading(true);
              try {
                onFiles([await uploadSignature(token, png)]);
              } catch (err) {
                onError(err instanceof Error ? err.message : String(err));
              } finally {
                setUploading(false);
              }
            }}
          />
          {/* Said where the signature is made, not in a footer. The person
              signing should know what is being kept alongside it. */}
          <p className="mt-1 text-xs text-muted">
            {uploading
              ? "שומר את החתימה..."
              : "החתימה נשמרת יחד עם התאריך, השעה וכתובת ה‑IP שממנה נשלח הטופס."}
          </p>
        </div>
      );

    case "consent":
      return (
        <div>
          {/* The declaration itself, not a link to it. Somebody agreeing to
              something has to be able to read it without leaving the page. */}
          <p className="mb-2 whitespace-pre-wrap rounded-md bg-ground p-3 text-sm leading-relaxed">
            {q.body}
          </p>
          <label className="flex items-start gap-2.5 text-sm font-semibold">
            <input
              type="checkbox"
              checked={value === "agreed"}
              onChange={(e) => onValue(e.target.checked ? "agreed" : null)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand,#0e6e6e)]"
            />
            <span>
              {q.label}
              {q.required && <span className="text-danger"> *</span>}
            </span>
          </label>
        </div>
      );

    case "file":
      return (
        <div>
          {label}
          <ul className="mb-2 flex flex-col gap-1">
            {files.map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{f.filename}</span>
                <button
                  type="button"
                  onClick={() => onFiles(files.filter((x) => x.path !== f.path))}
                  className="shrink-0 text-xs text-danger underline underline-offset-2"
                >
                  הסר
                </button>
              </li>
            ))}
          </ul>

          {fileStatus === "later" || fileStatus === "not_applicable" ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-ground px-3 py-2.5">
              <span className="text-sm">
                {fileStatus === "later" ? "תשלח את המסמך בהמשך" : "לא רלוונטי עבורך"}
              </span>
              <button
                type="button"
                onClick={() => onFileStatus("provided")}
                className="shrink-0 text-xs font-semibold text-brand underline underline-offset-2"
              >
                שנה
              </button>
            </div>
          ) : (
            <>
              {/* Uploaded as they are chosen rather than held until submit:
                  somebody photographing three documents should not lose the
                  first two because the third failed. */}
              <label
                className={`block cursor-pointer rounded-md border border-dashed border-rule
                            px-3 py-4 text-center text-sm font-semibold ${
                              uploading ? "text-muted" : "text-brand"
                            }`}
              >
                {uploading ? "מעלה..." : files.length > 0 ? "הוסף עוד קובץ" : "בחר קובץ או צלם"}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setUploading(true);
                    try {
                      onFiles([...files, await uploadIntakeFile(token, file)]);
                    } catch (err) {
                      onError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setUploading(false);
                    }
                  }}
                />
              </label>

              {/* The two honest answers besides the document itself. Without
                  them the only way past a document you do not have is to
                  abandon the form, and then the firm chases you anyway. */}
              {files.length === 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onFileStatus("later")}
                    className="rounded-md bg-ground px-2.5 py-1.5 text-xs font-semibold text-ink-soft
                               hover:bg-rule/60"
                  >
                    אין לי כרגע — אשלח בהמשך
                  </button>
                  <button
                    type="button"
                    onClick={() => onFileStatus("not_applicable")}
                    className="rounded-md bg-ground px-2.5 py-1.5 text-xs font-semibold text-ink-soft
                               hover:bg-rule/60"
                  >
                    לא רלוונטי עבורי
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      );

    default:
      return (
        <div>
          {label}
          <input
            type="text"
            value={(value as string) ?? ""}
            onChange={(e) => onValue(e.target.value)}
            className={box}
          />
        </div>
      );
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="flex w-full max-w-sm flex-col gap-3 text-center">
        <span className="text-sm font-bold tracking-tight text-brand">LEXA</span>
        {children}
      </Card>
    </div>
  );
}
