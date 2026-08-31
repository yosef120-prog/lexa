import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";
import { isDue, isMine, type CalendarEvent, type EventKind, type Reminder } from "@/lib/calendar-format";

export * from "@/lib/calendar-format";

const SELECT = "id, kind, title, location, starts_at, ends_at, all_day, matter:matters(id, ref_no, name)";

function normalise(rows: unknown[]): CalendarEvent[] {
  return (rows ?? []).map((row) => {
    const { matter, ...rest } = row as Omit<CalendarEvent, "matter"> & { matter: unknown };
    const m = matter as CalendarEvent["matter"][] | CalendarEvent["matter"];
    return { ...rest, matter: Array.isArray(m) ? (m[0] ?? null) : m };
  });
}

/** Everything still ahead, plus anything already past that nobody closed off. */
export async function listUpcoming(): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(SELECT)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(describeDbError(error));
  return normalise(data ?? []);
}

/**
 * What is asking for attention right now, for this person.
 *
 * The window is filtered in the database because most entries are outside it,
 * and decided in isDue because the exact edges -- an all-day deadline lasting
 * its whole day, an entry with no window at all -- are the part worth testing.
 */
export async function listDueReminders(userId: string): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, kind, title, location, starts_at, ends_at, all_day, remind_at, created_by, matter:matters(id, ref_no, name, lead_user_id)",
    )
    .lte("remind_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(describeDbError(error));

  const rows = (data ?? []).map((row) => {
    const { matter, ...rest } = row as Omit<Reminder, "matter"> & { matter: unknown };
    const m = matter as Reminder["matter"][] | Reminder["matter"];
    return { ...rest, matter: Array.isArray(m) ? (m[0] ?? null) : m } as Reminder;
  });

  const now = new Date();
  return rows.filter((e) => isDue(e, now) && isMine(e, userId));
}

export async function listMatterEvents(matterId: string): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from("events")
    .select(SELECT)
    .eq("matter_id", matterId)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(describeDbError(error));
  return normalise(data ?? []);
}

export async function createEvent(input: {
  org_id: string;
  matter_id?: string | null;
  kind: EventKind;
  title: string;
  starts_at: string;
  all_day: boolean;
  location: string;
}): Promise<void> {
  const { error } = await supabase.from("events").insert({
    org_id: input.org_id,
    matter_id: input.matter_id ?? null,
    kind: input.kind,
    title: input.title.trim(),
    starts_at: input.starts_at,
    all_day: input.all_day,
    location: input.location.trim() || null,
  });
  if (error) throw new Error(describeDbError(error));
}
