import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  acceptInvitation,
  describeInviteTrouble,
  peekInvitation,
  ROLE_EXPLAINS,
  ROLE_LABEL,
  type InvitePeek,
} from "@/lib/invitations";
import { AuthScreen } from "@/screens/AuthScreen";
import { Button, Card, ErrorNote } from "@/components/ui";

/**
 * The other end of an invitation link.
 *
 * The preview runs before anyone signs in, so a person can tell whether the
 * link is for them without first creating an account for a firm they may have
 * never heard of. It says the firm and the address and nothing else — enough
 * to recognise, useless to a stranger who found the link.
 */
export function AcceptInviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const { session, refreshMembership } = useAuth();
  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    peekInvitation(token)
      .then(setPeek)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [token]);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await acceptInvitation(token);
      await refreshMembership();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!peek && !error) {
    return (
      <div className="flex min-h-full items-center justify-center text-sm text-muted">טוען...</div>
    );
  }

  if (peek && !peek.valid) {
    return (
      <Frame>
        <h1 className="text-xl font-bold">ההזמנה לא בתוקף</h1>
        <p className="text-sm text-ink-soft">{describeInviteTrouble(peek.reason)}</p>
        <Button variant="ghost" onClick={onDone} className="px-0">
          המשך לכניסה הרגילה
        </Button>
      </Frame>
    );
  }

  // Signed out: the invitation stands, and the sign-in screen appears under it
  // with the address it is waiting for said out loud.
  if (!session) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="mx-auto w-full max-w-md px-4 pt-8">
          <Card className="flex flex-col gap-2">
            <h1 className="text-xl font-bold">הוזמנת ל{peek?.org_name}</h1>
            <p className="text-sm text-ink-soft">
              כדי להצטרף, התחבר עם <span className="font-semibold" dir="ltr">{peek?.email}</span>.
            </p>
          </Card>
        </div>
        <AuthScreen />
      </div>
    );
  }

  const wrongAccount =
    session.user.email?.toLowerCase() !== (peek?.email ?? "").toLowerCase();

  return (
    <Frame>
      <h1 className="text-xl font-bold">הוזמנת ל{peek?.org_name}</h1>

      {peek?.role && (
        <div className="rounded-md bg-ground px-3 py-2.5 text-sm">
          <p className="font-semibold">כ{ROLE_LABEL[peek.role]}</p>
          <p className="text-ink-soft">{ROLE_EXPLAINS[peek.role]}</p>
        </div>
      )}

      {wrongAccount ? (
        <p className="text-sm text-danger">
          אתה מחובר כ<span dir="ltr">{session.user.email}</span>, וההזמנה נשלחה ל
          <span dir="ltr">{peek?.email}</span>. התנתק והתחבר עם הכתובת הנכונה.
        </p>
      ) : (
        <Button onClick={join} disabled={busy}>
          {busy ? "מצטרף..." : "הצטרף למשרד"}
        </Button>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <Button variant="ghost" onClick={onDone} className="px-0">
        לא עכשיו
      </Button>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="flex w-full max-w-md flex-col gap-4">{children}</Card>
    </div>
  );
}
