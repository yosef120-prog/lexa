-- A dependent question belongs directly beneath the one it hangs off.
--
-- The builder draws it nested, and until now that was a drawing: the question
-- kept whatever position it was created at, which for anything written before
-- the "+ מותנית" button meant the bottom of the form. A firm looking at
-- twenty questions saw the tenancy agreement stranded after the signature,
-- indented under a question twelve rows above it.
--
-- Worse for the client, who is asked in this order and has no indentation to
-- read: the answer that decides the question comes twelve questions before it.
--
-- One level deep, which is all the editor allows, so the arrangement is simply
-- each question followed by whatever hangs off it.

/**
 * Renumbers one form so every dependent question follows its parent.
 *
 * Sorted by the parent's slot rather than its own: a child takes its parent's
 * place in the queue and sits just behind it. Children of the same parent keep
 * the order they were written in.
 *
 * A question whose parent was deleted has depends_on_question_id set to null by
 * the foreign key, so it falls back to its own position and stays where it is.
 */
create or replace function public.tidy_question_order(p_form_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Negative first. The unique constraint is deferred, but writing straight to
  -- the final numbers would still collide row by row, and negatives cannot
  -- clash with anything already in the table.
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
end;
$$;

revoke all on function public.tidy_question_order(uuid) from public;
grant execute on function public.tidy_question_order(uuid) to authenticated;

-- Every form that already exists, once. Questions written before the builder
-- placed them are sitting wherever they were added.
do $$
declare
  f uuid;
begin
  for f in select id from public.intake_forms loop
    perform public.tidy_question_order(f);
  end loop;
end;
$$;
