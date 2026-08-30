-- Stage 3: the matter.
--
-- The brief is firm that a matter opens in three fields. Everything else here
-- is nullable on purpose: a lawyer who has just taken a case knows the client
-- and roughly what it is, and rarely knows the court or the case number yet.
-- Demanding them at this moment is what sends people back to their own notes.

create type public.matter_status as enum ('open', 'on_hold', 'closed');

create table public.matters (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  client_id     uuid not null references public.clients (id) on delete restrict,

  -- The three fields asked for at opening.
  name          text not null check (length(btrim(name)) between 1 and 300),
  practice_area text,

  status        public.matter_status not null default 'open',

  -- Filled in later, when they exist.
  court         text,
  court_case_no text,
  lead_user_id  uuid references auth.users (id),

  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  -- A closed matter must say when. Catching the contradiction here means no
  -- screen has to decide what a closed matter with no closing date means.
  constraint matters_closed_has_date
    check ((status = 'closed') = (closed_at is not null))
);

create index matters_org_idx    on public.matters (org_id)    where deleted_at is null;
create index matters_client_idx on public.matters (client_id) where deleted_at is null;

-- A firm's own numbering, restarting at 1 per firm, so two firms never share a
-- reference and nobody has to quote a UUID down the phone.
create table public.matter_numbers (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  last   integer not null default 0
);

alter table public.matters add column ref_no integer;

create or replace function public.assign_matter_ref()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_ref integer;
begin
  insert into public.matter_numbers (org_id, last)
  values (new.org_id, 1)
  on conflict (org_id) do update set last = public.matter_numbers.last + 1
  returning last into next_ref;

  new.ref_no := next_ref;
  return new;
end;
$$;

create trigger assign_ref before insert on public.matters
  for each row execute function public.assign_matter_ref();

create unique index matters_org_ref_idx on public.matters (org_id, ref_no);

-- ---------------------------------------------------------------- rls

alter table public.matters        enable row level security;
alter table public.matter_numbers enable row level security;

create policy matters_read on public.matters
  for select to authenticated
  using (deleted_at is null and public.is_org_member(org_id));

-- Interns read but do not open or change, matching the permissions table.
create policy matters_write on public.matters
  for all to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

-- Counters are maintained by the definer trigger alone. No policy grants
-- anything, so nobody can rewind a firm's numbering.
create policy matter_numbers_read on public.matter_numbers
  for select to authenticated
  using (public.is_org_member(org_id));

create trigger audit after insert or update or delete on public.matters
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------- privileges

grant select, insert, update on public.matters        to authenticated;
grant select                 on public.matter_numbers to authenticated;
