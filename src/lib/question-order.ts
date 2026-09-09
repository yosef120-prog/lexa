/**
 * Where a conditional question sits in the list.
 *
 * Its own module for the reason intake-files.ts and payment-rules.ts are: these
 * are rules about order, and a rule should be testable without standing up a
 * database client. It imports nothing.
 *
 * The order matters twice. The client is asked the questions in it, so a
 * condition on an answer given later never matches. And the firm reads it, so a
 * question sitting far from the one it hangs off cannot be understood.
 */

/** Only what order depends on, so a test needs no more than this. */
export type Ordered = { id: string; depends_on_question_id: string | null };

/**
 * The order this question has to sit in for its condition to work.
 *
 * A condition is answered by a question the client has already been shown, so
 * a dependent below its parent is the only arrangement that functions. Rather
 * than refuse the choice, the list is rearranged around it: the intent — show
 * this only if that — is unambiguous, and the ordering is bookkeeping the
 * person should not have to do.
 */
export function orderForCondition<T extends Ordered>(
  all: T[],
  childId: string,
  parentId: string | null,
): T[] | null {
  if (!parentId) return null;
  const childAt = all.findIndex((q) => q.id === childId);
  const parentAt = all.findIndex((q) => q.id === parentId);
  if (childAt < 0 || parentAt < 0 || parentAt < childAt) return null;

  const rest = all.filter((q) => q.id !== childId);
  const insertAt = rest.findIndex((q) => q.id === parentId) + 1;
  return [...rest.slice(0, insertAt), all[childAt], ...rest.slice(insertAt)];
}

/**
 * Puts a dependent question directly beneath the one it hangs off.
 *
 * orderForCondition steps in only when the parent sits after the child, which
 * is the arrangement that breaks. This is the other one, which merely reads
 * badly: a question created from its parent belongs next to it, not at the
 * bottom of a form of twenty-three.
 *
 * Returns null when nothing would move, so the caller can skip the write.
 */
export function placeUnderParent<T extends Ordered>(
  all: T[],
  childId: string,
  parentId: string,
): T[] | null {
  const child = all.find((q) => q.id === childId);
  if (!child) return null;

  const rest = all.filter((q) => q.id !== childId);
  const parentAt = rest.findIndex((q) => q.id === parentId);
  if (parentAt < 0) return null;

  // Past the parent's existing children, so a second question on the same
  // answer lands below the first rather than jumping ahead of it.
  let at = parentAt + 1;
  while (at < rest.length && rest[at].depends_on_question_id === parentId) at += 1;

  const next = [...rest.slice(0, at), child, ...rest.slice(at)];
  return next.every((q, i) => q.id === all[i]?.id) ? null : next;
}
