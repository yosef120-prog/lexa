-- Reordering questions was refused as if it were a permission problem.
--
-- The browser wrote a new order with an upsert of {id, position} pairs. An
-- upsert is an insert, so row level security judged it as one — against a
-- proposed row whose org_id is null, which belongs to no firm and is refused.
-- The message the firm saw was "אין לך הרשאה לבצע את הפעולה הזו", which is
-- true of the row PostgREST described and false of the thing being attempted.
--
-- It had been there since reordering existed and was rarely reached, because
-- only a condition needing its parent moved above it went through that path.
-- Teaching the arrows to move a parent together with its children put every
-- press through it, and a latent bug became the one you hit first.
--
-- An order is not an insert. It is a renumbering of rows that already exist,
-- and this says so.

/**
 * Writes a whole form's order in one call.
 *
 * Every id must already belong to this form, and all of them must be listed.
 * Renumbering a subset would leave the rest holding positions that collide
 * with the new ones, and naming somebody else's id is how a firm would
 * renumber another firm's questionnaire.
 *
 * Negative first, then flipped, so no two rows hold the same position even
 * momentarily — the constraint is deferred, but a half-applied order is not
 * something to leave lying around inside a transaction that might do more.
 */
create or replace function public.set_question_order(p_form_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_org uuid;
begin
  select org_id into row_org from public.intake_forms where id = p_form_id;
  if row_org is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_org_role(
       row_org, array['owner', 'lawyer', 'secretary']::public.org_role[]
     ) then
    raise exception 'FORBIDDEN';
  end if;

  if (select count(*) from public.intake_questions where form_id = p_form_id)
     <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'INCOMPLETE_ORDER';
  end if;

  if exists (
    select 1
    from unnest(p_ids) as given(id)
    left join public.intake_questions q
      on q.id = given.id and q.form_id = p_form_id
    where q.id is null
  ) then
    raise exception 'NOT_FOUND';
  end if;

  update public.intake_questions t
  set position = -given.n
  from (select id, ordinality as n from unnest(p_ids) with ordinality as u(id, ordinality)) given
  where t.id = given.id;

  update public.intake_questions
  set position = -position
  where form_id = p_form_id and position < 0;
end;
$$;

revoke all on function public.set_question_order(uuid, uuid[]) from public;
grant execute on function public.set_question_order(uuid, uuid[]) to authenticated;

/**
 * Tidying holds the flag itself.
 *
 * It moves every row to a negative position and then flips it back, and the
 * halfway state is never in order — so the trigger fired on it, decided the
 * form needed tidying, and renumbered from the negative positions. Whatever
 * order was being written was overwritten by an ordering derived from
 * scratch values.
 *
 * The flag was already the answer for the trigger calling itself. It is the
 * same answer here: anything that rearranges positions on purpose says so, and
 * the trigger stays out of the way until it is finished.
 */
create or replace function public.tidy_question_order(p_form_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  was text := coalesce(current_setting('lexa.tidying', true), '');
begin
  perform set_config('lexa.tidying', 'on', true);

  with ordered as (
    select q.id,
           row_number() over (
             order by
               coalesce(p.position, q.position),
               (q.depends_on_question_id is not null),
               q.position
           ) as n
    from public.intake_questions q
    left join public.intake_questions p
      on p.id = q.depends_on_question_id and p.form_id = q.form_id
    where q.form_id = p_form_id
  )
  update public.intake_questions t
  set position = -o.n
  from ordered o
  where t.id = o.id;

  update public.intake_questions
  set position = -position
  where form_id = p_form_id and position < 0;

  perform set_config('lexa.tidying', was, true);
end;
$$;

create or replace function public.set_question_order(p_form_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  row_org uuid;
begin
  select org_id into row_org from public.intake_forms where id = p_form_id;
  if row_org is null then
    raise exception 'NOT_FOUND';
  end if;

  if not public.has_org_role(
       row_org, array['owner', 'lawyer', 'secretary']::public.org_role[]
     ) then
    raise exception 'FORBIDDEN';
  end if;

  if (select count(*) from public.intake_questions where form_id = p_form_id)
     <> coalesce(array_length(p_ids, 1), 0) then
    raise exception 'INCOMPLETE_ORDER';
  end if;

  if exists (
    select 1
    from unnest(p_ids) as given(id)
    left join public.intake_questions q
      on q.id = given.id and q.form_id = p_form_id
    where q.id is null
  ) then
    raise exception 'NOT_FOUND';
  end if;

  -- Held across both halves, or the trigger renumbers from the negative
  -- positions in between and the order asked for is lost.
  perform set_config('lexa.tidying', 'on', true);

  update public.intake_questions t
  set position = -given.n
  from (select id, ordinality as n from unnest(p_ids) with ordinality as u(id, ordinality)) given
  where t.id = given.id;

  update public.intake_questions
  set position = -position
  where form_id = p_form_id and position < 0;

  perform set_config('lexa.tidying', 'off', true);

  -- And then the invariant, once, over the order that was asked for: a
  -- dependent question still ends up beneath the one it hangs off.
  if not public.questions_are_tidy(p_form_id) then
    perform public.tidy_question_order(p_form_id);
  end if;
end;
$$;

revoke all on function public.set_question_order(uuid, uuid[]) from public;
grant execute on function public.set_question_order(uuid, uuid[]) to authenticated;
