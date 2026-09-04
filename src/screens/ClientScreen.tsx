import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { listClients, softDeleteClient, updateClient, type Client } from "@/lib/clients";
import { listMatters, STATUS_LABEL, type Matter } from "@/lib/matters";
import { listClientDocuments, type DocumentGroup } from "@/lib/documents";
import { listClientIntakes, type ClientIntake } from "@/lib/intake";
import { listClientMilestones, type ClientMilestone } from "@/lib/payments";
import { IntakePanel } from "@/components/intake-panel";
import { ContactsPanel } from "@/components/contacts-panel";
import { DocumentSearch } from "@/components/document-search";
import { ClientPayments } from "@/components/payments-panel";
import { ClientDocuments } from "@/components/client-documents";
import { DeleteButton } from "@/components/delete-button";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * The client card.
 *
 * Until now a client was a row in a table and nothing else — which was fine
 * while everything hung off a matter, and stopped being fine the moment
 * documents could arrive before one existed. This is where a person's own
 * things live: what was asked of them, what they sent back, and which files
 * they are involved in.
 */
export function ClientScreen({
  clientId,
  onBack,
  onOpenMatter,
  onOpenIntakes,
}: {
  clientId: string;
  onBack: () => void;
  onOpenMatter: (id: string) => void;
  onOpenIntakes: () => void;
}) {
  const { membership } = useAuth();
  const [client, setClient] = useState<Client | null>(null);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [documents, setDocuments] = useState<DocumentGroup[]>([]);
  const [intakes, setIntakes] = useState<ClientIntake[]>([]);
  // Reached from either side of the deal, so this is not simply the matters
  // list filtered — a buyer linked as a party owns none of them.
  const [payments, setPayments] = useState<ClientMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // The clients list is short and already policy-filtered; a dedicated
      // single-row query would be a second endpoint to keep in step for no gain
      // at this size.
      const [all, ms, docs, ins, pays] = await Promise.all([
        listClients(),
        listMatters(),
        listClientDocuments(clientId),
        listClientIntakes(clientId),
        listClientMilestones(clientId),
      ]);
      setClient(all.find((c) => c.id === clientId) ?? null);
      setMatters(ms.filter((m) => m.client?.id === clientId));
      setDocuments(docs);
      setIntakes(ins);
      setPayments(pays);
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

  if (loading) return <div className="p-6 text-sm text-muted">טוען...</div>;
  if (error) return <div className="p-6"><ErrorNote>{error}</ErrorNote></div>;
  if (!client) return <div className="p-6 text-sm text-muted">הלקוח לא נמצא.</div>;

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <Button variant="ghost" onClick={onBack} className="mb-3 px-0">
        ← כל הלקוחות
      </Button>

      {editing ? (
        <Card>
          <ClientForm
            client={client}
            matterCount={matters.length}
            onSaved={async () => {
              setEditing(false);
              await reload();
            }}
            onDeleted={onBack}
            onCancel={() => setEditing(false)}
          />
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold">{client.name}</h1>
              <span className="rounded-full bg-ground px-2.5 py-1 text-xs font-semibold text-ink-soft">
                {client.kind === "company" ? "חברה" : "אדם פרטי"}
              </span>
            </div>
            {/* Editing is the ordinary reason to touch this card, so it is the
                one control here. Deleting lives inside it, two steps away
                rather than beside the phone number. */}
            <button
              onClick={() => setEditing(true)}
              className="shrink-0 rounded px-2 py-1 text-sm font-semibold text-brand hover:bg-brand/10"
            >
              ערוך
            </button>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Fact label={client.kind === "company" ? "ח.פ." : "ת.ז."} value={client.national_id} ltr />
            <Fact label="טלפון" value={client.phone} ltr />
            <Fact label="אימייל" value={client.email} ltr />
          </dl>
        </Card>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_22rem]">
        <section className="flex flex-col gap-5">
          <IntakePanel
            orgId={membership?.org_id ?? ""}
            clientId={clientId}
            clientName={client.name}
            clientPhone={client.phone}
            intakes={intakes}
            onChanged={reload}
            onEditForms={onOpenIntakes}
          />
          {/* Above the documents, because "when is the next payment" is asked
              far more often than "where is the contract" — and until now the
              only way to answer it was to open the contract. */}
          <ClientPayments rows={payments} onOpenMatter={onOpenMatter} />

          <ContactsPanel clientId={clientId} matters={matters} />

          {/* Above the list, because a card with thirty files is exactly the
              card where scrolling the list stops working. */}
          {documents.length > 0 && <DocumentSearch clientId={clientId} />}

          <ClientDocuments
            orgId={membership?.org_id ?? ""}
            clientId={clientId}
            groups={documents}
            onChanged={reload}
          />
        </section>

        <aside>
          <Card className="flex flex-col gap-3">
            <h2 className="font-bold">תיקים</h2>
            {matters.length === 0 ? (
              <p className="text-sm text-ink-soft">אין תיקים פתוחים ללקוח הזה.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-rule">
                {matters.map((m) => (
                  <li key={m.id} className="py-2">
                    <button
                      onClick={() => onOpenMatter(m.id)}
                      className="flex w-full items-baseline gap-2 text-start"
                    >
                      <span className="font-mono text-xs text-muted">#{m.ref_no}</span>
                      <span className="flex-1 text-sm font-semibold underline-offset-2 hover:underline">
                        {m.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{STATUS_LABEL[m.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

/**
 * Correcting a client, and — at the bottom, behind its own confirmation —
 * removing one.
 *
 * Deleting used to sit on the card itself, one tap from the phone number
 * somebody came to check. It is a rare act with no undo in the interface, so
 * it belongs at the end of the screen you open on purpose.
 */
function ClientForm({
  client,
  matterCount,
  onSaved,
  onDeleted,
  onCancel,
}: {
  client: Client;
  matterCount: number;
  onSaved: () => Promise<void>;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState(client.kind);
  const [name, setName] = useState(client.name);
  const [nationalId, setNationalId] = useState(client.national_id ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateClient(client.id, { kind, name, national_id: nationalId, phone, email });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="text-lg font-bold">עריכת לקוח</h2>

      <div className="flex gap-2">
        {(["individual", "company"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              kind === k ? "bg-brand text-white" : "bg-ground text-ink-soft"
            }`}
          >
            {k === "individual" ? "אדם פרטי" : "חברה"}
          </button>
        ))}
      </div>

      <Field label="שם" value={name} onChange={(e) => setName(e.target.value)} required />
      <Field
        label={kind === "individual" ? "תעודת זהות" : "ח.פ."}
        value={nationalId}
        onChange={(e) => setNationalId(e.target.value)}
        dir="ltr"
        hint="משמש לבדיקות ניגוד עניינים, אז שווה שיהיה מדויק."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="טלפון"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
          hint="לשליחת שאלון בוואטסאפ."
        />
        <Field
          label="אימייל"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          dir="ltr"
        />
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "שומר..." : "שמור"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>

      <div className="border-t border-rule pt-4">
        <DeleteButton
          label="מחק לקוח"
          what={client.name}
          consequence={
            matterCount > 0
              ? `הלקוח יירד מהרשימה. ${matterCount} התיקים שלו, המסמכים והחיובים נשארים כפי שהם.`
              : "הלקוח יירד מהרשימה. המסמכים והרישומים שלו נשארים כפי שהם."
          }
          onDelete={async () => {
            await softDeleteClient(client.id);
            onDeleted();
          }}
        />
      </div>
    </form>
  );
}

function Fact({ label, value, ltr }: { label: string; value?: string | null; ltr?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}:</dt>
      <dd className={value ? "font-semibold" : "text-muted"} dir={ltr && value ? "ltr" : undefined}>
        {value || "טרם הוזן"}
      </dd>
    </div>
  );
}
