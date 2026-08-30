import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorNote, Field } from "@/components/ui";

/**
 * Shown once, to a signed-in user who belongs to no firm yet.
 *
 * The firm and its owner are created by one database function rather than two
 * calls from here: a failure between them would leave a firm that RLS hides
 * from everyone, its creator included.
 */
export function CreateFirmScreen() {
  const { refreshMembership, signOut } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const { error } = await supabase.rpc("create_organization", { org_name: name });

    if (error) {
      setError(
        error.message.includes("ORG_NAME_REQUIRED")
          ? "צריך שם למשרד."
          : `לא הצלחנו ליצור את המשרד: ${error.message}`,
      );
      setBusy(false);
      return;
    }

    await refreshMembership();
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">כמעט שם</h1>
          <p className="mt-1 text-sm text-ink-soft">
            נותר להקים את המשרד. אתה תהיה הבעלים שלו.
          </p>
        </div>

        <Card>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field
              label="שם המשרד"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: דניאל שמעונוב, עורך דין"
              hint="אפשר לשנות בהמשך."
              autoFocus
              required
            />
            {error && <ErrorNote>{error}</ErrorNote>}
            <Button type="submit" disabled={busy}>
              {busy ? "מקים..." : "הקם משרד"}
            </Button>
          </form>
        </Card>

        <Button variant="ghost" onClick={signOut} className="self-center">
          התנתק
        </Button>
      </div>
    </div>
  );
}
