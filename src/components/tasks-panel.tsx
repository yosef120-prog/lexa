import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { createTask, formatDue, isOverdue, setTaskDone, type Task } from "@/lib/tasks";
import { listMembers, type Member } from "@/lib/invitations";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

function personName(p: { full_name: string | null; email: string | null } | null): string {
  return p?.full_name || p?.email || "לא שויך";
}

/**
 * One task, with the checkbox doing the work.
 *
 * Marking something done is the single most repeated action here, so it costs
 * one tap and no dialog. The row goes quiet rather than disappearing, so the
 * tap can be taken back.
 */
export function TaskRow({
  task,
  onChanged,
  showMatter = false,
  onOpenMatter,
}: {
  task: Task;
  onChanged: () => void;
  showMatter?: boolean;
  onOpenMatter?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = task.status === "done";
  const late = !done && isOverdue(task.due_date);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await setTaskDone(task.id, !done);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1 py-2">
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={done}
          disabled={busy}
          onChange={toggle}
          aria-label={done ? "החזר למשימות פתוחות" : "סמן כבוצע"}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand,#1f4e79)]"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={`text-sm font-semibold ${done ? "text-muted line-through" : ""}`}>
            {task.title}
          </span>
          <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <span className={late ? "font-semibold text-danger" : ""}>
              {formatDue(task.due_date)}
            </span>
            <span>·</span>
            <span>{personName(task.assignee)}</span>
            {showMatter && task.matter && (
              <>
                <span>·</span>
                {onOpenMatter && task.matter_id ? (
                  <button
                    onClick={() => onOpenMatter(task.matter_id as string)}
                    className="underline underline-offset-2 hover:text-ink"
                  >
                    #{task.matter.ref_no} {task.matter.name}
                  </button>
                ) : (
                  <span>
                    #{task.matter.ref_no} {task.matter.name}
                  </span>
                )}
              </>
            )}
          </span>
          {task.notes && <p className="mt-0.5 text-xs whitespace-pre-wrap text-ink-soft">{task.notes}</p>}
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}

/** The form for a new task, used both on a matter and on its own. */
export function NewTaskForm({
  matterId,
  onSaved,
  onCancel,
}: {
  matterId?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { membership } = useAuth();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMembers()
      .then(setMembers)
      // A task with nobody on it is still a task, so a failure here narrows the
      // form rather than blocking it.
      .catch((e) => console.warn("member list unavailable", e));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      await createTask({
        org_id: membership.org_id,
        matter_id: matterId ?? null,
        title,
        due_date: due,
        assignee_user_id: assignee || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-rule pt-3">
      <Field
        label="מה צריך לעשות"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
        required
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="עד מתי" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">על מי</span>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                       outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          >
            <option value="">לא שויך</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {personName(m.profile)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? "שומר..." : "הוסף משימה"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

export function TasksPanel({
  matterId,
  tasks,
  onChanged,
}: {
  matterId: string;
  tasks: Task[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const open = tasks.filter((t) => t.status === "open");

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">משימות</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-sm font-semibold text-brand underline underline-offset-2"
          >
            הוסף
          </button>
        )}
      </div>

      {tasks.length === 0 && !adding && (
        <p className="text-sm text-ink-soft">
          אין משימות בתיק. משימה היא משהו שמישהו צריך לעשות — בשונה ממועד ביומן, שקורה בין אם עשו
          משהו ובין אם לא.
        </p>
      )}

      {tasks.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-rule">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} onChanged={onChanged} />
            ))}
          </ul>
          <p className="text-xs text-muted">{open.length} פתוחות מתוך {tasks.length}</p>
        </>
      )}

      {adding && (
        <NewTaskForm
          matterId={matterId}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </Card>
  );
}
