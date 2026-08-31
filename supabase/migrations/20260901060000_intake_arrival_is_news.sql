-- Telling the firm that a client answered.
--
-- Until now a submitted questionnaire sat on a client card waiting to be
-- noticed. The whole point of the feature is that chasing documents stops
-- being the lawyer's job, and that only works if the arrival announces itself.
--
-- Two separate facts, deliberately kept apart, the same way an event's
-- remind_at and reminded_at are:
--
--   reviewed_at — somebody at the firm has looked at it
--   notified_at — the daily mail has gone out about it
--
-- Collapsing them into one column would mean that reading the banner cancels
-- the email, or that the email marks it read. Neither is true, and the version
-- that quietly stops the mail is the one that loses a client's documents in a
-- busy week.

alter table public.client_intakes
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.profiles (id) on delete set null,
  add column notified_at timestamptz;

-- What is waiting to be looked at. Small and hot: every screen load asks.
create index client_intakes_unreviewed_idx on public.client_intakes (org_id, submitted_at desc)
  where status = 'submitted' and reviewed_at is null;

-- What the mail job asks for, which is a different question.
create index client_intakes_unnotified_idx on public.client_intakes (submitted_at)
  where status = 'submitted' and notified_at is null;

comment on column public.client_intakes.reviewed_at is
  'When someone at the firm looked. Set from the app; never by the mail job.';
comment on column public.client_intakes.notified_at is
  'When the daily mail went out. Set by the job; never by the app.';
