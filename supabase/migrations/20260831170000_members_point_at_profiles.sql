-- Point every reference to a person at profiles rather than at auth.users.
--
-- PostgREST will not follow a foreign key into the auth schema, so a column
-- that points there cannot be read alongside the person's name in one request.
-- The request fails outright, and the screen that meant to show who did
-- something shows nothing at all. That has now caused the same bug twice — in
-- matter_activity.actor_user_id, and in org_members.user_id, where the list of
-- colleagues came back empty — so this migration fixes the rest of them before
-- a third screen finds one.
--
-- The constraints are no weaker for the change: profiles.id is itself a
-- foreign key to auth.users, so none of these can name someone who has no
-- account, and deleting the account still cascades through profiles. Every
-- profile exists before any of these rows can be written, because the signup
-- trigger creates it on insert into auth.users.
--
-- Two columns are deliberately left pointing into auth. profiles.id is the
-- mirror itself and has nowhere else to point. audit_log.actor_id has to
-- survive the profile being deleted — an audit trail that forgets who acted is
-- not an audit trail — which is also why it is the one place the answer is
-- still recorded after the reassignments below.

alter table public.org_members
  drop constraint org_members_user_id_fkey,
  add constraint org_members_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade;

-- The rest name a person incidentally: who opened the file, who ran the check.
-- They take `set null`, matching the tables written later, so that removing
-- someone from the firm is possible at all rather than being refused by a
-- client record they created two years ago.
alter table public.org_members
  drop constraint org_members_invited_by_fkey,
  add constraint org_members_invited_by_fkey
    foreign key (invited_by) references public.profiles (id) on delete set null;

alter table public.clients
  drop constraint clients_created_by_fkey,
  add constraint clients_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.conflict_checks
  drop constraint conflict_checks_performed_by_fkey,
  add constraint conflict_checks_performed_by_fkey
    foreign key (performed_by) references public.profiles (id) on delete set null;

alter table public.matters
  drop constraint matters_created_by_fkey,
  add constraint matters_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.matters
  drop constraint matters_lead_user_id_fkey,
  add constraint matters_lead_user_id_fkey
    foreign key (lead_user_id) references public.profiles (id) on delete set null;

alter table public.matter_parties
  drop constraint matter_parties_created_by_fkey,
  add constraint matter_parties_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;
