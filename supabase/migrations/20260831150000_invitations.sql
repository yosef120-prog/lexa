-- Inviting a colleague into the firm.
--
-- There is no sending domain on this project, so nothing here emails anybody.
-- The owner gets a link and passes it on however they already talk to that
-- person. That is a smaller promise than an invitation email, and it is one the
-- system can actually keep.

create table public.org_invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,

  -- The invitation is for this address and no other. A link that reaches the
  -- wrong inbox is then worth nothing, which matters more here than the
  -- convenience of accepting under a different address.
  email       text not null check (position('@' in email) > 1),
  role        public.org_role not null,

  -- Long and random. This is the only thing standing between a forwarded
  -- message and a seat inside a law firm.
  --
  -- Two UUIDs rather than gen_random_bytes: that needs pgcrypto, and this
  -- schema deliberately depends on no extensions. The randomness is the same
  -- 256 bits either way.
  token       text not null unique
              default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),

  invited_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  revoked_at  timestamptz,

  -- Only one live invitation per address per firm, so a second send replaces
  -- rather than creating two links that both work.
  constraint invitation_accepted_has_who
    check ((accepted_at is null) = (accepted_by is null))
);

create unique index org_invitations_live_idx
  on public.org_invitations (org_id, lower(email))
  where accepted_at is null and revoked_at is null;

create index org_invitations_token_idx on public.org_invitations (token)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------- rls

alter table public.org_invitations enable row level security;

-- Owners manage invitations; nobody else in the firm needs to see who was
-- asked and declined.
create policy invitations_owner_read on public.org_invitations
  for select to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy invitations_owner_write on public.org_invitations
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy invitations_owner_update on public.org_invitations
  for update to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));

create trigger audit after insert or update or delete on public.org_invitations
  for each row execute function public.write_audit();

grant select, insert, update on public.org_invitations to authenticated;

-- ---------------------------------------------------------------- redeeming

/**
 * Turns an invitation into a seat.
 *
 * Definer, because the caller is by definition not yet a member and no policy
 * they are subject to could let them read the invitation. Every condition the
 * policy would have enforced is checked here first, and each failure has its own
 * name so the screen can say what actually went wrong.
 */
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv         public.org_invitations;
  caller_mail text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into inv from public.org_invitations where token = p_token;
  if inv.id is null then
    raise exception 'INVITE_NOT_FOUND';
  end if;
  if inv.revoked_at is not null then
    raise exception 'INVITE_REVOKED';
  end if;
  if inv.accepted_at is not null then
    raise exception 'INVITE_ALREADY_USED';
  end if;
  if inv.expires_at < now() then
    raise exception 'INVITE_EXPIRED';
  end if;

  select email into caller_mail from public.profiles where id = auth.uid();
  if lower(coalesce(caller_mail, '')) <> lower(inv.email) then
    raise exception 'INVITE_WRONG_ACCOUNT';
  end if;

  if exists (select 1 from public.org_members where org_id = inv.org_id and user_id = auth.uid()) then
    raise exception 'ALREADY_A_MEMBER';
  end if;

  insert into public.org_members (org_id, user_id, role, status, invited_by, joined_at)
  values (inv.org_id, auth.uid(), inv.role, 'active', inv.invited_by, now());

  update public.org_invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  return inv.org_id;
end;
$$;

/**
 * What a link can reveal before anyone signs in: the firm's name and the
 * address it was meant for. Enough to tell someone whether it is for them, and
 * nothing that helps a stranger who found the link.
 */
create or replace function public.peek_invitation(p_token text)
returns table (org_name text, email text, role public.org_role, valid boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv public.org_invitations;
  org public.organizations;
begin
  select * into inv from public.org_invitations where token = p_token;
  if inv.id is null then
    return query select null::text, null::text, null::public.org_role, false, 'INVITE_NOT_FOUND';
    return;
  end if;

  select * into org from public.organizations where id = inv.org_id;

  return query select
    org.name,
    inv.email,
    inv.role,
    inv.revoked_at is null and inv.accepted_at is null and inv.expires_at >= now(),
    case
      when inv.revoked_at is not null then 'INVITE_REVOKED'
      when inv.accepted_at is not null then 'INVITE_ALREADY_USED'
      when inv.expires_at < now() then 'INVITE_EXPIRED'
      else null
    end;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
revoke all on function public.peek_invitation(text)   from public;
grant execute on function public.accept_invitation(text) to authenticated;
-- Readable before joining, which is the whole point of a preview.
grant execute on function public.peek_invitation(text) to authenticated, anon;
