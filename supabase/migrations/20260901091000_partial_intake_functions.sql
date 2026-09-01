-- The three functions that make a half-finished questionnaire work.
--
-- Separate from the migration that added the enum value: Postgres refuses to
-- use a value in the same transaction that added it, and all three name
-- 'partial'.

/**
 * A token is good while anything is still expected of it.
 *
 * The addition is 'partial'. Without it the storage policy would refuse the
 * upload of the very document the client came back to send.
 */
create or replace function public.intake_is_open(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.client_intakes
    where token = p_token
      and status in ('sent', 'opened', 'partial')
      and expires_at > now()
  );
$$;

-- Dropped rather than replaced: the return type gains a column, and
-- `create or replace` refuses to change one. Every caller is in this
-- repository, so there is no window where something is calling the old shape.
drop function if exists public.open_intake(text);

/**
 * What the link shows, which now depends on what is left.
 *
 * On a first visit: everything. On a return after some documents were marked
 * as still coming: only those. A client who comes back holding one piece of
 * paper should not be asked their address again.
 */
create or replace function public.open_intake(p_token text)
returns table (
  valid       boolean,
  reason      text,
  org_name    text,
  client_name text,
  form_name   text,
  intro       text,
  questions   jsonb,
  is_return   boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  intake public.client_intakes;
  again  boolean;
begin
  select * into intake from public.client_intakes where token = p_token;

  if intake.id is null then
    return query select false, 'NOT_FOUND', null::text, null::text, null::text, null::text, null::jsonb, false;
    return;
  end if;
  if intake.revoked_at is not null then
    return query select false, 'REVOKED', null::text, null::text, null::text, null::text, null::jsonb, false;
    return;
  end if;
  if intake.status = 'submitted' then
    return query select false, 'ALREADY_SUBMITTED', null::text, null::text, null::text, null::text, null::jsonb, false;
    return;
  end if;
  if intake.expires_at <= now() then
    return query select false, 'EXPIRED', null::text, null::text, null::text, null::text, null::jsonb, false;
    return;
  end if;

  again := intake.status = 'partial';

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
       from public.intake_questions q
       where q.form_id = f.id
         and (
           not again
           or exists (
             select 1 from public.intake_answers a
             where a.intake_id = intake.id
               and a.question_id = q.id
               and a.status = 'later'
           )
         )
      ),
      '[]'::jsonb
    ),
    again
  from public.intake_forms f
  where f.id = intake.form_id;
end;
$$;

/**
 * Recording what came in, and deciding whether anything is still owed.
 *
 * The form closes only when no document is left marked "later". Until then it
 * stays open on the same token, so the client returns to the link they already
 * have rather than waiting for the firm to notice and issue another.
 *
 * A second submission merges into the first. Answers already given are not
 * revisited, because the client was not shown them.
 */
create or replace function public.submit_intake(p_token text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  intake  public.client_intakes;
  item    jsonb;
  qid     uuid;
  qtype   public.intake_question_type;
  astatus public.answer_status;
  f       jsonb;
  signed  boolean := false;
  owed    integer;
  headers json;
begin
  select * into intake from public.client_intakes where token = p_token for update;

  if intake.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if intake.revoked_at is not null then
    raise exception 'REVOKED';
  end if;
  if intake.status = 'submitted' then
    raise exception 'ALREADY_SUBMITTED';
  end if;
  if intake.expires_at <= now() then
    raise exception 'EXPIRED';
  end if;

  for item in select * from jsonb_array_elements(p_answers)
  loop
    qid := (item ->> 'question_id')::uuid;

    select type into qtype
    from public.intake_questions
    where id = qid and form_id = intake.form_id;

    if qtype is null then
      raise exception 'UNKNOWN_QUESTION';
    end if;

    if qtype = 'signature' then
      signed := true;
    end if;

    astatus := case
      when qtype <> 'file' then null
      when item ->> 'status' in ('later', 'not_applicable') then (item ->> 'status')::public.answer_status
      else 'provided'
    end;

    insert into public.intake_answers
      (org_id, intake_id, question_id, value_text, value_number, value_date, value_json, status)
    values (
      intake.org_id, intake.id, qid,
      nullif(btrim(coalesce(item ->> 'text', '')), ''),
      case when item ->> 'number' is null then null else (item ->> 'number')::numeric end,
      case when item ->> 'date'   is null then null else (item ->> 'date')::date end,
      item -> 'json',
      astatus
    )
    on conflict (intake_id, question_id) do update
    set value_text = excluded.value_text,
        value_number = excluded.value_number,
        value_date = excluded.value_date,
        value_json = excluded.value_json,
        status = excluded.status,
        answered_at = now();

    if qtype in ('file', 'signature') and jsonb_typeof(item -> 'json') = 'array' then
      for f in select * from jsonb_array_elements(item -> 'json')
      loop
        if split_part(f ->> 'path', '/', 1) <> p_token then
          raise exception 'FILE_OUTSIDE_INTAKE';
        end if;

        -- A retry can send the same path twice; the same file should not land
        -- on the card twice because of it.
        insert into public.documents
          (org_id, client_id, intake_id, bucket, storage_path, filename, mime, size_bytes)
        select
          intake.org_id, intake.client_id, intake.id, 'intake-uploads',
          f ->> 'path',
          coalesce(nullif(btrim(f ->> 'filename'), ''), 'קובץ מהשאלון'),
          f ->> 'mime',
          case when f ->> 'size' is null then null else (f ->> 'size')::bigint end
        where not exists (
          select 1 from public.documents d where d.storage_path = f ->> 'path'
        );
      end loop;
    end if;
  end loop;

  select count(*) into owed
  from public.intake_answers
  where intake_id = intake.id and status = 'later';

  headers := nullif(current_setting('request.headers', true), '')::json;

  update public.client_intakes
  set status = case
        when owed > 0 then 'partial'::public.intake_status
        else 'submitted'::public.intake_status
      end,
      -- Set only when the form is actually finished. A partial return is not a
      -- submission, and the firm's "it arrived" banner should not fire on one.
      submitted_at = case when owed > 0 then null else now() end,
      signed_at = case when signed then now() else signed_at end,
      signed_ip = case
        when signed then split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)
        else signed_ip
      end,
      signed_agent = case when signed then headers ->> 'user-agent' else signed_agent end
  where id = intake.id;
end;
$$;

revoke all on function public.intake_is_open(text) from public;
revoke all on function public.open_intake(text) from public;
revoke all on function public.submit_intake(text, jsonb) from public;

grant execute on function public.intake_is_open(text) to anon, authenticated;
grant execute on function public.open_intake(text) to anon, authenticated;
grant execute on function public.submit_intake(text, jsonb) to anon, authenticated;
