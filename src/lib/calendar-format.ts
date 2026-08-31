/**
 * Date and label handling for the diary.
 *
 * Deliberately free of any Supabase or React import, so it can be tested on its
 * own — these functions decide which day a deadline lands on in someone's
 * calendar, and that is the kind of thing that is wrong for months before
 * anyone notices.
 */

export type EventKind = "hearing" | "meeting" | "deadline" | "other";

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  hearing: "דיון",
  meeting: "פגישה",
  deadline: "מועד אחרון",
  other: "אחר",
};

export type CalendarEvent = {
  id: string;
  kind: EventKind;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  matter: { id: string; ref_no: number; name: string } | null;
};

/** A calendar entry with the two fields that decide who is warned, and when. */
export type Reminder = CalendarEvent & {
  remind_at: string | null;
  created_by: string | null;
  matter: (CalendarEvent["matter"] & { lead_user_id: string | null }) | null;
};

/**
 * Whether an entry is currently asking for attention.
 *
 * The window opens at remind_at -- 24 hours before, unless someone said
 * otherwise -- and closes when the entry is behind us. An all-day deadline
 * counts for the whole of its day: a deadline "today" is still today at 16:00,
 * and dropping it at midnight would remove the warning on the morning it
 * matters most.
 */
export function isDue(event: Reminder, now: Date = new Date()): boolean {
  if (!event.remind_at) return false;
  if (new Date(event.remind_at) > now) return false;
  // Compared against the caller's clock rather than through daysAway, which
  // reads the real one: a function that half ignores the time it was handed
  // cannot be tested, and would drift from the branch below.
  if (event.all_day) return startOfDay(new Date(event.starts_at)) >= startOfDay(now);
  return new Date(event.starts_at) >= now;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Whether this entry is the viewer's to act on.
 *
 * Whoever types a hearing date is often the secretary; whoever has to stand up
 * in court is the lawyer. Warning only the person who created it would reach
 * exactly the wrong desk, so the lawyer leading the matter is warned too.
 *
 * A matter with nobody leading it warns everyone. That is noisy in a large
 * firm and correct in every firm: an unassigned hearing that belongs to nobody
 * is worse than one that belongs to all.
 */
export function isMine(event: Reminder, userId: string): boolean {
  if (event.created_by === userId) return true;
  if (!event.matter) return false;
  return event.matter.lead_user_id === userId || event.matter.lead_user_id === null;
}

/** Days from today, negative once the date has passed. */
export function daysAway(iso: string): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(new Date(iso)) - midnight(new Date())) / 86_400_000);
}

export function formatWhen(e: CalendarEvent): string {
  const d = new Date(e.starts_at);
  const date = d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
  if (e.all_day) return date;
  return `${date} · ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`;
}

export function relativeWhen(iso: string): string {
  const days = daysAway(iso);
  if (days < -1) return `עבר לפני ${Math.abs(days)} ימים`;
  if (days === -1) return "היה אתמול";
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days <= 7) return `בעוד ${days} ימים`;
  return `בעוד ${days} ימים`;
}

/**
 * A one-way "add to Google Calendar" link.
 *
 * The brief asked for calendar sync "if it comes easily". Two-way sync is a
 * project; this is a URL, and it puts the date where Daniel already looks.
 */
export function googleCalendarUrl(e: CalendarEvent): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = new Date(e.starts_at);
  const end = e.ends_at
    ? new Date(e.ends_at)
    : new Date(start.getTime() + (e.all_day ? 86_400_000 : 60 * 60 * 1000));

  // An all-day date is written in local terms, because that is what it means: a
  // deadline on the 3rd is the 3rd in Israel. Reading it in UTC moves midnight
  // back across the date line and files the deadline a day early.
  //
  // A timed event is the opposite — a hearing at 09:00 is a moment — so it goes
  // out in UTC with the Z that says so.
  const stamp = (d: Date) =>
    e.all_day
      ? `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
      : `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
        `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.matter ? `${e.title} · תיק #${e.matter.ref_no}` : e.title,
    dates: `${stamp(start)}/${stamp(end)}`,
  });
  if (e.location) params.set("location", e.location);
  if (e.matter) params.set("details", e.matter.name);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
