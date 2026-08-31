-- Payment demands, assembled from time that has not been charged for.
--
-- This is a demand, not a tax invoice. The brief is explicit that the real
-- invoice comes out of Morning or iCount, and it is right: issuing one is a
-- regulated act, and building that is not a feature, it is a second product.
-- What lives here is the arithmetic and the record of what was demanded, with
-- room to note the number the real system gave it.

create type public.invoice_status as enum ('draft', 'issued', 'paid', 'cancelled');

create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  client_id     uuid not null references public.clients (id) on delete restrict,
  -- Nullable: a firm can bill a client across several matters at once.
  matter_id     uuid references public.matters (id) on delete set null,

  number        integer,
  status        public.invoice_status not null default 'draft',
  currency      text not null default 'ILS',

  subtotal      numeric(12, 2) not null default 0 check (subtotal >= 0),
  -- Stored rather than read from a constant: the rate on the day is part of the
  -- record, and Israeli VAT has changed twice in recent memory.
  vat_rate      numeric(5, 2)  not null default 18 check (vat_rate >= 0 and vat_rate <= 100),
  vat           numeric(12, 2) not null default 0 check (vat >= 0),
  total         numeric(12, 2) not null default 0 check (total >= 0),

  issued_at     timestamptz,
  due_date      date,
  paid_at       timestamptz,
  notes         text,

  -- Where the real tax invoice ended up, once someone issued it there.
  external_provider   text,
  external_invoice_id text,
  external_url        text,

  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Anything that went out to a client has a date on it. A draft has not gone
  -- anywhere yet, and a cancelled demand may never have — so neither is
  -- required to carry one.
  constraint invoice_issued_has_date
    check (status not in ('issued', 'paid') or issued_at is not null),
  constraint invoice_draft_has_no_date
    check (status <> 'draft' or issued_at is null),
  constraint invoice_paid_has_date
    check ((status = 'paid') = (paid_at is not null))
);

create index invoices_org_idx    on public.invoices (org_id, created_at desc);
create index invoices_client_idx on public.invoices (client_id);

create table public.invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  -- Set when the line came from recorded work, which is what lets the entry be
  -- released again if the demand is cancelled.
  time_entry_id uuid references public.time_entries (id) on delete set null,

  description   text not null,
  quantity      numeric(10, 2) not null check (quantity > 0),
  unit_price    numeric(12, 2) not null check (unit_price >= 0),
  amount        numeric(12, 2) not null check (amount >= 0),
  position      integer not null,

  unique (invoice_id, position)
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

-- Each firm numbers its demands from one, for the same reason matters do: a
-- number someone can say on the phone.
create table public.invoice_numbers (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  last   integer not null default 0
);

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_number integer;
begin
  insert into public.invoice_numbers (org_id, last)
  values (new.org_id, 1)
  on conflict (org_id) do update set last = public.invoice_numbers.last + 1
  returning last into next_number;

  new.number := next_number;
  return new;
end;
$$;

create trigger assign_number before insert on public.invoices
  for each row execute function public.assign_invoice_number();

create unique index invoices_org_number_idx on public.invoices (org_id, number);

-- ---------------------------------------------------------------- rls

alter table public.invoices        enable row level security;
alter table public.invoice_lines   enable row level security;
alter table public.invoice_numbers enable row level security;

-- Money is for the people who deal with money, matching the fee agreement.
create policy invoices_read on public.invoices
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]));

create policy invoices_update on public.invoices
  for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]));

create policy invoice_lines_read on public.invoice_lines
  for select to authenticated
  using (public.has_org_role(org_id, array['owner', 'lawyer']::public.org_role[]));

create policy invoice_numbers_read on public.invoice_numbers
  for select to authenticated
  using (public.is_org_member(org_id));

create trigger audit after insert or update or delete on public.invoices
  for each row execute function public.write_audit();

grant select, update on public.invoices        to authenticated;
grant select         on public.invoice_lines   to authenticated;
grant select         on public.invoice_numbers to authenticated;

-- ---------------------------------------------------------------- assembling

/**
 * Turns everything unbilled on a matter into one payment demand.
 *
 * Definer, and no insert policy exists for either table, because a demand and
 * its lines have to appear together or not at all. Two client-side inserts
 * could leave an invoice with no lines, or worse, time entries marked as billed
 * against a demand that was never created.
 */
create or replace function public.create_invoice_from_unbilled(
  p_matter_id uuid,
  p_vat_rate  numeric default 18
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m           public.matters;
  new_invoice uuid;
  line        record;
  seat        integer := 0;
  running     numeric(12, 2) := 0;
  vat_amount  numeric(12, 2);
begin
  select * into m from public.matters where id = p_matter_id and deleted_at is null;
  if m.id is null then
    raise exception 'MATTER_NOT_FOUND';
  end if;
  if not public.has_org_role(m.org_id, array['owner', 'lawyer']::public.org_role[]) then
    raise exception 'FORBIDDEN';
  end if;

  -- Priced work only. Time recorded without a rate is real work, but nobody can
  -- say what it is worth, and guessing on an invoice is the wrong kind of help.
  if not exists (
    select 1 from public.time_entries
    where matter_id = p_matter_id and deleted_at is null
      and invoice_id is null and billable and rate is not null
  ) then
    raise exception 'NOTHING_TO_BILL';
  end if;

  insert into public.invoices (org_id, client_id, matter_id, vat_rate)
  values (m.org_id, m.client_id, m.id, p_vat_rate)
  returning id into new_invoice;

  for line in
    select id, description, minutes, rate, started_at
    from public.time_entries
    where matter_id = p_matter_id and deleted_at is null
      and invoice_id is null and billable and rate is not null
    order by started_at
  loop
    seat := seat + 1;
    insert into public.invoice_lines
      (org_id, invoice_id, time_entry_id, description, quantity, unit_price, amount, position)
    values (
      m.org_id, new_invoice, line.id,
      coalesce(nullif(btrim(line.description), ''), 'עבודה בתיק') ||
        ' · ' || to_char(line.started_at, 'DD/MM/YYYY'),
      round(line.minutes / 60.0, 2),
      line.rate,
      round((line.minutes / 60.0) * line.rate, 2),
      seat
    );
    running := running + round((line.minutes / 60.0) * line.rate, 2);
  end loop;

  -- Claimed once the lines exist, so a failure above leaves the time free to be
  -- billed again rather than stranded.
  update public.time_entries
  set invoice_id = new_invoice
  where matter_id = p_matter_id and deleted_at is null
    and invoice_id is null and billable and rate is not null;

  vat_amount := round(running * p_vat_rate / 100, 2);

  update public.invoices
  set subtotal = running, vat = vat_amount, total = running + vat_amount,
      updated_at = now()
  where id = new_invoice;

  insert into public.matter_activity
    (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
  values (m.org_id, m.id, 'charge', auth.uid(),
          'דרישת תשלום על ' || to_char(running + vat_amount, 'FM999999990.00') || ' ₪',
          'invoices', new_invoice);

  return new_invoice;
end;
$$;

/** Cancelling releases the time, so the work can be billed again properly. */
create or replace function public.cancel_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice_id;
  if inv.id is null then
    raise exception 'INVOICE_NOT_FOUND';
  end if;
  if not public.has_org_role(inv.org_id, array['owner', 'lawyer']::public.org_role[]) then
    raise exception 'FORBIDDEN';
  end if;
  if inv.status = 'paid' then
    raise exception 'ALREADY_PAID';
  end if;

  update public.time_entries set invoice_id = null where invoice_id = p_invoice_id;
  update public.invoices
  set status = 'cancelled', issued_at = null, updated_at = now()
  where id = p_invoice_id;
end;
$$;

revoke all on function public.create_invoice_from_unbilled(uuid, numeric) from public;
revoke all on function public.cancel_invoice(uuid) from public;
grant execute on function public.create_invoice_from_unbilled(uuid, numeric) to authenticated;
grant execute on function public.cancel_invoice(uuid) to authenticated;
