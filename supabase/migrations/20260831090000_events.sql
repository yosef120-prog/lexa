-- Stage 6: hearings, meetings and deadlines.
--
-- The brief asks for a reminder 24 hours before. Nothing on this stack can send
-- one yet -- there is no sending domain -- so remind_at is stored and left
-- unsent rather than promised. What the app does deliver today is the thing
-- Daniel actually asked for: the dates in front of him.

create type public.event_kind as enum ('hearing', 'meeting', 'deadline', 'other');

create table public.events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  -- Nullable: a bar association meeting belongs to the firm, not to a matter.
  matter_id   uuid references public.matters (id) on delete cascade,

  kind        public.event_kind not null default 'hearing',
  title       text not null check (length(btrim(title)) between 1 and 300),
  location    text,
  notes       text,

  starts_at   timestamptz not null,
  ends_at     timestamptz,
  -- A statutory deadline is a date, not a time of day. Saying which it is here
  -- keeps every screen from having to guess.
  all_day     boolean not null default false,

  remind_at   timestamptz,
  reminded_at timestamptz,

  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create index events_org_time_idx on public.events (org_id, starts_at)
  where deleted_at is null;
create index events_matter_idx on public.events (matter_id) where deleted_at is null;
-- Supports the future sender: what is due a reminder and has not had one.
create index events_pending_reminder_idx on public.events (remind_at)
  where deleted_at is null and reminded_at is null;

-- 24 hours before, unless the caller says otherwise. A default rather than a
-- required field, because the person entering a hearing date is not thinking
-- about when to be reminded.
create or replace function public.default_event_reminder()
returns trigger
language plpgsql
as $$
begin
  if new.remind_at is null then
    new.remind_at := new.starts_at - interval '24 hours';
  end if;
  return new;
end;
$$;

create trigger set_reminder before insert on public.events
  for each row execute function public.default_event_reminder();

create or replace function public.log_event_added()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.matter_id is null then
    return new;
  end if;
  insert into public.matter_activity
    (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
  values
    (new.org_id, new.matter_id, 'event', new.created_by,
     new.title || ' · ' || to_char(new.starts_at, 'DD/MM/YYYY'),
     'events', new.id);
  return new;
end;
$$;

create trigger log_added after insert on public.events
  for each row execute function public.log_event_added();

create trigger audit after insert or update or delete on public.events
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------- rls

alter table public.events enable row level security;

create policy events_read on public.events
  for select to authenticated
  using (deleted_at is null and public.is_org_member(org_id));

-- A secretary keeping the diary is the normal case, so this is not limited to
-- lawyers. Interns are excluded, matching the permissions table.
create policy events_insert on public.events
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy events_update on public.events
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

grant select, insert, update on public.events to authenticated;
