-- Tasks with an owner and a date, from section 4 of the brief.
--
-- A task differs from a diary entry in what it asks of you: an event happens at
-- a time whether or not anyone acts, a task waits until someone does something.
-- That is why it carries an assignee and a completion, and the diary does not.

create type public.task_status as enum ('open', 'done', 'cancelled');

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  -- Nullable: "renew the office insurance" belongs to the firm, not a file.
  matter_id        uuid references public.matters (id) on delete cascade,

  title            text not null check (length(btrim(title)) between 1 and 300),
  notes            text,
  assignee_user_id uuid references public.profiles (id) on delete set null,
  due_date         date,

  status           public.task_status not null default 'open',
  completed_at     timestamptz,
  completed_by     uuid references public.profiles (id) on delete set null,

  created_by       uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- A finished task must say when it finished, so no screen has to decide what
  -- a done task with no date means.
  constraint tasks_done_has_date
    check ((status = 'done') = (completed_at is not null))
);

create index tasks_org_open_idx on public.tasks (org_id, due_date)
  where status = 'open';
create index tasks_matter_idx on public.tasks (matter_id) where status = 'open';
create index tasks_assignee_idx on public.tasks (assignee_user_id) where status = 'open';

-- ---------------------------------------------------------------- rls

alter table public.tasks enable row level security;

create policy tasks_read on public.tasks
  for select to authenticated
  using (public.is_org_member(org_id));

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

-- An intern cannot create a task but can finish one given to them. Being asked
-- to do something and being unable to mark it done is the kind of gap that
-- sends people back to a paper list.
create policy tasks_update on public.tasks
  for update to authenticated
  using (
    assignee_user_id = auth.uid()
    or public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[])
  )
  with check (
    assignee_user_id = auth.uid()
    or public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[])
  );

create trigger audit after insert or update or delete on public.tasks
  for each row execute function public.write_audit();

-- A task on a matter belongs on its timeline, like everything else that
-- happens to it.
create or replace function public.log_task_added()
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
    (new.org_id, new.matter_id, 'note', new.created_by,
     'משימה: ' || new.title ||
       coalesce(' · עד ' || to_char(new.due_date, 'DD/MM/YYYY'), ''),
     'tasks', new.id);
  return new;
end;
$$;

create trigger log_added after insert on public.tasks
  for each row execute function public.log_task_added();

grant select, insert, update on public.tasks to authenticated;
