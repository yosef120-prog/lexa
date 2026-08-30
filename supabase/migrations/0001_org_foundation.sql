-- LEXA · Stage 1 — organizations, membership, roles, audit.
--
-- Everything else in the product hangs off this file. Two rules it establishes,
-- which every later migration must follow:
--
--   1. Every tenant-owned table carries org_id, even when it could be derived
--      through a join. Isolation is then one rule, enforced the same way
--      everywhere, and reviewable at a glance.
--   2. Deletion is a deleted_at stamp, never a DELETE.

-- gen_random_uuid() is core Postgres since 13; no pgcrypto extension needed.

-- ---------------------------------------------------------------- roles

create type public.org_role as enum ('owner', 'lawyer', 'intern', 'secretary');

create type public.member_status as enum ('invited', 'active', 'suspended');

-- ---------------------------------------------------------------- tables

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  -- Recorded per firm because a customer contract may pin it. Informational
  -- today; the Supabase project region is what actually decides where rows live.
  data_region text not null default 'eu-central-1',
  plan        text not null default 'trial',
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- One row per person per firm. Membership is a table and not a column on the
-- user, so the same lawyer can later belong to two firms without a migration.
create table public.org_members (
  org_id     uuid not null references public.organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       public.org_role not null,
  status     public.member_status not null default 'active',
  invited_by uuid references auth.users (id),
  joined_at  timestamptz,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index org_members_user_idx on public.org_members (user_id) where status = 'active';

-- Mirrors auth.users so the app can show a name without reaching into the auth
-- schema. Populated by the trigger at the bottom of this file.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only. No policy grants UPDATE or DELETE to anyone, including owners:
-- an audit trail a user can edit is not an audit trail.
create table public.audit_log (
  id         bigint generated always as identity primary key,
  org_id     uuid references public.organizations (id) on delete set null,
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_time_idx on public.audit_log (org_id, created_at desc);

-- ---------------------------------------------------------------- helpers

-- The single isolation predicate. Every tenant table's policy calls this, so
-- there is exactly one definition of "may see this firm" to audit.
--
-- SECURITY DEFINER with a pinned search_path: without it, reading org_members
-- from inside an org_members policy recurses.
create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.has_org_role(target_org uuid, allowed public.org_role[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = target_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any (allowed)
  );
$$;

-- ---------------------------------------------------------------- RLS

alter table public.organizations enable row level security;
alter table public.org_members  enable row level security;
alter table public.profiles     enable row level security;
alter table public.audit_log    enable row level security;

create policy organizations_read on public.organizations
  for select to authenticated
  using (deleted_at is null and public.is_org_member(id));

create policy organizations_owner_update on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner']::public.org_role[]))
  with check (public.has_org_role(id, array['owner']::public.org_role[]));

create policy org_members_read on public.org_members
  for select to authenticated
  using (public.is_org_member(org_id));

create policy org_members_owner_write on public.org_members
  for all to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Colleagues need each other's names for assignee pickers and the timeline.
create policy profiles_read_colleagues on public.profiles
  for select to authenticated
  using (exists (
    select 1
    from public.org_members mine
    join public.org_members theirs on theirs.org_id = mine.org_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = public.profiles.id
      and theirs.status = 'active'
  ));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Read-only, and only for owners. Writes arrive through the trigger below,
-- which runs as definer and bypasses RLS.
create policy audit_log_owner_read on public.audit_log
  for select to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]));

-- Absent an UPDATE policy the write is already a silent no-op, but Supabase
-- grants these privileges to its roles by default and silence is a poor way to
-- state an intention this important. Revoking makes tampering an outright error.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke insert, update, delete on public.audit_log from %I', r);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- triggers

-- Attach to any tenant table with:
--   create trigger audit after insert or update or delete on public.<table>
--     for each row execute function public.write_audit();
-- Keeping it generic means a new table gets an audit trail for one line.
create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_org uuid;
  old_j   jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  new_j   jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
begin
  -- Tenant tables carry org_id. The organizations table itself does not: a firm
  -- row is its own tenant, keyed by id. Without this fallback its audit rows land
  -- with a null org_id, which no read policy matches -- so renaming a firm would
  -- vanish from the trail silently.
  row_org := coalesce(
    (new_j ->> 'org_id')::uuid,
    (old_j ->> 'org_id')::uuid,
    case
      when tg_table_name = 'organizations'
      then coalesce((new_j ->> 'id')::uuid, (old_j ->> 'id')::uuid)
    end
  );

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after)
  values (
    row_org,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(new_j ->> 'id', old_j ->> 'id'),
    old_j,
    new_j
  );

  return coalesce(new, old);
end;
$$;

create trigger audit after insert or update or delete on public.organizations
  for each row execute function public.write_audit();

create trigger audit after insert or update or delete on public.org_members
  for each row execute function public.write_audit();

-- Every signup gets a profile row, so the app never has to handle its absence.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- signup

-- Creating a firm and becoming its owner is one indivisible step. Done from the
-- client as two statements, a failure between them would leave an orphan firm
-- that RLS then hides from everyone -- including the person who just made it.
create or replace function public.create_organization(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_org uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if org_name is null or length(btrim(org_name)) = 0 then
    raise exception 'ORG_NAME_REQUIRED';
  end if;

  insert into public.organizations (name)
  values (btrim(org_name))
  returning id into new_org;

  insert into public.org_members (org_id, user_id, role, status, joined_at)
  values (new_org, auth.uid(), 'owner', 'active', now());

  return new_org;
end;
$$;

revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

-- ---------------------------------------------------------------- privileges

-- The project is created with "Automatically expose new tables" turned off, so
-- nothing is reachable through the Data API until this file says so. RLS then
-- decides which rows. Two layers, both explicit.
--
-- anon is granted nothing at all: every table here is behind a login.
--
-- Forgetting a grant breaks a feature loudly. Forgetting a revoke leaks data
-- silently. So the default is nothing, and additions are listed one by one.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;

    -- Renaming the firm is an owner action; the policy above enforces that.
    grant select, update                 on public.organizations to authenticated;
    grant select, insert, update, delete on public.org_members   to authenticated;
    grant select, update                 on public.profiles      to authenticated;
    -- Read only. Inserts arrive via the definer trigger, which needs no grant.
    grant select                         on public.audit_log     to authenticated;
  end if;
end;
$$;
