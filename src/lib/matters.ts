import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

export type MatterStatus = "open" | "on_hold" | "closed";

export type Matter = {
  id: string;
  ref_no: number;
  name: string;
  practice_area: string | null;
  status: MatterStatus;
  court: string | null;
  court_case_no: string | null;
  opened_at: string;
  client: { id: string; name: string } | null;
};

export const STATUS_LABEL: Record<MatterStatus, string> = {
  open: "פתוח",
  on_hold: "מושהה",
  closed: "סגור",
};

/** The areas a small Israeli practice actually works in. Suggestions, not a
 *  closed list — the field stays free text so nobody is blocked by a gap. */
export const PRACTICE_AREAS = [
  "נדל״ן",
  "מקרקעין ותכנון",
  "משפחה",
  "ירושה וצוואות",
  "נזיקין",
  "דיני עבודה",
  "חוזים",
  "חברות ומסחרי",
  "הוצאה לפועל",
  "פלילי",
  "מנהלי",
];

export async function listMatters(): Promise<Matter[]> {
  const { data, error } = await supabase
    .from("matters")
    .select(
      "id, ref_no, name, practice_area, status, court, court_case_no, opened_at, client:clients(id, name)",
    )
    .order("ref_no", { ascending: false });
  if (error) throw new Error(describeDbError(error));

  // PostgREST types an embedded one-to-one as an array; the foreign key makes
  // it single.
  return (data ?? []).map((row) => {
    const { client, ...rest } = row as unknown as Omit<Matter, "client"> & {
      client: { id: string; name: string }[] | { id: string; name: string } | null;
    };
    return { ...rest, client: Array.isArray(client) ? (client[0] ?? null) : client };
  });
}

export async function createMatter(input: {
  org_id: string;
  client_id: string;
  name: string;
  practice_area: string;
}): Promise<void> {
  const { error } = await supabase.from("matters").insert({
    org_id: input.org_id,
    client_id: input.client_id,
    name: input.name.trim(),
    practice_area: input.practice_area.trim() || null,
  });
  if (error) throw new Error(describeDbError(error));
}
