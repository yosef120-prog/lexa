/**
 * Counting things in Hebrew.
 *
 * A screen that says "1 משתמשים" reads as a translation, and a lawyer notices.
 * One takes the singular and drops the numeral entirely — "משתמש אחד", not
 * "1 משתמש" — which is the case every list hits on its first day and the one
 * that a plain interpolation always gets wrong.
 *
 * Two upward is left alone: "2 תיקים" is how a number is read off a screen,
 * and the literary "שני תיקים" would need the noun's gender to be carried
 * around for no gain in a count.
 */
export function count(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}
