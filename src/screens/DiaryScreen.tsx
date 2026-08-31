import { useCallback, useEffect, useState } from "react";
import {
  daysAway,
  EVENT_KIND_LABEL,
  formatWhen,
  googleCalendarUrl,
  listUpcoming,
  relativeWhen,
  type CalendarEvent,
} from "@/lib/events";
import { EventForm } from "@/components/event-form";
import { count } from "@/lib/hebrew";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * What Daniel asked for in one sentence: the dates in front of him.
 *
 * Sorted by urgency rather than grouped by matter, because the question this
 * screen answers is "what is coming at me", not "what is in that file".
 */
export function DiaryScreen({ onOpenMatter }: { onOpenMatter: (id: string) => void }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setEvents(await listUpcoming());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const past = events.filter((e) => daysAway(e.starts_at) < 0);
  const ahead = events.filter((e) => daysAway(e.starts_at) >= 0);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">יומן</h1>
          <p className="text-sm text-muted">
            {loading ? "טוען..." : count(ahead.length, "מועד אחד לפנינו", "מועדים לפנינו")}
          </p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}>מועד חדש</Button>}
      </div>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {adding && (
        <Card className="mb-6">
          <h2 className="text-lg font-bold">מועד חדש</h2>
          <EventForm
            onDone={async () => {
              setAdding(false);
              await reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}

      {/* Anything already past sits at the top, because a date that slipped is
          the most urgent thing on the screen. */}
      {past.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold text-danger">עברו ולא נסגרו</h2>
          <div className="flex flex-col gap-2">
            {past.map((e) => (
              <Editable key={e.id} event={e} editing={editing} setEditing={setEditing} reload={reload}>
                <EventRow event={e} onOpenMatter={onOpenMatter} onEdit={setEditing} overdue />
              </Editable>
            ))}
          </div>
        </section>
      )}

      {!loading && ahead.length === 0 && past.length === 0 && !adding && (
        <Card className="text-center text-sm text-ink-soft">
          היומן ריק. דיון או מועד אחרון נכנסים בכפתור למעלה.
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {ahead.map((e) => (
          <Editable key={e.id} event={e} editing={editing} setEditing={setEditing} reload={reload}>
            <EventRow event={e} onOpenMatter={onOpenMatter} onEdit={setEditing} />
          </Editable>
        ))}
      </div>
    </div>
  );
}

/** The row, or the form that is correcting it — in the same place on the page. */
function Editable({
  event,
  editing,
  setEditing,
  reload,
  children,
}: {
  event: CalendarEvent;
  editing: CalendarEvent | null;
  setEditing: (e: CalendarEvent | null) => void;
  reload: () => Promise<void>;
  children: React.ReactNode;
}) {
  if (editing?.id !== event.id) return <>{children}</>;
  return (
    <Card>
      <h2 className="text-lg font-bold">עריכת מועד</h2>
      <EventForm
        event={event}
        onDone={async () => {
          setEditing(null);
          await reload();
        }}
        onCancel={() => setEditing(null)}
      />
    </Card>
  );
}

export function EventRow({
  event,
  onOpenMatter,
  onEdit,
  overdue = false,
}: {
  event: CalendarEvent;
  onOpenMatter?: (id: string) => void;
  onEdit?: (event: CalendarEvent) => void;
  overdue?: boolean;
}) {
  const days = daysAway(event.starts_at);
  const soon = days >= 0 && days <= 2;

  return (
    <Card className={`flex items-start justify-between gap-4 p-4 ${overdue ? "border-danger/40 bg-danger/5" : ""}`}>
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="rounded bg-ground px-1.5 py-0.5 text-xs font-semibold text-ink-soft">
            {EVENT_KIND_LABEL[event.kind]}
          </span>
          <span className="font-semibold">{event.title}</span>
        </div>
        <span className="text-sm text-ink-soft">
          {formatWhen(event)}
          {event.location && ` · ${event.location}`}
        </span>
        {event.matter && onOpenMatter && (
          <button
            onClick={() => onOpenMatter(event.matter!.id)}
            className="self-start text-xs text-brand underline underline-offset-2"
          >
            תיק #{event.matter.ref_no} {event.matter.name}
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={`text-xs font-semibold ${
            overdue ? "text-danger" : soon ? "text-warning" : "text-muted"
          }`}
        >
          {relativeWhen(event.starts_at)}
        </span>
        {/* One-way, and one click. Daniel already lives in Google Calendar. */}
        <a
          href={googleCalendarUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand underline underline-offset-2"
        >
          ליומן גוגל
        </a>
        {onEdit && (
          <button
            onClick={() => onEdit(event)}
            className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
          >
            ערוך
          </button>
        )}
      </div>
    </Card>
  );
}
