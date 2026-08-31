import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

export type SearchKind = "matter" | "client" | "party";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  matter_id: string | null;
  ref_no: number | null;
};

export const KIND_LABEL: Record<SearchKind, string> = {
  matter: "תיק",
  client: "לקוח",
  party: "צד",
};

export async function searchFirm(query: string): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase.rpc("search_firm", { q });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []) as SearchHit[];
}
