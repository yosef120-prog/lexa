/**
 * What the reminder mail says, without sending one.
 *
 * The subject line is read on a lock screen and often nowhere else, so getting
 * it wrong wastes the whole message. These are the pure parts; the sending and
 * the query need a network and a key and are exercised by running the job.
 */
import { whenLine, subjectFor, bodyFor, order } from "../scripts/send-reminders.mjs";

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

console.log("\nreminder mail · what it says\n");

// Built from a local midnight rather than written with an offset: these compare
// calendar days, so a literal would assert the machine sits in Israel and pass
// here while failing on the build runner. That has already happened once.
const now = new Date(2026, 8, 10, 8, 0, 0);
const dayAfter = (days, h = 9, m = 30) =>
  new Date(2026, 8, 10 + days, h, m, 0).toISOString();

const hearing = (over = {}) => ({
  id: "a",
  kind: "hearing",
  title: "דיון הוכחות",
  location: "שלום ת״א, אולם 3",
  starts_at: dayAfter(1),
  all_day: false,
  matter: { ref_no: 7, name: "מכירת דירה" },
  ...over,
});

check("tomorrow is named, not dated away", whenLine(hearing(), now).startsWith("מחר · "), true);
check("today says today", whenLine(hearing({ starts_at: dayAfter(0, 16) }), now).startsWith("היום · "), true);
check("further out counts the days", whenLine(hearing({ starts_at: dayAfter(4) }), now).startsWith("בעוד 4 ימים"), true);

// A hearing is a moment and the hour is the part somebody acts on. A statutory
// deadline is a day, and inventing a time for it would be inventing precision.
check("a hearing keeps its time", whenLine(hearing(), now).includes("09:30"), true);
check(
  "an all-day deadline has none to keep",
  /\d{2}:\d{2}/.test(whenLine(hearing({ all_day: true, kind: "deadline" }), now)),
  false,
);

// One entry: say what it is, because that is the whole message.
check(
  "a single entry names itself in the subject",
  subjectFor([hearing()], now),
  "דיון מחר: דיון הוכחות",
);
check(
  "several are counted, with the nearest called out",
  subjectFor([hearing({ starts_at: dayAfter(3) }), hearing({ id: "b", starts_at: dayAfter(1) })], now),
  "2 מועדים לפניך · הקרוב מחר",
);

check(
  "the soonest is listed first however they arrive",
  order([hearing({ id: "late", starts_at: dayAfter(5) }), hearing({ id: "soon", starts_at: dayAfter(1) })]).map(
    (e) => e.id,
  ),
  ["soon", "late"],
);

// A matter name is client data and goes into markup. Escaping it is the
// difference between a title and an injection.
const nasty = hearing({ title: '<script>alert("x")</script>', matter: null });
check("markup in a title is escaped, not rendered", bodyFor([nasty], now).includes("<script>"), false);
check("and the text still survives", bodyFor([nasty], now).includes("&lt;script&gt;"), true);

// Nobody should assume their colleagues got a copy of something they did not.
check(
  "the mail admits it reached only one address",
  bodyFor([hearing()], now).includes("רק לכתובת שבבעלות חשבון השליחה"),
  true,
);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
