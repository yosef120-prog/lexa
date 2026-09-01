import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { listClients, softDeleteClient, type Client } from "@/lib/clients";
import { listMatters, STATUS_LABEL, type Matter } from "@/lib/matters";
import { listClientDocuments, type DocumentGroup } from "@/lib/documents";
import { listClientIntakes, type ClientIntake } from "@/lib/intake";
import { IntakePanel } from "@/components/intake-panel";
import { ClientDocuments } from "@/components/client-documents";
import { DeleteButton } from "@/components/delete-button";
import { Button, Card, ErrorNote } from "@/components/ui";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // The clients list is short and already policy-filtered; a dedicated
      // single-row query would be a second endpoint to keep in step for no gain
      // at this size.
      const [all, ms, docs, ins] = await Promise.all([
        listClients(),
        listMatters(),
        listClientDocuments(clientId),
        listClientIntakes(clientId),
      ]);
      setClient(all.find((c) => c.id === clientId) ?? null);
      setMatters(ms.filter((m) => m.client?.id === clientId));
      setDocuments(docs);
      setIntakes(ins);
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

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-bold">{client.name}</h1>
          <span className="rounded-full bg-ground px-2.5 py-1 text-xs font-semibold text-ink-soft">
            {client.kind === "company" ? "חברה" : "אדם פרטי"}
          </span>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Fact label={client.kind === "company" ? "ח.פ." : "ת.ז."} value={client.national_id} ltr />
          <Fact label="טלפון" value={client.phone} ltr />
          <Fact label="אימייל" value={client.email} ltr />
        </dl>

        <div className="border-t border-rule pt-3">
          <DeleteButton
            label="מחק לקוח"
            what={client.name}
            consequence={
              matters.length > 0
                ? `הלקוח יירד מהרשימה. ${matters.length} התיקים שלו, המסמכים והחיובים נשארים כפי שהם.`
                : "הלקוח יירד מהרשימה. המסמכים והרישומים שלו נשארים כפי שהם."
            }
            onDelete={async () => {
              await softDeleteClient(clientId);
              onBack();
            }}
          />
        </div>
      </Card>

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
