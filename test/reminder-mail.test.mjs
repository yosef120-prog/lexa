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

// Written as instants with an explicit offset, never built from the machine's
// own calendar. The script pins itself to the firm's zone on purpose, so these
// have to name the moment rather than let the runner decide which one it was —
// September 2026 is IDT, so +03:00 is what the courthouse clock reads.
const now = new Date("2026-09-10T08:00:00+03:00");
const dayAfter = (days, h = 9, m = 30) =>
  new Date(`2026-09-${String(10 + days).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+03:00`).toISOString();

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

// The hearing that came back wrong.
//
// A hearing entered at 11:00 in Tel Aviv is stored as 08:00Z, and the job runs
// on a machine in UTC. "he-IL" chooses the language, not the clock, so the mail
// went out saying 08:00 -- the right number for London and useless to a lawyer
// due in court. The zone has to be named, and named as the firm's rather than
// whichever one the runner happens to boot in.
const inCourtAt11 = hearing({ starts_at: "2026-09-01T08:00:00Z" });
const evening = new Date("2026-08-31T20:00:00Z");
check("a hearing keeps Israeli time on a UTC machine", whenLine(inCourtAt11, evening).includes("11:00"), true);
check("and is not reported in the runner's zone", whenLine(inCourtAt11, evening).includes("08:00"), false);

// Just past midnight in Tel Aviv is still the previous evening in UTC. Counting
// days on the runner's calendar would call tomorrow's hearing "today".
const justAfterMidnight = hearing({ starts_at: "2026-09-01T22:15:00Z" });
check(
  "days are counted on the firm's calendar",
  whenLine(justAfterMidnight, new Date("2026-09-01T20:00:00Z")).startsWith("מחר"),
  true,
);

// A questionnaire coming back outranks a date in the subject line. The date
// will still be there tomorrow; the client who finally sent their documents is
// waiting now.
const arrival = (name) => ({ id: name, client_name: name, form_name: "שאלון פתיחת תיק" });

check(
  "one arrival and nothing else names the client",
  subjectFor([], now, [arrival("שרה לוי")]),
  "שאלון חזר: שרה לוי",
);
check("several are counted", subjectFor([], now, [arrival("א"), arrival("ב")]), "2 שאלונים חזרו");
check(
  "arrivals come before dates when there are both",
  subjectFor([hearing()], now, [arrival("שרה לוי")]).startsWith("1 שאלונים חזרו"),
  true,
);
check(
  "and dates alone still read as before",
  subjectFor([hearing()], now, []),
  "דיון מחר: דיון הוכחות",
);

// The arrival is listed above the dates for the same reason.
const bothBody = bodyFor([hearing()], now, [arrival("שרה לוי")]);
check("the mail lists the arrival", bothBody.includes("שאלון חזר"), true);
check(
  "above the diary entries",
  bothBody.indexOf("שאלון חזר") < bothBody.indexOf("דיון הוכחות"),
  true,
);
// A client's name is data, and it goes into markup like any other.
check(
  "and a name is escaped there too",
  bodyFor([], now, [arrival('<b>x</b>')]).includes("&lt;b&gt;"),
  true,
);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
