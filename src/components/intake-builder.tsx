import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  addQuestion,
  createForm,
  listForms,
  listQuestions,
  QUESTION_TYPE_LABEL,
  removeQuestion,
  type IntakeForm,
  type IntakeQuestion,
  type QuestionType,
} from "@/lib/intake";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * A starting questionnaire, so nobody faces an empty screen.
 *
 * These are the things a lawyer asks at a first meeting and then spends two
 * weeks chasing. A firm can delete any of them and add its own; the point is
 * that the first link can go out in under a minute.
 */
const STARTER: Array<{ type: QuestionType; label: string; required: boolean }> = [
  { type: "text", label: "שם מלא כפי שמופיע בתעודת הזהות", required: true },
  { type: "text", label: "מספר תעודת זהות", required: true },
  { type: "text", label: "כתובת מלאה", required: true },
  { type: "text", label: "טלפון", required: true },
  { type: "text", label: "אימייל", required: false },
  { type: "file", label: "צילום תעודת זהות", required: true },
  { type: "long_text", label: "ספר בקצרה במה מדובר", required: true },
  { type: "file", label: "מסמכים רלוונטיים — חוזים, מכתבים, כל דבר שקיבלת", required: false },
];

export function IntakeBuilder() {
  const { membership } = useAuth();
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await listForms();
      setForms(all);
      const pick = selected ?? all[0]?.id ?? null;
      setSelected(pick);
      setQuestions(pick ? await listQuestions(pick) : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [selected]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function createStarter() {
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      const formId = await createForm(
        membership.org_id,
        "שאלון פתיחת תיק",
        "כמה פרטים ומסמכים לפני הפגישה הראשונה. אפשר למלא מהטלפון.",
      );
      for (const [i, q] of STARTER.entries()) {
        await addQuestion({
          org_id: membership.org_id,
          form_id: formId,
          position: i + 1,
          type: q.type,
          label: q.label,
          required: q.required,
          options: [],
        });
      }
      setSelected(formId);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5 flex flex-col gap-3">
      <div>
        <h2 className="font-bold">שאלון ללקוחות</h2>
        <p className="mt-1 text-sm text-ink-soft">
          מה לשאול לקוח חדש. שולחים לו קישור מכרטיס הלקוח, הוא ממלא בלי חשבון, והמסמכים נוחתים
          אצלך.
        </p>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {forms.length === 0 ? (
        <Button onClick={createStarter} disabled={busy} className="self-start">
          {busy ? "מכין..." : "צור שאלון פתיחה"}
        </Button>
      ) : (
        <>
          {forms.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {forms.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelected(f.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                    selected === f.id ? "bg-brand text-white" : "bg-ground text-ink-soft"
                  }`}
                >
                  {f.name}
                </button>
              ))}
            </div>
          )}

          <ol className="flex flex-col divide-y divide-rule">
            {questions.map((q, i) => (
              <li key={q.id} className="flex items-start justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-1 gap-2">
                  <span className="font-mono text-xs text-muted">{i + 1}</span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-semibold">
                      {q.label}
                      {q.required && <span className="text-danger"> *</span>}
                    </span>
                    <span className="text-xs text-muted">{QUESTION_TYPE_LABEL[q.type]}</span>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    await removeQuestion(q.id);
                    await reload();
                  }}
                  className="shrink-0 rounded px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
                >
                  הסר
                </button>
              </li>
            ))}
          </ol>

          {adding && selected ? (
            <NewQuestion
              orgId={membership?.org_id ?? ""}
              formId={selected}
              position={questions.length + 1}
              onSaved={async () => {
                setAdding(false);
                await reload();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="self-start text-sm font-semibold text-brand underline underline-offset-2"
            >
              הוסף שאלה
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function NewQuestion({
  orgId,
  formId,
  position,
  onSaved,
  onCancel,
}: {
  orgId: string;
  formId: string;
  position: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<QuestionType>("text");
  const [label, setLabel] = useState("");
  const [required, setRequired] = useState(false);
  const [options, setOptions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsOptions = type === "single_choice" || type === "multi_choice";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addQuestion({
        org_id: orgId,
        form_id: formId,
        position,
        type,
        label,
        required,
        // One per line: a comma is a legitimate character inside an answer
        // option, and asking someone to escape it is asking for a bug report.
        options: options.split("\n").map((o) => o.trim()).filter(Boolean),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-rule pt-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              type === t ? "bg-brand text-white" : "bg-ground text-ink-soft"
            }`}
          >
            {QUESTION_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <Field
        label="השאלה"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="לדוגמה: צילום תעודת זהות"
        autoFocus
        required
      />

      {needsOptions && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">אפשרויות</span>
          <textarea
            rows={3}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            placeholder={"אפשרות בכל שורה"}
            className="rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                       outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={required}
          onChange={(e) => setRequired(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-brand,#0e6e6e)]"
        />
        חובה
      </label>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !label.trim()}>
          {busy ? "שומר..." : "הוסף"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}
