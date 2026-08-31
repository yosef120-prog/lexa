import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { listFactors, submitCode, type Factor } from "@/lib/mfa";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * The gate between a correct password and the firm's files.
 *
 * It stands in front of the whole app rather than inside it, because a session
 * that has not answered the challenge is a session that must not see a client
 * name — not even briefly, not even behind a spinner.
 */
export function SecondStepScreen({ onPassed }: { onPassed: () => void }) {
  const { signOut } = useAuth();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listFactors()
      .then((all) => setFactor(all.find((f) => f.status === "verified") ?? null))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!factor) return;
    setBusy(true);
    setError(null);
    try {
      await submitCode(factor.id, code);
      onPassed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCode("");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <div>
          <span className="text-lg font-bold tracking-tight text-brand">LEXA</span>
          <h1 className="mt-2 text-xl font-bold">שלב שני</h1>
          <p className="mt-1 text-sm text-ink-soft">
            הקלד את הקוד מאפליקציית האימות שבטלפון שלך.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label="קוד"
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

          <Button type="submit" disabled={busy || !factor || code.replace(/\s/g, "").length < 6}>
            {busy ? "בודק..." : "המשך"}
          </Button>
        </form>

        {/* A way out that is not "give up and close the tab": someone on the
            wrong account, or without their phone, needs a door. */}
        <button
          onClick={signOut}
          className="self-start text-sm text-muted underline underline-offset-2 hover:text-ink"
        >
          התנתק
        </button>
      </Card>
    </div>
  );
}
