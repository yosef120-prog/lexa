-- A signature on an intake form.
--
-- The questionnaire this brings across ends with a client signing with a
-- finger, and the signature is the part that carries weight: a power of
-- attorney to obtain tax clearances, and an acceptance of a fee. What makes
-- such a signature worth anything later is not the drawing — it is being able
-- to say when it was made and from where.
--
-- So the drawing is stored like any other attachment, and the circumstances
-- are stored on the intake itself, written by the server rather than sent by
-- the browser. A timestamp the client could set is not evidence of anything.

alter type public.intake_question_type add value if not exists 'signature';

alter table public.client_intakes
  add column signed_at timestamptz,
  add column signed_ip text,
  add column signed_agent text;

comment on column public.client_intakes.signed_ip is
  'Taken from the request headers by submit_intake. Never sent by the client.';

/**
 * Recording what the client filled in, with the circumstances of a signature.
 *
 * Replaces the previous version. The only difference is the block at the end:
 * when the form carried a signature, the moment and the origin are written
 * from what the server can see, not from anything the payload claimed.
 */
create or replace function public.submit_intake(p_token text, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  intake public.client_intakes;
  item   jsonb;
  qid    uuid;
  qtype  public.intake_question_type;
  f      jsonb;
  signed boolean := false;
  headers json;
begin
  select * into intake from public.client_intakes where token = p_token for update;

  if intake.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if intake.revoked_at is not null then
    raise exception 'REVOKED';
  end if;
  if intake.submitted_at is not null then
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

    insert into public.intake_answers
      (org_id, intake_id, question_id, value_text, value_number, value_date, value_json)
    values (
      intake.org_id, intake.id, qid,
      nullif(btrim(coalesce(item ->> 'text', '')), ''),
      case when item ->> 'number' is null then null else (item ->> 'number')::numeric end,
      case when item ->> 'date'   is null then null else (item ->> 'date')::date end,
      item -> 'json'
    )
    on conflict (intake_id, question_id) do update
    set value_text = excluded.value_text,
        value_number = excluded.value_number,
        value_date = excluded.value_date,
        value_json = excluded.value_json,
        answered_at = now();

    -- A signature is an image, and so is filed like every other attachment.
    if qtype in ('file', 'signature') and jsonb_typeof(item -> 'json') = 'array' then
      for f in select * from jsonb_array_elements(item -> 'json')
      loop
        if split_part(f ->> 'path', '/', 1) <> p_token then
          raise exception 'FILE_OUTSIDE_INTAKE';
        end if;

        insert into public.documents
          (org_id, client_id, intake_id, bucket, storage_path, filename, mime, size_bytes)
        values (
          intake.org_id, intake.client_id, intake.id, 'intake-uploads',
          f ->> 'path',
          coalesce(nullif(btrim(f ->> 'filename'), ''), 'קובץ מהשאלון'),
          f ->> 'mime',
          case when f ->> 'size' is null then null else (f ->> 'size')::bigint end
        );
      end loop;
    end if;
  end loop;

  -- Read rather than accepted. The browser is the one party here with a reason
  -- to misreport when and from where, so neither value comes from it.
  headers := nullif(current_setting('request.headers', true), '')::json;

  update public.client_intakes
  set status = 'submitted',
      submitted_at = now(),
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
