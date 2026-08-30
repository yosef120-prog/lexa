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
  { table_name: "org_members", privs: "DELETE,INSERT,SELECT,UPDATE" },
  { table_name: "organizations", privs: "SELECT,UPDATE" },
  { table_name: "profiles", privs: "SELECT,UPDATE" },
]);

console.log(`\n${checks - failures}/${checks} checks passed\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
