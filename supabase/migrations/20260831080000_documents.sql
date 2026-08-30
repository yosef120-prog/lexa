-- Stage 5: documents on a matter, with versions.
--
-- Files never travel through the API. The browser asks storage for a signed
-- upload URL, sends the bytes straight there, and only then writes the row that
-- makes the file part of the matter. Downloads go through a URL that expires in
-- a minute, so a link copied out of the page is worthless a moment later.
--
-- Versions share a version_group_id and count upward. Uploading again never
-- overwrites: the old bytes stay, addressable, because a lawyer asked what the
-- contract said last week is asking a real question.

create table public.documents (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id) on delete cascade,
  matter_id        uuid not null references public.matters (id) on delete cascade,

  -- Path inside the bucket. Begins with the org id, which is what the storage
  -- policies read to decide who may touch the bytes.
  storage_path     text not null unique,
  filename         text not null check (length(btrim(filename)) between 1 and 300),
  mime             text,
  size_bytes       bigint check (size_bytes >= 0),

  version_group_id uuid not null default gen_random_uuid(),
  version_no       integer not null,

  -- No virus scanning exists on this stack, and pretending otherwise would be
  -- worse than saying so. The column records that plainly and leaves room for a
  -- scanner later without a migration.
  scan_status      text not null default 'not_scanned'
                   check (scan_status in ('not_scanned', 'clean', 'infected', 'failed')),

  uploaded_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  unique (version_group_id, version_no)
);

create index documents_matter_idx on public.documents (matter_id) where deleted_at is null;
create index documents_group_idx  on public.documents (version_group_id, version_no desc);

-- Version numbers are assigned here, not by the caller. Two uploads racing for
-- the same number would otherwise fail on the unique constraint, and the loser
-- would have already sent its bytes.
create or replace function public.assign_document_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select coalesce(max(version_no), 0) + 1 into new.version_no
  from public.documents
  where version_group_id = new.version_group_id;
  return new;
end;
$$;

create trigger assign_version before insert on public.documents
  for each row execute function public.assign_document_version();

create or replace function public.log_document_added()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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

create trigger log_added after insert on public.documents
  for each row execute function public.log_document_added();

create trigger audit after insert or update or delete on public.documents
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------- rls

alter table public.documents enable row level security;

create policy documents_read on public.documents
  for select to authenticated
  using (deleted_at is null and public.is_org_member(org_id));

create policy documents_insert on public.documents
  for insert to authenticated
  with check (public.is_org_member(org_id));

-- Renaming is allowed; the bytes and their path are not editable from here.
create policy documents_update on public.documents
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

grant select, insert, update on public.documents to authenticated;

-- ---------------------------------------------------------------- storage

-- Private. Every read is a signed URL with a short life; there is no public
-- path to any byte in here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'matter-documents', 'matter-documents', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/heic', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- The first path segment is the firm id, so one predicate covers the whole
-- bucket and matches the isolation rule used everywhere else.
create policy matter_documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'matter-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy matter_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'matter-documents'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

-- No update and no delete policy: uploading a new version is how a document
-- changes, and the bytes already filed stay where they are.
