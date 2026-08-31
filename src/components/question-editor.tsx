import { useState, type FormEvent } from "react";
import {
  QUESTION_TYPE_LABEL,
  type IntakeQuestion,
  type QuestionType,
} from "@/lib/intake";
import { Button, ErrorNote, Field } from "@/components/ui";

export type QuestionDraft = {
  type: QuestionType;
  label: string;
  help: string;
  body: string;
  required: boolean;
  options: string[];
  depends_on_question_id: string | null;
  depends_on_value: string | null;
};

export function draftFrom(q: IntakeQuestion): QuestionDraft {
  return {
    type: q.type,
    label: q.label,
    help: q.help ?? "",
    body: q.body ?? "",
    required: q.required,
    options: q.options ?? [],
    depends_on_question_id: q.depends_on_question_id,
    depends_on_value: q.depends_on_value,
  };
}

export const EMPTY_DRAFT: QuestionDraft = {
  type: "text",
  label: "",
  help: "",
  body: "",
  required: false,
  options: [],
  depends_on_question_id: null,
  depends_on_value: null,
};

/**
 * One form for writing a question and for correcting one.
 *
 * Correcting is the common case, not the rare one: nobody writes the right
 * wording first time, and a lawyer only finds out a question was ambiguous
 * after a client has misread it.
 */
export function QuestionEditor({
  draft: initial,
  earlier,
  saveLabel,
  onSave,
  onCancel,
}: {
  draft: QuestionDraft;
  /** Questions before this one — the only ones a condition may depend on. */
  earlier: IntakeQuestion[];
  saveLabel: string;
  onSave: (draft: QuestionDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<QuestionDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof QuestionDraft>(k: K, v: QuestionDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const needsOptions = draft.type === "single_choice" || draft.type === "multi_choice";
  const parent = earlier.find((q) => q.id === draft.depends_on_question_id) ?? null;

  // Only a question with a known set of answers can be depended on. Depending
  // on free text would mean matching strings a client typed, which fails the
  // first time somebody adds a space.
  const canBeParent = earlier.filter(
    (q) => q.type === "yes_no" || q.type === "single_choice" || q.type === "multi_choice",
  );

  const parentValues =
    parent?.type === "yes_no" ? ["yes", "no"] : (parent?.options ?? []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const box =
    "w-full rounded-md border border-rule bg-surface px-3 py-2.5 text-base outline-none " +
    "focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-md bg-ground p-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(QUESTION_TYPE_LABEL) as QuestionType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => set("type", t)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              draft.type === t ? "bg-brand text-white" : "bg-surface text-ink-soft"
            }`}
          >
            {QUESTION_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <Field
        label="השאלה"
        value={draft.label}
        onChange={(e) => set("label", e.target.value)}
        placeholder="לדוגמה: צילום תעודת זהות"
        autoFocus
        required
      />

      <Field
        label="הסבר קצר (לא חובה)"
        value={draft.help}
        onChange={(e) => set("help", e.target.value)}
        placeholder="שורה שמופיעה מתחת לשאלה"
      />

      {draft.type === "consent" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">נוסח ההצהרה</span>
          <textarea
            rows={5}
            value={draft.body}
            onChange={(e) => set("body", e.target.value)}
            placeholder="הטקסט שהלקוח מאשר"
            className={`${box} resize-y`}
          />
        </label>
      )}

      {needsOptions && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">אפשרויות</span>
          <textarea
            rows={4}
            value={draft.options.join("\n")}
            // One per line: a comma is legitimate inside an answer option, and
            // asking anyone to escape it invites a bug report.
            onChange={(e) => set("options", e.target.value.split("\n"))}
            placeholder="אפשרות בכל שורה"
            className={`${box} resize-y`}
          />
        </label>
      )}

      {canBeParent.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-rule pt-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">הצג רק אם...</span>
            <select
              value={draft.depends_on_question_id ?? ""}
              onChange={(e) => {
                set("depends_on_question_id", e.target.value || null);
                set("depends_on_value", null);
              }}
              className={box}
            >
              <option value="">תמיד מוצגת</option>
              {canBeParent.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>

          {parent && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">נענתה</span>
              <select
                value={draft.depends_on_value ?? ""}
                onChange={(e) => set("depends_on_value", e.target.value || null)}
                className={box}
                required
              >
                <option value="">בחר תשובה</option>
                {parentValues.map((v) => (
                  <option key={v} value={v}>
                    {v === "yes" ? "כן" : v === "no" ? "לא" : v}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.required}
          onChange={(e) => set("required", e.target.checked)}
          className="h-4 w-4 accent-[var(--color-brand,#0e6e6e)]"
        />
        חובה
      </label>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !draft.label.trim()}>
          {busy ? "שומר..." : saveLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}
