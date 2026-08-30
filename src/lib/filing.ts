import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";
import type { DocumentRow } from "@/lib/documents";

export type FilingStatus = "draft" | "building" | "ready" | "failed" | "submitted";

export const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  draft: "בהכנה",
  building: "מופק",
  ready: "מוכן להגשה",
  failed: "ההפקה נכשלה",
  submitted: "הוגש",
};

export type FilingItem = {
  id: string;
  position: number;
  document: Pick<DocumentRow, "id" | "filename" | "size_bytes"> | null;
};

export type FilingBundle = {
  id: string;
  title: string;
  status: FilingStatus;
  main_document_id: string | null;
  page_count: number | null;
  error: string | null;
  submitted_at: string | null;
  submitted_note: string | null;
  created_at: string;
  main: Pick<DocumentRow, "id" | "filename" | "size_bytes"> | null;
  items: FilingItem[];
};

/**
 * נספח א׳, ב׳, ג׳ — how an Israeli filing actually labels its exhibits, and
 * what the index a court reads will say.
 */
const HEBREW_ORDINALS = [
  "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י",
  "יא", "יב", "יג", "יד", "טו", "טז", "יז", "יח", "יט", "כ",
];

export function appendixLabel(position: number): string {
  const letter = HEBREW_ORDINALS[position - 1];
  return letter ? `נספח ${letter}׳` : `נספח ${position}`;
}

function one<T>(v: T[] | T | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function listBundles(matterId: string): Promise<FilingBundle[]> {
  const { data, error } = await supabase
    .from("filing_bundles")
    .select(
      "id, title, status, main_document_id, page_count, error, submitted_at, submitted_note, created_at, " +
        "main:documents!filing_bundles_main_document_id_fkey(id, filename, size_bytes), " +
        "items:filing_bundle_items(id, position, document:documents(id, filename, size_bytes))",
    )
    .eq("matter_id", matterId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(describeDbError(error));

  // PostgREST returns an embedded one-to-one as an array in some shapes and as
  // an object in others, so both are accepted rather than guessed at.
  return (data ?? []).map((row) => {
    const r = row as never as Omit<FilingBundle, "main" | "items"> & {
      main: unknown;
      items: Array<Omit<FilingItem, "document"> & { document: unknown }>;
    };
    return {
      ...r,
      main: one(r.main as FilingBundle["main"][] | FilingBundle["main"]),
      items: [...(r.items ?? [])]
        .map((i) => ({
          ...i,
          document: one(i.document as FilingItem["document"][] | FilingItem["document"]),
        }))
        .sort((a, b) => a.position - b.position),
    };
  });
}

export async function createBundle(input: {
  org_id: string;
  matter_id: string;
  title: string;
  main_document_id: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from("filing_bundles")
    .insert({
      org_id: input.org_id,
      matter_id: input.matter_id,
      title: input.title.trim(),
      main_document_id: input.main_document_id,
    })
    .select("id")
    .single();
  if (error) throw new Error(describeDbError(error));
  return data.id;
}

export async function addAppendix(input: {
  org_id: string;
  bundle_id: string;
  document_id: string;
  position: number;
}): Promise<void> {
  const { error } = await supabase.from("filing_bundle_items").insert(input);
  if (error) {
    if (error.code === "23505") {
      throw new Error("המסמך הזה כבר בהגשה.");
    }
    throw new Error(describeDbError(error));
  }
}

export async function removeAppendix(itemId: string): Promise<void> {
  const { error } = await supabase.from("filing_bundle_items").delete().eq("id", itemId);
  if (error) throw new Error(describeDbError(error));
}

/**
 * Moves an appendix one place and renumbers.
 *
 * Positions are unique per bundle, so the two rows cannot simply swap: the
 * first write would collide with the row it is trying to trade places with.
 * One is parked out of the way first.
 */
export async function moveAppendix(
  items: FilingItem[],
  itemId: string,
  direction: -1 | 1,
): Promise<void> {
  const index = items.findIndex((i) => i.id === itemId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= items.length) return;

  const a = items[index];
  const b = items[target];
  const parking = Math.max(...items.map((i) => i.position)) + 1;

  for (const step of [
    { id: a.id, position: parking },
    { id: b.id, position: a.position },
    { id: a.id, position: b.position },
  ]) {
    const { error } = await supabase
      .from("filing_bundle_items")
      .update({ position: step.position })
      .eq("id", step.id);
    if (error) throw new Error(describeDbError(error));
  }
}

export async function markSubmitted(bundleId: string, note: string): Promise<void> {
  const { error } = await supabase
    .from("filing_bundles")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_note: note.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bundleId);
  if (error) throw new Error(describeDbError(error));
}

/** Bytes across the whole bundle, which is what decides whether it needs splitting. */
export function bundleSize(bundle: FilingBundle): number {
  return (
    (bundle.main?.size_bytes ?? 0) +
    bundle.items.reduce((sum, i) => sum + (i.document?.size_bytes ?? 0), 0)
  );
}

/** נט המשפט refuses anything larger, which is why the renderer has to split. */
export const NET_HAMISHPAT_LIMIT = 30 * 1024 * 1024;
