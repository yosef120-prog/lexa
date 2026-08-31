-- Making the questionnaire actually the firm's.
--
-- The builder could add a question and remove one, and nothing else. A lawyer
-- could not fix a typo, reorder anything, or change the wording after seeing
-- how a client read it — which means the questionnaire was mine and not
-- theirs, and a questionnaire a firm cannot shape is one they will not use.
--
-- Two capabilities come across from the questionnaire this replaces, and both
-- matter more in a law office than in most forms.

-- A question that appears only when an earlier answer calls for it.
--
-- "Is there a pending proceeding?" → "In which court?" is the shape of half
-- the questions a lawyer asks. Without this the client reads a page of
-- questions that mostly do not apply to them, which is how a form gets
-- abandoned halfway.
--
-- One level deep, deliberately: a question depends on one parent and nothing
-- more. Chains of conditions are a thing to debug rather than a thing to fill
-- in, and the original made the same call.
alter table public.intake_questions
  add column depends_on_question_id uuid references public.intake_questions (id) on delete set null,
  add column depends_on_value text;

-- A declaration the client is asked to accept — a consent to representation, a
-- privacy notice, an acknowledgement about fees. The body is the text they are
-- agreeing to, so it lives with the question rather than in a help line.
alter type public.intake_question_type add value if not exists 'consent';

alter table public.intake_questions
  add column body text;

-- Reordering swaps two positions, and a unique constraint checked per row
-- refuses the first half of the swap. Deferring it to the end of the
-- transaction lets the pair move together, which is the only way to reorder
-- without inventing a temporary position nobody wants to see.
alter table public.intake_questions
  drop constraint intake_questions_form_id_position_key,
  add constraint intake_questions_form_id_position_key
    unique (form_id, position) deferrable initially deferred;

comment on column public.intake_questions.depends_on_question_id is
  'Show this only when that question was answered with depends_on_value.';
comment on column public.intake_questions.body is
  'For a consent question: the text being agreed to.';

-- The preview has to carry the new fields, or the client never sees a
-- condition the firm wrote and never reads a declaration it is asked to
-- accept. Same function, three more keys.
create or replace function public.open_intake(p_token text)
returns table (
  valid       boolean,
  reason      text,
  org_name    text,
  client_name text,
  form_name   text,
  intro       text,
  questions   jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  intake public.client_intakes;
begin
  select * into intake from public.client_intakes where token = p_token;

  if intake.id is null then
    return query select false, 'NOT_FOUND', null::text, null::text, null::text, null::text, null::jsonb;
    return;
  end if;
  if intake.revoked_at is not null then
    return query select false, 'REVOKED', null::text, null::text, null::text, null::text, null::jsonb;
    return;
  end if;
  if intake.submitted_at is not null then
    return query select false, 'ALREADY_SUBMITTED', null::text, null::text, null::text, null::text, null::jsonb;
    return;
  end if;
  if intake.expires_at <= now() then
    return query select false, 'EXPIRED', null::text, null::text, null::text, null::text, null::jsonb;
    return;
  end if;

  if intake.opened_at is null then
    update public.client_intakes
    set opened_at = now(), status = 'opened'
    where id = intake.id;
  end if;

  return query
  select
    true,
    null::text,
    (select o.name from public.organizations o where o.id = intake.org_id),
    (select c.name from public.clients c where c.id = intake.client_id),
    f.name,
    f.intro,
    coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'id', q.id, 'type', q.type, 'label', q.label,
           'help', q.help, 'body', q.body,
           'required', q.required, 'options', q.options,
           'depends_on_question_id', q.depends_on_question_id,
           'depends_on_value', q.depends_on_value
         ) order by q.position
       )
       from public.intake_questions q where q.form_id = f.id),
      '[]'::jsonb
    )
  from public.intake_forms f
  where f.id = intake.form_id;
end;
$$;

revoke all on function public.open_intake(text) from public;
grant execute on function public.open_intake(text) to anon, authenticated;
