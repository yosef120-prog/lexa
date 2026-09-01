/**
 * Whether a payment is late.
 *
 * The whole value of the schedule is the firm noticing a date slipping past.
 * A comparison done on timestamps rather than on days would call a payment due
 * this morning overdue by lunchtime, and a screen that cries wolf about money
 * is a screen a firm stops reading.
 */
import { isOverdue, formatAmount } from "../src/lib/payment-rules.ts";

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(
      `  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`  ok    ${label}`);
  }
}

console.log("\npayments · late or not\n");

// Mid-afternoon, so a naive timestamp comparison would already have written
// today off.
const today = new Date("2026-09-01T15:30:00");

check("due today is not late today", isOverdue({ due_date: "2026-09-01", paid_at: null }, today), false);
check("yesterday is late", isOverdue({ due_date: "2026-08-31", paid_at: null }, today), true);
check("tomorrow is not", isOverdue({ due_date: "2026-09-02", paid_at: null }, today), false);

// Paid closes the question, whenever it was paid.
check(
  "a paid one is never late",
  isOverdue({ due_date: "2026-01-01", paid_at: "2026-03-01" }, today),
  false,
);
check(
  "even paid after the date",
  isOverdue({ due_date: "2026-08-01", paid_at: "2026-08-20" }, today),
  false,
);

console.log("\npayments · the amount\n");

check("with separators", formatAmount(250000), "250,000 ₪");
check("and agorot when there are any", formatAmount(1234.5), "1,234.5 ₪");
check("zero is a real amount, not nothing", formatAmount(0), "0 ₪");
// A milestone can be a date with no sum agreed yet; showing "0 ₪" would be a
// number the contract never contained.
check("no amount shows nothing at all", formatAmount(null), "");

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
