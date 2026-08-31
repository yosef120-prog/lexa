import { useCallback, useEffect, useState } from "react";
import { isOverdue, listOpenTasks, type Task } from "@/lib/tasks";
import { NewTaskForm, TaskRow } from "@/components/tasks-panel";
import { count } from "@/lib/hebrew";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * Every open task in the firm, soonest first.
 *
 * Grouped by lateness rather than by matter, for the same reason the diary is
 * sorted by date: the question this screen answers is what is falling behind,
 * not what belongs to which file.
 */
export function TasksScreen({ onOpenMatter }: { onOpenMatter: (id: string) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setTasks(await listOpenTasks());
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

  const late = tasks.filter((t) => isOverdue(t.due_date));
  const rest = tasks.filter((t) => !isOverdue(t.due_date));

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">משימות</h1>
          <p className="text-sm text-muted">
            {loading
              ? "טוען..."
              : late.length > 0
                ? `${count(tasks.length, "משימה אחת פתוחה", "פתוחות")} · ${late.length} באיחור`
                : count(tasks.length, "משימה אחת פתוחה", "פתוחות")}
          </p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}>משימה חדשה</Button>}
      </div>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {adding && (
        <Card className="mb-5">
          <NewTaskForm
            onSaved={() => {
              setAdding(false);
              void reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}

      {!loading && tasks.length === 0 && !adding && (
        <Card className="text-center text-sm text-ink-soft">
          אין משימות פתוחות.
        </Card>
      )}

      {late.length > 0 && (
        <Group title="באיחור" tone="danger">
          {late.map((t) => (
            <TaskRow key={t.id} task={t} onChanged={reload} showMatter onOpenMatter={onOpenMatter} />
          ))}
        </Group>
      )}

      {rest.length > 0 && (
        <Group title="לפנינו">
          {rest.map((t) => (
            <TaskRow key={t.id} task={t} onChanged={reload} showMatter onOpenMatter={onOpenMatter} />
          ))}
        </Group>
      )}
    </div>
  );
}

function Group({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h2
        className={`mb-1.5 text-xs font-bold tracking-wide ${
          tone === "danger" ? "text-danger" : "text-muted"
        }`}
      >
        {title}
      </h2>
      <Card className="p-0">
        <ul className="flex flex-col divide-y divide-rule px-4">{children}</ul>
      </Card>
    </section>
  );
}
