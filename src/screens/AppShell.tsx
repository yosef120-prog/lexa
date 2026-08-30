import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { ClientsScreen } from "@/screens/ClientsScreen";

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

      <main className="flex-1">
        <ClientsScreen />
      </main>
    </div>
  );
}
