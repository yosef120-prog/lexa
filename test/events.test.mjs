/**
 * The date maths around the diary, in isolation.
 *
 * These are pure functions, so they need no database — but they decide whether
 * a deadline lands on the right day in someone's calendar, which is exactly the
 * kind of thing that is wrong for months before anyone notices.
 */
import { googleCalendarUrl, daysAway, relativeWhen } from "../src/lib/calendar-format.ts";

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++;
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

console.log("\ndiary · dates\n");

function paramOf(url, key) {
  return new URL(url).searchParams.get(key);
}

// Midnight local on the 3rd. In Israel that is 21:00 UTC on the 2nd, so reading
// the date in UTC would file the deadline a day early — which is the bug this
// exists to prevent.
const localMidnight = new Date(2026, 8, 3, 0, 0, 0);
const allDay = {
  id: "1",
  kind: "deadline",
  title: "הגשת מס שבח",
  location: null,
  starts_at: localMidnight.toISOString(),
  ends_at: null,
  all_day: true,
  matter: null,
};
check("an all-day deadline keeps its local date", paramOf(googleCalendarUrl(allDay), "dates").split("/")[0], "20260903");

// A hearing is a moment, so it travels as UTC and Google converts it back.
const at9 = new Date(2026, 8, 3, 9, 0, 0);
const timed = { ...allDay, kind: "hearing", title: "דיון", all_day: false, starts_at: at9.toISOString() };
const timedStamp = paramOf(googleCalendarUrl(timed), "dates").split("/")[0];
check("a timed event is sent as an instant", /^\d{8}T\d{6}Z$/.test(timedStamp), true);
check("and round-trips to the same moment", new Date(
  `${timedStamp.slice(0,4)}-${timedStamp.slice(4,6)}-${timedStamp.slice(6,8)}T${timedStamp.slice(9,11)}:${timedStamp.slice(11,13)}:00Z`
).getTime(), at9.getTime());

// The matter reference travels with the title so the entry is recognisable
// among a hundred others in a personal calendar.
const withMatter = { ...timed, matter: { id: "m", ref_no: 7, name: "מכירת דירה" } };
check("the matter number rides along in the title", paramOf(googleCalendarUrl(withMatter), "text"), "דיון · תיק #7");

// --- relative wording --------------------------------------------------------
const day = 86_400_000;
check("today is today", relativeWhen(new Date().toISOString()), "היום");
check("tomorrow is tomorrow", relativeWhen(new Date(Date.now() + day).toISOString()), "מחר");
check("yesterday reads as past", relativeWhen(new Date(Date.now() - day).toISOString()), "היה אתמול");

// Compared by calendar day, not by elapsed hours: 23:00 tonight and 01:00
// tomorrow are two hours apart and belong to different days.
const lateTonight = new Date(); lateTonight.setHours(23, 0, 0, 0);
const earlyTomorrow = new Date(Date.now() + day); earlyTomorrow.setHours(1, 0, 0, 0);
check("late tonight is still today", daysAway(lateTonight.toISOString()), 0);
check("early tomorrow is already tomorrow", daysAway(earlyTomorrow.toISOString()), 1);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
