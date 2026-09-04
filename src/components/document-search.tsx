import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  askDocuments,
  getAiConnection,
  indexDocuments,
  readableCount,
  searchDocuments,
  type AiAnswer,
  type DocumentHit,
  type Readable,
} from "@/lib/doc-search";
import { getDownloadUrl, type DocumentRow } from "@/lib/documents";
import { Button, Card, ErrorNote } from "@/components/ui";

type Mode = "plain" | "ai";

/**
 * Searching inside a client's documents.
 *
 * Two searches, side by side, because they fail in opposite directions. The
 * plain one finds the letters you typed and cannot see a photograph. The AI
 * one reads the photograph and costs money every time it is asked.
 *
 * Which is why both are here rather than one clever box: the firm chooses,
 * knowing what each costs, instead of the software choosing for them.
 */
export function DocumentSearch({ clientId }: { clientId: string }) {
  const [mode, setMode] = useState<Mode>("plain");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<DocumentHit[] | null>(null);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [shelf, setShelf] = useState<Readable | null>(null);
  const [aiOn, setAiOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const survey = useCallback(async () => {
    try {
      setShelf(await readableCount(clientId));
    } catch {
      setShelf(null);
    }
  }, [clientId]);

  useEffect(() => {
    void survey();
    getAiConnection()
      .then((c) => setAiOn(Boolean(c)))
      .catch(() => setAiOn(false));

    // Reading the files happens on arrival, not on upload: an intake file
    // comes from a client with no session and nothing to make the call. A
    // failure here costs the plain search some files and nothing else.
    indexDocuments(clientId)
      .then((r) => {
        if (r.read > 0) void survey();
      })
      .catch((e) => console.warn("indexing unavailable", e));
  }, [clientId, survey]);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setBusy(true);
    setError(null);
    setHits(null);
    setAnswer(null);
    try {
      if (mode === "plain") {
        setHits(await searchDocuments(clientId, term.trim()));
      } else {
        setAnswer(await askDocuments(clientId, term.trim()));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const blind = shelf && shelf.pictures > 0;

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="font-bold">חיפוש במסמכים</h2>

      <div className="flex flex-wrap gap-1.5">
        <Tab active={mode === "plain"} onClick={() => setMode("plain")}>
          חיפוש רגיל
        </Tab>
        <Tab active={mode === "ai"} onClick={() => setMode("ai")}>
          חיפוש עם AI
        </Tab>
      </div>

      <form onSubmit={run} className="flex flex-col gap-2">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={mode === "plain" ? "מילה שמופיעה במסמך" : "שאלה על המסמכים של הלקוח"}
          className="w-full rounded-md border border-rule bg-surface px-3 py-2.5 text-base outline-none
                     focus:border-brand focus:ring-2 focus:ring-brand/20"
        />

        {mode === "plain" ? (
          <p className="text-xs text-muted">
            מחפש את המילה כפי שהקלדת, בשם הקובץ ובתוכן שלו.
            {blind && (
              // Said before the search, not after it comes back empty. A firm
              // that searches a photograph and finds nothing concludes the
              // words are not there.
              <>
                {" "}
                <span className="text-warning">
                  {shelf.pictures === 1
                    ? "מסמך אחד כאן הוא תמונה או סריקה, ואין בו טקסט לחפש בו — נסה חיפוש AI."
                    : `${shelf.pictures} מסמכים כאן הם תמונות או סריקות, ואין בהם טקסט לחפש בו — נסה חיפוש AI.`}
                </span>
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted">
            קורא את המסמכים, כולל תמונות וסריקות, ועונה בעברית עם שם המסמך שממנו לקוחה כל עובדה.
            {" "}
            <span className="font-semibold">כל שאלה עולה כסף בחשבון ה‑AI של המשרד.</span>
          </p>
        )}

        {mode === "ai" && !aiOn ? (
          <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
            חיפוש AI לא מופעל. בעל המשרד מפעיל אותו בהגדרות, עם מפתח משלו.
          </p>
        ) : (
          <Button type="submit" disabled={busy || !term.trim()}>
            {busy ? (mode === "ai" ? "קורא את המסמכים..." : "מחפש...") : "חפש"}
          </Button>
        )}
      </form>

      {error && <ErrorNote>{error}</ErrorNote>}

      {hits && <PlainResults hits={hits} />}
      {answer && <AiResult answer={answer} />}
    </Card>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
        active ? "bg-brand text-white" : "bg-ground text-ink-soft hover:bg-rule/60"
      }`}
    >
      {children}
    </button>
  );
}

function PlainResults({ hits }: { hits: DocumentHit[] }) {
  if (hits.length === 0) {
    return <p className="text-sm text-muted">לא נמצא במסמכים של הלקוח הזה.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-rule border-t border-rule">
      {hits.map((h) => (
        <li key={h.id} className="flex flex-col gap-1 py-2.5">
          <Open hit={h} />
          <span className="text-xs text-muted">
            {h.where_found === "filename" ? "נמצא בשם הקובץ" : "נמצא בתוך המסמך"}
          </span>
          {/* The words around the hit, so the firm can see why this file came
              back without opening it. */}
          {h.snippet && <p className="rounded-md bg-ground p-2 text-xs leading-relaxed">{h.snippet}</p>}
        </li>
      ))}
    </ul>
  );
}

function Open({ hit }: { hit: DocumentHit }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        onClick={async () => {
          try {
            const url = await getDownloadUrl({
              storage_path: hit.storage_path,
              filename: hit.filename,
              bucket: hit.bucket,
            } as DocumentRow);
            window.open(url, "_blank", "noopener");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
        className="self-start text-start text-sm font-semibold text-brand underline underline-offset-2"
      >
        {hit.filename}
      </button>
      {error && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}

function AiResult({ answer }: { answer: AiAnswer }) {
  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
      {/* Which files it actually saw. Without this the firm cannot tell an
          answer drawn from everything from one drawn from the four documents
          that fitted. */}
      <p className="text-xs text-muted">נקראו: {answer.read.join(" · ")}</p>
    </div>
  );
}
