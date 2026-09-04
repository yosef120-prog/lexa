import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  connectAi,
  disconnectAi,
  getAiConnection,
  type AiConnection,
} from "@/lib/doc-search";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * Turning on the AI search, with the firm's own key.
 *
 * Off by default and off forever unless somebody chooses otherwise. Everything
 * else in this product costs the firm nothing to run; this is the one feature
 * that bills per use, and a firm that does not want that keeps the plain
 * search and loses nothing it had.
 *
 * The key never comes back. The database refuses to return it to the browser
 * at all, which is why replacing it means typing it again rather than editing
 * what is shown.
 */
export function AiPanel() {
  const { membership } = useAuth();
  const [connection, setConnection] = useState<AiConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setConnection(await getAiConnection());
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
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold">חיפוש AI במסמכים</h3>
          <p className="mt-1 text-sm text-ink-soft">
            החיפוש הרגיל מוצא מילים בקבצים שיש בהם טקסט. חיפוש AI קורא גם תמונות וסריקות ועונה על
            שאלה — ועולה כסף בכל שאלה.
          </p>
        </div>
        {connection && !editing && (
          <span className="shrink-0 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-semibold text-brand">
            מופעל
          </span>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}
      {loading && <p className="text-sm text-muted">טוען...</p>}

      {!loading &&
        (editing || !connection ? (
          <ConnectForm
            orgId={membership?.org_id ?? ""}
            existing={connection}
            onSaved={async () => {
              setEditing(false);
              await reload();
            }}
            onCancel={connection ? () => setEditing(false) : undefined}
          />
        ) : (
          <Connected
            connection={connection}
            onEdit={() => setEditing(true)}
            onChanged={reload}
          />
        ))}
    </Card>
  );
}

function Connected({
  connection,
  onEdit,
  onChanged,
}: {
  connection: AiConnection;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">מודל:</dt>
          <dd className="font-semibold" dir="ltr">
            {connection.model}
          </dd>
        </div>
      </dl>

      {/* Whether it still works, not only whether it was once set up. */}
      {connection.last_error && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
          החיפוש האחרון נכשל: {connection.last_error}
        </p>
      )}
      {connection.last_ok_at && !connection.last_error && (
        <p className="text-xs text-muted">
          חיפוש אחרון הצליח ב־{new Date(connection.last_ok_at).toLocaleString("he-IL")}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
        <Button variant="ghost" onClick={onEdit}>
          החלף מפתח או מודל
        </Button>
        <button
          type="button"
          onClick={async () => {
            await disconnectAi(connection.id);
            await onChanged();
          }}
          className="rounded px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10"
        >
          כבה
        </button>
      </div>
    </div>
  );
}

function ConnectForm({
  orgId,
  existing,
  onSaved,
  onCancel,
}: {
  orgId: string;
  existing: AiConnection | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(existing?.model ?? "claude-sonnet-5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connectAi({ orgId, apiKey, model });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-rule pt-3">
      <ol className="flex list-inside list-decimal flex-col gap-1 text-sm text-ink-soft">
        <li>
          פתח חשבון ב־
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline underline-offset-2"
          >
            Anthropic Console
          </a>{" "}
          וטען אותו בסכום שאתה מוכן להוציא.
        </li>
        <li>צור מפתח API והעתק אותו לכאן.</li>
        <li>החיוב הוא ישירות מולם, לפי שימוש. אין כאן מנוי.</li>
      </ol>

      <Field
        label="מפתח API"
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        dir="ltr"
        required
        hint={
          existing
            ? "המפתח אינו נשמר לתצוגה — הקלד אותו מחדש כדי להחליף."
            : "נשמר בצד השרת בלבד. הוא לא ניתן לקריאה חזרה מהתוכנה."
        }
      />

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">מודל</span>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          dir="ltr"
          className="rounded-md border border-rule bg-surface px-3 py-2.5 text-base"
        >
          <option value="claude-sonnet-5">claude-sonnet-5</option>
          <option value="claude-opus-5">claude-opus-5</option>
          <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
        </select>
        <span className="text-xs text-muted">
          Haiku זול ומהיר, Sonnet מדויק יותר, Opus החזק ביותר ויקר יותר.
        </span>
      </label>

      {/* Said before the key is pasted, not after. */}
      <p className="rounded-md bg-warning/10 px-3 py-2 text-xs">
        חיפוש AI שולח את המסמכים של הלקוח לשרתי Anthropic כדי לענות על השאלה. ודא שזה מתיישב עם
        חובת הסודיות שלך כלפי הלקוח לפני שאתה מפעיל.
      </p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !apiKey.trim()}>
          {busy ? "שומר..." : existing ? "עדכן" : "הפעל"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            ביטול
          </Button>
        )}
      </div>
    </form>
  );
}
