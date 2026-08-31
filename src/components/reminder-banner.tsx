import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  daysAway,
  EVENT_KIND_LABEL,
  formatWhen,
  listDueReminders,
  relativeWhen,
  type Reminder,
} from "@/lib/events";

const DISMISSED_KEY = "lexa.reminders.dismissed";

/**
 * Dismissals live in the browser, not in the database.
 *
 * The events table has a reminded_at column, and it would be the obvious place
 * to write this — which is exactly the trap. That column belongs to the sender
 * that will mail these out; setting it from here would mean closing a banner
 * silently cancels the email that was going to arrive. Two different questions,
 * two different records.
 */
function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    // Private windows and blocked site data both land here. Nothing is
    // dismissed, which is the safe way to be wrong about a court date.
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // Nothing to recover: the banner simply comes back next time.
  }
}

/**
 * What is coming, said where it cannot be missed.
 *
 * The brief asks for a reminder 24 hours ahead. Mail needs a sending domain
 * this project does not have, so this is the half that can be delivered today
 * and honestly: it reaches whoever opens the app, and says so by living at the
 * top of every screen rather than in a notification that was never sent.
 */
export function ReminderBanner({ onOpenMatter }: { onOpenMatter: (id: string) => void }) {
  const { session } = useAuth();
  const [due, setDue] = useState<Reminder[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  const userId = session?.user.id;

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      setDue(await listDueReminders(userId));
    } catch (e) {
      // A failure here must not take the screen down with it. The diary is one
      // tab away and holds the same dates.
      console.warn("reminders unavailable", e);
    }
  }, [userId]);

  useEffect(() => {
    void reload();
    // Re-checked on the hour so a banner appears during a long session rather
    // than waiting for a reload. Cheap: one query, at most fifty rows.
    const timer = window.setInterval(() => void reload(), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [reload]);

  const showing = due.filter((e) => !dismissed.includes(e.id));
  if (showing.length === 0) return null;

  function dismiss(id: string) {
    // Only ids still in the window are kept, so the list cannot grow without
    // bound as hearings come and go.
    const next = [...dismissed, id].filter((kept) => due.some((e) => e.id === kept));
    setDismissed(next);
    writeDismissed(next);
  }

  return (
    <div className="flex flex-col gap-px bg-rule" role="status" aria-live="polite">
      {showing.map((e) => (
        // Today reads differently from tomorrow, because it is: a hearing this
        // afternoon and one in twenty hours ask for different things.
        <div
          key={e.id}
          className={`flex items-center gap-3 px-4 py-2.5 sm:px-6 ${
            daysAway(e.starts_at) <= 0 ? "bg-danger/10" : "bg-warning/10"
          }`}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-bold">
              {EVENT_KIND_LABEL[e.kind]} {relativeWhen(e.starts_at)}
            </span>
            <span className="truncate">{e.title}</span>
            <span className="text-ink-soft">{formatWhen(e)}</span>
            {e.location && <span className="text-ink-soft">· {e.location}</span>}
            {e.matter && (
              <button
                onClick={() => onOpenMatter(e.matter!.id)}
                className="font-semibold underline underline-offset-2"
              >
                תיק #{e.matter.ref_no}
              </button>
            )}
          </div>

          <button
            onClick={() => dismiss(e.id)}
            aria-label="הסתר תזכורת"
            className="shrink-0 rounded px-2 py-1 text-sm font-semibold text-ink-soft hover:bg-ink/5"
          >
            הסתר
          </button>
        </div>
      ))}
    </div>
  );
}
