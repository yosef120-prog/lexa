import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import {
  connect,
  disconnect,
  getConnection,
  sendWhatsApp,
  type Connection,
} from "@/lib/whatsapp-gateway";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * Connecting the firm's own WhatsApp.
 *
 * Two ways of sending exist and both are wanted. Without a connection the
 * button opens WhatsApp on the phone with the message written, which needs
 * nothing and costs nothing. With one, the message goes out from the firm's
 * number without anybody switching apps — which is what makes it possible to
 * send to twenty clients on a Sunday morning.
 */
export function WhatsAppPanel() {
  const { membership, session } = useAuth();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setConnection(await getConnection());
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
          <h3 className="font-bold">שליחה מוואטסאפ של המשרד</h3>
          <p className="mt-1 text-sm text-ink-soft">
            בלי חיבור, כפתור הוואטסאפ פותח את האפליקציה עם ההודעה מוכנה. עם חיבור, ההודעה יוצאת
            מהמספר של המשרד בלי לעבור אפליקציה.
          </p>
        </div>
        {connection && !editing && (
          <span className="shrink-0 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-semibold text-brand">
            מחובר
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
            myPhone={(session?.user.phone as string) ?? ""}
            orgId={membership?.org_id ?? ""}
            onEdit={() => setEditing(true)}
            onChanged={reload}
          />
        ))}
    </Card>
  );
}

function Connected({
  connection,
  orgId,
  onEdit,
  onChanged,
}: {
  connection: Connection;
  myPhone: string;
  orgId: string;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function test(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await sendWhatsApp({
        orgId,
        to: testTo,
        message: "הודעת בדיקה מ‑LEXA. אם קיבלת אותה, החיבור עובד.",
      });
      setResult("נשלח. בדוק את הטלפון שהזנת.");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">מספר:</dt>
          <dd className="font-semibold" dir="ltr">
            {connection.phone || "לא הוזן"}
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt className="text-muted">מזהה מופע:</dt>
          <dd className="font-semibold" dir="ltr">
            {connection.instance_id}
          </dd>
        </div>
      </dl>

      {/* Whether it still works, not only whether it was once set up. A
          connection that stopped answering looks identical to one that never
          did until something tries to use it. */}
      {connection.last_error && (
        <p className="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
          השליחה האחרונה נכשלה: {connection.last_error}
        </p>
      )}
      {connection.last_ok_at && !connection.last_error && (
        <p className="text-xs text-muted">
          שליחה אחרונה הצליחה ב־{new Date(connection.last_ok_at).toLocaleString("he-IL")}
        </p>
      )}

      <form onSubmit={test} className="flex flex-col gap-2 border-t border-rule pt-3">
        <Field
          label="שלח הודעת בדיקה"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="052-1234567"
          dir="ltr"
          hint="שלח לעצמך, כדי לראות שהחיבור באמת עובד."
        />
        {result && <p className="text-sm font-semibold text-brand">{result}</p>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !testTo.trim()}>
            {busy ? "שולח..." : "שלח בדיקה"}
          </Button>
          <Button type="button" variant="ghost" onClick={onEdit}>
            החלף פרטים
          </Button>
          <button
            type="button"
            onClick={async () => {
              await disconnect(connection.id);
              await onChanged();
            }}
            className="rounded px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger/10"
          >
            נתק
          </button>
        </div>
      </form>
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
  existing: Connection | null;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [instanceId, setInstanceId] = useState(existing?.instance_id ?? "");
  const [apiToken, setApiToken] = useState("");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect({ orgId, instanceId, apiToken, phone });
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
            href="https://green-api.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline underline-offset-2"
          >
            Green API
          </a>{" "}
          וצור מופע.
        </li>
        <li>סרוק את קוד ה‑QR מהוואטסאפ של המשרד, כמו חיבור לוואטסאפ ווב.</li>
        <li>העתק לכאן את מזהה המופע ואת הטוקן.</li>
      </ol>

      <Field
        label="מזהה מופע (idInstance)"
        value={instanceId}
        onChange={(e) => setInstanceId(e.target.value)}
        dir="ltr"
        required
      />
      <Field
        label="טוקן (apiTokenInstance)"
        type="password"
        value={apiToken}
        onChange={(e) => setApiToken(e.target.value)}
        dir="ltr"
        required
        hint={
          existing
            ? "הטוקן אינו נשמר לתצוגה — הקלד אותו מחדש כדי להחליף."
            : "נשמר בצד השרת בלבד. הוא לא ניתן לקריאה חזרה מהתוכנה."
        }
      />
      <Field
        label="מספר הוואטסאפ של המשרד"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        dir="ltr"
        placeholder="052-1234567"
        hint="לתצוגה בלבד, כדי לדעת איזה חשבון מחובר."
      />

      {/* Said before the token is pasted, not after. */}
      <p className="rounded-md bg-warning/10 px-3 py-2 text-xs">
        הטוקן הזה הוא שליטה מלאה בוואטסאפ שתחבר — מי שמחזיק בו יכול לקרוא ולכתוב בשם המשרד.
        חבר חשבון ייעודי למשרד ולא מספר פרטי.
      </p>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !instanceId.trim() || !apiToken.trim()}>
          {busy ? "שומר..." : existing ? "עדכן חיבור" : "חבר"}
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
