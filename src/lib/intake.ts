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
  | "file"
  | "consent"
  | "signature";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  text: "טקסט קצר",
  long_text: "טקסט ארוך",
  number: "מספר",
  yes_no: "כן / לא",
  single_choice: "בחירה אחת",
  multi_choice: "בחירה מרובה",
  date: "תאריך",
  file: "קובץ",
  consent: "הצהרה לאישור",
  signature: "חתימה",
};

export type IntakeQuestion = {
  id: string;
  position: number;
  type: QuestionType;
  label: string;
  help: string | null;
  /** For a consent question: the text being agreed to. */
  body: string | null;
  required: boolean;
  options: string[] | null;
  /** Show this only when that question was answered with depends_on_value. */
  depends_on_question_id: string | null;
  depends_on_value: string | null;
};

export type IntakeForm = {
  id: string;
  name: string;
  intro: string | null;
  is_default: boolean;
  created_at: string;
};

export type IntakeStatus = "sent" | "opened" | "partial" | "submitted" | "revoked";

export const INTAKE_STATUS_LABEL: Record<IntakeStatus, string> = {
  sent: "נשלח",
  opened: "נפתח",
  // Named for what the firm has to do about it, not for the state machine.
  partial: "חסרים מסמכים",
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
  /** Documents only: attached, still coming, or not applicable. */
  status: "provided" | "later" | "not_applicable" | null;
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
    .select("id, position, type, label, help, body, required, options, depends_on_question_id, depends_on_value")
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
  help?: string;
  body?: string;
  required: boolean;
  options: string[];
  // Returns the new id, because a condition has to point at a question that
  // does not exist until this call has run.
}): Promise<string> {
  const needsOptions = input.type === "single_choice" || input.type === "multi_choice";
  const { data, error } = await supabase.from("intake_questions").insert({
    org_id: input.org_id,
    form_id: input.form_id,
    position: input.position,
    type: input.type,
    label: input.label.trim(),
    help: input.help?.trim() || null,
    body: input.type === "consent" ? input.body?.trim() || null : null,
    required: input.required,
    options: needsOptions ? input.options.filter((o) => o.trim()) : null,
  })
    .select("id")
    .single();
  if (error) {
    if (error.message.includes("intake_choice_has_options")) {
      throw new Error("שאלת בחירה צריכה לפחות אפשרות אחת.");
    }
    throw new Error(describeDbError(error));
  }
  return data.id;
}

/** Correcting a question after seeing how a client read it. */
export async function updateQuestion(
  id: string,
  patch: {
    type: QuestionType;
    label: string;
    help: string;
    body: string;
    required: boolean;
    options: string[];
    depends_on_question_id: string | null;
    depends_on_value: string | null;
  },
): Promise<void> {
  const needsOptions = patch.type === "single_choice" || patch.type === "multi_choice";
  const { error } = await supabase
    .from("intake_questions")
    .update({
      type: patch.type,
      label: patch.label.trim(),
      help: patch.help.trim() || null,
      body: patch.type === "consent" ? patch.body.trim() || null : null,
      required: patch.required,
      options: needsOptions ? patch.options.filter((o) => o.trim()) : null,
      depends_on_question_id: patch.depends_on_question_id,
      depends_on_value: patch.depends_on_question_id ? patch.depends_on_value : null,
    })
    .eq("id", id);
  if (error) {
    if (error.message.includes("intake_choice_has_options")) {
      throw new Error("שאלת בחירה צריכה לפחות אפשרות אחת.");
    }
    throw new Error(describeDbError(error));
  }
}

/**
 * Moving a question up or down.
 *
 * Both rows are written in one request so the unique constraint on (form,
 * position) sees the finished pair rather than the half-swapped middle — which
 * is why that constraint is deferred.
 */
export async function swapQuestions(a: IntakeQuestion, b: IntakeQuestion): Promise<void> {
  const { error } = await supabase.from("intake_questions").upsert([
    { id: a.id, position: b.position },
    { id: b.id, position: a.position },
  ]);
  if (error) throw new Error(describeDbError(error));
}

export async function updateForm(
  id: string,
  patch: { name: string; intro: string },
): Promise<void> {
  const { error } = await supabase
    .from("intake_forms")
    .update({ name: patch.name.trim(), intro: patch.intro.trim() || null })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
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

const INTAKE_COLUMNS =
  "id, token, status, expires_at, opened_at, submitted_at, created_at, form:intake_forms(id, name)";

export type SentIntake = { intake: ClientIntake; reused: boolean };

/**
 * Sending a questionnaire, or handing back the one already out there.
 *
 * A second live link for the same client and form is worse than useless: they
 * would hold two, the answers would split between them, and whichever they
 * found first would probably be the wrong one. So an existing link that still
 * works is returned as it is, and a new one is minted only when there is none.
 */
export async function sendIntake(
  orgId: string,
  clientId: string,
  formId: string,
): Promise<SentIntake> {
  const { data: live, error: findError } = await supabase
    .from("client_intakes")
    .select(INTAKE_COLUMNS)
    .eq("client_id", clientId)
    .eq("form_id", formId)
    .in("status", ["sent", "opened", "partial"])
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (findError) throw new Error(describeDbError(findError));

  if (live && live.length > 0) {
    return { intake: shapeIntake(live[0]), reused: true };
  }

  const { data, error } = await supabase
    .from("client_intakes")
    .insert({ org_id: orgId, client_id: clientId, form_id: formId })
    .select(INTAKE_COLUMNS)
    .single();
  if (error) throw new Error(describeDbError(error));
  return { intake: shapeIntake(data), reused: false };
}

function shapeIntake(row: unknown): ClientIntake {
  const f = (row as Record<string, unknown>).form;
  return {
    ...(row as ClientIntake),
    form: Array.isArray(f) ? ((f[0] as ClientIntake["form"]) ?? null) : (f as ClientIntake["form"]),
  };
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

export type IntakeOverview = ClientIntake & {
  client: { id: string; name: string } | null;
};

/**
 * Every questionnaire the firm has out, across all clients.
 *
 * The builder answers "what do we ask"; this answers "who owes us what", which
 * is the question somebody actually opens this screen with.
 */
export async function listAllIntakes(): Promise<IntakeOverview[]> {
  const { data, error } = await supabase
    .from("client_intakes")
    .select(
      "id, token, status, expires_at, opened_at, submitted_at, created_at, client:clients(id, name), form:intake_forms(id, name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(describeDbError(error));

  const one = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null);

  return (data ?? []).map((row) => ({
    ...(row as unknown as IntakeOverview),
    client: one((row as Record<string, unknown>).client),
    form: one((row as Record<string, unknown>).form),
  }));
}

export type ArrivedIntake = {
  id: string;
  submitted_at: string;
  client: { id: string; name: string } | null;
  form: { name: string } | null;
};

/**
 * Questionnaires that came back and nobody has looked at yet.
 *
 * The banner's whole job. Row level security scopes it to the firm, so no
 * org filter is needed here — the same reason every other list in this file
 * omits one.
 */
export async function listArrivedIntakes(): Promise<ArrivedIntake[]> {
  const { data, error } = await supabase
    .from("client_intakes")
    .select("id, submitted_at, client:clients(id, name), form:intake_forms(name)")
    .eq("status", "submitted")
    .is("reviewed_at", null)
    .order("submitted_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(describeDbError(error));

  const one = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null);

  return (data ?? []).map((row) => ({
    ...(row as unknown as ArrivedIntake),
    client: one((row as Record<string, unknown>).client),
    form: one((row as Record<string, unknown>).form),
  }));
}

/**
 * Marking one as looked at.
 *
 * Writes reviewed_at only. notified_at belongs to the mail job, and a banner
 * that silences tomorrow's email would lose a client's documents in a busy
 * week — the same trap as the diary's reminded_at.
 */
export async function markIntakeReviewed(id: string): Promise<void> {
  const { data: who } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("client_intakes")
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: who.user?.id })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

export async function listAnswers(intakeId: string): Promise<IntakeAnswer[]> {
  const { data, error } = await supabase
    .from("intake_answers")
    .select("question_id, value_text, value_number, value_date, value_json, status")
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
    case "consent":
      // What was recorded is the wording accepted, which can be long. The list
      // says that it was accepted; the wording is in the answer itself.
      return answer.value_text ? "אושר" : "—";
    case "signature":
      return Array.isArray(answer.value_json) && answer.value_json.length > 0 ? "נחתם" : "—";
    case "file":
      // What the client said about it, which is the part the firm acts on: a
      // count of zero and "does not apply to me" mean very different things.
      if (answer.status === "later") return "אין לו כרגע — ישלח בהמשך";
      if (answer.status === "not_applicable") return "לא רלוונטי";
      return Array.isArray(answer.value_json) && answer.value_json.length > 0
        ? `${(answer.value_json as unknown[]).length} קבצים`
        : "—";
    default:
      return answer.value_text || "—";
  }
}
