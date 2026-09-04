import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

/**
 * Searching a client's documents, two ways.
 *
 * The plain search matches the letters somebody typed against text already
 * pulled out of the files. It is free, instant, and finds exactly what is
 * there — and it cannot see a photograph at all, because a photograph has no
 * text to match.
 *
 * The AI search reads the files, pictures included, and answers a question
 * about them. It costs the firm money per question, so it exists only once a
 * firm has supplied its own key.
 */

export type DocumentHit = {
  id: string;
  filename: string;
  mime: string | null;
  bucket: string;
  storage_path: string;
  created_at: string;
  where_found: "filename" | "content";
  snippet: string | null;
};

export async function searchDocuments(clientId: string, term: string): Promise<DocumentHit[]> {
  const { data, error } = await supabase.rpc("search_client_documents", {
    p_client_id: clientId,
    q: term,
  });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []) as DocumentHit[];
}

/** How much of this client's shelf the plain search can actually see. */
export type Readable = { total: number; withText: number; pictures: number; pending: number };

export async function readableCount(clientId: string): Promise<Readable> {
  const { data, error } = await supabase
    .from("documents")
    .select("text_state")
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) throw new Error(describeDbError(error));

  const rows = (data ?? []) as Array<{ text_state: string }>;
  return {
    total: rows.length,
    withText: rows.filter((r) => r.text_state === "done").length,
    pictures: rows.filter((r) => r.text_state === "no_text").length,
    pending: rows.filter((r) => r.text_state === "pending").length,
  };
}

const RENDERER = import.meta.env.VITE_RENDERER_URL;

async function callRenderer(path: string, body: unknown): Promise<unknown> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("התחבר מחדש ונסה שוב.");

  let response: Response;
  try {
    response = await fetch(`${RENDERER}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("אין חיבור לשירות. בדוק את האינטרנט ונסה שוב.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload as { error?: string })?.error ?? `הבקשה נכשלה (${response.status}).`);
  }
  return payload;
}

/**
 * Asks the service to read any files it has not read yet.
 *
 * Called when a card opens rather than when a file is uploaded, because an
 * intake file arrives from a client with no session and nothing to make the
 * call. The happy side effect is that the files read first are the ones
 * somebody is actually looking at.
 */
export async function indexDocuments(clientId: string): Promise<{ looked: number; read: number }> {
  return (await callRenderer("/documents/index", { clientId })) as { looked: number; read: number };
}

export type AiAnswer = { answer: string; read: string[] };

export async function askDocuments(clientId: string, question: string): Promise<AiAnswer> {
  return (await callRenderer("/documents/ask", { clientId, question })) as AiAnswer;
}

// ------------------------------------------------------------ the firm's key

export type AiConnection = {
  id: string;
  org_id: string;
  model: string;
  last_ok_at: string | null;
  last_error: string | null;
};

/** The key is deliberately absent: the database refuses to return it. */
const AI_COLUMNS = "id, org_id, model, last_ok_at, last_error";

export async function getAiConnection(): Promise<AiConnection | null> {
  const { data, error } = await supabase.from("ai_connections").select(AI_COLUMNS).limit(1);
  if (error) throw new Error(describeDbError(error));
  return ((data ?? [])[0] as AiConnection) ?? null;
}

export async function connectAi(input: {
  orgId: string;
  apiKey: string;
  model: string;
}): Promise<void> {
  const existing = await getAiConnection();
  const { error } = existing
    ? await supabase
        .from("ai_connections")
        .update({ api_key: input.apiKey, model: input.model, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase.from("ai_connections").insert({
        org_id: input.orgId,
        api_key: input.apiKey,
        model: input.model,
      });
  if (error) throw new Error(describeDbError(error));
}

export async function disconnectAi(id: string): Promise<void> {
  const { error } = await supabase.from("ai_connections").delete().eq("id", id);
  if (error) throw new Error(describeDbError(error));
}
