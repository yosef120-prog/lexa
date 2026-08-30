import { useAuth } from "@/lib/auth";
import { Button, Card } from "@/components/ui";

const ROLE_LABEL: Record<string, string> = {
  owner: "בעלים",
  lawyer: "עורך דין",
  intern: "מתמחה",
  secretary: "מזכירה",
};

/**
 * The signed-in shell. Deliberately almost empty: stage 1 ends when a person can
 * register and own a firm, and the sidebar fills in as stages 2 to 4 land.
 */
export function AppShell() {
  const { membership, session, signOut } = useAuth();
  if (!membership) return null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-rule bg-surface px-6 py-4">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-bold tracking-tight">LEXA</span>
          <span className="text-sm text-muted">{membership.org_name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-soft">
            {session?.user.email}
            <span className="mx-1.5 text-rule">·</span>
            {ROLE_LABEL[membership.role] ?? membership.role}
          </span>
          <Button variant="ghost" onClick={signOut}>
            התנתק
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <Card className="flex flex-col gap-3">
          <h1 className="text-xl font-bold">המשרד הוקם</h1>
          <p className="text-sm text-ink-soft">
            שלב 1 גמור: יש חשבון, יש משרד, ואתה רשום כבעלים שלו. כל פעולה שנעשית
            מכאן נרשמת ביומן ביקורת שאי אפשר לערוך.
          </p>
          <p className="text-sm text-ink-soft">
            הבא בתור — שלב 2: כרטיס לקוח ובדיקת ניגוד עניינים.
          </p>
        </Card>
      </main>
    </div>
  );
}
