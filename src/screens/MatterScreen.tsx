import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { STATUS_LABEL, type Matter, type MatterStatus } from "@/lib/matters";
import {
  addNote,
  addParty,
  getMatter,
  getParties,
  getTimeline,
  PARTY_SIDE_LABEL,
  setMatterStatus,
  type Activity,
  type Party,
  type PartySide,
} from "@/lib/matter-detail";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

const KIND_LABEL: Record<Activity["kind"], string> = {
  matter_opened: "התיק נפתח",
  note: "הערה",
  status_changed: "שינוי סטטוס",
  party_added: "נוסף צד",
  document: "מסמך",
  charge: "חיוב",
  event: "אירוע",
};

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `היום ${time}` : `${d.toLocaleDateString("he-IL")} ${time}`;
}

function who(actor: Activity["actor"]): string {
  return actor?.full_name || actor?.email || "—";
}

export function MatterScreen({ matterId, onBack }: { matterId: string; onBack: () => void }) {
  const [matter, setMatter] = useState<Matter | null>(null);
  const [timeline, setTimeline] = useState<Activity[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [m, t, p] = await Promise.all([
        getMatter(matterId),
        getTimeline(matterId),
        getParties(matterId),
      ]);
      setMatter(m);
      setTimeline(t);
      setParties(p);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [matterId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <div className="p-6 text-sm text-muted">טוען...</div>;
  if (error) return <div className="p-6"><ErrorNote>{error}</ErrorNote></div>;
  if (!matter) return null;

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <Button variant="ghost" onClick={onBack} className="mb-3 px-0">
        ← כל התיקים
      </Button>

      <MatterHeader matter={matter} onChanged={reload} />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_20rem]">
        <section className="flex flex-col gap-4">
          <NoteComposer matterId={matterId} onAdded={reload} />
          <Timeline entries={timeline} />
        </section>

        <aside>
          <Parties matterId={matterId} parties={parties} onAdded={reload} />
        </aside>
      </div>
    </div>
  );
}

function MatterHeader({ matter, onChanged }: { matter: Matter; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(status: MatterStatus) {
    setBusy(true);
    setError(null);
    try {
      await setMatterStatus(matter.id, status);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm text-muted">#{matter.ref_no}</span>
        <h1 className="text-2xl font-bold">{matter.name}</h1>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <Fact label="לקוח" value={matter.client?.name} />
        <Fact label="תחום" value={matter.practice_area} />
        <Fact label="בית משפט" value={matter.court} />
        <Fact label="מספר בנט" value={matter.court_case_no} />
      </dl>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <span className="text-sm text-ink-soft">סטטוס:</span>
        {(["open", "on_hold", "closed"] as const).map((s) => (
          <button
            key={s}
            disabled={busy || matter.status === s}
            onClick={() => change(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              matter.status === s
                ? "bg-brand text-white"
                : "bg-ground text-ink-soft hover:bg-rule/60 disabled:opacity-50"
            }`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}:</dt>
      <dd className={value ? "font-semibold" : "text-muted"}>{value || "טרם הוזן"}</dd>
    </div>
  );
}

function NoteComposer({ matterId, onAdded }: { matterId: string; onAdded: () => void }) {
  const { membership, session } = useAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!membership || !session) return;
    setBusy(true);
    setError(null);
    try {
      await addNote({
        org_id: membership.org_id,
        matter_id: matterId,
        actor_user_id: session.user.id,
        body,
      });
      setBody("");
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="מה קרה בתיק? שיחה, החלטה, משהו שכדאי לזכור."
          rows={3}
          className="w-full resize-y rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                     outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex items-center justify-between">
          {/* Said once, here, where someone is about to write something. */}
          <span className="text-xs text-muted">רישום בציר הזמן אינו ניתן לעריכה או למחיקה.</span>
          <Button type="submit" disabled={busy || !body.trim()}>
            {busy ? "רושם..." : "הוסף לציר הזמן"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Timeline({ entries }: { entries: Activity[] }) {
  return (
    <div className="flex flex-col">
      {entries.map((e, i) => (
        <div key={e.id} className="flex gap-3">
          {/* The rail: a dot per entry, a line between them. */}
          <div className="flex flex-col items-center">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
            {i < entries.length - 1 && <span className="w-px flex-1 bg-rule" />}
          </div>

          <div className="flex-1 pb-5">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <span className="font-semibold text-ink-soft">{KIND_LABEL[e.kind]}</span>
              <span>·</span>
              <span>{who(e.actor)}</span>
              <span>·</span>
              <time dateTime={e.occurred_at}>{when(e.occurred_at)}</time>
            </div>
            {e.body && (
              <p className="mt-1 text-sm whitespace-pre-wrap">
                {e.kind === "status_changed" ? translateStatusChange(e.body) : e.body}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The trigger stores the raw enum pair; the reader gets Hebrew. */
function translateStatusChange(body: string): string {
  return body
    .split(" → ")
    .map((s) => STATUS_LABEL[s as MatterStatus] ?? s)
    .join(" ← ");
}

function Parties({
  matterId,
  parties,
  onAdded,
}: {
  matterId: string;
  parties: Party[];
  onAdded: () => void;
}) {
  const { membership } = useAuth();
  const [adding, setAdding] = useState(false);
  const [side, setSide] = useState<PartySide>("opposing");
  const [name, setName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!membership) return;
    setBusy(true);
    setError(null);
    try {
      await addParty({
        org_id: membership.org_id,
        matter_id: matterId,
        side,
        name,
        national_id: nationalId,
      });
      setName("");
      setNationalId("");
      setAdding(false);
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">צדדים</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="text-sm font-semibold text-brand underline underline-offset-2"
          >
            הוסף
          </button>
        )}
      </div>

      {parties.length === 0 && !adding && (
        <p className="text-sm text-ink-soft">
          עוד לא נרשמו צדדים. צד שכנגד שנרשם כאן נכנס לבדיקות ניגוד עניינים עתידיות.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {parties.map((p) => (
          <li key={p.id} className="flex flex-col">
            <span className="font-semibold">{p.name}</span>
            <span className="text-xs text-muted">
              {PARTY_SIDE_LABEL[p.side]}
              {p.national_id && (
                <>
                  <span className="mx-1">·</span>
                  <span dir="ltr">{p.national_id}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {adding && (
        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-rule pt-3">
          <div className="flex flex-wrap gap-1.5">
            {(["opposing", "client", "other"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  side === s ? "bg-brand text-white" : "bg-ground text-ink-soft"
                }`}
              >
                {PARTY_SIDE_LABEL[s]}
              </button>
            ))}
          </div>
          <Field label="שם" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          <Field
            label="ת.ז. / ח.פ."
            value={nationalId}
            onChange={(e) => setNationalId(e.target.value)}
            dir="ltr"
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "שומר..." : "שמור"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              ביטול
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
