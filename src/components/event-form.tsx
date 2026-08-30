import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { createEvent, EVENT_KIND_LABEL, type EventKind } from "@/lib/events";
import { Button, ErrorNote, Field } from "@/components/ui";

/** Today in the local timezone, as the value a date input expects. */
function todayValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EventForm({
  matterId,
  onDone,
  onCancel,
}: {
  matterId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { membership } = useAuth();
  const [kind, setKind] = useState<EventKind>("hearing");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayValue());
  const [time, setTime] = useState("09:00");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await createEvent({
        org_id: membership.org_id,
        matter_id: matterId ?? null,
        kind,
        title,
        starts_at: startsAt.toISOString(),
        all_day: allDay,
        location,
      });
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

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? "שומר..." : "שמור"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
      <p className="text-xs text-muted">תזכורת נקבעת ל־24 שעות מראש. שליחת תזכורות עוד לא פעילה.</p>
    </form>
  );
}
