-- Stage 7: the fee agreement, the timer, and the lines it produces.
--
-- The brief is specific about the timer: one per user at a time, held on the
-- server, surviving a browser refresh. All three are properties of where the
-- state lives, so it lives in a table with the user as its primary key rather
-- than in a tab that can be closed.

create type public.fee_kind as enum ('hourly', 'fixed', 'retainer');

create table public.fee_agreements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  -- One agreement per matter. A second would leave every rate lookup ambiguous.
  matter_id       uuid not null unique references public.matters (id) on delete cascade,

  kind            public.fee_kind not null,
  currency        text not null default 'ILS',
  hourly_rate     numeric(12, 2) check (hourly_rate >= 0),
  fixed_amount    numeric(12, 2) check (fixed_amount >= 0),
  -- Percentage of a transaction, which is how most Israeli property work is
  -- priced. Kept alongside fixed_amount because a deal is often one or the
  -- other and the firm should not have to fake an amount to record a percentage.
  percent         numeric(5, 2) check (percent >= 0 and percent <= 100),
  retainer_amount numeric(12, 2) check (retainer_amount >= 0),

  notes           text,
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- An hourly agreement without a rate cannot price anything, so it is refused
  -- here rather than discovered when the first invoice comes out wrong.
  constraint fee_hourly_needs_rate
    check (kind <> 'hourly' or hourly_rate is not null)
);

create table public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  matter_id   uuid not null references public.matters (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete restrict,

  started_at  timestamptz not null,
  ended_at    timestamptz,
  minutes     integer not null check (minutes > 0),
  description text,

  billable    boolean not null default true,
  -- The rate as it stood when the work was done. Reading it live would silently
  -- reprice last year's hours the day the firm raises its fees.
  rate        numeric(12, 2),

  -- Null until the line goes onto a payment demand. This is how "what has not
  -- been billed yet" is answered.
  invoice_id  uuid,

  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index time_entries_matter_idx on public.time_entries (matter_id)
  where deleted_at is null;
create index time_entries_unbilled_idx on public.time_entries (org_id, matter_id)
  where deleted_at is null and invoice_id is null and billable;

-- One row per user, enforced by the primary key rather than by a check the
-- application has to remember to make.
create table public.active_timers (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  org_id     uuid not null references public.organizations (id) on delete cascade,
  matter_id  uuid not null references public.matters (id) on delete cascade,
  started_at timestamptz not null default now(),
  note       text
);

-- ---------------------------------------------------------------- rls

alter table public.fee_agreements enable row level security;
alter table public.time_entries   enable row level security;
alter table public.active_timers  enable row level security;

-- Money is for the people who deal with money. An intern records time but does
-- not see what the firm charges for it.
create policy fee_agreements_read on public.fee_agreements
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]));

create policy fee_agreements_write on public.fee_agreements
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]));

create policy fee_agreements_update on public.fee_agreements
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]));

-- Everyone reads the firm's time: a partner has to see what the team booked,
-- and hiding colleagues' entries would make a payment demand impossible to check.
create policy time_entries_read on public.time_entries
  for select to authenticated
  using (deleted_at is null and public.is_org_member(org_id));

-- But time is recorded in your own name only.
create policy time_entries_insert on public.time_entries
  for insert to authenticated
  with check (public.is_org_member(org_id) and user_id = auth.uid());

-- And edited only while it is still unbilled: a line already on a payment
-- demand has left the building.
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (
    invoice_id is null
    and (user_id = auth.uid()
         or public.has_org_role(org_id, array['owner']::public.org_role[]))
  )
  with check (
    user_id = auth.uid()
    or public.has_org_role(org_id, array['owner']::public.org_role[])
  );

create policy active_timers_own on public.active_timers
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_org_member(org_id));

create trigger audit after insert or update or delete on public.fee_agreements
  for each row execute function public.write_audit();
create trigger audit after insert or update or delete on public.time_entries
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------- the timer

create or replace function public.start_timer(p_matter_id uuid, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_org uuid;
  begun   timestamptz;
begin
  select org_id into row_org
  from public.matters
  where id = p_matter_id and deleted_at is null;

  if row_org is null then
    raise exception 'MATTER_NOT_FOUND';
  end if;
  if not public.is_org_member(row_org) then
    raise exception 'FORBIDDEN';
  end if;
  if exists (select 1 from public.active_timers where user_id = auth.uid()) then
    raise exception 'TIMER_ALREADY_RUNNING';
  end if;

  insert into public.active_timers (user_id, org_id, matter_id, note)
  values (auth.uid(), row_org, p_matter_id, p_note)
  returning started_at into begun;

  return begun;
end;
$$;

/**
 * Stops the running timer and turns it into a line.
 *
 * The rate is copied from the agreement as it stands right now, not referenced,
 * so raising the firm's fees never reprices work already done.
 */
create or replace function public.stop_timer(p_description text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t          public.active_timers;
  elapsed    integer;
  live_rate  numeric(12, 2);
  entry_id   uuid;
begin
  select * into t from public.active_timers where user_id = auth.uid();
  if t.user_id is null then
    raise exception 'NO_TIMER_RUNNING';
  end if;

  -- Rounded up, so a four minute call is a minute of work rather than nothing.
  elapsed := greatest(1, ceil(extract(epoch from (now() - t.started_at)) / 60.0)::integer);

  select f.hourly_rate into live_rate
  from public.fee_agreements f
  where f.matter_id = t.matter_id and f.kind = 'hourly';

  insert into public.time_entries
    (org_id, matter_id, user_id, started_at, ended_at, minutes, description, rate)
  values
    (t.org_id, t.matter_id, t.user_id, t.started_at, now(), elapsed,
     coalesce(nullif(btrim(coalesce(p_description, '')), ''), t.note), live_rate)
  returning id into entry_id;

  insert into public.matter_activity
    (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
  values
    (t.org_id, t.matter_id, 'charge', t.user_id,
     elapsed || ' דקות' ||
       coalesce(' · ' || nullif(btrim(coalesce(p_description, '')), ''), ''),
     'time_entries', entry_id);

  delete from public.active_timers where user_id = auth.uid();
  return entry_id;
end;
$$;

/** Abandons the running timer without recording anything. */
create or replace function public.cancel_timer()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.active_timers where user_id = auth.uid();
end;
$$;

revoke all on function public.start_timer(uuid, text) from public;
revoke all on function public.stop_timer(text)        from public;
revoke all on function public.cancel_timer()          from public;

grant execute on function public.start_timer(uuid, text) to authenticated;
grant execute on function public.stop_timer(text)        to authenticated;
grant execute on function public.cancel_timer()          to authenticated;

grant select, insert, update on public.fee_agreements to authenticated;
grant select, insert, update on public.time_entries   to authenticated;
grant select, insert, delete on public.active_timers  to authenticated;
