import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  addQuestion,
  createForm,
  listForms,
  listQuestions,
  QUESTION_TYPE_LABEL,
  removeQuestion,
  swapQuestions,
  updateForm,
  updateQuestion,
  type IntakeForm,
  type IntakeQuestion,
  type QuestionType,
} from "@/lib/intake";
import {
  draftFrom,
  EMPTY_DRAFT,
  QuestionEditor,
  type QuestionDraft,
} from "@/components/question-editor";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

type Starter = {
  type: QuestionType;
  label: string;
  help?: string;
  body?: string;
  required: boolean;
  options?: string[];
  /** 1-based index into this list — the position the parent will be given. */
  dependsOn?: number;
  dependsValue?: string;
};

/**
 * A starting point, not a finished questionnaire.
 *
 * These are the questions a first meeting turns on. Every one can be reworded,
 * reordered or removed, which is the part that was missing: a questionnaire a
 * firm cannot shape is mine rather than theirs, and it has to sound like them.
 */
const STARTER: Starter[] = [
  { type: "text", label: "שם מלא כפי שמופיע בתעודת הזהות", required: true },
  { type: "text", label: "מספר תעודת זהות", required: true },
  { type: "date", label: "תאריך לידה", required: false },
  { type: "text", label: "כתובת מלאה", required: true },
  { type: "text", label: "טלפון", required: true },
  { type: "text", label: "אימייל", required: false },
  { type: "file", label: "צילום תעודת זהות", help: "אפשר לצלם מהטלפון", required: true },
  { type: "long_text", label: "ספר בקצרה במה מדובר", required: true },
  {
    type: "single_choice",
    label: "איך הגעת אלינו?",
    options: ["המלצה", "חיפוש באינטרנט", "לקוח קודם", "אחר"],
    required: false,
  },
  { type: "yes_no", label: "האם יש הליך משפטי תלוי ועומד בעניין הזה?", required: true },
  {
    type: "text",
    label: "באיזה בית משפט, ומה מספר התיק?",
    required: false,
    dependsOn: 10,
    dependsValue: "yes",
  },
  { type: "yes_no", label: "האם פנית לעורך דין אחר בעניין הזה?", required: true },
  {
    type: "text",
    label: "שם עורך הדין, והאם הייצוג הסתיים",
    // A second firm on one matter is a conflict question and a fee question at
    // once, which is why it belongs before the first meeting rather than in it.
    help: "חשוב לדעת לפני שמתחילים",
    required: false,
    dependsOn: 12,
    dependsValue: "yes",
  },
  {
    type: "yes_no",
    label: "האם יש מועד קרוב שאנחנו צריכים לדעת עליו?",
    help: "דיון, מועד להגשה, תפוגת התיישנות",
    required: true,
  },
  { type: "date", label: "מתי?", required: false, dependsOn: 14, dependsValue: "yes" },
  {
    type: "file",
    label: "מסמכים רלוונטיים — חוזים, מכתבים, כל דבר שקיבלת",
    required: false,
  },
  {
    type: "consent",
    label: "אני מאשר/ת",
    body:
      "הפרטים שמסרתי נכונים ומלאים למיטב ידיעתי. ידוע לי שמסירת הפרטים אינה יוצרת " +
      "יחסי עורך דין–לקוח, ושייצוג ייקבע רק לאחר פגישה ובכפוף להסכם שכר טרחה בכתב " +
      "ולבדיקת ניגוד עניינים.",
    required: true,
  },
];

export function IntakeBuilder() {
  const { membership } = useAuth();
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingForm, setEditingForm] = useState(false);
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

      // Two passes: a condition points at a question that has no id until the
      // first pass has created it.
      const created: string[] = [];
      for (const [i, q] of STARTER.entries()) {
        created.push(
          await addQuestion({
            org_id: membership.org_id,
            form_id: formId,
            position: i + 1,
            type: q.type,
            label: q.label,
            help: q.help,
            body: q.body,
            required: q.required,
            options: q.options ?? [],
          }),
        );
      }
      for (const [i, q] of STARTER.entries()) {
        if (!q.dependsOn) continue;
        await updateQuestion(created[i], {
          type: q.type,
          label: q.label,
          help: q.help ?? "",
          body: q.body ?? "",
          required: q.required,
          options: q.options ?? [],
          depends_on_question_id: created[q.dependsOn - 1],
          depends_on_value: q.dependsValue ?? null,
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

  const chosen = forms.find((f) => f.id === selected) ?? null;

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

          {editingForm && chosen ? (
            <FormDetails
              form={chosen}
              onSaved={async () => {
                setEditingForm(false);
                await reload();
              }}
              onCancel={() => setEditingForm(false)}
            />
          ) : (
            chosen?.intro && <p className="text-xs text-muted">{chosen.intro}</p>
          )}

          <ol className="flex flex-col divide-y divide-rule">
            {questions.map((q, i) => (
              <li key={q.id} className="py-2">
                {editingId === q.id ? (
                  <QuestionEditor
                    draft={draftFrom(q)}
                    earlier={questions.slice(0, i)}
                    saveLabel="שמור שינויים"
                    onSave={async (d: QuestionDraft) => {
                      await updateQuestion(q.id, d);
                      setEditingId(null);
                      await reload();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <QuestionRow
                    question={q}
                    index={i}
                    all={questions}
                    onEdit={() => {
                      setEditingId(q.id);
                      setAdding(false);
                    }}
                    onChanged={reload}
                  />
                )}
              </li>
            ))}
          </ol>

          {adding && selected ? (
            <QuestionEditor
              draft={EMPTY_DRAFT}
              earlier={questions}
              saveLabel="הוסף"
              onSave={async (d: QuestionDraft) => {
                const id = await addQuestion({
                  org_id: membership?.org_id ?? "",
                  form_id: selected,
                  position: questions.length + 1,
                  type: d.type,
                  label: d.label,
                  help: d.help,
                  body: d.body,
                  required: d.required,
                  options: d.options,
                });
                // The condition goes in a second call rather than as another
                // argument to addQuestion: one way to express it, not two.
                if (d.depends_on_question_id) await updateQuestion(id, d);
                setAdding(false);
                await reload();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => {
                  setAdding(true);
                  setEditingId(null);
                }}
                className="text-sm font-semibold text-brand underline underline-offset-2"
              >
                הוסף שאלה
              </button>
              <button
                onClick={() => setEditingForm(true)}
                className="text-sm text-ink-soft underline underline-offset-2 hover:text-ink"
              >
                ערוך שם והקדמה
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function QuestionRow({
  question: q,
  index: i,
  all,
  onEdit,
  onChanged,
}: {
  question: IntakeQuestion;
  index: number;
  all: IntakeQuestion[];
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const parent = all.find((p) => p.id === q.depends_on_question_id);

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-1 gap-2">
        <span className="mt-0.5 font-mono text-xs text-muted">{i + 1}</span>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">
            {q.label}
            {q.required && <span className="text-danger"> *</span>}
          </span>
          <span className="text-xs text-muted">
            {QUESTION_TYPE_LABEL[q.type]}
            {/* The condition is the thing most worth seeing from the list: it
                decides who is asked this at all. */}
            {parent && (
              <>
                {" · רק אם "}
                <span className="font-semibold">{parent.label}</span>
                {" = "}
                {q.depends_on_value === "yes"
                  ? "כן"
                  : q.depends_on_value === "no"
                    ? "לא"
                    : q.depends_on_value}
              </>
            )}
          </span>
          {q.help && <span className="text-xs text-muted">{q.help}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Move
          up
          disabled={i === 0}
          onMove={async () => {
            await swapQuestions(q, all[i - 1]);
            await onChanged();
          }}
        />
        <Move
          disabled={i === all.length - 1}
          onMove={async () => {
            await swapQuestions(q, all[i + 1]);
            await onChanged();
          }}
        />
        <button
          onClick={onEdit}
          className="rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
        >
          ערוך
        </button>
        <button
          onClick={async () => {
            await removeQuestion(q.id);
            await onChanged();
          }}
          className="rounded px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
        >
          הסר
        </button>
      </div>
    </div>
  );
}

/** Up and down as buttons, not a drag: a drag is unusable on a phone. */
function Move({
  up = false,
  disabled,
  onMove,
}: {
  up?: boolean;
  disabled: boolean;
  onMove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      aria-label={up ? "העבר למעלה" : "העבר למטה"}
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onMove();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded px-1.5 py-1 text-sm font-semibold text-ink-soft
                 hover:bg-rule/50 disabled:opacity-25"
    >
      {up ? "↑" : "↓"}
    </button>
  );
}

function FormDetails({
  form,
  onSaved,
  onCancel,
}: {
  form: IntakeForm;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(form.name);
  const [intro, setIntro] = useState(form.intro ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateForm(form.id, { name, intro });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md bg-ground p-3">
      <Field label="שם השאלון" value={name} onChange={(e) => setName(e.target.value)} required />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">הקדמה</span>
        <textarea
          rows={3}
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
          placeholder="מה שהלקוח קורא לפני השאלה הראשונה"
          className="resize-y rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                     outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </label>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "שומר..." : "שמור"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}
