-- What the client attached becomes a document on their card.
--
-- The files land in intake-uploads, because that is the only bucket an
-- anonymous caller may write to. The firm's own files live in
-- matter-documents. So a document row now has to say which bucket holds it —
-- without that, every download would look in the wrong place, and the failure
-- would be a broken link rather than an error anyone could read.

alter table public.documents
  add column bucket text not null default 'matter-documents';

comment on column public.documents.bucket is
  'Which storage bucket holds the object. Intake files stay in intake-uploads: '
  'moving them would need the service role, and a copy is a second thing to '
  'keep in step for no gain.';

/**
 * Recording what the client filled in, including what they attached.
 *
 * Replaces the earlier version. The difference is the file branch: for a
 * question of type file, the payload carries the paths the client already
 * uploaded, and each becomes a document on the client's card. Doing it here
 * rather than from the browser is the point — an anonymous caller can write
 * into a bucket and cannot write a row in documents, so the only way a file
 * becomes part of the record is through this function, which has already
 * checked the token.
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

    -- The question has to belong to the form this token was issued for. This
    -- is the only place in the schema where an outsider supplies an id, and
    -- without the check a caller could post one from another firm's form and
    -- write a row carrying this firm's org_id.
    select type into qtype
    from public.intake_questions
    where id = qid and form_id = intake.form_id;

    if qtype is null then
      raise exception 'UNKNOWN_QUESTION';
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

    if qtype = 'file' and jsonb_typeof(item -> 'json') = 'array' then
      for f in select * from jsonb_array_elements(item -> 'json')
      loop
        -- The path must sit under this token's own folder. The storage policy
        -- already refuses anything else on the way in; this refuses it again
        -- on the way into the record, because the two checks answer different
        -- questions and only one of them is about what gets filed.
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

  update public.client_intakes
  set status = 'submitted', submitted_at = now()
  where id = intake.id;
end;
$$;

revoke all on function public.submit_intake(text, jsonb) from public;
grant execute on function public.submit_intake(text, jsonb) to anon, authenticated;
