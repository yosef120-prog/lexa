-- A questionnaire that comes back without everything.
--
-- The model so far was: sent, filled in once, closed. Real clients do not work
-- that way. Somebody has the deed but has to ask the bank for the mortgage
-- statement, and the choice we were giving them was to abandon the form or to
-- upload nothing. Both mean the lawyer chases them anyway, which is the thing
-- this feature exists to stop.
--
-- So a document request now has three answers, not one: here it is, I will
-- send it later, it does not apply to me. Anything left as "later" keeps the
-- form open, and the same link — reopened whenever the document turns up —
-- shows only what is still outstanding.
--
-- Nothing new is issued for that. A second link would mean two live tokens for
-- one client, and the one they find first would be the wrong one.

create type public.answer_status as enum ('provided', 'later', 'not_applicable');

alter table public.intake_answers
  add column status public.answer_status;

comment on column public.intake_answers.status is
  'For a document request: whether it was attached, is still coming, or does '
  'not apply. Null for every other kind of question.';

-- 'partial' is the state between the first submission and the last document.
alter type public.intake_status add value if not exists 'partial';
