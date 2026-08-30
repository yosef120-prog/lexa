-- Stage 8, the half that does not need a PDF engine: choosing what goes into a
-- court filing and in what order.
--
-- The rendering service does not exist yet -- Cloudflare cannot compile the
-- WebAssembly that PDF layout needs, which is why a separate Node container is
-- planned. So a bundle is assembled, ordered and reviewed here, and sits in
-- 'draft' until something can build it. The status says which of those it is
-- rather than implying a file exists.

create type public.filing_status as enum (
  'draft',      -- being assembled
  'building',   -- handed to the renderer
  'ready',      -- a PDF exists and can be downloaded
  'failed',     -- the renderer refused it; error says why
  'submitted'   -- the lawyer filed it and said so
);

create table public.filing_bundles (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations (id) on delete cascade,
  matter_id          uuid not null references public.matters (id) on delete cascade,

  title              text not null check (length(btrim(title)) between 1 and 300),
  -- The pleading itself. Everything else is an appendix behind it.
  main_document_id   uuid references public.documents (id) on delete set null,

  status             public.filing_status not null default 'draft',
  output_document_id uuid references public.documents (id) on delete set null,
  page_count         integer check (page_count >= 0),
  error              text,

  -- Recorded by hand: nothing here talks to נט המשפט, and pretending otherwise
  -- would be the most dangerous thing this table could do.
  submitted_at       timestamptz,
  submitted_note     text,

  created_by         uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A bundle that claims to be ready must have something to hand over.
  constraint filing_ready_has_output
    check (status <> 'ready' or output_document_id is not null),
  constraint filing_submitted_has_date
    check ((status = 'submitted') = (submitted_at is not null))
);

create index filing_bundles_matter_idx on public.filing_bundles (matter_id);

-- Appendix order is the whole point: נספח א׳ is the first one, and a court
-- reads them in the order the index promises.
create table public.filing_bundle_items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  bundle_id   uuid not null references public.filing_bundles (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete restrict,
  position    integer not null check (position > 0),

  unique (bundle_id, position),
  -- The same exhibit twice is a mistake every time.
  unique (bundle_id, document_id)
);

create index filing_bundle_items_bundle_idx on public.filing_bundle_items (bundle_id, position);

-- ---------------------------------------------------------------- rls

alter table public.filing_bundles      enable row level security;
alter table public.filing_bundle_items enable row level security;

create policy filing_bundles_read on public.filing_bundles
  for select to authenticated
  using (public.is_org_member(org_id));

create policy filing_bundles_insert on public.filing_bundles
  for insert to authenticated
  with check (public.is_org_member(org_id));

create policy filing_bundles_update on public.filing_bundles
  for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy filing_items_read on public.filing_bundle_items
  for select to authenticated
  using (public.is_org_member(org_id));

create policy filing_items_write on public.filing_bundle_items
  for all to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create trigger audit after insert or update or delete on public.filing_bundles
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------- timeline

create or replace function public.log_filing_submitted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    insert into public.matter_activity
      (org_id, matter_id, kind, actor_user_id, body, ref_table, ref_id)
    values
      (new.org_id, new.matter_id, 'document', auth.uid(),
       'הוגש: ' || new.title ||
         coalesce(' · ' || nullif(btrim(coalesce(new.submitted_note, '')), ''), ''),
       'filing_bundles', new.id);
  end if;
  return new;
end;
$$;

create trigger log_submitted after update on public.filing_bundles
  for each row execute function public.log_filing_submitted();

grant select, insert, update         on public.filing_bundles      to authenticated;
grant select, insert, update, delete on public.filing_bundle_items to authenticated;
