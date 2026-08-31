import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * The end of a reset link.
 *
 * Reached only after Supabase has accepted the token in the URL, which is what
 * makes this safe to show without asking for the old password: the mailbox
 * already proved who this is.
 */
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = again.length > 0 && password !== again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      onDone();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.toLowerCase().includes("should be at least")
          ? "הסיסמה קצרה מדי — לפחות 6 תווים."
          : message.toLowerCase().includes("expired") || message.toLowerCase().includes("invalid")
            ? "הקישור פג. בקש קישור חדש ממסך ההתחברות."
            : message,
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="flex w-full max-w-sm flex-col gap-4">
        <div>
          <span className="text-lg font-bold tracking-tight text-brand">LEXA</span>
          <h1 className="mt-2 text-xl font-bold">בחר סיסמה חדשה</h1>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field
            label="סיסמה חדשה"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            hint="לפחות 6 תווים"
            autoFocus
            required
          />
          {/* Typed twice, because a password nobody can read back is the one
              thing here that cannot be corrected after the fact. */}
          <Field
            label="שוב, לוודא"
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            required
          />

          {mismatch && <ErrorNote>שתי הסיסמאות אינן זהות.</ErrorNote>}
          {error && <ErrorNote>{error}</ErrorNote>}

          <Button type="submit" disabled={busy || tooShort || mismatch || !password}>
            {busy ? "שומר..." : "שמור והיכנס"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
