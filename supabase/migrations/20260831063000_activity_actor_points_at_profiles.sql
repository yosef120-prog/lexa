-- Point the timeline's author at profiles rather than auth.users.
--
-- The feed has to show who wrote each entry, and the name lives in profiles.
-- With the foreign key aimed at auth.users there was no relationship PostgREST
-- could follow, so asking for the author failed the request outright and the
-- whole matter screen came back as an error.
--
-- profiles.id references auth.users with a cascade, so nothing is loosened: the
-- same values remain valid, and deleting the account still clears the row.

alter table public.matter_activity
  drop constraint matter_activity_actor_user_id_fkey;

alter table public.matter_activity
  add constraint matter_activity_actor_user_id_fkey
  foreign key (actor_user_id) references public.profiles (id) on delete set null;
