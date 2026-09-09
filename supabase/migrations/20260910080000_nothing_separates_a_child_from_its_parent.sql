-- A dependent question cannot be separated from the one it hangs off.
--
-- The arrows were taught to move a parent with its children, which closed the
-- way it happened in practice. It was not the only way. Changing a question's
-- condition to point at an earlier question left it where it was; a direct
-- write left it wherever it was put; and deleting the parent quietly turned a
-- question meant for tenants into one every client is asked.
--
-- So the rule moves to where nothing can go around it. The screen can still be
-- wrong about what it draws; the order underneath it cannot.

/**
 * Whether a form is already arranged with every child behind its parent.
 *
 * The same ordering tidy_question_order produces, compared against the one
 * stored. Asking this first is what stops the trigger below from working on
 * every write, and what makes it terminate: after a tidy the answer is yes.
 */
create or replace function public.questions_are_tidy(p_form_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
    from (
      select q.position,
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
    ) x
    where x.position <> x.n
  );
$$;

/**
 * Puts the order back after anything that disturbed it.
 *
 * A statement trigger rather than a row one: a reorder writes every row of the
 * form, and tidying once at the end is both cheaper and the only point at which
 * the arrangement is meaningful — halfway through a reorder it never is.
 *
 * It must not re-enter, and "the second pass will find it tidy" is not enough:
 * tidying moves every row to a negative position before flipping it back, and
 * that halfway state is never tidy, so the trigger called itself until the
 * error stack gave out. A flag held for the length of the transaction is what
 * actually stops it.
 */
create or replace function public.keep_questions_tidy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  f uuid;
begin
  if coalesce(current_setting('lexa.tidying', true), '') = 'on' then
    return null;
  end if;

  perform set_config('lexa.tidying', 'on', true);
  for f in select distinct form_id from touched loop
    if not public.questions_are_tidy(f) then
      perform public.tidy_question_order(f);
    end if;
  end loop;
  perform set_config('lexa.tidying', 'off', true);

  return null;
end;
$$;

create trigger tidy_after_insert
  after insert on public.intake_questions
  referencing new table as touched
  for each statement execute function public.keep_questions_tidy();

create trigger tidy_after_update
  after update on public.intake_questions
  referencing new table as touched
  for each statement execute function public.keep_questions_tidy();

/**
 * Removing a question that others hang off.
 *
 * The foreign key says `on delete set null`, which quietly promotes every
 * question that depended on it: one written for tenants becomes one every
 * client is asked, and nothing says so. Deleting them instead would throw away
 * work the firm may not mean to lose.
 *
 * So it is refused, and the firm decides. The same shape as refusing to delete
 * a client with an open matter.
 */
create or replace function public.no_orphaned_conditions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.intake_questions
    where depends_on_question_id = old.id
  ) then
    raise exception 'HAS_DEPENDENT_QUESTIONS';
  end if;
  return old;
end;
$$;

create trigger refuse_if_depended_on
  before delete on public.intake_questions
  for each row execute function public.no_orphaned_conditions();

revoke all on function public.questions_are_tidy(uuid) from public;
grant execute on function public.questions_are_tidy(uuid) to authenticated;
