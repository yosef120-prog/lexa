/**
 * The daily reminder mail.
 *
 * Runs on a schedule, finds diary entries whose warning window has opened and
 * that have not been mailed, sends one digest, and marks them sent.
 *
 * It goes to one address — the one that owns the Resend account. That is not a
 * design choice, it is Resend's rule for anyone sending without a verified
 * domain, and the mail says so in its own footer rather than letting the reader
 * assume their colleagues got a copy too. Connecting a domain is what turns
 * this into the feature the brief actually describes; nothing else here changes
 * when that happens.
 *
 * No dependencies on purpose: fetch is built in, and a scheduled job that
 * installs a tree of packages to send one email is a job that breaks on a
 * Tuesday for reasons unrelated to email.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const TO = process.env.REMINDER_RECIPIENT;

// Resend's shared sender. Only reaches the account owner, which is exactly the
// arrangement this script is built for.
const FROM = "LEXA <onboarding@resend.dev>";

/**
 * The firm's clock, which is not the runner's.
 *
 * This job runs on a machine in UTC. A hearing entered at 11:00 in Tel Aviv is
 * stored as 08:00Z, and "he-IL" chooses the language, not the timezone — so
 * the first mail this script ever sent announced a hearing at 08:00. The right
 * number for London, and useless to a lawyer due in court at eleven.
 *
 * Every date this file turns into words goes through here. When LEXA has firms
 * outside Israel, this becomes a column on the organisation; until then it is
 * one constant, named, rather than an accident of where the job happens to run.
 */
const ZONE = process.env.REMINDER_TIMEZONE || "Asia/Jerusalem";

/**
 * Which day an instant falls on, counted in the firm's zone.
 *
 * "Tomorrow" is a calendar question, so it cannot be answered by subtracting
 * hours: a hearing at 00:15 in Tel Aviv is the previous evening in UTC, and a
 * runner counting its own days would call it today.
 */
function dayNumber(date) {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return Math.round(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

const KIND_LABEL = {
  hearing: "דיון",
  deadline: "מועד אחרון",
  meeting: "פגישה",
  other: "אחר",
};

function required(name, value) {
  if (!value) {
    console.error(`Missing ${name}. Add it under Settings → Secrets and variables → Actions.`);
    process.exit(1);
  }
  return value;
}

async function db(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    // The body carries the reason; the status alone never has.
    throw new Error(`${path} → ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * How a date reads in the mail.
 *
 * An all-day deadline is a day and is written as one. A hearing is a moment,
 * and the time is the part somebody acts on, so it is not dropped.
 */
export function whenLine(event, now = new Date()) {
  const start = new Date(event.starts_at);
  const date = start.toLocaleDateString("he-IL", {
    timeZone: ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const days = dayNumber(start) - dayNumber(now);
  const near = days === 0 ? "היום" : days === 1 ? "מחר" : `בעוד ${days} ימים`;

  if (event.all_day) return `${near} · ${date}`;
  const time = start.toLocaleTimeString("he-IL", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${near} · ${date} · ${time}`;
}

/** Soonest first: the mail is read from the top and rarely to the bottom. */
export function order(events) {
  return [...events].sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}

/**
 * The subject line, which carries whatever is most worth acting on.
 *
 * A questionnaire coming back outranks a date: the date will still be there
 * tomorrow, and the client who finally sent their documents is waiting.
 */
export function subjectFor(events, now = new Date(), arrivals = []) {
  if (arrivals.length > 0 && events.length === 0) {
    return arrivals.length === 1
      ? `שאלון חזר: ${arrivals[0].client_name}`
      : `${arrivals.length} שאלונים חזרו`;
  }
  if (arrivals.length > 0) {
    return `${arrivals.length} שאלונים חזרו · ${events.length} מועדים לפניך`;
  }

  const soonest = order(events)[0];
  const days = dayNumber(new Date(soonest.starts_at)) - dayNumber(now);
  const when = days <= 0 ? "היום" : days === 1 ? "מחר" : `בעוד ${days} ימים`;

  // The subject line is what gets read on a lock screen, so it carries the
  // thing itself rather than the word "reminder".
  return events.length === 1
    ? `${KIND_LABEL[soonest.kind] ?? "מועד"} ${when}: ${soonest.title}`
    : `${events.length} מועדים לפניך · הקרוב ${when}`;
}

const escape = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function bodyFor(events, now = new Date(), arrivals = []) {
  const arrivalRows = arrivals
    .map(
      (a) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #ddd8cb">
          <div style="font-size:12px;color:#0e6e6e">שאלון חזר</div>
          <div style="font-size:16px;font-weight:700;color:#15222a">${escape(a.client_name)}</div>
          <div style="font-size:13px;color:#4a5d68">${escape(a.form_name ?? "")}</div>
        </td>
      </tr>`,
    )
    .join("");

  const rows = order(events)
    .map((e) => {
      const bits = [whenLine(e, now), e.location, e.matter ? `תיק #${e.matter.ref_no} ${e.matter.name}` : null]
        .filter(Boolean)
        .map(escape)
        .join(" · ");
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #ddd8cb">
          <div style="font-size:12px;color:#74838c">${escape(KIND_LABEL[e.kind] ?? "מועד")}</div>
          <div style="font-size:16px;font-weight:700;color:#15222a">${escape(e.title)}</div>
          <div style="font-size:13px;color:#4a5d68">${bits}</div>
        </td>
      </tr>`;
    })
    .join("");

  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;background:#f3f1ea;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #ddd8cb;border-radius:8px;padding:24px">
    <div style="font-size:18px;font-weight:700;color:#0e6e6e;letter-spacing:.5px">LEXA</div>
    <p style="font-size:14px;color:#4a5d68;margin:4px 0 16px">מה מחכה לך</p>
    <table style="width:100%;border-collapse:collapse">${arrivalRows}${rows}</table>
    <p style="font-size:12px;color:#74838c;margin-top:20px;line-height:1.6">
      התזכורת נשלחת רק לכתובת שבבעלות חשבון השליחה, כל עוד לא חובר דומיין למשרד.
      שאר אנשי המשרד רואים את המועדים האלה בראש המסך בתוכנה.
    </p>
  </div>
</div>`;
}

async function main() {
  required("SUPABASE_URL", SUPABASE_URL);
  required("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  required("REMINDER_RECIPIENT", TO);

  const now = new Date().toISOString();
  const query = new URLSearchParams({
    select: "id,kind,title,location,starts_at,all_day,matter:matters(ref_no,name)",
    deleted_at: "is.null",
    reminded_at: "is.null",
    remind_at: `lte.${now}`,
    starts_at: `gte.${now}`,
    order: "starts_at.asc",
    limit: "50",
  });

  const due = await db(`events?${query}`);

  // Questionnaires that came back and have not been mailed about. A separate
  // question from whether the firm has looked at them: reviewed_at belongs to
  // the app, notified_at to this job, and letting either write the other's
  // column is how a client's documents go unmentioned in a busy week.
  const arrivalQuery = new URLSearchParams({
    select: "id,submitted_at,client:clients(name),form:intake_forms(name)",
    status: "eq.submitted",
    notified_at: "is.null",
    order: "submitted_at.asc",
    limit: "50",
  });
  const arrivedRaw = await db(`client_intakes?${arrivalQuery}`);
  const arrivals = arrivedRaw.map((a) => ({
    id: a.id,
    submitted_at: a.submitted_at,
    client_name: (Array.isArray(a.client) ? a.client[0] : a.client)?.name ?? "לקוח",
    form_name: (Array.isArray(a.form) ? a.form[0] : a.form)?.name ?? null,
  }));

  if (due.length === 0 && arrivals.length === 0) {
    console.log("Nothing due and nothing arrived. No mail sent.");
    return;
  }

  const events = due.map((e) => ({ ...e, matter: Array.isArray(e.matter) ? e.matter[0] : e.matter }));
  console.log(
    `${events.length} due: ${events.map((e) => e.title).join(", ") || "-"}; ` +
      `${arrivals.length} arrived: ${arrivals.map((a) => a.client_name).join(", ") || "-"}`,
  );

  if (!RESEND_KEY) {
    // Useful on its own: it proves the query half works before any key exists.
    console.log("No RESEND_API_KEY — dry run, nothing sent and nothing marked.");
    console.log(`Subject would be: ${subjectFor(events, new Date(), arrivals)}`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      subject: subjectFor(events, new Date(), arrivals),
      html: bodyFor(events, new Date(), arrivals),
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend → ${res.status}: ${await res.text()}`);
  }

  // Marked only after the send succeeded. The other order loses a reminder
  // permanently the first time Resend has a bad minute, and a hearing warned
  // about zero times is the failure that matters.
  const stamp = new Date().toISOString();

  if (events.length > 0) {
    await db(`events?id=in.(${events.map((e) => e.id).join(",")})`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ reminded_at: stamp }),
    });
  }

  if (arrivals.length > 0) {
    await db(`client_intakes?id=in.(${arrivals.map((a) => a.id).join(",")})`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ notified_at: stamp }),
    });
  }

  console.log(
    `Sent to ${TO}; marked ${events.length} reminded and ${arrivals.length} notified.`,
  );
}

// Imported by the tests for the pure parts; run only when invoked directly.
if (process.argv[1]?.endsWith("send-reminders.mjs")) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
