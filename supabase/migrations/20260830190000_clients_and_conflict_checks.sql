-- Stage 2: the client card, and the conflict-of-interest search.
--
-- Israeli identifiers come in two flavours and people type them inconsistently
-- -- 03-1234567, 031234567, sometimes with a stray space. Matching has to
-- ignore that, so a normalised copy is stored alongside what was typed and the
-- search compares digits to digits.

create type public.client_kind as enum ('individual', 'company');

create table public.clients (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  kind         public.client_kind not null default 'individual',
  name         text not null check (length(btrim(name)) between 1 and 200),
  -- Israeli ת.ז. or ח.פ., as typed. Nullable: a client can be opened before the
  -- number is known, and refusing to save until it is would push people back to
  -- their own notes.
  national_id  text,
  phone        text,
  email        text,
  notes        text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

-- Digits only, for matching. Generated so it can never drift from national_id.
alter table public.clients
  add column national_id_digits text
  generated always as (nullif(regexp_replace(coalesce(national_id, ''), '\D', '', 'g'), '')) stored;

create index clients_org_idx on public.clients (org_id) where deleted_at is null;
create index clients_national_id_idx on public.clients (org_id, national_id_digits)
  where deleted_at is null and national_id_digits is not null;

-- Every conflict search is kept: what was asked, by whom, when, and what came
-- back. If a client ever disputes that a check was run, this is the answer --
-- which is why it is written even when the search finds nothing.
create table public.conflict_checks (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  performed_by      uuid references auth.users (id),
  query_name        text,
  query_national_id text,
  hit_count         integer not null default 0,
  results           jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

create index conflict_checks_org_time_idx on public.conflict_checks (org_id, created_at desc);

-- ---------------------------------------------------------------- rls

alter table public.clients enable row level security;
alter table public.conflict_checks enable row level security;

create policy clients_read on public.clients
  for select to authenticated
  using (deleted_at is null and public.is_org_member(org_id));

-- Interns read the firm's clients but do not open or change them.
create policy clients_write on public.clients
  for all to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy conflict_checks_read on public.conflict_checks
  for select to authenticated
  using (public.is_org_member(org_id));

-- Anyone in the firm may run a check; nobody may alter the record of one.
create policy conflict_checks_insert on public.conflict_checks
  for insert to authenticated
  with check (public.is_org_member(org_id));

create trigger audit after insert or update or delete on public.clients
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------- search

/**
 * Looks for existing clients matching a name or an identifier, records the
 * search, and returns what it found.
 *
 * Runs as the caller so RLS scopes it to their own firm -- a conflict search
 * must never reach across firms, which is exactly the kind of leak a definer
 * function would introduce here.
 *
 * This is a search aid. It cannot see parties it has no row for, and the screen
 * says so: a clean result is not a clearance.
 */
create or replace function public.run_conflict_check(p_name text, p_national_id text)
returns table (client_id uuid, client_name text, national_id text, matched_on text)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  caller_org uuid;
  digits     text := nullif(regexp_replace(coalesce(p_national_id, ''), '\D', '', 'g'), '');
  trimmed    text := nullif(btrim(coalesce(p_name, '')), '');
  found      jsonb;
begin
  select m.org_id into caller_org
  from public.org_members m
  where m.user_id = auth.uid() and m.status = 'active'
  limit 1;

  if caller_org is null then
    raise exception 'NO_ORG';
  end if;

  if trimmed is null and digits is null then
    raise exception 'NOTHING_TO_CHECK';
  end if;

  -- Matched once, into one value. What gets recorded and what gets shown are
  -- then the same thing by construction -- two similar queries would drift, and
  -- a stored record that disagrees with the answer given is worse than none.
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'client_id',   c.id,
             'client_name', c.name,
             'national_id', c.national_id,
             'matched_on',  case
                              when digits is not null and c.national_id_digits = digits
                              then 'national_id'
                              else 'name'
                            end)),
           '[]'::jsonb)
  into found
  from public.clients c
  where c.deleted_at is null
    and (
      (digits is not null and c.national_id_digits = digits)
      -- Substring rather than equality: "כהן" should surface "יוסף חיים כהן".
      or (trimmed is not null and c.name ilike '%' || trimmed || '%')
    );

  -- Written before returning, and written even when nothing matched: the value
  -- of this table is that it proves a check happened.
  insert into public.conflict_checks
    (org_id, performed_by, query_name, query_national_id, hit_count, results)
  values
    (caller_org, auth.uid(), trimmed, digits, jsonb_array_length(found), found);

  return query
  select (m ->> 'client_id')::uuid,
         m ->> 'client_name',
         m ->> 'national_id',
         m ->> 'matched_on'
  from jsonb_array_elements(found) m;
end;
$$;

revoke all on function public.run_conflict_check(text, text) from public;
grant execute on function public.run_conflict_check(text, text) to authenticated;

-- ---------------------------------------------------------------- privileges

grant select, insert, update on public.clients         to authenticated;
grant select, insert         on public.conflict_checks to authenticated;
