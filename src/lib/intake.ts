import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

/**
 * Intake questionnaires — the firm's side.
 *
 * The client's side lives in `intake-public.ts`, which imports nothing from
 * here on purpose: that file runs for someone with no account, and the two
 * should not be able to drift into sharing a query.
 */

export type QuestionType =
  | "text"
  | "long_text"
  | "number"
  | "yes_no"
  | "single_choice"
  | "multi_choice"
  | "date"
  | "file";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  text: "טקסט קצר",
  long_text: "טקסט ארוך",
  number: "מספר",
  yes_no: "כן / לא",
  single_choice: "בחירה אחת",
  multi_choice: "בחירה מרובה",
  date: "תאריך",
  file: "קובץ",
};

export type IntakeQuestion = {
  id: string;
  position: number;
  type: QuestionType;
  label: string;
  help: string | null;
  required: boolean;
  options: string[] | null;
};

export type IntakeForm = {
  id: string;
  name: string;
  intro: string | null;
  is_default: boolean;
  created_at: string;
};

export type IntakeStatus = "sent" | "opened" | "submitted" | "revoked";

export const INTAKE_STATUS_LABEL: Record<IntakeStatus, string> = {
  sent: "נשלח",
  opened: "נפתח",
  submitted: "הוגש",
  revoked: "בוטל",
};

export type ClientIntake = {
  id: string;
  token: string;
  status: IntakeStatus;
  expires_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  created_at: string;
  form: { id: string; name: string } | null;
};

export type IntakeAnswer = {
  question_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: unknown;
};

export function intakeLink(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}?intake=${token}`;
}

// ------------------------------------------------------------------ forms

export async function listForms(): Promise<IntakeForm[]> {
  const { data, error } = await supabase
    .from("intake_forms")
    .select("id, name, intro, is_default, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(describeDbError(error));
  return data ?? [];
}

export async function listQuestions(formId: string): Promise<IntakeQuestion[]> {
  const { data, error } = await supabase
    .from("intake_questions")
    .select("id, position, type, label, help, required, options")
    .eq("form_id", formId)
    .order("position", { ascending: true });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []) as IntakeQuestion[];
}

export async function createForm(orgId: string, name: string, intro: string): Promise<string> {
  const { data, error } = await supabase
    .from("intake_forms")
    .insert({ org_id: orgId, name: name.trim(), intro: intro.trim() || null })
    .select("id")
    .single();
  if (error) throw new Error(describeDbError(error));
  return data.id;
}

export async function addQuestion(input: {
  org_id: string;
  form_id: string;
  position: number;
  type: QuestionType;
  label: string;
  required: boolean;
  options: string[];
}): Promise<void> {
  const needsOptions = input.type === "single_choice" || input.type === "multi_choice";
  const { error } = await supabase.from("intake_questions").insert({
    org_id: input.org_id,
    form_id: input.form_id,
    position: input.position,
    type: input.type,
    label: input.label.trim(),
    required: input.required,
    options: needsOptions ? input.options.filter((o) => o.trim()) : null,
  });
  if (error) {
    if (error.message.includes("intake_choice_has_options")) {
      throw new Error("שאלת בחירה צריכה לפחות אפשרות אחת.");
    }
    throw new Error(describeDbError(error));
  }
}

export async function removeQuestion(id: string): Promise<void> {
  const { error } = await supabase.from("intake_questions").delete().eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

// ------------------------------------------------------------------ sending

export async function listClientIntakes(clientId: string): Promise<ClientIntake[]> {
  const { data, error } = await supabase
    .from("client_intakes")
    .select("id, token, status, expires_at, opened_at, submitted_at, created_at, form:intake_forms(id, name)")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []).map((row) => {
    const f = (row as Record<string, unknown>).form;
    return {
      ...(row as unknown as ClientIntake),
      form: Array.isArray(f) ? ((f[0] as ClientIntake["form"]) ?? null) : (f as ClientIntake["form"]),
    };
  });
}

export async function sendIntake(
  orgId: string,
  clientId: string,
  formId: string,
): Promise<ClientIntake> {
  const { data, error } = await supabase
    .from("client_intakes")
    .insert({ org_id: orgId, client_id: clientId, form_id: formId })
    .select("id, token, status, expires_at, opened_at, submitted_at, created_at, form:intake_forms(id, name)")
    .single();
  if (error) throw new Error(describeDbError(error));
  return { ...(data as unknown as ClientIntake), form: null };
}

/**
 * Pulling a link back.
 *
 * Not a delete: the fact that a client was asked, and when, is part of the
 * record even after the link stops working.
 */
export async function revokeIntake(id: string): Promise<void> {
  const { error } = await supabase
    .from("client_intakes")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

export async function listAnswers(intakeId: string): Promise<IntakeAnswer[]> {
  const { data, error } = await supabase
    .from("intake_answers")
    .select("question_id, value_text, value_number, value_date, value_json")
    .eq("intake_id", intakeId);
  if (error) throw new Error(describeDbError(error));
  return data ?? [];
}

/** How an answer reads once it is back with the firm. */
export function answerText(question: IntakeQuestion, answer: IntakeAnswer | undefined): string {
  if (!answer) return "—";
  switch (question.type) {
    case "number":
      return answer.value_number === null ? "—" : String(answer.value_number);
    case "date":
      return answer.value_date ? new Date(answer.value_date).toLocaleDateString("he-IL") : "—";
    case "yes_no":
      return answer.value_text === "yes" ? "כן" : answer.value_text === "no" ? "לא" : "—";
    case "multi_choice":
      return Array.isArray(answer.value_json) && answer.value_json.length > 0
        ? (answer.value_json as string[]).join(" · ")
        : "—";
    case "file":
      // The files themselves are documents on the client card by now; this is
      // only the count, so the answer list reads consistently.
      return Array.isArray(answer.value_json)
        ? `${(answer.value_json as unknown[]).length} קבצים`
        : "—";
    default:
      return answer.value_text || "—";
  }
}
