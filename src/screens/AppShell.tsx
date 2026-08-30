import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { ClientsScreen } from "@/screens/ClientsScreen";
import { MattersScreen } from "@/screens/MattersScreen";
import { MatterScreen } from "@/screens/MatterScreen";

const ROLE_LABEL: Record<string, string> = {
  owner: "בעלים",
  lawyer: "עורך דין",
  intern: "מתמחה",
  secretary: "מזכירה",
};

type Tab = "matters" | "clients";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "matters", label: "תיקים" },
  { id: "clients", label: "לקוחות" },
];

/**
 * The signed-in shell. Navigation is local state rather than routes: there is
 * nothing yet worth linking to. Stage 4 brings the matter screen, and with it a
 * real reason for URLs.
 */
export function AppShell() {
  const { membership, session, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("matters");
  const [openMatter, setOpenMatter] = useState<string | null>(null);

  if (!membership) return null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-rule bg-surface">
        <div className="flex items-center justify-between px-6 pt-4">
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
        </div>

        <nav className="flex gap-1 px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setOpenMatter(null); }}
              aria-current={tab === t.id ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
                tab === t.id
                  ? "border-brand text-brand"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        {tab === "clients" ? (
          <ClientsScreen />
        ) : openMatter ? (
          <MatterScreen matterId={openMatter} onBack={() => setOpenMatter(null)} />
        ) : (
          <MattersScreen
            onGoToClients={() => setTab("clients")}
            onOpenMatter={setOpenMatter}
          />
        )}
      </main>
    </div>
  );
}
