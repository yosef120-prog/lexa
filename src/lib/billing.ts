import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

export type FeeKind = "hourly" | "fixed" | "retainer";

export const FEE_KIND_LABEL: Record<FeeKind, string> = {
  hourly: "לפי שעה",
  fixed: "סכום קבוע / אחוזים",
  retainer: "ריטיינר",
};

export type FeeAgreement = {
  id: string;
  kind: FeeKind;
  currency: string;
  hourly_rate: number | null;
  fixed_amount: number | null;
  percent: number | null;
  retainer_amount: number | null;
};

export type TimeEntry = {
  id: string;
  started_at: string;
  minutes: number;
  description: string | null;
  billable: boolean;
  rate: number | null;
  invoice_id: string | null;
  user: { full_name: string | null; email: string | null } | null;
};

export type RunningTimer = { matter_id: string; started_at: string; note: string | null };

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} דק׳`;
  if (m === 0) return `${h} ש׳`;
  return `${h}:${String(m).padStart(2, "0")} ש׳`;
}

export function formatMoney(amount: number, currency = "ILS"): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** What a line is worth. Null rate means the work is recorded but not priced. */
export function lineValue(entry: TimeEntry): number | null {
  if (!entry.billable || entry.rate === null) return null;
  return (entry.minutes / 60) * entry.rate;
}

export async function getRunningTimer(): Promise<RunningTimer | null> {
  const { data, error } = await supabase
    .from("active_timers")
    .select("matter_id, started_at, note")
    .maybeSingle();
  if (error) throw new Error(describeDbError(error));
  return data;
}

export async function startTimer(matterId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("start_timer", {
    p_matter_id: matterId,
    p_note: note.trim() || null,
  });
  if (error) {
    if (error.message.includes("TIMER_ALREADY_RUNNING")) {
      throw new Error("כבר רץ אצלך טיימר. עצור אותו קודם.");
    }
    throw new Error(describeDbError(error));
  }
}

export async function stopTimer(description: string): Promise<void> {
  const { error } = await supabase.rpc("stop_timer", {
    p_description: description.trim() || null,
  });
  if (error) {
    if (error.message.includes("NO_TIMER_RUNNING")) {
      throw new Error("אין טיימר פעיל.");
    }
    throw new Error(describeDbError(error));
  }
}

export async function cancelTimer(): Promise<void> {
  const { error } = await supabase.rpc("cancel_timer");
  if (error) throw new Error(describeDbError(error));
}

export async function listTimeEntries(matterId: string): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("time_entries")
    .select(
      "id, started_at, minutes, description, billable, rate, invoice_id, user:profiles!time_entries_user_id_fkey(full_name, email)",
    )
    .eq("matter_id", matterId)
    .order("started_at", { ascending: false });
  if (error) throw new Error(describeDbError(error));

  return (data ?? []).map((row) => {
    const { user, ...rest } = row as never as Omit<TimeEntry, "user"> & { user: unknown };
    const u = user as TimeEntry["user"][] | TimeEntry["user"];
    return { ...rest, user: Array.isArray(u) ? (u[0] ?? null) : u };
  });
}

/**
 * Returns null when the caller may not see the firm's rates, rather than
 * throwing: an intern opening a matter should get the screen, minus the money.
 */
export async function getFeeAgreement(matterId: string): Promise<FeeAgreement | null> {
  const { data, error } = await supabase
    .from("fee_agreements")
    .select("id, kind, currency, hourly_rate, fixed_amount, percent, retainer_amount")
    .eq("matter_id", matterId)
    .maybeSingle();
  if (error) {
    console.warn("fee agreement not readable", error.message);
    return null;
  }
  return data;
}

export async function saveFeeAgreement(input: {
  org_id: string;
  matter_id: string;
  existingId?: string;
  kind: FeeKind;
  hourly_rate: string;
  fixed_amount: string;
  percent: string;
}): Promise<void> {
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const row = {
    org_id: input.org_id,
    matter_id: input.matter_id,
    kind: input.kind,
    hourly_rate: input.kind === "hourly" ? num(input.hourly_rate) : null,
    fixed_amount: input.kind === "fixed" ? num(input.fixed_amount) : null,
    percent: input.kind === "fixed" ? num(input.percent) : null,
    retainer_amount: input.kind === "retainer" ? num(input.fixed_amount) : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = input.existingId
    ? await supabase.from("fee_agreements").update(row).eq("id", input.existingId)
    : await supabase.from("fee_agreements").insert(row);

  if (error) {
    if (error.message.includes("fee_hourly_needs_rate")) {
      throw new Error("הסכם לפי שעה חייב תעריף.");
    }
    throw new Error(describeDbError(error));
  }
}
