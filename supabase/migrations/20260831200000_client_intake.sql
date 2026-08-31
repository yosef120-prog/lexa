-- Intake questionnaires: the one door in this schema that opens outward.
--
-- A firm sends a client a link. The client fills in answers and attaches
-- documents without an account, a password, or anything to install, and the
-- result lands on their card. That is the whole point — the brief's biggest
-- named pain is clients who never send their documents, and every step between
-- the client and the upload is a step where they stop.
--
-- Everything else in this database answers "is the caller a member of this
-- firm". Here the answer is no, and the token is the credential instead: 256
-- bits, unguessable, bound to one client, expiring, and single use. Whoever
-- holds it may add to one client's card and read nothing at all.
--
-- What an anonymous holder can do, exhaustively:
--   * read the firm's name, the client's name, and the questions
--   * write answers, once
--   * upload files under their own token's folder
-- What they cannot do: read any answer, any file, any other client, or learn
-- that any other client exists.

create type public.intake_question_type as enum (
  'text', 'long_text', 'number', 'yes_no', 'single_choice', 'multi_choice', 'date', 'file'
);

create type public.intake_status as enum ('sent', 'opened', 'submitted', 'revoked');

-- ---------------------------------------------------------------- the form

create table public.intake_forms (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 200),
  intro       text,
  is_default  boolean not null default false,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index intake_forms_org_idx on public.intake_forms (org_id) where deleted_at is null;

create table public.intake_questions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  form_id     uuid not null references public.intake_forms (id) on delete cascade,

  position    integer not null,
  type        public.intake_question_type not null default 'text',
  label       text not null check (length(btrim(label)) between 1 and 500),
  help        text,
  required    boolean not null default false,
  -- Options for the choice types. Null for everything else.
  options     jsonb,

  constraint intake_choice_has_options check (
    type not in ('single_choice', 'multi_choice')
    or (options is not null and jsonb_array_length(options) > 0)
  ),
  unique (form_id, position)
);

create index intake_questions_form_idx on public.intake_questions (form_id, position);

-- ---------------------------------------------------------------- the link

create table public.client_intakes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  form_id     uuid not null references public.intake_forms (id) on delete restrict,

  -- The credential. Two UUIDs rather than gen_random_bytes, which needs
  -- pgcrypto; this schema depends on no extensions and the randomness is the
  -- same 256 bits either way.
  token       text not null unique
              default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),

  status      public.intake_status not null default 'sent',
  -- Shorter than an invitation's week: this one collects identity documents,
  -- and a link that lives forever in a WhatsApp thread is a liability.
  expires_at  timestamptz not null default now() + interval '14 days',
  opened_at   timestamptz,
  submitted_at timestamptz,
  revoked_at  timestamptz,

  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index client_intakes_client_idx on public.client_intakes (client_id, created_at desc);
create index client_intakes_token_idx on public.client_intakes (token)
  where status in ('sent', 'opened');

create table public.intake_answers (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  intake_id    uuid not null references public.client_intakes (id) on delete cascade,
  question_id  uuid not null references public.intake_questions (id) on delete cascade,

  -- One column per shape rather than one text column holding everything: a
  -- number that has to be compared, or a date that has to be sorted, is not a
  -- string, and discovering that later means rewriting every reader.
  value_text   text,
  value_number numeric,
  value_date   date,
  value_json   jsonb,

  answered_at  timestamptz not null default now(),
  unique (intake_id, question_id)
);

create index intake_answers_intake_idx on public.intake_answers (intake_id);

-- ---------------------------------------------------------------- rls

alter table public.intake_forms     enable row level security;
alter table public.intake_questions enable row level security;
alter table public.client_intakes   enable row level security;
alter table public.intake_answers   enable row level security;

-- The firm's side. Nothing here is granted to anon: everything an outsider can
-- reach goes through the definer functions below, which decide exactly what to
-- hand back.
create policy intake_forms_read on public.intake_forms
  for select to authenticated
  using (deleted_at is null and public.is_org_member(org_id));

create policy intake_forms_write on public.intake_forms
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy intake_forms_update on public.intake_forms
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy intake_questions_read on public.intake_questions
  for select to authenticated using (public.is_org_member(org_id));

create policy intake_questions_write on public.intake_questions
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy intake_questions_update on public.intake_questions
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy intake_questions_delete on public.intake_questions
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy client_intakes_read on public.client_intakes
  for select to authenticated using (public.is_org_member(org_id));

create policy client_intakes_write on public.client_intakes
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy client_intakes_update on public.client_intakes
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

-- Answers are read by the firm and written only by the submit function. No
-- insert policy exists for anyone, which is what stops a member of the firm
-- from quietly filling in what the client said.
create policy intake_answers_read on public.intake_answers
  for select to authenticated using (public.is_org_member(org_id));

create trigger audit after insert or update or delete on public.client_intakes
  for each row execute function public.write_audit();

grant select, insert, update on public.intake_forms     to authenticated;
grant select, insert, update, delete on public.intake_questions to authenticated;
grant select, insert, update on public.client_intakes   to authenticated;
grant select on public.intake_answers to authenticated;

-- ---------------------------------------------------------------- the door

/**
 * Whether a token is currently good for anything.
 *
 * Its own function because three separate places need the same answer -- the
 * preview, the submit, and the storage policy -- and three copies of this
 * condition would eventually disagree. The one that drifts would be the
 * storage policy, which is the one guarding the files.
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
      and status in ('sent', 'opened')
      and expires_at > now()
  );
$$;

/**
 * What the link shows before anything is filled in.
 *
 * Everything an outsider ever learns about the firm is in this return type.
 * The client's name is here because a person needs to know the form is for
 * them; nothing else about them is, and nothing at all about any other client.
 * Opening it is recorded, which tells the firm whether silence means "did not
 * see it" or "saw it and did not act".
 */
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

  -- Recorded once. A second visit is not news, and overwriting it would lose
  -- the only interesting fact: when they first looked.
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
           'help', q.help, 'required', q.required, 'options', q.options
         ) order by q.position
       )
       from public.intake_questions q where q.form_id = f.id),
      '[]'::jsonb
    )
  from public.intake_forms f
  where f.id = intake.form_id;
end;
$$;

/**
 * Recording what the client filled in.
 *
 * Definer, because the caller is nobody and no policy they are subject to
 * could write a row. Every condition a policy would have enforced is checked
 * here first, and the answers are inserted in one statement with the status
 * change, so a half-submitted form cannot exist.
 *
 * p_answers is an array of {question_id, text, number, date, json}.
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

    -- The question has to belong to the form this token was issued for.
    -- Without this, a caller could post an id from another firm's form and
    -- write a row carrying this firm's org_id -- a foothold, however small,
    -- and the only place in the schema where an outsider supplies an id.
    if not exists (
      select 1 from public.intake_questions
      where id = qid and form_id = intake.form_id
    ) then
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
  end loop;

  update public.client_intakes
  set status = 'submitted', submitted_at = now()
  where id = intake.id;
end;
$$;

revoke all on function public.intake_is_open(text) from public;
revoke all on function public.open_intake(text)    from public;
revoke all on function public.submit_intake(text, jsonb) from public;

grant execute on function public.open_intake(text) to anon, authenticated;
grant execute on function public.submit_intake(text, jsonb) to anon, authenticated;

-- intake_is_open has to be executable by both roles, and not because anyone
-- calls it directly. The storage policy below is evaluated against every
-- insert into storage.objects, including the firm's own matter documents in
-- the other bucket -- Postgres checks that it may run the function before it
-- decides the bucket does not match. Left ungranted, uploading a pleading
-- fails with "permission denied for function intake_is_open", which names
-- nothing a person could act on.
--
-- Withholding it bought nothing anyway: the answer is only interesting to
-- someone who already holds a 256-bit token, and they can call open_intake.
grant execute on function public.intake_is_open(text) to anon, authenticated;

-- ---------------------------------------------------------------- documents

-- A document can now belong to a client rather than a matter.
--
-- Intake documents arrive before any matter exists -- an identity card, a
-- deed, whatever the lawyer asked for at the first meeting -- and they belong
-- to the person. Opening the existing table rather than adding a parallel one
-- keeps versioning, downloading and the export as single mechanisms; a second
-- document store would have to grow its own copy of all three, and the copies
-- would drift.
alter table public.documents
  alter column matter_id drop not null,
  add column client_id uuid references public.clients (id) on delete cascade,
  add column intake_id uuid references public.client_intakes (id) on delete set null;

-- A document with neither is a document nobody can find.
alter table public.documents
  add constraint documents_belongs_somewhere
    check (matter_id is not null or client_id is not null);

create index documents_client_idx on public.documents (client_id)
  where deleted_at is null and client_id is not null;

-- The existing timeline logger writes to matter_activity, which needs a
-- matter. A client document has none, so it now returns early rather than
-- failing the insert.
create or replace function public.log_document_added()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.matter_id is null then
    return new;
  end if;
  -- Everything below is unchanged from the original. Only the early return
  -- above is new: replacing a function means retyping a body that already
  -- worked, and the version suffix was lost the first time this was written.
  insert into public.matter_activity
    (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
  values
    (new.org_id, new.matter_id, 'document', new.uploaded_by,
     case when new.version_no = 1
          then new.filename
          else new.filename || ' · גרסה ' || new.version_no
     end,
     'documents', new.id);
  return new;
end;
$$;

-- ---------------------------------------------------------------- storage

-- A separate bucket from matter-documents on purpose. Anonymous callers can
-- write here, and the blast radius of a mistake in the policy below should not
-- include a single file that a firm already holds.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'intake-uploads', 'intake-uploads', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/heic', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ]
)
on conflict (id) do nothing;

/**
 * The client uploading a file.
 *
 * The path is <token>/<uuid>, and the policy checks that the first segment is
 * a token that is currently open. Knowing the token is the authorisation --
 * the same capability the link itself grants -- and nothing else about the
 * request is trusted.
 *
 * Insert only. There is deliberately no select policy for anon on this bucket:
 * a client can add to the pile and cannot read it back, so a leaked link
 * cannot be used to retrieve what an earlier client uploaded.
 */
create policy intake_upload on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'intake-uploads'
    and public.intake_is_open((storage.foldername(name))[1])
  );

-- The firm reads what arrived for its own clients, and only through a token it
-- issued. The join is what ties a folder name back to an organisation.
create policy intake_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'intake-uploads'
    and exists (
      select 1 from public.client_intakes i
      where i.token = (storage.foldername(storage.objects.name))[1]
        and public.is_org_member(i.org_id)
    )
  );
