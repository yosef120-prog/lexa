import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  addQuestion,
  createForm,
  listForms,
  listQuestions,
  QUESTION_TYPE_LABEL,
  removeQuestion,
  orderForCondition,
  moveQuestion,
  placeUnderParent,
  reorderQuestions,
  updateForm,
  updateQuestion,
  type IntakeForm,
  type IntakeQuestion,
} from "@/lib/intake";
import {
  draftFrom,
  EMPTY_DRAFT,
  QuestionEditor,
  type QuestionDraft,
} from "@/components/question-editor";
import { TEMPLATES, type Template } from "@/lib/intake-templates";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

export function IntakeBuilder() {
  const { membership } = useAuth();
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  // Which question a new dependent one is being written under. A firm thinks
  // "if they say rented, I need the tenancy agreement" — starting from the
  // answer — so this is the direction the screen offers.
  const [childOf, setChildOf] = useState<string | null>(null);

  // What a client is actually asked in order. A dependent question is not a
  // step of its own — it belongs to the one it hangs off — so it takes no
  // number and the numbering does not skip.
  const numbering = (() => {
    let n = 0;
    return questions.map((q) => (q.depends_on_question_id ? null : ++n));
  })();
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

  async function createFrom(template: Template) {
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      const formId = await createForm(membership.org_id, template.name, template.intro);

      // Two passes: a condition points at a question that has no id until the
      // first pass has created it.
      const created: string[] = [];
      for (const [i, q] of template.questions.entries()) {
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
      for (const [i, q] of template.questions.entries()) {
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
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-soft">התחל מאחד מאלה, ושנה כל מה שצריך:</p>
          {TEMPLATES.map((t) => (
            <div key={t.key} className="flex items-center justify-between gap-3 rounded-md bg-ground p-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{t.name}</span>
                <span className="text-xs text-muted">
                  {t.questions.length} שאלות · {t.note}
                </span>
              </div>
              <Button onClick={() => createFrom(t)} disabled={busy} className="shrink-0">
                {busy ? "מכין..." : "צור"}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <>
          {forms.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {forms.map((f) => (
                <button
                  type="button"
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


          {/* Numbered by what a client is actually asked in order. A question
              that hangs off another is not a step of its own — it is part of
              the one above it, and takes an arrow rather than a number. */}
          <ol className="flex flex-col divide-y divide-rule">
            {questions.map((q, i) => (
              <li
                key={q.id}
                className={
                  q.depends_on_question_id
                    ? "border-s-2 border-brand/30 bg-brand/5 py-2 ps-3"
                    : "py-2"
                }
              >
                {editingId === q.id ? (
                  <QuestionEditor
                    draft={draftFrom(q)}
                    earlier={questions.filter((other) => other.id !== q.id)}
                    saveLabel="שמור שינויים"
                    onSave={async (d: QuestionDraft) => {
                      await updateQuestion(q.id, d);
                      // A condition only works when its parent comes first, so
                      // the list is rearranged around the choice rather than
                      // the choice being refused.
                      const fixed = orderForCondition(
                        questions,
                        q.id,
                        d.depends_on_question_id,
                      );
                      if (fixed) await reorderQuestions(selected ?? "", fixed);
                      setEditingId(null);
                      await reload();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <QuestionRow
                      question={q}
                      index={i}
                      number={numbering[i]}
                      all={questions}
                      formId={selected ?? ""}
                      onEdit={() => {
                        setEditingId(q.id);
                        setAdding(false);
                        setChildOf(null);
                      }}
                      onAddChild={() => {
                        setChildOf(q.id);
                        setEditingId(null);
                        setAdding(false);
                      }}
                      onChanged={reload}
                    />

                    {/* Written where it will live, with the condition already
                        pointing at the question above it — the answer is the
                        only thing left to choose. */}
                    {childOf === q.id && (
                      <div className="mt-2 border-s-2 border-brand/30 bg-brand/5 ps-3">
                        <p className="pt-2 text-xs font-semibold text-brand">
                          שאלה שתוצג רק לפי התשובה ל״{q.label}״
                        </p>
                        <QuestionEditor
                          draft={{ ...EMPTY_DRAFT, depends_on_question_id: q.id }}
                          earlier={questions}
                          saveLabel="הוסף"
                          onSave={async (d: QuestionDraft) => {
                            const id = await addQuestion({
                              org_id: membership?.org_id ?? "",
                              form_id: selected ?? "",
                              position: questions.length + 1,
                              type: d.type,
                              label: d.label,
                              help: d.help,
                              body: d.body,
                              required: d.required,
                              options: d.options,
                            });
                            await updateQuestion(id, d);

                            // It was added last, as every question is. This is
                            // what puts it under the one it belongs to.
                            const parentId = d.depends_on_question_id;
                            if (parentId) {
                              const fresh = await listQuestions(selected ?? "");
                              const placed = placeUnderParent(fresh, id, parentId);
                              if (placed) await reorderQuestions(selected ?? "", placed);
                            }
                            setChildOf(null);
                            await reload();
                          }}
                          onCancel={() => setChildOf(null)}
                        />
                      </div>
                    )}
                  </>
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
                if (d.depends_on_question_id) {
                  await updateQuestion(id, d);
                  // The new question is last, so a parent anywhere above it
                  // already works; nothing needs moving.
                }
                setAdding(false);
                await reload();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setEditingId(null);
                }}
                className="text-sm font-semibold text-brand underline underline-offset-2"
              >
                הוסף שאלה
              </button>
              <button
                type="button"
                onClick={() => setEditingForm(true)}
                className="text-sm text-ink-soft underline underline-offset-2 hover:text-ink"
              >
                ערוך שם והקדמה
              </button>
              {/* A firm doing both conveyancing and litigation needs two
                  questionnaires, not one that tries to be both. */}
              {TEMPLATES.filter((t) => !forms.some((f) => f.name === t.name)).map((t) => (
                <button
                  type="button"
                  key={t.key}
                  onClick={() => createFrom(t)}
                  disabled={busy}
                  className="text-sm text-ink-soft underline underline-offset-2 hover:text-ink disabled:opacity-50"
                >
                  הוסף גם: {t.name}
                </button>
              ))}
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
  number,
  all,
  formId,
  onEdit,
  onAddChild,
  onChanged,
}: {
  question: IntakeQuestion;
  index: number;
  /** Its place in what the client is asked, or null when it hangs off another. */
  number: number | null;
  all: IntakeQuestion[];
  onEdit: () => void;
  /** The form these questions belong to, which reordering is scoped by. */
  formId: string;
  /** Offered only on a question that has answers to hang one off. */
  onAddChild: () => void;
  onChanged: () => Promise<void>;
}) {
  const [removeError, setRemoveError] = useState<string | null>(null);

  const parent = all.find((p) => p.id === q.depends_on_question_id);
  const children = all.filter((c) => c.depends_on_question_id === q.id);

  // A condition survives a reorder that moves its parent below it, and then
  // silently never matches: the client is asked the parent after the point
  // where the answer was needed, so the dependent question never appears. The
  // arrows make this one click away, so it has to be visible.
  const parentIsLater = parent ? all.indexOf(parent) > i : false;

  // The answers the parent can currently be given. A condition points at the
  // text of one of them, so an answer that was removed — or renamed in a way
  // the database could not follow, such as a reorder — leaves the condition
  // pointing at nothing. It then matches nobody, and the question it guards is
  // never shown again. Silently, which is the part worth catching.
  // Only a question with answers can have one hang off it. There is nothing
  // to condition on in a free-text reply.
  const hasAnswers =
    q.type === "yes_no" ||
    ((q.type === "single_choice" || q.type === "multi_choice") &&
      (q.options?.length ?? 0) > 0);

  const parentAnswers = parent
    ? parent.type === "yes_no"
      ? ["yes", "no"]
      : (parent.options ?? [])
    : [];
  const conditionIsDangling = Boolean(
    parent && q.depends_on_value && parentAnswers.length > 0 &&
      !parentAnswers.includes(q.depends_on_value),
  );

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-1 gap-2">
        <span
          className="mt-0.5 shrink-0 font-mono text-xs text-muted"
          aria-hidden={number === null}
        >
          {number === null ? "↳" : number}
        </span>
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
            {q.required && !parent && " · חובה"}
            {/* Said on the parent as well, so the connection reads from both
                ends: from below you see what turns this question on, and from
                above you see that something hangs off this answer. */}
            {children.length > 0 && (
              <span className="text-brand">
                {children.length === 1
                  ? " · שאלה אחת תלויה בתשובה כאן"
                  : ` · ${children.length} שאלות תלויות בתשובה כאן`}
              </span>
            )}
          </span>
          {q.help && <span className="text-xs text-muted">{q.help}</span>}
          {conditionIsDangling && (
            <span className="mt-0.5 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-semibold text-danger">
              התנאי מצביע על תשובה שכבר לא קיימת בשאלה שמעליה, ולכן השאלה הזו לא תוצג לאף אחד.
              פתח אותה ובחר תשובה קיימת.
            </span>
          )}
          {removeError && (
            <span className="mt-0.5 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-semibold text-danger">
              {removeError}
            </span>
          )}
          {parentIsLater && (
            <span className="mt-0.5 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-semibold text-danger">
              השאלה שהיא תלויה בה מופיעה אחריה — היא לעולם לא תוצג ללקוח. הזז אותה למטה, או
              את השאלה השנייה למעלה.
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {/* A question moves with whatever hangs off it, and a dependent one
            moves only among its siblings. Swapping single rows let a parent
            walk away from its children, which leaves them conditioned on an
            answer now given after them — the arrangement in which a condition
            never matches and the question is never shown again. */}
        <Move
          up
          disabled={moveQuestion(all, q.id, -1) === null}
          onMove={async () => {
            const next = moveQuestion(all, q.id, -1);
            if (next) await reorderQuestions(formId, next);
            await onChanged();
          }}
        />
        <Move
          disabled={moveQuestion(all, q.id, 1) === null}
          onMove={async () => {
            const next = moveQuestion(all, q.id, 1);
            if (next) await reorderQuestions(formId, next);
            await onChanged();
          }}
        />
        {/* Offered from the answer rather than from the new question, because
            that is the order the thought arrives in: "if they say rented, I
            need the tenancy agreement." Written the other way round it means
            creating a question and then hunting its parent in a list of
            twenty-three. */}
        {hasAnswers && (
          <button
            type="button"
            onClick={onAddChild}
            title="הוסף שאלה שתוצג רק לפי התשובה כאן"
            className="rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
          >
            + מותנית
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="rounded px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
        >
          ערוך
        </button>
        <button
          type="button"
          onClick={async () => {
            // The database refuses to remove a question others hang off. A
            // refusal nobody sees is a button that looks broken, which is a
            // mistake this codebase has made before.
            try {
              setRemoveError(null);
              await removeQuestion(q.id);
              await onChanged();
            } catch (e) {
              setRemoveError(e instanceof Error ? e.message : String(e));
            }
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
      type="button"
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
