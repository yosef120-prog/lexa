-- Searching inside the files, not only across their names.
--
-- Two searches, because they answer different questions at different prices.
--
-- The plain one reads text the firm already holds: a substring match over what
-- was extracted from each file. Free, instant, and it finds what it finds — a
-- word that is in a document, spelled the way the searcher spelled it.
--
-- Substring rather than Postgres full text search, and the reason is Hebrew.
-- There is no Hebrew dictionary in Postgres, so to_tsvector would fall back to
-- 'simple', which splits on whitespace and lowercases and nothing else. In a
-- language where "בחוזה", "והחוזה" and "לחוזה" are all the word חוזה wearing a
-- prefix, that indexes each of them as a different word and a lawyer searching
-- חוזה finds none of them. ILIKE '%חוזה%' finds all four.
--
-- Unindexed, deliberately. A firm has hundreds of documents, not millions, and
-- scanning a few hundred text columns is not measurable. The index that would
-- help is GIN over pg_trgm, and adding it now would buy nothing while making
-- the schema depend on an extension the test harness cannot install — so the
-- thing that is tested would stop being the thing that runs. When a firm has
-- enough documents for this to be slow, that extension is the answer.
--
-- The AI one is in the next section, and costs money, which is why it is off
-- until a firm turns it on with its own key.

-- ---------------------------------------------------------------- the text

create type public.text_status as enum (
  'pending',    -- not looked at yet
  'done',       -- text was found and stored
  'no_text',    -- a real file with nothing to read: a photograph, a scan
  'unsupported',-- a type this stack cannot open
  'failed'      -- tried and could not; the reason is in text_error
);

alter table public.documents
  add column text_content   text,
  add column text_state     public.text_status not null default 'pending',
  add column text_error     text,
  add column text_read_at   timestamptz;

comment on column public.documents.text_content is
  'Text pulled out of the file so it can be searched. Null for a photograph, '
  'which has no text to pull; those are what the AI search is for.';

-- What the extractor asks for: the next few files nobody has read yet.
create index documents_text_pending_idx
  on public.documents (text_state, created_at)
  where deleted_at is null and text_state = 'pending';

/**
 * Searching one client's documents.
 *
 * Runs as the caller so row level security answers for it, the same rule
 * search_firm follows: a search that reached past the firm would be the worst
 * possible bug in this product, and the safest way not to write it is to never
 * hold the privilege.
 *
 * Both the name and the contents are searched, and a name match ranks first —
 * somebody typing "נסח" usually wants the file called that, not every file
 * mentioning it.
 */
create or replace function public.search_client_documents(p_client_id uuid, q text)
returns table (
  id        uuid,
  filename  text,
  mime      text,
  bucket    text,
  storage_path text,
  created_at timestamptz,
  where_found text,   -- 'filename' | 'content'
  snippet   text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with input as (select nullif(btrim(coalesce(q, '')), '') as term)
  select
    d.id, d.filename, d.mime, d.bucket, d.storage_path, d.created_at,
    case when d.filename ilike '%' || i.term || '%' then 'filename' else 'content' end,
    -- A window around the first hit, so the firm can see why this file came
    -- back without opening it. Null for a name match, where the name is the
    -- evidence.
    case
      when d.filename ilike '%' || i.term || '%' then null
      else
        '…' || substr(
          d.text_content,
          greatest(1, position(lower(i.term) in lower(d.text_content)) - 60),
          220
        ) || '…'
    end
  from public.documents d
  cross join input i
  where d.deleted_at is null
    and d.client_id = p_client_id
    and i.term is not null
    and (
      d.filename ilike '%' || i.term || '%'
      or (d.text_content is not null and d.text_content ilike '%' || i.term || '%')
    )
  order by
    case when d.filename ilike '%' || i.term || '%' then 0 else 1 end,
    d.created_at desc
  limit 50;
$$;

revoke all on function public.search_client_documents(uuid, text) from public;
grant execute on function public.search_client_documents(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the AI key

/**
 * A firm's own key for the AI search.
 *
 * The same shape as the WhatsApp gateway, and for the same reason: this is a
 * credential that spends the firm's money, and it must not be readable by the
 * application that offers the button. Column privileges, not a policy —
 * policies decide which rows you see and this is about a column. The app can
 * write the key and can never read it back, so "we accidentally sent the key
 * to the browser" is a database error rather than a code review.
 *
 * Off until a firm turns it on. Reading a client's documents with a model
 * costs per search, and this product is otherwise free to run; a firm that
 * does not want that expense keeps the plain search and loses nothing it had.
 */
create table public.ai_connections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,

  provider    text not null default 'anthropic' check (provider in ('anthropic')),
  api_key     text not null,

  -- Named rather than assumed, so a firm can move to a cheaper or better model
  -- without a migration.
  model       text not null default 'claude-sonnet-5',

  last_ok_at    timestamptz,
  last_error    text,
  last_error_at timestamptz,

  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (org_id)
);

alter table public.ai_connections enable row level security;

-- Every member may see that it is on, because every member uses the button.
-- Only an owner decides to spend the firm's money.
create policy ai_member_read on public.ai_connections
  for select to authenticated
  using (public.is_org_member(org_id));

create policy ai_owner_write on public.ai_connections
  for insert to authenticated
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy ai_owner_update on public.ai_connections
  for update to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.org_role[]));

create policy ai_owner_delete on public.ai_connections
  for delete to authenticated
  using (public.has_org_role(org_id, array['owner']::public.org_role[]));

-- The point of the table. Everything except the key is readable; the key can be
-- written and never read back. `select *` fails for the application by design.
grant select (
  id, org_id, provider, model, last_ok_at, last_error, last_error_at,
  created_by, created_at, updated_at
) on public.ai_connections to authenticated;

grant insert (org_id, provider, api_key, model) on public.ai_connections to authenticated;
grant update (api_key, model, updated_at) on public.ai_connections to authenticated;
grant delete on public.ai_connections to authenticated;

/**
 * The redaction, widened.
 *
 * It was written for whatsapp_connections and strips 'api_token'. This table's
 * secret is called 'api_key', so attaching the existing function here would
 * have written the key into audit_log — which every member of the firm can
 * read — carrying it straight past the column privileges above and handing it
 * to exactly the people they exist to keep it from. The protection would have
 * looked intact and been worthless.
 *
 * Both names are stripped now, from every table this is attached to. A third
 * secret under a fourth name is the failure this cannot prevent; the test
 * beside it is what catches that.
 */
create or replace function public.write_audit_redacted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old_j jsonb := case when tg_op = 'INSERT' then null
                 else to_jsonb(old) - 'api_token' - 'api_key' end;
  new_j jsonb := case when tg_op = 'DELETE' then null
                 else to_jsonb(new) - 'api_token' - 'api_key' end;
begin
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after)
  values (
    coalesce((new_j ->> 'org_id')::uuid, (old_j ->> 'org_id')::uuid),
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(new_j ->> 'id', old_j ->> 'id'),
    old_j,
    new_j
  );
  return coalesce(new, old);
end;
$$;

create trigger audit after insert or update or delete on public.ai_connections
  for each row execute function public.write_audit_redacted();
