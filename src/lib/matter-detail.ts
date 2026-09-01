import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";
import type { Matter } from "@/lib/matters";

export type PartySide = "client" | "opposing" | "other";

export const PARTY_SIDE_LABEL: Record<PartySide, string> = {
  client: "לקוח",
  opposing: "צד שכנגד",
  other: "צד נוסף",
};

export type Party = {
  id: string;
  side: PartySide;
  name: string;
  national_id: string | null;
  notes: string | null;
  /**
   * Set when this party also has a client card at the firm.
   *
   * Optional because both are ordinary: the other side in a sale sometimes is
   * a client of the firm and sometimes is only a name. When it is set, the
   * matter's agreed payment dates reach that person's card too.
   */
  client_id: string | null;
};

export type ActivityKind =
  | "matter_opened"
  | "note"
  | "status_changed"
  | "party_added"
  | "document"
  | "charge"
  | "event";

export type Activity = {
  id: string;
  kind: ActivityKind;
  body: string | null;
  occurred_at: string;
  actor: { full_name: string | null; email: string | null } | null;
};

function one<T>(v: T[] | T | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function getMatter(id: string): Promise<Matter> {
  const { data, error } = await supabase
    .from("matters")
    .select(
      "id, ref_no, name, practice_area, status, court, court_case_no, opened_at, client:clients(id, name)",
    )
    .eq("id", id)
    .single();
  if (error) throw new Error(describeDbError(error));

  const { client, ...rest } = data as never as Omit<Matter, "client"> & { client: unknown };
  return { ...rest, client: one(client as { id: string; name: string }[]) };
}

export async function getTimeline(matterId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from("matter_activity")
    .select("id, kind, body, occurred_at, actor:profiles!matter_activity_actor_user_id_fkey(full_name, email)")
    .eq("matter_id", matterId)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(describeDbError(error));

  return (data ?? []).map((row) => {
    const { actor, ...rest } = row as never as Omit<Activity, "actor"> & { actor: unknown };
    return { ...rest, actor: one(actor as Activity["actor"][]) };
  });
}

export async function addNote(input: {
  org_id: string;
  matter_id: string;
  actor_user_id: string;
  body: string;
}): Promise<void> {
  const { error } = await supabase.from("matter_activity").insert({
    org_id: input.org_id,
    matter_id: input.matter_id,
    kind: "note",
    // The policy requires this to be the caller. Passing it explicitly keeps
    // that requirement visible here rather than hidden in a default.
    actor_user_id: input.actor_user_id,
    body: input.body.trim(),
  });
  if (error) throw new Error(describeDbError(error));
}

export async function getParties(matterId: string): Promise<Party[]> {
  const { data, error } = await supabase
    .from("matter_parties")
    .select("id, side, name, national_id, notes, client_id")
    .eq("matter_id", matterId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []) as Party[];
}

export async function addParty(input: {
  org_id: string;
  matter_id: string;
  side: PartySide;
  name: string;
  national_id: string;
  client_id?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("matter_parties").insert({
    org_id: input.org_id,
    matter_id: input.matter_id,
    side: input.side,
    name: input.name.trim(),
    national_id: input.national_id.trim() || null,
    client_id: input.client_id || null,
  });
  if (error) throw new Error(describeDbError(error));
}

/** Ties an existing party to a client card, or unties them. */
export async function linkPartyToClient(
  partyId: string,
  clientId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("matter_parties")
    .update({ client_id: clientId })
    .eq("id", partyId);
  if (error) throw new Error(describeDbError(error));
}

export async function setMatterStatus(
  matterId: string,
  status: "open" | "on_hold" | "closed",
): Promise<void> {
  // The check constraint pairs these two, so they are always sent together.
  const { error } = await supabase
    .from("matters")
    .update({
      status,
      closed_at: status === "closed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matterId);
  if (error) throw new Error(describeDbError(error));
}
