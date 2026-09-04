import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  addContact,
  CHANNEL_LABEL,
  deleteContact,
  forDateTimeInput,
  listContacts,
  updateContact,
  type Contact,
  type ContactChannel,
} from "@/lib/contacts";
import type { Matter } from "@/lib/matters";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * The log of what was said.
 *
 * Written for the moment it is actually used: the phone is still at the ear,
 * the client is still talking, and whoever is typing has one hand. So the box
 * is open on arrival with the time already filled in — nothing to click before
 * you can start writing — and everything else is a default that can be changed
 * afterwards.
 */
export function ContactsPanel({
  clientId,
  matters,
}: {
  clientId: string;
  matters: Matter[];
}) {
  const { membership } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setContacts(await listContacts(clientId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">יומן שיחות</h2>
        <span className="text-xs text-muted">{contacts.length}</span>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <NewContact
        orgId={membership?.org_id ?? ""}
        clientId={clientId}
        matters={matters}
        onSaved={reload}
      />

      {loading ? (
        <p className="text-sm text-muted">טוען...</p>
      ) : contacts.length === 0 ? (
        <p className="text-sm text-muted">עוד לא תועדה שיחה עם הלקוח הזה.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-t border-rule">
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} matters={matters} onChanged={reload} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewContact({
  orgId,
  clientId,
  matters,
  onSaved,
}: {
  orgId: string;
  clientId: string;
  matters: Matter[];
  onSaved: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("phone_in");
  // Now, because a call is logged while it is happening. Editable, because
  // sometimes it is written up that evening.
  const [when, setWhen] = useState(() => forDateTimeInput(new Date().toISOString()));
  const [matterId, setMatterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addContact({
        orgId,
        clientId,
        matterId: matterId || null,
        channel,
        occurredAt: new Date(when).toISOString(),
        body,
      });
      setBody("");
      setWhen(forDateTimeInput(new Date().toISOString()));
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {/* The writing box first and always open. A "add note" button that
          reveals a box is one click between a ringing phone and a record. */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="מה נאמר בשיחה"
        className="w-full resize-y rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                   outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">סוג</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ContactChannel)}
            className="rounded-md border border-rule bg-surface px-2 py-1.5 text-sm"
          >
            {(Object.keys(CHANNEL_LABEL) as ContactChannel[]).map((k) => (
              <option key={k} value={k}>
                {CHANNEL_LABEL[k]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">מתי</span>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="rounded-md border border-rule bg-surface px-2 py-1.5 text-sm"
          />
        </label>

        {matters.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">תיק</span>
            <select
              value={matterId}
              onChange={(e) => setMatterId(e.target.value)}
              className="max-w-[12rem] rounded-md border border-rule bg-surface px-2 py-1.5 text-sm"
            >
              <option value="">ללא</option>
              {matters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <Button type="submit" disabled={busy || !body.trim()}>
          {busy ? "שומר..." : "שמור שיחה"}
        </Button>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
    </form>
  );
}

function ContactRow({
  contact,
  matters,
  onChanged,
}: {
  contact: Contact;
  matters: Matter[];
  onChanged: () => Promise<void>;
}) {
  const { session } = useAuth();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(contact.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = contact.actor_user_id === session?.user.id;
  const matter = matters.find((m) => m.id === contact.matter_id);
  const when = new Date(contact.occurred_at);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateContact(contact.id, { body });
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="rounded bg-ground px-1.5 py-0.5 text-xs font-semibold text-ink-soft">
          {CHANNEL_LABEL[contact.channel]}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {when.toLocaleDateString("he-IL")} · {when.toLocaleTimeString("he-IL", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {matter && <span className="text-xs text-muted">· {matter.name}</span>}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full resize-y rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                       outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy || !body.trim()}>
              {busy ? "שומר..." : "שמור"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setBody(contact.body);
                setEditing(false);
              }}
            >
              ביטול
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{contact.body}</p>
      )}

      <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
        <span>{contact.author?.full_name || contact.author?.email || "—"}</span>
        {/* Shown rather than hidden. A note that quietly changed is worth less
            than one that says it changed. */}
        {contact.edited_at && <span>· נערך {new Date(contact.edited_at).toLocaleDateString("he-IL")}</span>}
        {mine && !editing && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-brand underline underline-offset-2"
            >
              ערוך
            </button>
            <button
              type="button"
              onClick={async () => {
                await deleteContact(contact.id);
                await onChanged();
              }}
              className="text-danger underline underline-offset-2"
            >
              מחק
            </button>
          </>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
    </li>
  );
}
