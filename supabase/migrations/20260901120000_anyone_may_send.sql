-- Who may know that the firm's WhatsApp is connected.
--
-- Reading was restricted to owners, which got the wrong person. The owner is
-- who decides to connect it; the secretary is who sends twenty questionnaires
-- on a Sunday morning. With the row invisible to them the app concluded the
-- firm was not connected and quietly fell back to opening the app by hand —
-- exactly the work the connection exists to remove, for exactly the person
-- doing most of it.
--
-- Safe to open, because the protection here was never the row policy. The
-- token is unreadable to this role by column privilege, whatever any policy
-- says: a member can now see that a connection exists and which number it is,
-- and still cannot read the secret.
--
-- Changing it stays with owners.

drop policy whatsapp_owner_read on public.whatsapp_connections;

create policy whatsapp_member_read on public.whatsapp_connections
  for select to authenticated
  using (public.is_org_member(org_id));
