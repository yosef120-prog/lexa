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

/**
 * One question and everything that hangs off it, as a unit.
 *
 * The list is kept so that children follow their parent, so a block is a
 * parent and the run of children directly after it.
 */
function blocksOf<T extends Ordered>(all: T[]): T[][] {
  const blocks: T[][] = [];
  for (const q of all) {
    const head = blocks[blocks.length - 1]?.[0];
    if (q.depends_on_question_id && head && q.depends_on_question_id === head.id) {
      blocks[blocks.length - 1].push(q);
    } else {
      blocks.push([q]);
    }
  }
  return blocks;
}

/**
 * Moves a question up or down without separating it from what it belongs to.
 *
 * A parent travels with its children: moving it past the next question would
 * otherwise leave them stranded behind, still conditioned on an answer now
 * given after them, which is the arrangement that makes a condition never
 * match.
 *
 * A child moves only among its siblings. There is nowhere else it can go —
 * outside its parent's run it is either before the answer it depends on or
 * marooned under a question it has nothing to do with.
 *
 * Returns null when the move is not available, which is also what the arrow
 * asks to decide whether it is disabled.
 */
export function moveQuestion<T extends Ordered>(
  all: T[],
  id: string,
  direction: -1 | 1,
): T[] | null {
  const blocks = blocksOf(all);

  const blockAt = blocks.findIndex((b) => b.some((q) => q.id === id));
  if (blockAt < 0) return null;
  const block = blocks[blockAt];
  const isHead = block[0].id === id;

  if (isHead) {
    const to = blockAt + direction;
    if (to < 0 || to >= blocks.length) return null;
    const next = [...blocks];
    [next[blockAt], next[to]] = [next[to], next[blockAt]];
    return next.flat();
  }

  // A child, among the children of its own parent only.
  const at = block.findIndex((q) => q.id === id);
  const to = at + direction;
  if (to < 1 || to >= block.length) return null;
  const moved = [...block];
  [moved[at], moved[to]] = [moved[to], moved[at]];
  const next = [...blocks];
  next[blockAt] = moved;
  return next.flat();
}
