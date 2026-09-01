import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

/**
 * The firm's own WhatsApp, connected through a gateway.
 *
 * Nothing here can read the api token, and that is not an oversight to be
 * fixed later: the database refuses the column to this role. Sending happens
 * in the renderer service, which holds the service role and is the only thing
 * that ever sees it.
 */

export type Connection = {
  id: string;
  provider: string;
  instance_id: string;
  phone: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

/** Every column but the token. Naming it here would be refused outright. */
const COLUMNS = "id, provider, instance_id, phone, last_ok_at, last_error, last_error_at";

export async function getConnection(): Promise<Connection | null> {
  const { data, error } = await supabase
    .from("whatsapp_connections")
    .select(COLUMNS)
    .limit(1)
    .maybeSingle();
  if (error) {
    // An intern or a lawyer simply has no row to see; that is not a failure
    // worth showing them.
    if (error.code === "42501") return null;
    throw new Error(describeDbError(error));
  }
  return data as Connection | null;
}

export async function connect(input: {
  orgId: string;
  instanceId: string;
  apiToken: string;
  phone: string;
}): Promise<void> {
  const { error } = await supabase.from("whatsapp_connections").upsert(
    {
      org_id: input.orgId,
      provider: "green_api",
      instance_id: input.instanceId.trim(),
      api_token: input.apiToken.trim(),
      phone: input.phone.trim() || null,
    },
    { onConflict: "org_id" },
  );
  if (error) throw new Error(describeDbError(error));
}

export async function disconnect(id: string): Promise<void> {
  const { error } = await supabase.from("whatsapp_connections").delete().eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

const RENDERER = import.meta.env.VITE_RENDERER_URL;

/**
 * Asks the service to send one message.
 *
 * The caller's own Supabase token goes along, and the service re-checks
 * membership before it reads any credentials — so a forged request can at
 * most make your own firm send a message you could have sent by clicking.
 */
export async function sendWhatsApp(input: {
  orgId: string;
  to: string;
  message: string;
}): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("התחבר מחדש ונסה שוב.");

  let response: Response;
  try {
    response = await fetch(`${RENDERER}/whatsapp/send`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error("אין חיבור לשירות השליחה. בדוק את האינטרנט ונסה שוב.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `השליחה נכשלה (${response.status}).`);
  }
}
