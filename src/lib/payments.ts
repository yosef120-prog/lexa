import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

export { formatAmount, isOverdue } from "@/lib/payment-rules";

/**
 * When the money is due.
 *
 * Agreed once, in one contract, and then needed by both sides for a year. It
 * hangs off the matter — the deal — rather than off either party, which is
 * what lets it appear on the seller's card and the buyer's without being
 * typed twice or drifting apart.
 *
 * Each unpaid milestone keeps a diary entry in step with it, so the date
 * reaches the firm through the machinery that already carries hearings rather
 * than through a second one nobody remembers to check.
 */

export type Milestone = {
  id: string;
  matter_id: string;
  label: string;
  amount: number | null;
  due_date: string;
  paid_at: string | null;
  note: string | null;
};

/** The same rows as seen from a client card, with the deal named. */
export type ClientMilestone = Milestone & { matter_name: string };

export async function listMilestones(matterId: string): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from("payment_milestones")
    .select("id, matter_id, label, amount, due_date, paid_at, note")
    .eq("matter_id", matterId)
    .order("due_date");
  if (error) throw new Error(describeDbError(error));
  return (data ?? []) as Milestone[];
}

/**
 * Every payment date touching this person, from whichever side of the deal.
 *
 * A function rather than a query because the answer spans two ways of being
 * involved — owning the matter, or being a linked party on it — and working
 * that out in the browser would mean fetching every matter to ask.
 */
export async function listClientMilestones(clientId: string): Promise<ClientMilestone[]> {
  const { data, error } = await supabase.rpc("client_payment_milestones", {
    p_client_id: clientId,
  });
  if (error) throw new Error(describeDbError(error));
  return (data ?? []) as ClientMilestone[];
}

export async function addMilestone(input: {
  orgId: string;
  matterId: string;
  label: string;
  amount: number | null;
  dueDate: string;
  note?: string | null;
}): Promise<void> {
  const { error } = await supabase.from("payment_milestones").insert({
    org_id: input.orgId,
    matter_id: input.matterId,
    label: input.label.trim(),
    amount: input.amount,
    due_date: input.dueDate,
    note: input.note?.trim() || null,
  });
  if (error) throw new Error(describeDbError(error));
}

export async function updateMilestone(
  id: string,
  patch: { label?: string; amount?: number | null; dueDate?: string; note?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("payment_milestones")
    .update({
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
      ...(patch.dueDate ? { due_date: patch.dueDate } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

/** Marking it in or out. Out restores the diary entry rather than losing it. */
export async function setPaid(id: string, paidOn: string | null): Promise<void> {
  const { error } = await supabase
    .from("payment_milestones")
    .update({ paid_at: paidOn, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(describeDbError(error));
}

export async function removeMilestone(id: string): Promise<void> {
  const { error } = await supabase.from("payment_milestones").delete().eq("id", id);
  if (error) throw new Error(describeDbError(error));
}
