-- Removing a document.
--
-- The other soft deletes have existed since their tables did; this one was
-- missing, so a file uploaded by mistake — the wrong client's identity card,
-- most obviously — could not be taken off a card by anyone.
--
-- A definer function for the same reason as the others: a plain
-- `update ... set deleted_at` succeeds, but PostgREST asks for the row back
-- and the read policy hides anything deleted, so the client cannot tell a
-- deletion from a refusal.
--
-- The object stays in storage. Removing bytes is a different decision with
-- different consequences — a document withdrawn from a card may still be
-- something the firm has to produce later — and marking the row is what the
-- rest of this schema means by deleting.

create or replace function public.soft_delete_document(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  doc public.documents;
begin
  select * into doc from public.documents where id = p_document_id and deleted_at is null;
  if doc.id is null then
    raise exception 'NOT_FOUND';
  end if;

  -- The three roles that may file a document may withdraw one. An intern who
  -- can upload and not correct their own mistake asks a colleague to do it,
  -- which is worse for everybody.
  if not public.has_org_role(doc.org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  update public.documents set deleted_at = now() where id = p_document_id;

  -- A document that leaves a matter leaves a trace on it. Nothing is quietly
  -- removed from a file's history.
  if doc.matter_id is not null then
    insert into public.matter_activity
      (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
    values (doc.org_id, doc.matter_id, 'document', auth.uid(),
            'הוסר: ' || doc.filename, 'documents', doc.id);
  end if;
end;
$$;

revoke all on function public.soft_delete_document(uuid) from public;
grant execute on function public.soft_delete_document(uuid) to authenticated;
