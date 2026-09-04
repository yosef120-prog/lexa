-- Where exactly, and searching a sentence rather than a word.
--
-- Three things the first version could not do.
--
-- It could say a file matched and not where in it. "It is in the contract" is
-- not an answer when the contract is forty pages.
--
-- It could only be given one word. A lawyer thinking "מתי משולם התשלום הראשון"
-- had to guess which single word to try, and guessing wrong looks exactly like
-- the document not existing.
--
-- And it was asymmetric about Hebrew. Substring matching means "חוזה" finds
-- "בחוזה", because the second contains the first — but "בחוזה" finds nothing in
-- a document that says "חוזה", which is the direction a person typing a whole
-- sentence actually hits.

-- ------------------------------------------------------------------ pages

alter table public.documents
  add column text_pages jsonb;

comment on column public.documents.text_pages is
  'One string per page, so a hit can say which page it is on. text_content is '
  'the same text joined, kept because the AI search wants one blob.';

-- Everything already read was read before pages existed, so it has text and no
-- page numbers. Queued again rather than left half-answered: a search that can
-- name the page for files read after today and not for files read before it is
-- worse than one that is simply consistent.
update public.documents
set text_state = 'pending'
where text_state = 'done' and text_pages is null;

-- ------------------------------------------------------------------ hebrew

/**
 * Hebrew's five final letters, written as their ordinary forms.
 *
 * ך ם ן ף ץ are the same letters as כ מ נ פ צ, written differently because
 * they end a word. To a substring search they are different characters
 * entirely, which is why "תשלום" did not find "תשלומים": the first ends in a
 * final mem and the second carries an ordinary one in the middle. Every plural
 * and every suffix in the language hits this.
 *
 * The mapping is one character to one, so an offset into the folded text is
 * the same offset in the original — which is what lets the snippet be cut from
 * the real words rather than the folded ones.
 */
create or replace function public.hebrew_fold(t text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select translate(lower(coalesce(t, '')), 'ךםןףץ', 'כמנפצ');
$$;

/**
 * A word with its Hebrew prefixes taken off.
 *
 * ו, ה, ב, כ, ל, מ and ש attach to the front of a Hebrew word and change
 * nothing a searcher cares about: חוזה, החוזה, בחוזה and והחוזה are the same
 * word to somebody looking for it. Substring matching already handles one
 * direction — searching חוזה finds בחוזה, because the longer word contains the
 * shorter. This handles the other: searching בחוזה should find חוזה.
 *
 * At most two letters come off, and never below four characters. The bound
 * was three until "משולם" came back as "ולם" — a fragment that is inside
 * עולם, אולם and שולם alike, and would have quietly turned a search for one
 * word into a search for a syllable.
 *
 * A dictionary would do this properly. Postgres has no Hebrew one, and this
 * covers the cases a person actually types.
 */
create or replace function public.hebrew_stem(w text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  s text := btrim(coalesce(w, ''));
  i int := 0;
begin
  while i < 2 and length(s) >= 5 and left(s, 1) in ('ו', 'ה', 'ב', 'כ', 'ל', 'מ', 'ש') loop
    s := substr(s, 2);
    i := i + 1;
  end loop;
  return s;
end;
$$;

/**
 * The words worth searching for in what somebody typed.
 *
 * Punctuation goes, and so do the words that appear in every document ever
 * written: a query containing "של" would otherwise match everything and rank
 * by nothing.
 */
create or replace function public.search_words(q text)
returns table (word text, stem text)
language sql
immutable
set search_path = public, pg_catalog
as $$
  select distinct w, public.hebrew_stem(w)
  from (
    select btrim(regexp_replace(lower(t), '[^[:alnum:]֐-׿]', '', 'g')) as w
    from regexp_split_to_table(coalesce(q, ''), '\s+') as t
  ) x
  where length(w) >= 2
    and w not in (
      'של','את','על','עם','לא','זה','זו','אני','הוא','היא','אם','כי','גם','או',
      'יש','אין','מה','מי','לי','לו','לה','הם','הן','אל','כל','רק','אבל','כך',
      'the','and','for','with','this','that','from','are','was'
    );
$$;

-- ------------------------------------------------------------------ search

-- The return type gains three columns, and `create or replace` cannot change
-- one. Every caller is in this repository.
drop function if exists public.search_client_documents(uuid, text);

/**
 * Searching one client's documents, by a word or by a whole sentence.
 *
 * Runs as the caller so row level security answers for it — the rule every
 * search in this schema follows, because a search that reached past the firm
 * would be the worst bug in the product and the safest way not to write one is
 * to never hold the privilege.
 *
 * A sentence is treated as the words in it. A document that has four of the
 * five ranks above one that has two, which is what makes typing a question
 * useful rather than a way to match nothing: an exact-phrase search over a
 * scanned contract almost always returns empty, and the searcher learns
 * nothing from that.
 *
 * The page comes from the same lateral join that does the matching, so it is
 * the page the words are actually on rather than a second guess afterwards.
 */
create or replace function public.search_client_documents(p_client_id uuid, q text)
returns table (
  id           uuid,
  filename     text,
  mime         text,
  bucket       text,
  storage_path text,
  created_at   timestamptz,
  where_found  text,     -- 'filename' | 'content'
  page         integer,  -- null when the file has no pages to speak of
  pages        integer,  -- how many it has, so "3" can read as "3 of 12"
  matched      text[],   -- which of the searched words were found
  asked        integer,  -- how many were searched for
  snippet      text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with
  terms as (select word, stem from public.search_words(q)),
  asked as (select count(*)::int as n from terms),

  mine as (
    select d.id, d.filename, d.mime, d.bucket, d.storage_path, d.created_at,
           coalesce(d.text_pages, '[]'::jsonb) as pages
    from public.documents d
    where d.deleted_at is null and d.client_id = p_client_id
  ),

  -- Every page of every document against every word. Small numbers on both
  -- sides: a client has tens of documents, and a query has a handful of words.
  hits as (
    select m.id, t.word, p.ordinality::int as page, p.value as body,
           position(public.hebrew_fold(t.stem) in public.hebrew_fold(p.value)) as at
    from mine m
    cross join terms t
    cross join lateral jsonb_array_elements_text(m.pages) with ordinality as p(value, ordinality)
    where public.hebrew_fold(p.value) like '%' || public.hebrew_fold(t.stem) || '%'
  ),

  -- The name counts as a match too, and outranks the contents: somebody typing
  -- "נסח" usually wants the file called that.
  named as (
    select m.id, t.word
    from mine m
    cross join terms t
    where public.hebrew_fold(m.filename) like '%' || public.hebrew_fold(t.stem) || '%'
  ),

  -- Every word found anywhere in the document, which is what the score is.
  words as (
    select id, array_agg(distinct word) as words
    from hits
    group by id
  ),

  per_page as (
    select id, page, count(distinct word) as found, min(at) filter (where at > 0) as at
    from hits
    group by id, page
  ),

  -- The page to send somebody to is the one where most of what they asked
  -- about appears, not merely the first page containing any one of the words.
  -- On a tie the earlier page wins: a term is usually defined before it is
  -- used again.
  best as (
    select distinct on (id) id, page, at
    from per_page
    order by id, found desc, page
  ),

  scored as (
    select
      m.id, m.filename, m.mime, m.bucket, m.storage_path, m.created_at,
      jsonb_array_length(m.pages) as page_count,
      b.page, b.at,
      (select array_agg(distinct w) from (
         select word as w from named n where n.id = m.id
         union
         select unnest(coalesce(wd.words, '{}')) as w
       ) u) as matched,
      exists (select 1 from named n where n.id = m.id) as in_name
    from mine m
    left join best b on b.id = m.id
    left join words wd on wd.id = m.id
    where b.id is not null or exists (select 1 from named n where n.id = m.id)
  )

  select
    s.id, s.filename, s.mime, s.bucket, s.storage_path, s.created_at,
    case when s.in_name then 'filename' else 'content' end,
    s.page,
    nullif(s.page_count, 0),
    s.matched,
    (select n from asked),
    case
      when s.at is null then null
      else '…' || substr(
             (select h.body from hits h where h.id = s.id and h.page = s.page limit 1),
             greatest(1, s.at - 60), 220
           ) || '…'
    end
  from scored s
  order by
    -- Most of the sentence first. A document holding four of the five words is
    -- the one the searcher meant, whatever its name is.
    coalesce(array_length(s.matched, 1), 0) desc,
    s.in_name desc,
    s.created_at desc
  limit 50;
$$;

revoke all on function public.search_client_documents(uuid, text) from public;
grant execute on function public.search_client_documents(uuid, text) to authenticated;
revoke all on function public.hebrew_stem(text) from public;
revoke all on function public.search_words(text) from public;
grant execute on function public.hebrew_stem(text) to authenticated;
revoke all on function public.hebrew_fold(text) from public;
grant execute on function public.hebrew_fold(text) to authenticated;
grant execute on function public.search_words(text) to authenticated;
