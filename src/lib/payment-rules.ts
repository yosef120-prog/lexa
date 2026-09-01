/**
 * Judging a payment date, without a database client in the room.
 *
 * Its own module for the reason intake-files.ts is: these are rules, and a
 * rule should be testable without standing up Supabase. It imports nothing.
 */

export function formatAmount(amount: number | null): string {
  if (amount === null) return "";
  return `${amount.toLocaleString("he-IL", { maximumFractionDigits: 2 })} ₪`;
}

/**
 * Whether this one is late, judged on the day rather than the instant.
 *
 * A payment due today is not overdue at nine in the morning, and comparing
 * timestamps would say it was. A screen that cries wolf about money is a
 * screen a firm stops reading.
 */
export function isOverdue(
  m: { due_date: string; paid_at: string | null },
  today = new Date(),
): boolean {
  if (m.paid_at) return false;
  const cutoff = new Date(today);
  cutoff.setHours(0, 0, 0, 0);
  return new Date(`${m.due_date}T00:00:00`) < cutoff;
}
