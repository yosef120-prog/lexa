import { supabase } from "@/lib/supabase";

export type Client = {
  id: string;
  kind: "individual" | "company";
  name: string;
  national_id: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
};

export type ConflictHit = {
  client_id: string;
  client_name: string;
  national_id: string | null;
  matched_on: "national_id" | "name";
};

export async function listClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id, kind, name, national_id, phone, email, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Runs the search and records that it happened, in one database call. The
 * record is written even when nothing is found — that is the case worth being
 * able to prove later.
 */
export async function runConflictCheck(
  name: string,
  nationalId: string,
): Promise<ConflictHit[]> {
  const { data, error } = await supabase.rpc("run_conflict_check", {
    p_name: name || null,
    p_national_id: nationalId || null,
  });
  if (error) {
    if (error.message.includes("NOTHING_TO_CHECK")) {
      throw new Error("צריך שם או מספר זהות כדי לבדוק.");
    }
    throw new Error(error.message);
  }
  return (data ?? []) as ConflictHit[];
}

export async function createClient(input: {
  org_id: string;
  kind: "individual" | "company";
  name: string;
  national_id: string;
  phone: string;
  email: string;
}): Promise<void> {
  const { error } = await supabase.from("clients").insert({
    org_id: input.org_id,
    kind: input.kind,
    name: input.name.trim(),
    national_id: input.national_id.trim() || null,
    phone: input.phone.trim() || null,
    email: input.email.trim() || null,
  });
  if (error) throw new Error(error.message);
}
