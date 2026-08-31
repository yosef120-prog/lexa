-- One minute reads as "דקה אחת", not "1 דקות".
--
-- Hebrew takes the singular for one and drops the numeral entirely, so a timer
-- stopped after a short call was writing a line the lawyer reads as a bad
-- translation of an English string. The React screens were fixed with the
-- count() helper in src/lib/hebrew.ts; the timeline entry is built in SQL and
-- was missed.
--
-- Two upward is left alone -- "3 דקות" is how a number is read off a screen --
-- which is the same rule the helper follows.
--
-- The rest of stop_timer is unchanged; the function is restated in full because
-- that is the only way Postgres replaces a body.
--
-- Every other Hebrew body built in a trigger was checked for the same fault.
-- None of them count anything: the document feed writes an edition number
-- ("גרסה 2"), the invoice feed a formatted amount, and the rest interpolate a
-- title or a date. This was the only one.

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
     case when elapsed = 1 then 'דקה אחת' else elapsed || ' דקות' end ||
       coalesce(' · ' || nullif(btrim(coalesce(p_description, '')), ''), ''),
     'time_entries', entry_id);

  delete from public.active_timers where user_id = auth.uid();
  return entry_id;
end;
$$;

revoke all on function public.stop_timer(text) from public;
grant execute on function public.stop_timer(text) to authenticated;
