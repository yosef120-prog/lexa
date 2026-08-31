/**
 * Applies the migrations against a real Postgres (PGlite, in-process) and checks
 * that tenant isolation actually holds — not that the SQL merely parses.
 *
 * The stakes: a hole here shows one firm another firm's privileged files.
 *
 * Supabase supplies auth.uid() from the request JWT. Here it reads a GUC we set
 * per test, which is the same contract from the policies' point of view.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const SUPABASE_STUBS = `
  create schema if not exists auth;

  create table auth.users (
    id                 uuid primary key,
    email              text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );

  -- Mirrors Supabase: null when unauthenticated, else the JWT subject.
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('test.uid', true), '')::uuid;
  $$;

  create role authenticated;
  create role anon;
  -- The role the filing renderer connects as.
  create role service_role;

  -- Supabase grants this, and functions that deliberately run as the caller --
  -- so that RLS applies to them -- need it to call auth.uid() at all. The
  -- security definer ones never noticed, because they run as the owner.
  grant usage on schema auth to authenticated, anon;

  -- Enough of Supabase Storage to exercise the bucket policies. Without it the
  -- migration would have to be skipped here, which would leave the rules
  -- guarding client files as the only ones never tested.
  create schema if not exists storage;

  create table storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean default false,
    file_size_limit    bigint,
    allowed_mime_types text[]
  );

  create table storage.objects (
    id        uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name      text not null,
    owner     uuid,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;

  -- Supabase's own: the path parts excluding the file name.
  create or replace function storage.foldername(name text) returns text[]
  language plpgsql immutable as $$
  declare
    parts text[] := string_to_array(name, '/');
  begin
    return parts[1:array_length(parts, 1) - 1];
  end;
  $$;

  grant usage on schema storage to authenticated, anon;
  grant select, insert on storage.objects to authenticated;
  grant select on storage.buckets to authenticated;
`;

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

const db = new PGlite();

// PGlite dumps its whole bundle into the stack on an unhandled rejection, which
// buries the one line that matters.
process.on("unhandledRejection", (e) => {
  console.error(`\nSQL ERROR: ${e?.message ?? e}`);
  if (e?.hint) console.error(`HINT: ${e.hint}`);
  if (e?.detail) console.error(`DETAIL: ${e.detail}`);
  process.exit(1);
});

// RLS never applies to a superuser, so every tenant query below runs as
// `authenticated` — the role the Supabase client actually connects as.
async function asUser(uid, fn) {
  await db.exec(`set role authenticated; set test.uid = '${uid}';`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; set test.uid = '';`);
  }
}

const UID_A = "11111111-1111-1111-1111-111111111111";
const UID_B = "22222222-2222-2222-2222-222222222222";

console.log("\nschema · tenant isolation\n");

await db.exec(SUPABASE_STUBS);

// A real Supabase project hands anon and authenticated privileges on new tables
// before any migration runs. An earlier version of this harness started them
// empty, which made the suite pass while the real database left anon holding 12
// privileges. Start permissive, exactly as the platform does, so the migrations
// have to take the access away rather than merely never granting it.
await db.exec(`
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public
    grant select, insert, update, delete on tables to anon, authenticated;
`);

const migrationsDir = join(root, "supabase/migrations");
for (const file of (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(await readFile(join(migrationsDir, file), "utf8"));
  console.log(`  ok    ${file} applies cleanly`);
}

await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data)
  values ('${UID_A}', 'daniel@example.com', '{"full_name":"דניאל"}'::jsonb),
         ('${UID_B}', 'other@example.com',  '{"full_name":"אחר"}'::jsonb);
`);

// --- the signup trigger -----------------------------------------------------
const profiles = await db.query(`select id, full_name from public.profiles order by email`);
check("signup trigger created a profile per user", profiles.rows.length, 2);
check("profile picked up full_name from metadata", profiles.rows[0].full_name, "דניאל");

// --- creating a firm --------------------------------------------------------
const orgA = await asUser(UID_A, async () => {
  const r = await db.query(`select public.create_organization('משרד דניאל') as id`);
  return r.rows[0].id;
});
const orgB = await asUser(UID_B, async () => {
  const r = await db.query(`select public.create_organization('משרד אחר') as id`);
  return r.rows[0].id;
});
check("create_organization returned two distinct firms", orgA !== orgB, true);

const ownerRow = await db.query(
  `select role::text, status::text from public.org_members where org_id = '${orgA}'`,
);
check("creator became owner, active", ownerRow.rows[0], { role: "owner", status: "active" });

// --- isolation --------------------------------------------------------------
const aSeesOrgs = await asUser(UID_A, async () =>
  (await db.query(`select id from public.organizations`)).rows.map((r) => r.id),
);
check("user A sees only their own firm", aSeesOrgs, [orgA]);

const bSeesOrgs = await asUser(UID_B, async () =>
  (await db.query(`select id from public.organizations`)).rows.map((r) => r.id),
);
check("user B sees only their own firm", bSeesOrgs, [orgB]);

const aSeesMembers = await asUser(UID_A, async () =>
  (await db.query(`select org_id from public.org_members`)).rows.map((r) => r.org_id),
);
check("membership rows are firm-scoped too", aSeesMembers, [orgA]);

// --- a stranger may not rename another firm ---------------------------------
const renamed = await asUser(UID_B, async () => {
  const r = await db.query(`update public.organizations set name = 'נחטף' where id = '${orgA}' returning id`);
  return r.rows.length;
});
check("user B cannot rename user A's firm", renamed, 0);

// --- profiles: colleagues visible, strangers not ----------------------------
const aSeesProfiles = await asUser(UID_A, async () =>
  (await db.query(`select id from public.profiles`)).rows.map((r) => r.id),
);
check("user A sees only their own profile (no colleagues yet)", aSeesProfiles, [UID_A]);

// --- audit log --------------------------------------------------------------
const auditA = await asUser(UID_A, async () =>
  (await db.query(`select entity, action from public.audit_log order by id`)).rows,
);
check("owner sees their firm's audit trail", auditA.length > 0, true);
// Regression: organizations rows key the tenant by id, not org_id. Before the
// fallback in write_audit(), this row was written with a null org_id and no
// policy could ever match it — firm-level changes vanished from the trail.
check("firm creation itself was audited and is visible", auditA[0], {
  entity: "organizations",
  action: "insert",
});

const auditB = await asUser(UID_B, async () =>
  (await db.query(`select id from public.audit_log where org_id = '${orgA}'`)).rows.length,
);
check("user B cannot read user A's audit trail", auditB, 0);

// The whole point of an audit log: nobody edits it, owners included.
let auditWriteBlocked = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`update public.audit_log set action = 'tampered' where org_id = '${orgA}'`);
  });
} catch {
  auditWriteBlocked = true;
}
check("audit rows cannot be edited, even by the owner", auditWriteBlocked, true);

let auditDeleteBlocked = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`delete from public.audit_log where org_id = '${orgA}'`);
  });
} catch {
  auditDeleteBlocked = true;
}
check("audit rows cannot be deleted, even by the owner", auditDeleteBlocked, true);

// --- anonymous callers ------------------------------------------------------
let anonBlocked = false;
try {
  await db.exec(`set role authenticated; set test.uid = '';`);
  await db.query(`select public.create_organization('בלי התחברות')`);
} catch (e) {
  anonBlocked = /AUTH_REQUIRED/.test(String(e.message));
} finally {
  await db.exec(`reset role; set test.uid = '';`);
}
check("create_organization refuses an unauthenticated caller", anonBlocked, true);

// --- anonymous role reaches nothing -----------------------------------------
// With auto-expose off and no grant to anon, a logged-out caller must not even
// get as far as RLS. Checked per table so a stray future grant is caught here.
for (const table of ["organizations", "org_members", "profiles", "audit_log"]) {
  let denied = false;
  try {
    await db.exec("set role anon;");
    await db.query(`select 1 from public.${table} limit 1`);
  } catch (e) {
    denied = /permission denied/i.test(String(e.message));
  } finally {
    await db.exec("reset role;");
  }
  check(`anon has no access to ${table}`, denied, true);
}

// --- clients and the conflict search ----------------------------------------
const clientA = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.clients (org_id, name, national_id, created_by)
    values ('${orgA}', 'יוסף חיים כהן', '03-1234567', '${UID_A}')
    returning id
  `);
  return r.rows[0].id;
});
check("a client can be opened", typeof clientA, "string");

await asUser(UID_B, async () => {
  await db.query(`
    insert into public.clients (org_id, name, national_id, created_by)
    values ('${orgB}', 'לקוח של משרד אחר', '031234567', '${UID_B}')
  `);
});

const bSeesClients = await asUser(UID_B, async () =>
  (await db.query(`select name from public.clients`)).rows.map((r) => r.name),
);
check("clients are firm-scoped", bSeesClients, [{ name: "לקוח של משרד אחר" }].map((r) => r.name));

// The identifier is stored as typed but matched on digits, so the hyphens a
// person happens to include must not decide whether a conflict is found.
const byId = await asUser(UID_A, async () =>
  (await db.query(`select * from public.run_conflict_check(null, '031234567')`)).rows,
);
check("an identifier matches despite different punctuation", byId.length, 1);
check("and reports why it matched", byId[0]?.matched_on, "national_id");

const byName = await asUser(UID_A, async () =>
  (await db.query(`select * from public.run_conflict_check('כהן', null)`)).rows,
);
check("a partial name matches", byName.length, 1);

// The sharpest failure this feature could have: telling a lawyer they are clear
// because the match sat in someone else's firm, or worse, showing it to them.
const across = await asUser(UID_B, async () =>
  (await db.query(`select * from public.run_conflict_check(null, '031234567')`)).rows,
);
check("a conflict search never reaches another firm", across.map((r) => r.match_name), [
  "לקוח של משרד אחר",
]);

const emptySearch = await asUser(UID_A, async () =>
  (await db.query(`select * from public.run_conflict_check('שם שאינו קיים', null)`)).rows,
);
check("a search with no match returns nothing", emptySearch.length, 0);

// A check that found nothing is the one most worth being able to prove later.
const recorded = await asUser(UID_A, async () =>
  (await db.query(`select query_name, hit_count from public.conflict_checks order by created_at`)).rows,
);
check("every search was recorded, misses included", recorded.length, 3);
check("including the one that found nothing", recorded[2], {
  query_name: "שם שאינו קיים",
  hit_count: 0,
});

const bSeesChecks = await asUser(UID_B, async () =>
  (await db.query(`select id from public.conflict_checks`)).rows.length,
);
check("conflict records are firm-scoped too", bSeesChecks, 1);

// --- matters ----------------------------------------------------------------
const matterA1 = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.matters (org_id, client_id, name, practice_area, created_by)
    values ('${orgA}', '${clientA}', 'תביעת נזיקין', 'נזיקין', '${UID_A}')
    returning id, ref_no, status::text
  `);
  return r.rows[0];
});
check("a matter opens with three fields", matterA1.status, "open");
check("the first matter in a firm is numbered 1", matterA1.ref_no, 1);

const matterA2 = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.matters (org_id, client_id, name, created_by)
    values ('${orgA}', '${clientA}', 'עסקת מכר דירה', '${UID_A}')
    returning id, ref_no
  `);
  return r.rows[0];
});
const matterA2Id = matterA2.id;
check("numbering advances within the firm", matterA2.ref_no, 2);

// Each firm counts from one, so a reference is short and never collides with
// another firm's.
const clientB = await asUser(UID_B, async () => {
  const r = await db.query(`
    insert into public.clients (org_id, name, created_by)
    values ('${orgB}', 'לקוח ב', '${UID_B}') returning id
  `);
  return r.rows[0].id;
});
const matterB1 = await asUser(UID_B, async () => {
  const r = await db.query(`
    insert into public.matters (org_id, client_id, name, created_by)
    values ('${orgB}', '${clientB}', 'תיק של משרד אחר', '${UID_B}') returning ref_no
  `);
  return r.rows[0].ref_no;
});
check("the other firm also starts at 1", matterB1, 1);

const aSeesMatters = await asUser(UID_A, async () =>
  (await db.query(`select name from public.matters order by ref_no`)).rows.map((r) => r.name),
);
check("matters are firm-scoped", aSeesMatters, ["תביעת נזיקין", "עסקת מכר דירה"]);

// A closed matter with no closing date is a state no screen should have to
// interpret, so the database refuses it.
let closedWithoutDate = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`update public.matters set status = 'closed' where id = '${matterA1.id}'`);
  });
} catch {
  closedWithoutDate = true;
}
check("a matter cannot be closed without a closing date", closedWithoutDate, true);

const closedOk = await asUser(UID_A, async () => {
  const r = await db.query(`
    update public.matters set status = 'closed', closed_at = now()
    where id = '${matterA1.id}' returning status::text
  `);
  return r.rows[0]?.status;
});
check("closing with a date is accepted", closedOk, "closed");

// --- the timeline -----------------------------------------------------------
const feedAfterOpening = await asUser(UID_A, async () =>
  (await db.query(`
    select kind::text, body from public.matter_activity
    where matter_id = '${matterA1.id}' order by occurred_at
  `)).rows,
);
check("opening a matter starts its timeline", feedAfterOpening.map((r) => r.kind), [
  "matter_opened",
  // matterA1 was closed earlier in this file, which the trigger recorded.
  "status_changed",
]);
check("the status change says what changed", feedAfterOpening[1]?.body, "open → closed");

await asUser(UID_A, async () => {
  await db.query(`
    insert into public.matter_activity (org_id, matter_id, kind, actor_user_id, body)
    values ('${orgA}', '${matterA1.id}', 'note', '${UID_A}', 'שוחחתי עם הלקוח')
  `);
});
const withNote = await asUser(UID_A, async () =>
  (await db.query(`select body from public.matter_activity where kind = 'note'`)).rows.length,
);
check("a note lands on the timeline", withNote, 1);

// A note signed with someone else's name would make the whole feed worthless.
let forgedNote = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`
      insert into public.matter_activity (org_id, matter_id, kind, actor_user_id, body)
      values ('${orgA}', '${matterA1.id}', 'note', '${UID_B}', 'לא אני כתבתי')
    `);
  });
} catch {
  forgedNote = true;
}
check("a note cannot be attributed to someone else", forgedNote, true);

// Neither a policy nor a grant allows it, so tidying history afterwards fails
// outright rather than quietly touching nothing.
let feedEditBlocked = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`update public.matter_activity set body = 'שונה' where kind = 'note'`);
  });
} catch {
  feedEditBlocked = true;
}
check("timeline entries cannot be rewritten", feedEditBlocked, true);

let feedDeleteBlocked = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`delete from public.matter_activity where kind = 'note'`);
  });
} catch {
  feedDeleteBlocked = true;
}
check("nor deleted", feedDeleteBlocked, true);

// --- parties, and the conflict search that reads them ------------------------
await asUser(UID_A, async () => {
  await db.query(`
    insert into public.matter_parties (org_id, matter_id, side, name, national_id)
    values ('${orgA}', '${matterA1.id}', 'opposing', 'רות מזרחי', '55-555-5555')
  `);
});

const partyOnFeed = await asUser(UID_A, async () =>
  (await db.query(`
    select body, actor_user_id from public.matter_activity where kind = 'party_added'
  `)).rows[0],
);
check("adding a party shows on the timeline", partyOnFeed?.body, "רות מזרחי");
// The insert above omits created_by, exactly as the app did. The column
// defaults to the caller, so the entry is still signed.
check("and is attributed without the caller saying so", partyOnFeed?.actor_user_id, UID_A);

// The case stage 2 could not catch: the firm already acts against this person.
const againstParty = await asUser(UID_A, async () =>
  (await db.query(`select * from public.run_conflict_check(null, '555555555')`)).rows,
);
check("a conflict search now finds opposing parties", againstParty.length, 1);
check("and says which side they are on", againstParty[0]?.source, "party_opposing");
check("and which matter they appear in", againstParty[0]?.matter_ref, 1);

const partiesAcrossFirms = await asUser(UID_B, async () =>
  (await db.query(`select * from public.run_conflict_check(null, '555555555')`)).rows.length,
);
check("parties stay inside their own firm", partiesAcrossFirms, 0);

// --- documents and their versions -------------------------------------------
const groupId = "aaaaaaaa-0000-0000-0000-000000000001";

const v1 = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.documents (org_id, matter_id, storage_path, filename, mime, size_bytes, version_group_id)
    values ('${orgA}', '${matterA1.id}', '${orgA}/${matterA1.id}/a1', 'חוזה מכר.pdf',
            'application/pdf', 120000, '${groupId}')
    returning version_no
  `);
  return r.rows[0].version_no;
});
check("the first upload is version 1", v1, 1);

const v2 = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.documents (org_id, matter_id, storage_path, filename, version_group_id)
    values ('${orgA}', '${matterA1.id}', '${orgA}/${matterA1.id}/a2', 'חוזה מכר.pdf', '${groupId}')
    returning version_no
  `);
  return r.rows[0].version_no;
});
check("uploading again makes version 2", v2, 2);

// The point of versions: the earlier bytes are still addressable.
const bothVersions = await asUser(UID_A, async () =>
  (await db.query(`
    select version_no, storage_path from public.documents
    where version_group_id = '${groupId}' order by version_no
  `)).rows.length,
);
check("and version 1 is still there", bothVersions, 2);

const docOnFeed = await asUser(UID_A, async () =>
  (await db.query(`
    select body from public.matter_activity where kind = 'document' order by occurred_at
  `)).rows.map((r) => r.body),
);
check("both uploads reached the timeline", docOnFeed, ["חוזה מכר.pdf", "חוזה מכר.pdf · גרסה 2"]);

check("the scan status says plainly that nothing scanned it", await asUser(UID_A, async () =>
  (await db.query(`select scan_status from public.documents limit 1`)).rows[0].scan_status,
), "not_scanned");

const bSeesDocs = await asUser(UID_B, async () =>
  (await db.query(`select id from public.documents`)).rows.length,
);
check("documents are firm-scoped", bSeesDocs, 0);

// --- the bucket itself -------------------------------------------------------
// The row is only a label; these rules are what actually stand between a firm
// and another firm's files.
const bucket = await db.query(
  `select public, file_size_limit from storage.buckets where id = 'matter-documents'`,
);
check("the bucket is private", bucket.rows[0]?.public, false);

const ownFile = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into storage.objects (bucket_id, name)
    values ('matter-documents', '${orgA}/${matterA1.id}/a3') returning id
  `);
  return r.rows.length;
});
check("a member can write into their own firm's folder", ownFile, 1);

let crossFirmWrite = false;
try {
  await asUser(UID_B, async () => {
    await db.query(`
      insert into storage.objects (bucket_id, name)
      values ('matter-documents', '${orgA}/${matterA1.id}/stolen')
    `);
  });
} catch {
  crossFirmWrite = true;
}
check("but not into another firm's", crossFirmWrite, true);

const crossFirmRead = await asUser(UID_B, async () =>
  (await db.query(`select id from storage.objects where bucket_id = 'matter-documents'`)).rows.length,
);
check("and cannot see another firm's files at all", crossFirmRead, 0);

// --- the diary ---------------------------------------------------------------
const hearing = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.events (org_id, matter_id, kind, title, starts_at)
    values ('${orgA}', '${matterA1.id}', 'hearing', 'דיון הוכחות',
            now() + interval '10 days')
    returning id, remind_at, starts_at
  `);
  return r.rows[0];
});
// Nobody entering a hearing date is thinking about when to be reminded.
const gap = new Date(hearing.starts_at) - new Date(hearing.remind_at);
check("a reminder defaults to 24 hours before", gap, 24 * 60 * 60 * 1000);

const chosenReminder = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.events (org_id, kind, title, starts_at, remind_at)
    values ('${orgA}', 'deadline', 'הגשת מס שבח',
            now() + interval '30 days', now() + interval '23 days')
    returning remind_at
  `);
  return r.rows[0].remind_at !== null;
});
check("but a chosen one is kept", chosenReminder, true);

// A firm-level entry belongs to nobody's matter, and must not need one.
const firmWide = await asUser(UID_A, async () =>
  (await db.query(`select id from public.events where matter_id is null`)).rows.length,
);
check("an event can belong to the firm rather than a matter", firmWide, 1);

const eventOnFeed = await asUser(UID_A, async () =>
  (await db.query(`select body from public.matter_activity where kind = 'event'`)).rows.length,
);
check("a matter's event reaches its timeline", eventOnFeed, 1);
check("and a firm-wide one does not land on any", await asUser(UID_A, async () =>
  (await db.query(`select count(*)::int as n from public.matter_activity where kind='event'`)).rows[0].n,
), 1);

let backwards = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`
      insert into public.events (org_id, kind, title, starts_at, ends_at)
      values ('${orgA}', 'meeting', 'פגישה', now() + interval '2 days', now() + interval '1 day')
    `);
  });
} catch {
  backwards = true;
}
check("an event cannot end before it starts", backwards, true);

const bSeesEvents = await asUser(UID_B, async () =>
  (await db.query(`select id from public.events`)).rows.length,
);
check("the diary is firm-scoped", bSeesEvents, 0);

const UID_DIARY_INTERN = "44444444-4444-4444-4444-444444444444";
await db.exec(`
  insert into auth.users (id, email) values ('${UID_DIARY_INTERN}', 'intern2@example.com');
  insert into public.org_members (org_id, user_id, role, status, joined_at)
  values ('${orgA}', '${UID_DIARY_INTERN}', 'intern', 'active', now());
`);

const internAddedEvent = await asUser(UID_DIARY_INTERN, async () => {
  try {
    const r = await db.query(`
      insert into public.events (org_id, kind, title, starts_at)
      values ('${orgA}', 'meeting', 'של מתמחה', now()) returning id
    `);
    return r.rows.length;
  } catch {
    return 0;
  }
});
check("an intern does not keep the diary", internAddedEvent, 0);

// --- fee agreements ----------------------------------------------------------
// A colleague, so the one-timer-per-user rule can be shown to be per user
// rather than per firm.
const UID_C_TIMER = "55555555-5555-5555-5555-555555555555";
await db.exec(`
  insert into auth.users (id, email) values ('${UID_C_TIMER}', 'colleague@example.com');
  insert into public.org_members (org_id, user_id, role, status, joined_at)
  values ('${orgA}', '${UID_C_TIMER}', 'intern', 'active', now());
`);

// An hourly agreement with no rate cannot price anything, so it is refused at
// the door rather than found when the first invoice comes out wrong.
let hourlyWithoutRate = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`
      insert into public.fee_agreements (org_id, matter_id, kind)
      values ('${orgA}', '${matterA2Id}', 'hourly')
    `);
  });
} catch {
  hourlyWithoutRate = true;
}
check("an hourly agreement must carry a rate", hourlyWithoutRate, true);

await asUser(UID_A, async () => {
  await db.query(`
    insert into public.fee_agreements (org_id, matter_id, kind, hourly_rate)
    values ('${orgA}', '${matterA2Id}', 'hourly', 600)
  `);
});

// Daniel's own arrangement: a percentage of the deal, with no hourly rate to
// invent.
await asUser(UID_A, async () => {
  await db.query(`
    insert into public.fee_agreements (org_id, matter_id, kind, percent)
    values ('${orgA}', '${matterA1.id}', 'fixed', 1.5)
  `);
});
check("a percentage agreement needs no hourly rate", await asUser(UID_A, async () =>
  (await db.query(`select percent from public.fee_agreements where matter_id='${matterA1.id}'`)).rows[0].percent,
), "1.50");

let secondAgreement = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`
      insert into public.fee_agreements (org_id, matter_id, kind, hourly_rate)
      values ('${orgA}', '${matterA2Id}', 'hourly', 900)
    `);
  });
} catch {
  secondAgreement = true;
}
check("a matter cannot carry two agreements", secondAgreement, true);

// --- the timer ---------------------------------------------------------------
await asUser(UID_A, async () => {
  await db.query(`select public.start_timer('${matterA2Id}', 'ניסוח')`);
});

const running = await asUser(UID_A, async () =>
  (await db.query(`select matter_id from public.active_timers`)).rows.length,
);
check("a timer runs on the server, not in the page", running, 1);

// The brief is explicit about this one.
let secondTimer = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`select public.start_timer('${matterA1.id}')`);
  });
} catch (e) {
  secondTimer = /TIMER_ALREADY_RUNNING/.test(String(e.message));
}
check("a user may only run one timer at a time", secondTimer, true);

// Two people working at once is normal; the constraint is per person.
const internTimer = await asUser(UID_C_TIMER, async () => {
  await db.query(`select public.start_timer('${matterA2Id}')`);
  return (await db.query(`select user_id from public.active_timers`)).rows.length;
});
check("but a colleague can run their own", internTimer, 1);

const entryId = await asUser(UID_A, async () => {
  const r = await db.query(`select public.stop_timer('ניסוח כתב הגנה') as id`);
  return r.rows[0].id;
});

const entry = await asUser(UID_A, async () =>
  (await db.query(`
    select minutes, description, rate::text, invoice_id
    from public.time_entries where id = '${entryId}'
  `)).rows[0],
);
check("stopping it leaves a billable line", entry?.description, "ניסוח כתב הגנה");
// Rounded up, so a four minute call is a minute of work rather than nothing.
check("with at least one minute on it", entry.minutes >= 1, true);
// Copied, not referenced: raising the firm's fees must not reprice old work.
check("and the rate as it stood at the time", entry.rate, "600.00");
check("not yet billed", entry.invoice_id, null);

const timerCleared = await asUser(UID_A, async () =>
  (await db.query(`select user_id from public.active_timers`)).rows.length,
);
check("and the timer is no longer running", timerCleared, 0);

let stopWithoutStart = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`select public.stop_timer('כלום')`);
  });
} catch (e) {
  stopWithoutStart = /NO_TIMER_RUNNING/.test(String(e.message));
}
check("stopping nothing says so", stopWithoutStart, true);

const chargeOnFeed = await asUser(UID_A, async () =>
  (await db.query(`select body from public.matter_activity where kind = 'charge'`)).rows.length,
);
check("the work reached the matter's timeline", chargeOnFeed, 1);

// --- who may see and touch the money ----------------------------------------
const internSeesFees = await asUser(UID_C_TIMER, async () =>
  (await db.query(`select id from public.fee_agreements`)).rows.length,
);
check("an intern records time but does not see the firm's rates", internSeesFees, 0);

let timeForSomeoneElse = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`
      insert into public.time_entries (org_id, matter_id, user_id, started_at, minutes)
      values ('${orgA}', '${matterA2Id}', '${UID_C_TIMER}', now(), 30)
    `);
  });
} catch {
  timeForSomeoneElse = true;
}
check("time is booked in your own name only", timeForSomeoneElse, true);

// A line on a payment demand has left the building.
await db.exec(`update public.time_entries set invoice_id = gen_random_uuid() where id = '${entryId}'`);
const editedBilled = await asUser(UID_A, async () => {
  const r = await db.query(
    `update public.time_entries set minutes = 999 where id = '${entryId}' returning id`,
  );
  return r.rows.length;
});
check("a billed line can no longer be edited", editedBilled, 0);

// --- filing bundles ----------------------------------------------------------
const bundle = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.filing_bundles (org_id, matter_id, title, main_document_id)
    values ('${orgA}', '${matterA1.id}', 'כתב תביעה',
            (select id from public.documents where version_no = 2 limit 1))
    returning id, status::text
  `);
  return r.rows[0];
});
check("a bundle starts as a draft", bundle.status, "draft");

await asUser(UID_A, async () => {
  await db.query(`
    insert into public.filing_bundle_items (org_id, bundle_id, document_id, position)
    values ('${orgA}', '${bundle.id}',
            (select id from public.documents where version_no = 1 limit 1), 1)
  `);
});

// The same exhibit twice is a mistake every time.
let duplicateExhibit = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`
      insert into public.filing_bundle_items (org_id, bundle_id, document_id, position)
      values ('${orgA}', '${bundle.id}',
              (select id from public.documents where version_no = 1 limit 1), 2)
    `);
  });
} catch {
  duplicateExhibit = true;
}
check("the same document cannot be filed twice in one bundle", duplicateExhibit, true);

// Two appendices cannot both be נספח א׳.
let duplicatePosition = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`
      insert into public.filing_bundle_items (org_id, bundle_id, document_id, position)
      values ('${orgA}', '${bundle.id}',
              (select id from public.documents where version_no = 2 limit 1), 1)
    `);
  });
} catch {
  duplicatePosition = true;
}
check("nor can two appendices share a position", duplicatePosition, true);

// A bundle claiming to be ready must have something to hand over.
let readyWithoutFile = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`update public.filing_bundles set status = 'ready' where id = '${bundle.id}'`);
  });
} catch {
  readyWithoutFile = true;
}
check("a bundle cannot be ready without a produced file", readyWithoutFile, true);

let submittedWithoutDate = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`update public.filing_bundles set status = 'submitted' where id = '${bundle.id}'`);
  });
} catch {
  submittedWithoutDate = true;
}
check("nor submitted without saying when", submittedWithoutDate, true);

await asUser(UID_A, async () => {
  await db.query(`
    update public.filing_bundles
    set status = 'submitted', submitted_at = now(), submitted_note = 'אישור נט 12345'
    where id = '${bundle.id}'
  `);
});
const filingOnFeed = await asUser(UID_A, async () =>
  (await db.query(`select body from public.matter_activity where body like 'הוגש:%'`)).rows[0]?.body,
);
check("filing it by hand reaches the timeline", filingOnFeed, "הוגש: כתב תביעה · אישור נט 12345");

const bSeesBundles = await asUser(UID_B, async () =>
  (await db.query(`select id from public.filing_bundles`)).rows.length,
);
check("bundles are firm-scoped", bSeesBundles, 0);

// --- search ------------------------------------------------------------------
const searchAs = (uid, q) =>
  asUser(uid, async () =>
    (await db.query(`select kind, title, ref_no from public.search_firm('${q}')`)).rows,
  );

// A lawyer typing a name does not know which table it lives in.
check("a matter is found by name", (await searchAs(UID_A, "עסקת")).map((r) => r.kind), ["matter"]);
check("a client is found by name", (await searchAs(UID_A, "שרה")).map((r) => r.title), []);
check("a client is found by their own name", (await searchAs(UID_A, "יוסף")).some((r) => r.kind === "client"), true);

// The exact identifier is the surest match there is, so it comes first.
const searchById = await searchAs(UID_A, "03-1234567");
check("an identifier finds the client despite punctuation", searchById[0]?.kind, "client");

// How a firm finds the file someone appears in without being the client.
const asParty = await searchAs(UID_A, "רות");
check("an opposing party is found", asParty[0]?.kind, "party");
check("and points at the matter they appear in", asParty[0]?.ref_no, 1);

// The firm's own reference, which is what people say out loud.
check("a matter is found by its number", (await searchAs(UID_A, "2")).some((r) => r.kind === "matter"), true);

// The whole point of running as the caller rather than as definer.
check("search never crosses into another firm", (await searchAs(UID_B, "עסקת")).length, 0);
// Firm B holds a client with the same identifier. Finding their own is correct;
// what matters is that firm A's client with that number stays invisible.
check("an identifier finds only your own firm's match",
  (await searchAs(UID_B, "03-1234567")).map((r) => r.title), ["לקוח של משרד אחר"]);

// An empty query must return nothing rather than everything.
check("an empty search returns nothing", (await searchAs(UID_A, "   ")).length, 0);

// --- tasks -------------------------------------------------------------------
const taskId = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.tasks (org_id, matter_id, title, assignee_user_id, due_date)
    values ('${orgA}', '${matterA1.id}', 'להגיש בקשה לארכה', '${UID_C_TIMER}', current_date + 3)
    returning id, status::text
  `);
  return r.rows[0];
});
check("a task starts open", taskId.status, "open");

const taskOnFeed = await asUser(UID_A, async () =>
  (await db.query(`select body from public.matter_activity where body like 'משימה:%'`)).rows[0]?.body,
);
check("a matter's task reaches its timeline", /להגיש בקשה לארכה/.test(taskOnFeed ?? ""), true);

// A firm-level task belongs to nobody's file and must not need one.
const firmTask = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.tasks (org_id, title) values ('${orgA}', 'לחדש ביטוח משרד') returning id
  `);
  return r.rows.length;
});
check("a task can belong to the firm rather than a matter", firmTask, 1);

// A finished task must say when, so no screen has to interpret the gap.
let doneWithoutDate = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`update public.tasks set status = 'done' where id = '${taskId.id}'`);
  });
} catch {
  doneWithoutDate = true;
}
check("a task cannot be done without a completion time", doneWithoutDate, true);

// Being asked to do something and being unable to mark it done is what sends
// people back to a paper list.
const internFinished = await asUser(UID_C_TIMER, async () => {
  const r = await db.query(`
    update public.tasks set status = 'done', completed_at = now(), completed_by = '${UID_C_TIMER}'
    where id = '${taskId.id}' returning id
  `);
  return r.rows.length;
});
check("an intern can finish a task assigned to them", internFinished, 1);

const internCreated = await asUser(UID_C_TIMER, async () => {
  try {
    const r = await db.query(`
      insert into public.tasks (org_id, title) values ('${orgA}', 'של מתמחה') returning id
    `);
    return r.rows.length;
  } catch {
    return 0;
  }
});
check("but cannot create one", internCreated, 0);

const bSeesTasks = await asUser(UID_B, async () =>
  (await db.query(`select id from public.tasks`)).rows.length,
);
check("tasks are firm-scoped", bSeesTasks, 0);

// --- invitations -------------------------------------------------------------
const UID_INVITEE = "66666666-6666-6666-6666-666666666666";
const UID_STRANGER = "77777777-7777-7777-7777-777777777777";
await db.exec(`
  insert into auth.users (id, email) values
    ('${UID_INVITEE}', 'secretary@example.com'),
    ('${UID_STRANGER}', 'stranger@example.com');
`);

const inviteToken = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.org_invitations (org_id, email, role)
    values ('${orgA}', 'secretary@example.com', 'secretary')
    returning token
  `);
  return r.rows[0].token;
});
// This string is the only thing between a forwarded message and a seat inside
// a law firm, so it has to be long.
check("the token is long enough to be unguessable", inviteToken.length >= 64, true);

// Only an owner decides who joins.
let internInvited = false;
try {
  await asUser(UID_C_TIMER, async () => {
    await db.query(`
      insert into public.org_invitations (org_id, email, role)
      values ('${orgA}', 'someone@example.com', 'lawyer')
    `);
  });
} catch {
  internInvited = true;
}
check("only an owner can invite", internInvited, true);

// A link that reaches the wrong inbox must be worth nothing.
let wrongAccount = false;
try {
  await asUser(UID_STRANGER, async () => {
    await db.query(`select public.accept_invitation('${inviteToken}')`);
  });
} catch (e) {
  wrongAccount = /INVITE_WRONG_ACCOUNT/.test(String(e.message));
}
check("an invitation cannot be used from another account", wrongAccount, true);

const joinedOrg = await asUser(UID_INVITEE, async () => {
  const r = await db.query(`select public.accept_invitation('${inviteToken}') as org`);
  return r.rows[0].org;
});
check("the invited address joins the firm", joinedOrg, orgA);

const newRole = await db.query(
  `select role::text from public.org_members where user_id = '${UID_INVITEE}'`,
);
check("with the role they were offered", newRole.rows[0]?.role, "secretary");

// A used link must not work twice, or a forwarded message is a second seat.
let reused = false;
try {
  await asUser(UID_INVITEE, async () => {
    await db.query(`select public.accept_invitation('${inviteToken}')`);
  });
} catch (e) {
  reused = /INVITE_ALREADY_USED/.test(String(e.message));
}
check("and cannot be used a second time", reused, true);

// Enough to tell someone whether the link is for them, and nothing that helps
// a stranger who found it.
const peek = await asUser(UID_STRANGER, async () =>
  (await db.query(`select * from public.peek_invitation('${inviteToken}')`)).rows[0],
);
check("a spent invitation previews as invalid", peek?.valid, false);
check("and says why", peek?.reason, "INVITE_ALREADY_USED");

const expiredToken = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.org_invitations (org_id, email, role, expires_at)
    values ('${orgA}', 'late@example.com', 'lawyer', now() - interval '1 day')
    returning token
  `);
  return r.rows[0].token;
});
const expiredPeek = await asUser(UID_STRANGER, async () =>
  (await db.query(`select * from public.peek_invitation('${expiredToken}')`)).rows[0],
);
check("an expired invitation says so rather than failing silently", expiredPeek?.reason, "INVITE_EXPIRED");

// Colleagues can now see each other, which the profiles policy promised.
const inviteeSeesColleagues = await asUser(UID_INVITEE, async () =>
  (await db.query(`select id from public.profiles`)).rows.length,
);
check("a new member can see their colleagues' names", inviteeSeesColleagues > 1, true);

const bSeesInvites = await asUser(UID_B, async () =>
  (await db.query(`select id from public.org_invitations`)).rows.length,
);
check("invitations are firm-scoped", bSeesInvites, 0);

// --- payment demands ---------------------------------------------------------
// Two hours at 600, recorded by hand so the arithmetic is checkable.
await asUser(UID_A, async () => {
  await db.query(`
    insert into public.time_entries (org_id, matter_id, user_id, started_at, minutes, description, rate)
    values ('${orgA}', '${matterA2Id}', '${UID_A}', now() - interval '2 hours', 120, 'ישיבת הכנה', 600)
  `);
});

const invoiceId = await asUser(UID_A, async () => {
  const r = await db.query(`select public.create_invoice_from_unbilled('${matterA2Id}') as id`);
  return r.rows[0].id;
});

const invoice = await asUser(UID_A, async () =>
  (await db.query(`
    select number, status::text, subtotal::text, vat::text, total::text
    from public.invoices where id = '${invoiceId}'
  `)).rows[0],
);
check("the firm's first demand is numbered 1", invoice.number, 1);
check("it starts as a draft", invoice.status, "draft");

// Tied to the lines rather than to arithmetic written here: a total that
// disagrees with what it is made of is the bug worth catching, and hard-coded
// figures only test whether the test author can multiply.
const totals = await asUser(UID_A, async () =>
  (await db.query(`
    select
      (select sum(amount) from public.invoice_lines where invoice_id = '${invoiceId}')::text as lines_sum,
      subtotal::text, vat::text, total::text,
      round(subtotal * vat_rate / 100, 2)::text as expected_vat,
      (subtotal + vat)::text                    as expected_total
    from public.invoices where id = '${invoiceId}'
  `)).rows[0],
);
check("the subtotal is exactly what the lines add up to", totals.subtotal, totals.lines_sum);
check("VAT is the stored rate applied to it", totals.vat, totals.expected_vat);
check("and the total is subtotal plus VAT", totals.total, totals.expected_total);
// Two hours at 600 is the priced work on this matter.
check("which comes to two hours at the recorded rate", totals.subtotal, "1200.00");

// Every line came from an entry, and every one of those entries is now spoken
// for. Comparing the two counts is what proves nothing was billed loose.
const claimed = await asUser(UID_A, async () =>
  (await db.query(`
    select
      (select count(*) from public.time_entries where invoice_id = '${invoiceId}')::int as entries,
      (select count(*) from public.invoice_lines where invoice_id = '${invoiceId}')::int as lines
  `)).rows[0],
);
check("every line has an entry claimed behind it", claimed.entries, claimed.lines);
check("and that is the priced work on the matter", claimed.entries, 1);

// Billing the same work twice is the failure that costs a firm a client.
let billedTwice = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`select public.create_invoice_from_unbilled('${matterA2Id}')`);
  });
} catch (e) {
  billedTwice = /NOTHING_TO_BILL/.test(String(e.message));
}
check("the same work cannot be billed twice", billedTwice, true);

// Cancelling has to release the time, or the work is lost rather than rebilled.
await asUser(UID_A, async () => {
  await db.query(`select public.cancel_invoice('${invoiceId}')`);
});
const released = await asUser(UID_A, async () =>
  (await db.query(`
    select count(*)::int as n from public.time_entries where invoice_id = '${invoiceId}'
  `)).rows[0].n,
);
check("cancelling frees the time it had claimed", released, 0);
check("and the demand says it was cancelled", await asUser(UID_A, async () =>
  (await db.query(`select status::text from public.invoices where id = '${invoiceId}'`)).rows[0].status,
), "cancelled");

// Time recorded without a rate is real work nobody can price, and guessing on
// an invoice is the wrong kind of help.
await asUser(UID_A, async () => {
  await db.query(`
    insert into public.time_entries (org_id, matter_id, user_id, started_at, minutes, description)
    values ('${orgA}', '${matterA1.id}', '${UID_A}', now(), 45, 'ללא תעריף')
  `);
});
let unpriced = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`select public.create_invoice_from_unbilled('${matterA1.id}')`);
  });
} catch (e) {
  unpriced = /NOTHING_TO_BILL/.test(String(e.message));
}
check("unpriced work is not invented into a price", unpriced, true);

const internSeesInvoices = await asUser(UID_C_TIMER, async () =>
  (await db.query(`select id from public.invoices`)).rows.length,
);
check("an intern does not see the firm's invoices", internSeesInvoices, 0);

const bSeesInvoices = await asUser(UID_B, async () =>
  (await db.query(`select id from public.invoices`)).rows.length,
);
check("invoices are firm-scoped", bSeesInvoices, 0);

// --- soft delete actually hides things ---------------------------------------
// Regression: the write policies were declared FOR ALL, which covers SELECT.
// Permissive policies OR together, so for anyone able to write, the read
// policy's `deleted_at is null` never applied and a deleted client stayed
// visible. Every earlier check passed because none of them deleted a row and
// then looked for it.
const throwaway = await asUser(UID_A, async () => {
  const r = await db.query(`
    insert into public.clients (org_id, name, created_by)
    values ('${orgA}', 'לקוח למחיקה', '${UID_A}') returning id
  `);
  return r.rows[0].id;
});

const visibleBefore = await asUser(UID_A, async () =>
  (await db.query(`select id from public.clients where id = '${throwaway}'`)).rows.length,
);
check("a new client is visible", visibleBefore, 1);

// Second half of the same bug: once the read policy really applied, a plain
// UPDATE could no longer set deleted_at, because Postgres checks that policy
// against the new row. Deletion is a named function for exactly that reason.
let plainUpdateRefused = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`update public.clients set deleted_at = now() where id = '${throwaway}'`);
  });
} catch {
  plainUpdateRefused = true;
}
check("a plain update cannot delete a client", plainUpdateRefused, true);

await asUser(UID_A, async () => {
  await db.query(`select public.soft_delete_client('${throwaway}')`);
});

const visibleAfter = await asUser(UID_A, async () =>
  (await db.query(`select id from public.clients where id = '${throwaway}'`)).rows.length,
);
check("a deleted client is hidden, even from the owner", visibleAfter, 0);

const restored = await asUser(UID_A, async () => {
  await db.query(`select public.restore_client('${throwaway}')`);
  return (await db.query(`select id from public.clients where id = '${throwaway}'`)).rows.length;
});
check("and can be restored", restored, 1);

// Losing the client behind an open matter would orphan it on screen.
let blockedByMatter = false;
try {
  await asUser(UID_A, async () => {
    await db.query(`select public.soft_delete_client('${clientA}')`);
  });
} catch (e) {
  blockedByMatter = /HAS_OPEN_MATTERS/.test(String(e.message));
}
check("a client with an open matter cannot be deleted", blockedByMatter, true);

await asUser(UID_A, async () => {
  await db.query(`select public.soft_delete_client('${throwaway}')`);
});

// --- an intern reads but does not write -------------------------------------
const UID_C = "33333333-3333-3333-3333-333333333333";
await db.exec(`
  insert into auth.users (id, email) values ('${UID_C}', 'intern@example.com');
  insert into public.org_members (org_id, user_id, role, status, joined_at)
  values ('${orgA}', '${UID_C}', 'intern', 'active', now());
`);

const internSees = await asUser(UID_C, async () =>
  (await db.query(`select id from public.matters`)).rows.length,
);
check("an intern reads the firm's matters", internSees, 2);

const internWrote = await asUser(UID_C, async () => {
  const r = await db.query(`
    update public.matters set name = 'שונה בידי מתמחה' where id = '${matterA1.id}' returning id
  `);
  return r.rows.length;
});
check("an intern cannot change a matter", internWrote, 0);

const internOpenedClient = await asUser(UID_C, async () => {
  try {
    const r = await db.query(`
      insert into public.clients (org_id, name, created_by)
      values ('${orgA}', 'לקוח של מתמחה', '${UID_C}') returning id
    `);
    return r.rows.length;
  } catch {
    return 0;
  }
});
check("an intern cannot open a client", internOpenedClient, 0);

// --- privileges are exactly the intended list -------------------------------
// Regression: the real project granted anon 12 privileges the migration had not
// asked for, because 0001 relied on a dashboard setting instead of revoking.
const anonGrants = await db.query(`
  select count(*)::int as n
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'
`);
check("anon holds no table privilege at all", anonGrants.rows[0].n, 0);

const authGrants = await db.query(`
  select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'
  group by table_name
  order by table_name
`);
check("authenticated holds exactly the granted privileges", authGrants.rows, [
  { table_name: "active_timers", privs: "DELETE,INSERT,SELECT" },
  { table_name: "audit_log", privs: "SELECT" },
  { table_name: "clients", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "conflict_checks", privs: "INSERT,SELECT" },
  { table_name: "documents", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "events", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "fee_agreements", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "filing_bundle_items", privs: "DELETE,INSERT,SELECT,UPDATE" },
  { table_name: "filing_bundles", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "invoice_lines", privs: "SELECT" },
  { table_name: "invoice_numbers", privs: "SELECT" },
  { table_name: "invoices", privs: "SELECT,UPDATE" },
  { table_name: "matter_activity", privs: "INSERT,SELECT" },
  { table_name: "matter_numbers", privs: "SELECT" },
  { table_name: "matter_parties", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "matters", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "org_invitations", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "org_members", privs: "DELETE,INSERT,SELECT,UPDATE" },
  { table_name: "organizations", privs: "SELECT,UPDATE" },
  { table_name: "profiles", privs: "SELECT,UPDATE" },
  { table_name: "tasks", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "time_entries", privs: "INSERT,SELECT,UPDATE" },
]);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
