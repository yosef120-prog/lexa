import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

export type TaskStatus = "open" | "done" | "cancelled";

export type Task = {
  id: string;
  matter_id: string | null;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: TaskStatus;
  assignee_user_id: string | null;
  assignee: { full_name: string | null; email: string | null } | null;
  matter: { ref_no: number; name: string } | null;
};

// One literal rather than a concatenation: TypeScript widens `"a" + "b"` to
// string, and PostgREST's result typing is inferred from the literal.
const SELECT =
  "id, matter_id, title, notes, due_date, status, assignee_user_id, assignee:profiles!tasks_assignee_user_id_fkey(full_name, email), matter:matters(ref_no, name)";

/** PostgREST hands a one-to-one embed back as an object or a one-item array. */
function one<T>(value: unknown): T | null {
  return Array.isArray(value) ? ((value[0] as T) ?? null) : ((value as T) ?? null);
}

function shape(row: Record<string, unknown>): Task {
  return {
    ...(row as unknown as Task),
    assignee: one(row.assignee),
    matter: one(row.matter),
  };
}

/** Open tasks across the firm, soonest first, undated last. */
export async function listOpenTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(SELECT)
    .eq("status", "open")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);
  if (error) throw new Error(describeDbError(error));
  return (data ?? []).map(shape);
}

export async function listMatterTasks(matterId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select(SELECT)
    .eq("matter_id", matterId)
    .order("status", { ascending: true })
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []).map(shape);
}

export async function createTask(input: {
  org_id: string;
  matter_id?: string | null;
  title: string;
  notes?: string;
  due_date?: string;
  assignee_user_id?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("tasks").insert({
    org_id: input.org_id,
    matter_id: input.matter_id ?? null,
    title: input.title.trim(),
    notes: input.notes?.trim() || null,
    due_date: input.due_date || null,
    assignee_user_id: input.assignee_user_id || null,
  });
  if (error) throw new Error(describeDbError(error));
}

export async function setTaskDone(id: string, done: boolean): Promise<void> {
  const { data: who } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("tasks")
    .update(
      done
        ? { status: "done", completed_at: new Date().toISOString(), completed_by: who.user?.id }
        : { status: "open", completed_at: null, completed_by: null },
    )
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

/** Whether a due date has passed, judged by the day and not the hour. */
export function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dueDate) < today;
}

export function formatDue(dueDate: string | null): string {
  if (!dueDate) return "ללא מועד";
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "היום";
  if (days === 1) return "מחר";
  if (days === -1) return "אתמול";
  if (days < 0) return `באיחור ${Math.abs(days)} ימים`;
  if (days <= 7) return `בעוד ${days} ימים`;
  return due.toLocaleDateString("he-IL", { day: "numeric", month: "long" });
}
