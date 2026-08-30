import { useState } from "react";
import { daysAway, type CalendarEvent } from "@/lib/events";
import { EventForm } from "@/components/event-form";
import { EventRow } from "@/screens/DiaryScreen";
import { Card } from "@/components/ui";

export function MatterEvents({
  matterId,
  events,
  onChanged,
}: {
  matterId: string;
  events: CalendarEvent[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);

  // The next thing due is the fact this panel exists to surface, so it is not
  // buried under a list of everything that ever happened.
  const next = events.find((e) => daysAway(e.starts_at) >= 0) ?? null;
  const overdue = events.filter((e) => daysAway(e.starts_at) < 0);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">מועדים</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-sm font-semibold text-brand underline underline-offset-2"
          >
            הוסף
          </button>
        )}
      </div>

      {overdue.map((e) => (
        <EventRow key={e.id} event={e} overdue />
      ))}

      {next ? (
        <EventRow event={next} />
      ) : (
        overdue.length === 0 && (
          <p className="text-sm text-ink-soft">אין מועדים בתיק הזה.</p>
        )
      )}

      {events.length > (next ? 1 : 0) + overdue.length && (
        <p className="text-xs text-muted">
          ועוד {events.length - (next ? 1 : 0) - overdue.length} מאוחרים יותר — ראה ביומן.
        </p>
      )}

      {adding && (
        <EventForm
          matterId={matterId}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </Card>
  );
}
