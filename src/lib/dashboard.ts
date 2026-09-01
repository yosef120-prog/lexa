import { supabase } from "@/lib/supabase";
import { lineValue, type TimeEntry } from "@/lib/billing";

/**
 * What the firm looks like this morning.
 *
 * Two different questions, gathered together because they are asked together:
 * what needs doing today, and what shape the practice is in. The first decides
 * the next hour; the second is worth a glance and nothing more, which is why
 * the numbers sit below the list rather than above it.
 *
 * Every query is scoped by row level security, so none of them filters by
 * firm. Each is counted rather than fetched wherever a count is all that is
 * wanted — a firm with four thousand time entries should not download them to
 * learn that there are four thousand.
 */

export type Snapshot = {
  clients: number;
  matters: { open: number; onHold: number; closed: number };
  tasks: { open: number; overdue: number };
  diary: { soon: number; overdue: number };
  intakes: { waiting: number; missingDocs: number; arrived: number };
  money: { unbilled: number; awaitingPayment: number } | null;
};

async function countOf(
  table: string,
  narrow: (q: ReturnType<typeof buildCount>) => ReturnType<typeof buildCount>,
): Promise<number> {
  const { count, error } = await narrow(buildCount(table));
  if (error) return 0;
  return count ?? 0;
}

function buildCount(table: string) {
  return supabase.from(table).select("*", { count: "exact", head: true });
}

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

export async function loadSnapshot(): Promise<Snapshot> {
  const today = startOfToday();
  const now = new Date().toISOString();

  const [
    clients,
    open,
    onHold,
    closed,
    tasksOpen,
    tasksOverdue,
    diarySoon,
    diaryOverdue,
    waiting,
    missingDocs,
    arrived,
    money,
  ] = await Promise.all([
    countOf("clients", (q) => q),
    countOf("matters", (q) => q.eq("status", "open")),
    countOf("matters", (q) => q.eq("status", "on_hold")),
    countOf("matters", (q) => q.eq("status", "closed")),
    countOf("tasks", (q) => q.eq("status", "open")),
    countOf("tasks", (q) => q.eq("status", "open").lt("due_date", today.slice(0, 10))),
    // The next week, which is the horizon a person can actually act on.
    countOf("events", (q) => q.gte("starts_at", now).lte("starts_at", inDays(7))),
    countOf("events", (q) => q.lt("starts_at", today)),
    countOf("client_intakes", (q) => q.in("status", ["sent", "opened"])),
    countOf("client_intakes", (q) => q.eq("status", "partial")),
    countOf("client_intakes", (q) => q.eq("status", "submitted").is("reviewed_at", null)),
    loadMoney(),
  ]);

  return {
    clients,
    matters: { open, onHold, closed },
    tasks: { open: tasksOpen, overdue: tasksOverdue },
    diary: { soon: diarySoon, overdue: diaryOverdue },
    intakes: { waiting, missingDocs, arrived },
    money,
  };
}

/**
 * Returns null rather than zero when the caller may not see money.
 *
 * An intern opening this screen should get the screen without the figures,
 * not a firm that appears to have earned nothing.
 */
async function loadMoney(): Promise<Snapshot["money"]> {
  const [entries, invoices] = await Promise.all([
    supabase
      .from("time_entries")
      .select("minutes, rate, billable, invoice_id")
      .is("invoice_id", null)
      .eq("billable", true)
      .not("rate", "is", null),
    supabase.from("invoices").select("total").eq("status", "issued"),
  ]);

  if (entries.error || invoices.error) return null;

  const unbilled = (entries.data ?? []).reduce(
    (sum, e) => sum + (lineValue(e as unknown as TimeEntry) ?? 0),
    0,
  );
  const awaitingPayment = (invoices.data ?? []).reduce(
    (sum, i) => sum + Number((i as { total: number }).total ?? 0),
    0,
  );

  return { unbilled, awaitingPayment };
}
