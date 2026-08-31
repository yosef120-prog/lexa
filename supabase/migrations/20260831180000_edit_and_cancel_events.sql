-- Cancelling a diary entry, and keeping the reason on the matter's timeline.
--
-- Hearings move. A date typed wrong is worse than no date at all, because the
-- diary is trusted, so both correcting one and cancelling one have to be
-- possible from the screen — until now neither was.
--
-- Editing needs nothing new: the existing update policy already allows it.
-- Cancelling does, for the reason this schema has hit twice already. A plain
-- `update ... set deleted_at = now()` succeeds, but PostgREST asks for the row
-- back by default, and the select policy filters on `deleted_at is null` — so
-- the row vanishes from the response and the client cannot tell a successful
-- cancellation from a refused one. A definer function returns nothing and says
-- plainly which of the two happened.

create or replace function public.cancel_event(p_event_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = p_event_id and deleted_at is null;
  if ev.id is null then
    raise exception 'NOT_FOUND';
  end if;

  -- The same three roles that may keep the diary may correct it. A secretary
  -- who can enter a hearing and not remove one they mistyped is a secretary
  -- who keeps a second diary on paper.
  if not public.has_org_role(ev.org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  update public.events set deleted_at = now() where id = p_event_id;

  -- A hearing that disappears without trace is the thing a lawyer cannot have.
  -- The entry leaves the diary; the fact that it was cancelled, by whom, and
  -- why, stays on the matter where anyone looking will find it.
  if ev.matter_id is not null then
    insert into public.matter_activity
      (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
    values (
      ev.org_id, ev.matter_id, 'event', auth.uid(),
      'בוטל: ' || ev.title || ' · ' || to_char(ev.starts_at, 'DD/MM/YYYY') ||
        coalesce(' · ' || nullif(btrim(p_reason), ''), ''),
      'events', ev.id
    );
  end if;
end;
$$;

revoke all on function public.cancel_event(uuid, text) from public;
grant execute on function public.cancel_event(uuid, text) to authenticated;

-- Moving a hearing is not the same as entering one, and the timeline should be
-- able to say which happened. The insert logger fires only on insert, so this
-- covers the other half.
create or replace function public.log_event_moved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only a change of date is worth a line. Fixing a typo in a title is not an
  -- event in the life of the matter, and a timeline that records every
  -- keystroke is one nobody reads.
  if new.matter_id is null or new.starts_at = old.starts_at or new.deleted_at is not null then
    return new;
  end if;

  insert into public.matter_activity
    (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
  values (
    new.org_id, new.matter_id, 'event', auth.uid(),
    new.title || ' · נדחה מ־' || to_char(old.starts_at, 'DD/MM/YYYY') ||
      ' ל־' || to_char(new.starts_at, 'DD/MM/YYYY'),
    'events', new.id
  );
  return new;
end;
$$;

create trigger log_moved after update on public.events
  for each row execute function public.log_event_moved();

-- A hearing that moves takes its warning with it.
--
-- The reminder default fires on insert only, so until now moving a hearing left
-- remind_at pinned to the date it used to have. Push a hearing from the 3rd to
-- the 20th and the warning was already open and stayed open, for seventeen
-- days, about a date that had not arrived -- which is how a banner teaches
-- people to ignore it.
--
-- The lead time is preserved rather than reset to 24 hours: someone who asked
-- to be warned two days before a hearing still wants two days when it moves.
create or replace function public.keep_reminder_with_event()
returns trigger
language plpgsql
as $$
begin
  if new.starts_at = old.starts_at then
    return new;
  end if;

  -- Untouched by this statement, so it is ours to move. A caller setting
  -- remind_at explicitly in the same update is saying something deliberate,
  -- and that wins.
  if new.remind_at is not distinct from old.remind_at then
    new.remind_at := case
      when old.remind_at is null then null
      else new.starts_at - (old.starts_at - old.remind_at)
    end;
  end if;

  return new;
end;
$$;

create trigger move_reminder before update on public.events
  for each row execute function public.keep_reminder_with_event();
