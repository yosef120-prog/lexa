import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { ClientsScreen } from "@/screens/ClientsScreen";
import { MattersScreen } from "@/screens/MattersScreen";
import { MatterScreen } from "@/screens/MatterScreen";
import { DiaryScreen } from "@/screens/DiaryScreen";

const ROLE_LABEL: Record<string, string> = {
  owner: "בעלים",
  lawyer: "עורך דין",
  intern: "מתמחה",
  secretary: "מזכירה",
};

type Tab = "matters" | "diary" | "clients";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "matters", label: "תיקים" },
  { id: "diary", label: "יומן" },
  { id: "clients", label: "לקוחות" },
];

/**
 * The signed-in shell.
 *
 * Navigation is local state rather than routes: nothing here is worth a link
 * yet. When sharing a matter with a colleague becomes a thing people do, that
 * is the moment for URLs.
 *
 * The same tabs appear along the top on a desktop and along the bottom on a
 * phone — where a thumb is, and where the brief asked for them.
 */
export function AppShell() {
  const { membership, session, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("matters");
  const [openMatter, setOpenMatter] = useState<string | null>(null);

  if (!membership) return null;

  function go(next: Tab) {
    setTab(next);
    setOpenMatter(null);
  }

  function openMatterFrom(id: string) {
    setTab("matters");
    setOpenMatter(id);
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-rule bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 sm:px-6 sm:pt-4">
          <div className="flex items-baseline gap-2 sm:gap-3">
            <span className="text-lg font-bold tracking-tight">LEXA</span>
            <span className="truncate text-sm text-muted">{membership.org_name}</span>
          </div>

          {/* The identity line is the first thing to go on a narrow screen: it
              tells you who you are, which you already know. */}
          <div className="hidden items-center gap-4 md:flex">
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

        <div className="px-4 pb-3 pt-2 sm:px-6">
          <SearchBox onOpenMatter={openMatterFrom} onOpenClients={() => go("clients")} />
        </div>

        <nav className="hidden gap-1 px-6 sm:flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => go(t.id)}
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

      {/* Padded at the bottom so the fixed phone navigation never covers the
          last row of a list. */}
      <main className="flex-1 pb-20 sm:pb-0">
        {tab === "clients" ? (
          <ClientsScreen />
        ) : tab === "diary" && !openMatter ? (
          <DiaryScreen onOpenMatter={openMatterFrom} />
        ) : openMatter ? (
          <MatterScreen matterId={openMatter} onBack={() => setOpenMatter(null)} />
        ) : (
          <MattersScreen onGoToClients={() => go("clients")} onOpenMatter={setOpenMatter} />
        )}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-rule bg-surface
                   pb-[env(safe-area-inset-bottom)] sm:hidden"
        aria-label="ניווט"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => go(t.id)}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex-1 border-t-2 py-3 text-sm font-semibold ${
              tab === t.id ? "border-brand text-brand" : "border-transparent text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={signOut}
          className="flex-1 border-t-2 border-transparent py-3 text-sm font-semibold text-muted"
        >
          יציאה
        </button>
      </nav>
    </div>
  );
}
