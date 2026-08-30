-- Stage 4: the parties on a matter, and the timeline that runs down its middle.
--
-- Parties also close a real hole in stage 2. Until now the conflict search only
-- looked at clients, so the case it was least able to catch was the one that
-- matters most: acting against someone the firm already opposes, or has acted
-- for. Opposing parties live here, so the search reads them from now on.

create type public.party_side as enum ('client', 'opposing', 'other');

create table public.matter_parties (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  matter_id   uuid not null references public.matters (id) on delete cascade,
  side        public.party_side not null,
  name        text not null check (length(btrim(name)) between 1 and 200),
  national_id text,
  notes       text,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now()
);

alter table public.matter_parties
  add column national_id_digits text
  generated always as (nullif(regexp_replace(coalesce(national_id, ''), '\D', '', 'g'), '')) stored;

create index matter_parties_matter_idx on public.matter_parties (matter_id);
create index matter_parties_search_idx on public.matter_parties (org_id, national_id_digits)
  where national_id_digits is not null;

-- One feed per matter. Everything that happens lands here, whatever produced
-- it, so the screen reads as a story rather than as five separate lists.
create type public.activity_kind as enum (
  'matter_opened', 'note', 'status_changed', 'party_added', 'document', 'charge', 'event'
);

create table public.matter_activity (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id) on delete cascade,
  matter_id      uuid not null references public.matters (id) on delete cascade,
  kind           public.activity_kind not null,
  actor_user_id  uuid references auth.users (id),
  body           text,
  -- Where the entry came from, for the rows that stand for something else.
  ref_table      text,
  ref_id         uuid,
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

create index matter_activity_feed_idx
  on public.matter_activity (matter_id, occurred_at desc);

-- ---------------------------------------------------------------- rls

alter table public.matter_parties  enable row level security;
alter table public.matter_activity enable row level security;

create policy matter_parties_read on public.matter_parties
  for select to authenticated
  using (public.is_org_member(org_id));

create policy matter_parties_insert on public.matter_parties
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy matter_parties_update on public.matter_parties
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy matter_activity_read on public.matter_activity
  for select to authenticated
  using (public.is_org_member(org_id));

-- Interns write notes. Reading a file and recording what you found is the job.
create policy matter_activity_insert on public.matter_activity
  for insert to authenticated
  with check (public.is_org_member(org_id) and actor_user_id = auth.uid());

-- No update or delete policy anywhere: the timeline is a record of what
-- happened, and a record that can be rewritten is not one.

-- ---------------------------------------------------------------- triggers

-- A matter's own opening is the first thing on its timeline, so the feed is
-- never empty and always starts at the beginning.
create or replace function public.log_matter_opened()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.matter_activity (org_id, matter_id, kind, actor_user_id, occurred_at)
  values (new.org_id, new.id, 'matter_opened', new.created_by, new.opened_at);
  return new;
end;
$$;

create trigger log_opened after insert on public.matters
  for each row execute function public.log_matter_opened();

create or replace function public.log_matter_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    insert into public.matter_activity (org_id, matter_id, kind, actor_user_id, body)
    values (new.org_id, new.id, 'status_changed', auth.uid(),
            old.status::text || ' → ' || new.status::text);
  end if;
  return new;
end;
$$;

create trigger log_status_change after update on public.matters
  for each row execute function public.log_matter_status_change();

create or replace function public.log_party_added()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.matter_activity
    (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
  values
    (new.org_id, new.matter_id, 'party_added', new.created_by, new.name,
     'matter_parties', new.id);
  return new;
end;
$$;

create trigger log_added after insert on public.matter_parties
  for each row execute function public.log_party_added();

create trigger audit after insert or update or delete on public.matter_parties
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------- conflicts

-- Return shape changes, so this replaces rather than amends the stage 2
-- version. Same contract otherwise: match once, record what was matched, return
-- exactly that.
drop function if exists public.run_conflict_check(text, text);

create function public.run_conflict_check(p_name text, p_national_id text)
returns table (
  match_id     uuid,
  match_name   text,
  national_id  text,
  matched_on   text,
  source       text,
  matter_ref   integer,
  matter_name  text
)
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

  with hits as (
    select c.id, c.name, c.national_id,
           case when digits is not null and c.national_id_digits = digits
                then 'national_id' else 'name' end as matched_on,
           'client'::text as source,
           null::integer  as matter_ref,
           null::text     as matter_name
    from public.clients c
    where c.deleted_at is null
      and ((digits is not null and c.national_id_digits = digits)
        or (trimmed is not null and c.name ilike '%' || trimmed || '%'))

    union all

    -- The half that was missing: someone the firm already acts against.
    select p.id, p.name, p.national_id,
           case when digits is not null and p.national_id_digits = digits
                then 'national_id' else 'name' end,
           'party_' || p.side::text,
           m.ref_no,
           m.name
    from public.matter_parties p
    join public.matters m on m.id = p.matter_id and m.deleted_at is null
    where ((digits is not null and p.national_id_digits = digits)
        or (trimmed is not null and p.name ilike '%' || trimmed || '%'))
  )
  select coalesce(jsonb_agg(to_jsonb(hits)), '[]'::jsonb) into found from hits;

  insert into public.conflict_checks
    (org_id, performed_by, query_name, query_national_id, hit_count, results)
  values
    (caller_org, auth.uid(), trimmed, digits, jsonb_array_length(found), found);

  return query
  select (h ->> 'id')::uuid, h ->> 'name', h ->> 'national_id', h ->> 'matched_on',
         h ->> 'source', (h ->> 'matter_ref')::integer, h ->> 'matter_name'
  from jsonb_array_elements(found) h;
end;
$$;

revoke all on function public.run_conflict_check(text, text) from public;
grant execute on function public.run_conflict_check(text, text) to authenticated;

-- ---------------------------------------------------------------- privileges

grant select, insert, update on public.matter_parties  to authenticated;
grant select, insert         on public.matter_activity to authenticated;
