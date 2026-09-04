-- Stop words wear prefixes too, and three letters is not a search term.
--
-- Found by searching "מתי נמסרת החזקה ומה גובה התמורה" over a real card. It
-- offered a land registry extract as a match, on the strength of the word
-- "ומה" — which is "מה" with a vav in front, is not a search term in any
-- language, and matched because "רשומה" happens to contain those three
-- letters. A search that answers a question with a document sharing a
-- syllable with it teaches the firm to stop trusting the results.
--
-- Two changes. A word is now checked against the stop list after its prefixes
-- come off as well as before, so "ומה", "והמה" and "שמה" go the same way "מה"
-- already did. And question words join the list: "מתי" and "כמה" appear in no
-- contract ever written, and counting them only made a good match read as two
-- out of six.
--
-- The stem must also reach three characters to be searched at all. Two letters
-- inside a Hebrew document match somewhere every time.

create or replace function public.search_words(q text)
returns table (word text, stem text)
language sql
immutable
set search_path = public, pg_catalog
as $$
  with
  stops as (
    select unnest(array[
      'של','את','על','עם','לא','זה','זו','אני','הוא','היא','אם','כי','גם','או',
      'יש','אין','מה','מי','לי','לו','לה','הם','הן','אל','כל','רק','אבל','כך',
      -- Question words. A person types them; a document never contains them,
      -- and counting them makes three matches out of four read as three out
      -- of six.
      'מתי','כמה','איפה','למה','מדוע','האם','היכן','כיצד','מיהו','אילו','איזה',
      'the','and','for','with','this','that','from','are','was','how','when'
    ]) as w
  ),
  typed as (
    select btrim(regexp_replace(lower(t), '[^[:alnum:]֐-׿]', '', 'g')) as w
    from regexp_split_to_table(coalesce(q, ''), '\s+') as t
  ),
  -- Both strip depths, separately. A greedy {1,2} took two letters off "ומה"
  -- and produced "ה", which is in no list and let the word through — the exact
  -- bug this file exists to fix, reintroduced by the regex that was meant to
  -- fix it. One letter and two letters are different questions and are asked
  -- separately.
  bared as (
    select w,
           regexp_replace(w, '^[והבכלמש]', '')            as bare1,
           regexp_replace(w, '^[והבכלמש][והבכלמש]', '')   as bare2,
           public.hebrew_stem(w)                          as stem
    from typed
    where length(w) >= 2
  )
  select distinct w, stem
  from bared
  where length(stem) >= 3
    and w     not in (select w from stops)
    and bare1 not in (select w from stops)
    and bare2 not in (select w from stops);
$$;

revoke all on function public.search_words(text) from public;
grant execute on function public.search_words(text) to authenticated;
