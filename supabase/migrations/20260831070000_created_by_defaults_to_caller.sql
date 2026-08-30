-- Record who created a row without asking the caller to remember.
--
-- created_by was left to the application to fill in, and the application did
-- not. The visible symptom was a timeline entry reading "party added — " with
-- no name; the same silence applied to clients and to matters, so "matter
-- opened" would have been unattributed too.
--
-- A default is the right place for this. Every insert now records its author,
-- including inserts written later by someone who never read this file.

alter table public.clients        alter column created_by set default auth.uid();
alter table public.matters        alter column created_by set default auth.uid();
alter table public.matter_parties alter column created_by set default auth.uid();

-- Backfill what the audit trail can still tell us. Rows whose creator is
-- genuinely unknown stay null rather than being attributed to a guess.
update public.matter_parties p
set created_by = a.actor_id
from public.audit_log a
where p.created_by is null
  and a.entity = 'matter_parties'
  and a.action = 'insert'
  and a.entity_id = p.id::text
  and a.actor_id is not null;

update public.matter_activity act
set actor_user_id = p.created_by
from public.matter_parties p
where act.kind = 'party_added'
  and act.ref_id = p.id
  and act.actor_user_id is null
  and p.created_by is not null;
