import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { listClients, type Client } from "@/lib/clients";
import {
  createMatter,
  listMatters,
  PRACTICE_AREAS,
  STATUS_LABEL,
  type Matter,
} from "@/lib/matters";
import { count } from "@/lib/hebrew";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

export function MattersScreen({
  onGoToClients,
  onOpenMatter,
}: {
  onGoToClients: () => void;
  onOpenMatter: (id: string) => void;
}) {
  const [matters, setMatters] = useState<Matter[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([listMatters(), listClients()]);
      setMatters(m);
      setClients(c);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">תיקים</h1>
          <p className="text-sm text-muted">
            {loading ? "טוען..." : count(matters.length, "תיק אחד", "תיקים")}
          </p>
        </div>
        {!adding && clients.length > 0 && (
          <Button onClick={() => setAdding(true)}>תיק חדש</Button>
        )}
      </div>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {/* A matter needs a client, so say that rather than showing a form that
          cannot be completed. */}
      {!loading && clients.length === 0 && (
        <Card className="flex flex-col items-start gap-3">
          <p className="text-sm text-ink-soft">
            תיק נפתח תמיד עבור לקוח, ועוד אין לקוחות במשרד.
          </p>
          <Button onClick={onGoToClients}>לפתוח לקוח קודם</Button>
        </Card>
      )}

      {adding && (
        <div className="mb-6">
          <NewMatterForm
            clients={clients}
            onDone={async () => {
              setAdding(false);
              await reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {!loading && clients.length > 0 && matters.length === 0 && !adding && (
        <Card className="text-center text-sm text-ink-soft">
          עוד אין תיקים. פתיחת תיק לוקחת שלושה שדות.
        </Card>
      )}

      {matters.length > 0 && (
        <div className="flex flex-col gap-3">
          {matters.map((m) => (
            <Card key={m.id} className="p-0">
              <button
                type="button"
                onClick={() => onOpenMatter(m.id)}
                className="flex w-full items-start justify-between gap-4 p-4 text-start
                           transition-colors hover:bg-ground/60 sm:p-6"
              >
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-muted">#{m.ref_no}</span>
                  <span className="font-semibold">{m.name}</span>
                </div>
                <div className="text-sm text-ink-soft">
                  {m.client?.name ?? "—"}
                  {m.practice_area && (
                    <>
                      <span className="mx-1.5 text-rule">·</span>
                      {m.practice_area}
                    </>
                  )}
                </div>
              </div>
              <StatusPill status={m.status} />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Matter["status"] }) {
  const look =
    status === "open"
      ? "bg-brand/10 text-brand"
      : status === "on_hold"
        ? "bg-ground text-ink-soft"
        : "bg-rule/60 text-ink-soft";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${look}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function NewMatterForm({
  clients,
  onDone,
  onCancel,
}: {
  clients: Client[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { membership } = useAuth();
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [practiceArea, setPracticeArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      await createMatter({
        org_id: membership.org_id,
        client_id: clientId,
        name,
        practice_area: practiceArea,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">תיק חדש</h2>
          <p className="text-sm text-muted">
            שלושה שדות. בית המשפט ומספר התיק בנט נוספים בהמשך, כשהם קיימים.
          </p>
        </div>

        <Field
          label="שם התיק"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="לדוגמה: מכירת דירה ברחוב הרצל 12"
          autoFocus
          required
        />

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">לקוח</span>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                       outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            required
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <Field
          label="תחום"
          value={practiceArea}
          onChange={(e) => setPracticeArea(e.target.value)}
          list="practice-areas"
          hint="אפשר לבחור מהרשימה או לכתוב משלך."
        />
        <datalist id="practice-areas">
          {PRACTICE_AREAS.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !name.trim() || !clientId}>
            {busy ? "פותח..." : "פתח תיק"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            ביטול
          </Button>
        </div>
      </form>
    </Card>
  );
}
