-- Who a questionnaire's documents came from.
--
-- documents.uploaded_by defaults to auth.uid(), which is right for a file a
-- member drags onto a card and wrong for one a client sent through a link.
-- submit_intake runs as the definer but the default still reads the caller's
-- claim, so the answer depended on who happened to be holding a session in
-- that browser: null for a real client, and the lawyer's own name whenever
-- the firm opened the form to check it.
--
-- The second case is the dangerous one. A card that says the lawyer supplied
-- the client's identity document is a record of who produced evidence, and it
-- is wrong. Nobody would think to doubt it.
--
-- So intake documents are stamped as nobody's upload, explicitly, whatever
-- session the browser is carrying. intake_id is already on the row and is
-- what the screen reads to say the client sent it.

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
          (org_id, client_id, intake_id, bucket, storage_path, filename, mime, size_bytes,
           uploaded_by)
        select
          intake.org_id, intake.client_id, intake.id, 'intake-uploads',
          f ->> 'path',
          coalesce(nullif(btrim(f ->> 'filename'), ''), 'קובץ מהשאלון'),
          f ->> 'mime',
          case when f ->> 'size' is null then null else (f ->> 'size')::bigint end,
          -- Named rather than left to the default. The client is not a member
          -- and has no id here; crediting the session that happened to be open
          -- would put a colleague's name on the client's own document.
          null
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

revoke all on function public.submit_intake(text, jsonb) from public;
grant execute on function public.submit_intake(text, jsonb) to anon, authenticated;

-- The rows already written under the old default. Every document carrying an
-- intake_id came from a client, so any name on one of them is wrong by
-- definition and there is nothing to preserve.
update public.documents
set uploaded_by = null
where intake_id is not null and uploaded_by is not null;
