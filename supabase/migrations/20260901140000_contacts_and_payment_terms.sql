-- Two things a firm currently keeps in its head or in the contract PDF.
--
-- First: what was said on the phone. The matter timeline already records what
-- happened to a file, but a client rings before there is a file, and rings
-- about things no file covers. That conversation is currently written on a
-- pad, and the pad is not searchable, not shared, and not there when the
-- client rings back and the person who took the first call is out.
--
-- Second: when the money is due. The schedule is agreed in the contract and
-- then lives only in the contract, so answering "when is the second payment"
-- means opening a PDF and reading clauses. It should be on the card.

-- ---------------------------------------------------------------- contacts

create type public.contact_channel as enum (
  'phone_in', 'phone_out', 'meeting', 'whatsapp', 'email', 'other'
);

create table public.client_contacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  client_id     uuid not null references public.clients (id) on delete cascade,

  -- Optional. Much of what a client says on the phone is about one file, and
  -- some of it is about nothing yet.
  matter_id     uuid references public.matters (id) on delete set null,

  channel       public.contact_channel not null default 'phone_in',

  -- When the conversation happened, not when it was typed. A call taken at
  -- four and written up at seven is a call at four, and the difference is the
  -- whole value of the record.
  occurred_at   timestamptz not null default now(),

  body          text not null check (length(btrim(body)) between 1 and 20000),

  actor_user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),

  -- Set when the author changes what they wrote. Shown, rather than hidden:
  -- a note that quietly changed is worth less than one that says it changed.
  edited_at     timestamptz
);

create index client_contacts_client_idx
  on public.client_contacts (client_id, occurred_at desc);
create index client_contacts_matter_idx
  on public.client_contacts (matter_id) where matter_id is not null;

alter table public.client_contacts enable row level security;

create policy client_contacts_read on public.client_contacts
  for select to authenticated
  using (public.is_org_member(org_id));

-- Interns log calls. Taking a message is the job.
create policy client_contacts_insert on public.client_contacts
  for insert to authenticated
  with check (public.is_org_member(org_id) and actor_user_id = auth.uid());

-- Only the person who wrote it, and only their own.
--
-- Unlike the matter timeline, this is editable at all: a call summary is
-- typed in a hurry while the client is still talking, and a firm that cannot
-- fix a mistyped phone number in one goes back to the paper pad. The audit
-- trail below is what makes that safe rather than loose — every version is
-- kept there whether or not anyone thinks to look.
create policy client_contacts_update on public.client_contacts
  for update to authenticated
  using (actor_user_id = auth.uid() and public.is_org_member(org_id))
  with check (actor_user_id = auth.uid() and public.is_org_member(org_id));

create policy client_contacts_delete on public.client_contacts
  for delete to authenticated
  using (actor_user_id = auth.uid() and public.is_org_member(org_id));

create trigger audit after insert or update or delete on public.client_contacts
  for each row execute function public.write_audit();

/** Stamps the edit, so the screen never has to trust that nothing changed. */
create or replace function public.mark_contact_edited()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.body is distinct from old.body
     or new.occurred_at is distinct from old.occurred_at
     or new.channel is distinct from old.channel then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create trigger stamp_edit before update on public.client_contacts
  for each row execute function public.mark_contact_edited();

-- ------------------------------------------------------ the other side's card

-- A party on a matter may also be a client of the firm — the other side in a
-- sale sometimes is, and sometimes is only a name. Nullable because both are
-- ordinary: this link is what lets an agreed payment date appear on the buyer's
-- card as well as the seller's, when the buyer has a card at all.
alter table public.matter_parties
  add column client_id uuid references public.clients (id) on delete set null;

create index matter_parties_client_idx
  on public.matter_parties (client_id) where client_id is not null;

-- ---------------------------------------------------------------- payments

create table public.payment_milestones (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  matter_id   uuid not null references public.matters (id) on delete cascade,

  -- What the contract calls it: "תשלום ראשון במעמד החתימה".
  label       text not null check (length(btrim(label)) between 1 and 200),
  amount      numeric(14, 2) check (amount is null or amount >= 0),
  due_date    date not null,

  -- Null while it is still owed. A date rather than a flag, because "when did
  -- it come in" is the next question after "did it".
  paid_at     date,
  note        text,

  -- The diary entry this milestone keeps in step, so the date reaches the
  -- firm the same way a hearing does rather than through a second mechanism.
  event_id    uuid references public.events (id) on delete set null,

  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint payment_paid_not_before_agreed
    check (paid_at is null or paid_at >= due_date - 3650)
);

create index payment_milestones_matter_idx
  on public.payment_milestones (matter_id, due_date);
create index payment_milestones_due_idx
  on public.payment_milestones (org_id, due_date) where paid_at is null;

alter table public.payment_milestones enable row level security;

create policy payment_milestones_read on public.payment_milestones
  for select to authenticated
  using (public.is_org_member(org_id));

create policy payment_milestones_write on public.payment_milestones
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy payment_milestones_update on public.payment_milestones
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create policy payment_milestones_delete on public.payment_milestones
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer', 'secretary']::public.org_role[]));

create trigger audit after insert or update or delete on public.payment_milestones
  for each row execute function public.write_audit();

/**
 * Keeps a milestone's diary entry in step with the milestone.
 *
 * Reusing events rather than inventing a second dated thing: the diary screen,
 * the dashboard's overdue count and the reminder mail all already work on
 * events, and a payment date that needed its own copy of each would be three
 * places to fix the next time one of them changes.
 *
 * A paid milestone loses its entry. Nagging somebody about money that has
 * already arrived is how a firm learns to ignore the diary.
 */
create or replace function public.sync_payment_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wanted_title text;
  -- 09:00 Israel time three days ahead, which is long enough to chase and
  -- short enough to still be about this payment.
  remind timestamptz;
begin
  wanted_title := new.label ||
    coalesce(' · ' || to_char(new.amount, 'FM999,999,999.00') || ' ₪', '');
  remind := ((new.due_date - 3)::timestamp + time '09:00') at time zone 'Asia/Jerusalem';

  if new.paid_at is not null then
    if new.event_id is not null then
      update public.events set deleted_at = now()
      where id = new.event_id and deleted_at is null;
    end if;
    return new;
  end if;

  if new.event_id is null then
    insert into public.events (org_id, matter_id, kind, title, starts_at, all_day, remind_at, notes)
    values (
      new.org_id, new.matter_id, 'deadline', wanted_title,
      new.due_date::timestamp at time zone 'Asia/Jerusalem', true, remind,
      'מועד תשלום מתוך לוח התשלומים של התיק.'
    )
    returning id into new.event_id;
  else
    -- Undeleted as well as updated: a milestone marked paid by mistake and
    -- then corrected should get its date back rather than silently lose it.
    update public.events
    set title = wanted_title,
        starts_at = new.due_date::timestamp at time zone 'Asia/Jerusalem',
        remind_at = remind,
        reminded_at = case
          when starts_at is distinct from (new.due_date::timestamp at time zone 'Asia/Jerusalem')
          then null else reminded_at
        end,
        deleted_at = null
    where id = new.event_id;
  end if;

  return new;
end;
$$;

create trigger sync_event before insert or update on public.payment_milestones
  for each row execute function public.sync_payment_event();

/** A milestone that goes takes its diary entry with it. */
create or replace function public.drop_payment_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.event_id is not null then
    update public.events set deleted_at = now() where id = old.event_id;
  end if;
  return old;
end;
$$;

create trigger drop_event after delete on public.payment_milestones
  for each row execute function public.drop_payment_event();

/**
 * Every payment date touching one client, from whichever side.
 *
 * The point of the whole file: the schedule is agreed once, in one contract,
 * and both the seller and the buyer need it on their card. It hangs off the
 * matter — the deal — and reaches a card either because the client owns the
 * matter or because they are a linked party on it.
 *
 * Not security definer. It runs as the caller so row level security answers
 * for it, exactly as a direct select would.
 */
create or replace function public.client_payment_milestones(p_client_id uuid)
returns table (
  id          uuid,
  matter_id   uuid,
  matter_name text,
  label       text,
  amount      numeric,
  due_date    date,
  paid_at     date,
  note        text
)
language sql
stable
set search_path = public, pg_temp
as $$
  select m.id, m.matter_id, mt.name, m.label, m.amount, m.due_date, m.paid_at, m.note
  from public.payment_milestones m
  join public.matters mt on mt.id = m.matter_id and mt.deleted_at is null
  where mt.client_id = p_client_id
     or exists (
       select 1 from public.matter_parties p
       where p.matter_id = mt.id and p.client_id = p_client_id
     )
  order by m.due_date, m.created_at;
$$;

revoke all on function public.client_payment_milestones(uuid) from public;
grant execute on function public.client_payment_milestones(uuid) to authenticated;

grant select, insert, update, delete on public.client_contacts to authenticated;
grant select, insert, update, delete on public.payment_milestones to authenticated;
