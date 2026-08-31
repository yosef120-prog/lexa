import { supabase } from "@/lib/supabase";
import type { QuestionType } from "@/lib/intake";

/**
 * The client's side of an intake form.
 *
 * Everything here runs for someone with no account, so it deliberately imports
 * nothing from the firm's intake module: the two must not drift into sharing a
 * query, and the whole surface an outsider can reach should be readable in one
 * file.
 *
 * The token in the URL is the only credential. There is no session to steal
 * and nothing to sign in to.
 */

const BUCKET = "intake-uploads";

export type PublicQuestion = {
  id: string;
  type: QuestionType;
  label: string;
  help: string | null;
  /** For a consent question: the text being agreed to. */
  body: string | null;
  required: boolean;
  options: string[] | null;
  depends_on_question_id: string | null;
  depends_on_value: string | null;
};

/**
 * Whether a conditional question should be on screen.
 *
 * One level deep, matching what the editor allows. A question the client never
 * saw is never demanded — the required check uses this too, so the two cannot
 * disagree and leave somebody stuck on a button that will not enable.
 */
export function isVisible(q: PublicQuestion, answers: Record<string, unknown>): boolean {
  if (!q.depends_on_question_id || !q.depends_on_value) return true;
  const given = answers[q.depends_on_question_id];
  if (given === undefined || given === null) return false;
  if (Array.isArray(given)) return given.includes(q.depends_on_value);
  return given === q.depends_on_value;
}

export type PublicIntake = {
  valid: boolean;
  reason: string | null;
  org_name: string | null;
  client_name: string | null;
  form_name: string | null;
  intro: string | null;
  questions: PublicQuestion[];
};

const TROUBLE: Record<string, string> = {
  NOT_FOUND: "הקישור הזה לא מוכר. בקש מהמשרד קישור חדש.",
  REVOKED: "הקישור בוטל על ידי המשרד.",
  ALREADY_SUBMITTED: "השאלון כבר מולא ונשלח. תודה.",
  EXPIRED: "הקישור פג. בקש מהמשרד קישור חדש.",
  FILE_OUTSIDE_INTAKE: "אחד הקבצים לא נשמר כראוי. רענן את הדף ונסה שוב.",
  UNKNOWN_QUESTION: "משהו בטופס לא תואם. רענן את הדף ונסה שוב.",
};

export function describeTrouble(reason: string | null | undefined): string {
  if (!reason) return "משהו השתבש. נסה שוב.";
  return TROUBLE[reason] ?? "משהו השתבש. נסה שוב.";
}

export async function openIntake(token: string): Promise<PublicIntake> {
  const { data, error } = await supabase.rpc("open_intake", { p_token: token });
  if (error) throw new Error("לא ניתן לפתוח את השאלון כרגע. בדוק את החיבור ונסה שוב.");

  const row = (data as PublicIntake[] | null)?.[0];
  if (!row) {
    return { valid: false, reason: "NOT_FOUND", org_name: null, client_name: null, form_name: null, intro: null, questions: [] };
  }
  return { ...row, questions: (row.questions ?? []) as PublicQuestion[] };
}

export type UploadedFile = {
  path: string;
  filename: string;
  mime: string;
  size: number;
};

/**
 * Sends one file straight to storage.
 *
 * The path starts with the token, which is what the storage policy checks —
 * knowing the token is the authorisation, and it is the same capability the
 * link already granted. Uploading before submitting is deliberate: a client on
 * a phone photographing three documents should not lose the first two if the
 * third fails.
 */
export async function uploadIntakeFile(token: string, file: File): Promise<UploadedFile> {
  const path = `${token}/${crypto.randomUUID()}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type || undefined });

  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("mime") || m.includes("not allowed")) {
      throw new Error(`הקובץ ${file.name} מסוג שאינו נתמך. אפשר PDF, תמונה או מסמך Word.`);
    }
    if (m.includes("maximum") || m.includes("too large")) {
      throw new Error(`הקובץ ${file.name} גדול מדי. עד 25 מ״ב לקובץ.`);
    }
    throw new Error(`לא הצלחנו להעלות את ${file.name}. נסה שוב.`);
  }

  return { path, filename: file.name, mime: file.type || "", size: file.size };
}

/**
 * The signature, sent the same way a photograph is.
 *
 * Reusing the file path means it inherits the storage policy, the token check
 * and the row that lands on the client card. A separate route for it would be
 * a second thing to secure for no gain.
 */
export async function uploadSignature(token: string, png: Blob): Promise<UploadedFile> {
  const file = new File([png], "חתימה.png", { type: "image/png" });
  return uploadIntakeFile(token, file);
}

export type AnswerPayload = {
  question_id: string;
  text?: string | null;
  number?: number | null;
  date?: string | null;
  json?: unknown;
};

export async function submitIntake(token: string, answers: AnswerPayload[]): Promise<void> {
  const { error } = await supabase.rpc("submit_intake", {
    p_token: token,
    p_answers: answers,
  });
  if (error) {
    const named = Object.keys(TROUBLE).find((k) => error.message.includes(k));
    throw new Error(named ? TROUBLE[named] : "לא הצלחנו לשלוח את השאלון. נסה שוב.");
  }
}
