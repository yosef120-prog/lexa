import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  cancelEvent,
  createEvent,
  EVENT_KIND_LABEL,
  updateEvent,
  type CalendarEvent,
  type EventKind,
} from "@/lib/events";
import { Button, ErrorNote, Field } from "@/components/ui";

/** Today in the local timezone, as the value a date input expects. */
function todayValue(): string {
  return dateValue(new Date());
}

function dateValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * One form for entering a date and for correcting one.
 *
 * The same fields either way, because they are the same fields — and a hearing
 * that moves is the common case, not an edge one. Passing `event` switches it
 * to editing that entry.
 */
export function EventForm({
  matterId,
  event,
  onDone,
  onCancel,
}: {
  matterId?: string;
  event?: CalendarEvent;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { membership } = useAuth();
  const existing = event ? new Date(event.starts_at) : null;

  const [kind, setKind] = useState<EventKind>(event?.kind ?? "hearing");
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(existing ? dateValue(existing) : todayValue());
  const [time, setTime] = useState(existing && !event?.all_day ? timeValue(existing) : "09:00");
  const [location, setLocation] = useState(event?.location ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cancelling asks for a reason before it happens, because the reason is the
  // part that stays on the matter after the entry is gone.
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  // A statutory deadline is a day, not a moment. Asking for a time would invite
  // a made-up one.
  const allDay = kind === "deadline";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      const startsAt = allDay ? new Date(`${date}T00:00`) : new Date(`${date}T${time}`);
      const fields = {
        kind,
        title,
        starts_at: startsAt.toISOString(),
        all_day: allDay,
        location,
      };
      if (event) {
        await updateEvent(event.id, fields);
      } else {
        await createEvent({ org_id: membership.org_id, matter_id: matterId ?? null, ...fields });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-rule pt-3">
      <div className="flex flex-wrap gap-1.5">
        {(["hearing", "deadline", "meeting", "other"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              kind === k ? "bg-brand text-white" : "bg-ground text-ink-soft"
            }`}
          >
            {EVENT_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <Field
        label="מה"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={kind === "deadline" ? "לדוגמה: הגשת מס שבח" : "לדוגמה: דיון הוכחות"}
        autoFocus
        required
      />

      <div className={`grid gap-3 ${allDay ? "" : "grid-cols-2"}`}>
        <Field label="תאריך" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {!allDay && (
          <Field label="שעה" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        )}
      </div>

      {!allDay && (
        <Field
          label="מיקום"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="בית משפט השלום, אולם 3"
        />
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? "שומר..." : "שמור"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          חזור
        </Button>
        {event && !cancelling && (
          <button
            type="button"
            onClick={() => setCancelling(true)}
            className="mr-auto rounded px-2 py-1 text-sm font-semibold text-danger hover:bg-danger/10"
          >
            בטל מועד
          </button>
        )}
      </div>

      {cancelling && event && (
        <div className="flex flex-col gap-2 rounded-md bg-danger/10 p-3">
          <p className="text-sm font-semibold text-danger">ביטול {event.title}</p>
          {/* Said before it happens, so nobody expects to find it later. */}
          <p className="text-xs text-ink-soft">
            המועד יירד מהיומן. הביטול והסיבה יישארו בציר הזמן של התיק.
          </p>
          <Field
            label="סיבה"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="לדוגמה: נדחה בהסכמת הצדדים"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await cancelEvent(event.id, reason);
                  onDone();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                  setBusy(false);
                }
              }}
              className="rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "מבטל..." : "בטל את המועד"}
            </button>
            <Button type="button" variant="ghost" onClick={() => setCancelling(false)}>
              השאר
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted">
        תזכורת נקבעת ל־24 שעות מראש ומופיעה בראש המסך. שליחה במייל עוד לא מחוברת.
      </p>
    </form>
  );
}
