import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

/**
 * What was said, and when.
 *
 * The matter timeline records what happened to a file. This records what a
 * person said on the phone — which happens before there is a file, and about
 * things no file covers. Until now it went on a pad, and the pad is not
 * searchable, not shared, and not there when the client rings back and
 * whoever took the first call is out.
 */

export type ContactChannel = "phone_in" | "phone_out" | "meeting" | "whatsapp" | "email" | "other";

/** Who called whom is worth recording. It changes what the next call is. */
export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  phone_in: "שיחה נכנסת",
  phone_out: "שיחה יוצאת",
  meeting: "פגישה",
  whatsapp: "וואטסאפ",
  email: "אימייל",
  other: "אחר",
};

export type Contact = {
  id: string;
  client_id: string;
  matter_id: string | null;
  channel: ContactChannel;
  occurred_at: string;
  body: string;
  actor_user_id: string | null;
  edited_at: string | null;
  author: { full_name: string | null; email: string | null } | null;
};

export async function listContacts(clientId: string): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("client_contacts")
    .select(
      "id, client_id, matter_id, channel, occurred_at, body, actor_user_id, edited_at, author:profiles!client_contacts_actor_user_id_fkey(full_name, email)",
    )
    .eq("client_id", clientId)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(describeDbError(error));

  const one = <T,>(v: unknown): T | null =>
    Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null);

  return (data ?? []).map((row) => ({
    ...(row as unknown as Contact),
    author: one((row as Record<string, unknown>).author),
  }));
}

export async function addContact(input: {
  orgId: string;
  clientId: string;
  matterId?: string | null;
  channel: ContactChannel;
  occurredAt: string;
  body: string;
}): Promise<void> {
  const { error } = await supabase.from("client_contacts").insert({
    org_id: input.orgId,
    client_id: input.clientId,
    matter_id: input.matterId || null,
    channel: input.channel,
    occurred_at: input.occurredAt,
    body: input.body.trim(),
  });
  if (error) throw new Error(describeDbError(error));
}

export async function updateContact(
  id: string,
  patch: { channel?: ContactChannel; occurredAt?: string; body?: string; matterId?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("client_contacts")
    .update({
      ...(patch.channel ? { channel: patch.channel } : {}),
      ...(patch.occurredAt ? { occurred_at: patch.occurredAt } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
      ...(patch.matterId !== undefined ? { matter_id: patch.matterId || null } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

export async function deleteContact(id: string): Promise<void> {
  const { error } = await supabase.from("client_contacts").delete().eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

/**
 * The value the datetime input wants, in the browser's own zone.
 *
 * toISOString would hand it UTC and the field would show the wrong hour for
 * half the year, which on a call log is the one field that has to be right.
 */
export function forDateTimeInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
