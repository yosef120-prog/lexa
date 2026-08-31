import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  abandonEnrolment,
  beginEnrolment,
  listFactors,
  removeFactor,
  submitCode,
  type Enrolment,
  type Factor,
} from "@/lib/mfa";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * Setting up the second step.
 *
 * One password is the only thing between a stolen laptop and every client file
 * in the firm. This panel says that once, in the words a lawyer would use, and
 * then gets out of the way.
 */
export function MfaPanel() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolment | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setFactors(await listFactors());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFactors([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = (factors ?? []).filter((f) => f.status === "verified");

  async function start() {
    setError(null);
    try {
      setEnrolling(await beginEnrolment());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="mt-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">אימות דו־שלבי</h2>
          <p className="mt-1 text-sm text-ink-soft">
            קוד מהטלפון בנוסף לסיסמה. בלעדיו, סיסמה אחת היא כל מה שמפריד בין מחשב שנגנב לבין
            כל תיקי הלקוחות.
          </p>
        </div>
        {active.length > 0 && (
          <span className="shrink-0 rounded-full bg-brand/15 px-2.5 py-1 text-xs font-semibold text-brand">
            פעיל
          </span>
        )}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      {factors === null && <p className="text-sm text-muted">טוען...</p>}

      {enrolling ? (
        <EnrolmentSteps
          enrolment={enrolling}
          onDone={async () => {
            setEnrolling(null);
            await reload();
          }}
          onCancel={async () => {
            await abandonEnrolment(enrolling.factorId);
            setEnrolling(null);
          }}
        />
      ) : (
        factors !== null && (
          <>
            {active.map((f) => (
              <FactorRow key={f.id} factor={f} onChanged={reload} />
            ))}
            {active.length === 0 && (
              <Button onClick={start} className="self-start">
                הפעל אימות דו־שלבי
              </Button>
            )}
          </>
        )
      )}
    </Card>
  );
}

function EnrolmentSteps({
  enrolment,
  onDone,
  onCancel,
}: {
  enrolment: Enrolment;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitCode(enrolment.factorId, code);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={confirm} className="flex flex-col gap-3 border-t border-rule pt-3">
      <ol className="flex list-inside list-decimal flex-col gap-1 text-sm text-ink-soft">
        <li>התקן אפליקציית אימות — Google Authenticator, Authy או דומה.</li>
        <li>סרוק את הקוד.</li>
        <li>הקלד את שש הספרות שהיא מציגה.</li>
      </ol>

      {/* Supabase returns the QR as an SVG data URI, so it renders without any
          image library and without a request leaving the page. */}
      <img
        src={enrolment.qrSvg}
        alt="קוד לסריקה באפליקציית האימות"
        className="h-44 w-44 self-center rounded-md border border-rule bg-white p-1"
      />

      {/* Someone setting this up on the phone they are reading it on cannot
          photograph their own screen. Typing the secret is the way out. */}
      <button
        type="button"
        onClick={() => setShowSecret((s) => !s)}
        className="self-center text-xs text-brand underline underline-offset-2"
      >
        {showSecret ? "הסתר את הקוד הידני" : "מגדיר מהטלפון עצמו? הקלד קוד במקום לסרוק"}
      </button>
      {showSecret && (
        <code className="select-all break-all rounded-md bg-ground p-2 text-center text-xs" dir="ltr">
          {enrolment.secret}
        </code>
      )}

      <Field
        label="הקוד מהאפליקציה"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        dir="ltr"
        autoFocus
        required
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || code.replace(/\s/g, "").length < 6}>
          {busy ? "מאמת..." : "אשר והפעל"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </form>
  );
}

function FactorRow({ factor, onChanged }: { factor: Factor; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeFactor(factor.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">אפליקציית אימות</span>
          <span className="text-xs text-muted">
            הוגדרה ב־{new Date(factor.created_at).toLocaleDateString("he-IL")}
          </span>
        </div>
        {!confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="rounded px-2 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
          >
            כבה
          </button>
        )}
      </div>

      {confirming && (
        <div className="flex flex-col gap-2 rounded-md bg-danger/10 p-3">
          {/* The consequence, before the click rather than after it. */}
          <p className="text-sm text-ink-soft">
            אחרי הכיבוי תספיק סיסמה כדי להיכנס לכל תיקי המשרד.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-md bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "מכבה..." : "כבה בכל זאת"}
            </button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              השאר פעיל
            </Button>
          </div>
        </div>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
