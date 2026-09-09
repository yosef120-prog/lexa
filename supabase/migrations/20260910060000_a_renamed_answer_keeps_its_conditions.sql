-- Renaming an answer should not silently unhook the questions that depend on it.
--
-- A condition is stored as the text of the answer that turns it on:
-- depends_on_value = 'מושכרת'. Edit that option to 'מושכרת לדייר' and the
-- condition still points at the old wording, matches nothing, and the question
-- it guards is never shown to anybody again. Nothing fails, nothing is logged,
-- and the firm finds out when a tenant is never asked for a tenancy agreement.
--
-- Storing an id per option instead of the text would remove the problem at the
-- root, and would rewrite how every choice question is authored, stored and
-- answered. This does the smaller thing: follow the rename.
--
-- It only follows a rename it can be certain about. One option's text changed
-- and every other stayed put — that is a rename, and there is exactly one
-- answer it can have become. Anything else (an option added, removed, or two
-- edited at once, which is indistinguishable from a reorder) is left alone,
-- because a wrong guess here points a condition at the wrong answer and that is
-- worse than a condition that visibly points at nothing. The builder shows the
-- ones left behind.

create or replace function public.keep_conditions_with_options()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed int;
  at      int;
begin
  if new.options is not distinct from old.options
     or old.options is null or new.options is null
     or jsonb_array_length(old.options) <> jsonb_array_length(new.options) then
    return new;
  end if;

  select count(*), min(i)
    into changed, at
  from generate_series(0, jsonb_array_length(new.options) - 1) as i
  where old.options ->> i is distinct from new.options ->> i;

  -- Two changes at once could be two renames or one reorder, and those want
  -- opposite answers. Left for a person to look at.
  if changed <> 1 then
    return new;
  end if;

  update public.intake_questions
  set depends_on_value = new.options ->> at
  where depends_on_question_id = new.id
    and depends_on_value = old.options ->> at;

  return new;
end;
$$;

-- After, not before: this writes to other rows of the same table, and the
-- column it writes is not the one the trigger watches, so it cannot re-fire.
create trigger keep_conditions after update of options on public.intake_questions
  for each row execute function public.keep_conditions_with_options();
