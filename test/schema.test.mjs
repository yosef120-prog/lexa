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

  -- Supabase grants this, and functions that deliberately run as the caller --
  -- so that RLS applies to them -- need it to call auth.uid() at all. The
  -- security definer ones never noticed, because they run as the owner.
  grant usage on schema auth to authenticated, anon;
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
    returning ref_no
  `);
  return r.rows[0].ref_no;
});
check("numbering advances within the firm", matterA2, 2);

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
  { table_name: "audit_log", privs: "SELECT" },
  { table_name: "clients", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "conflict_checks", privs: "INSERT,SELECT" },
  { table_name: "matter_activity", privs: "INSERT,SELECT" },
  { table_name: "matter_numbers", privs: "SELECT" },
  { table_name: "matter_parties", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "matters", privs: "INSERT,SELECT,UPDATE" },
  { table_name: "org_members", privs: "DELETE,INSERT,SELECT,UPDATE" },
  { table_name: "organizations", privs: "SELECT,UPDATE" },
  { table_name: "profiles", privs: "SELECT,UPDATE" },
]);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
