import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  createClient,
  listClients,
  runConflictCheck,
  type Client,
  type ConflictHit,
} from "@/lib/clients";
import { count } from "@/lib/hebrew";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

const SOURCE_LABEL: Record<string, string> = {
  party_opposing: "צד שכנגד",
  party_client: "לקוח בתיק",
  party_other: "צד נוסף",
};

export function ClientsScreen({ onOpenClient }: { onOpenClient: (id: string) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setClients(await listClients());
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
          <h1 className="text-2xl font-bold">לקוחות</h1>
          <p className="text-sm text-muted">
            {loading ? "טוען..." : count(clients.length, "לקוח אחד במשרד", "לקוחות במשרד")}
          </p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}>לקוח חדש</Button>}
      </div>

      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}

      {adding && (
        <div className="mb-6">
          <NewClientForm
            onDone={async () => {
              setAdding(false);
              await reload();
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {!loading && clients.length === 0 && !adding && (
        <Card className="text-center text-sm text-ink-soft">
          עוד אין לקוחות. הראשון מתחיל בכפתור למעלה.
        </Card>
      )}

      {clients.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="bg-ground text-xs text-ink-soft">
              <tr>
                <th className="p-3 text-start font-semibold">שם</th>
                <th className="p-3 text-start font-semibold">ת.ז. / ח.פ.</th>
                <th className="p-3 text-start font-semibold">טלפון</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-rule">
                  <td className="p-3 font-semibold">
                    <button
                      onClick={() => onOpenClient(c.id)}
                      className="text-brand underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </button>
                  </td>
                  <td className="p-3 text-ink-soft" dir="ltr">{c.national_id ?? "—"}</td>
                  <td className="p-3 text-ink-soft" dir="ltr">{c.phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function NewClientForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { membership } = useAuth();
  const [name, setName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<"individual" | "company">("individual");

  const [hits, setHits] = useState<ConflictHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The check is a gate, not a formality: nothing is saved before it has run
  // once for these details.
  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setHits(await runConflictCheck(name, nationalId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      await createClient({
        org_id: membership.org_id,
        kind,
        name,
        national_id: nationalId,
        phone,
        email,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  // Editing the identifying details invalidates the check that was run on the
  // old ones.
  function edited<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setHits(null);
    };
  }

  return (
    <Card>
      <form onSubmit={check} className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">לקוח חדש</h2>

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

        <Field
          label="שם"
          value={name}
          onChange={(e) => edited(setName)(e.target.value)}
          autoFocus
          required
        />
        <Field
          label={kind === "individual" ? "תעודת זהות" : "ח.פ."}
          value={nationalId}
          onChange={(e) => edited(setNationalId)(e.target.value)}
          dir="ltr"
          hint="מקפים ורווחים לא משנים לבדיקה."
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="טלפון" value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" />
          <Field
            label="אימייל"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
          />
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {hits === null ? (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "בודק..." : "בדוק ניגוד עניינים"}
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              ביטול
            </Button>
          </div>
        ) : (
          <ConflictResult hits={hits} busy={busy} onSave={save} onCancel={onCancel} />
        )}
      </form>
    </Card>
  );
}

function ConflictResult({
  hits,
  busy,
  onSave,
  onCancel,
}: {
  hits: ConflictHit[];
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {hits.length === 0 ? (
        <div className="rounded-md bg-ground px-3 py-2.5 text-sm">
          <p className="font-semibold">לא נמצאה התאמה בין לקוחות המשרד.</p>
          {/* Said plainly, because a lawyer relying on this needs to know what
              it did and did not look at. */}
          <p className="mt-1 text-ink-soft">
            הבדיקה השוותה מול לקוחות קיימים בלבד. היא אינה אישור שאין ניגוד עניינים.
          </p>
        </div>
      ) : (
        <div className="rounded-md bg-danger/10 px-3 py-2.5 text-sm" role="alert">
          <p className="font-semibold text-danger">
            נמצאו {hits.length} התאמות אפשריות
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {hits.map((h) => (
              <li key={h.match_id} className="flex flex-col">
                <span className="font-semibold">
                  {h.match_name}
                  {/* An opposing party is the serious case, so it is named
                      first and not left to be inferred from the matter. */}
                  {h.source !== "client" && (
                    <span className="mr-1.5 rounded bg-danger/20 px-1.5 py-0.5 text-xs">
                      {SOURCE_LABEL[h.source] ?? "צד בתיק"}
                    </span>
                  )}
                </span>
                <span className="text-xs text-ink-soft">
                  {h.matched_on === "national_id" ? "התאמה במספר זהות" : "התאמה בשם"}
                  {h.national_id && ` · ${h.national_id}`}
                  {h.matter_ref !== null && ` · תיק #${h.matter_ref} ${h.matter_name ?? ""}`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-ink-soft">
            הבדיקה נשמרה. אפשר להמשיך בכל זאת — ההחלטה שלך.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" onClick={onSave} disabled={busy}>
          {busy ? "שומר..." : hits.length > 0 ? "המשך ושמור בכל זאת" : "שמור לקוח"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </div>
  );
}
