import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { SearchBox } from "@/components/search-box";
import { ReminderBanner } from "@/components/reminder-banner";
import { ClientsScreen } from "@/screens/ClientsScreen";
import { ClientScreen } from "@/screens/ClientScreen";
import { MattersScreen } from "@/screens/MattersScreen";
import { MatterScreen } from "@/screens/MatterScreen";
import { DiaryScreen } from "@/screens/DiaryScreen";
import { TasksScreen } from "@/screens/TasksScreen";
import { TeamScreen } from "@/screens/TeamScreen";

const ROLE_LABEL: Record<string, string> = {
  owner: "בעלים",
  lawyer: "עורך דין",
  intern: "מתמחה",
  secretary: "מזכירה",
};

type Tab = "matters" | "tasks" | "diary" | "clients" | "team";

// The firm screen earns its place here. It was reachable only by tapping the
// firm's name in the header, which is fine on a desktop and invisible on a
// phone — and it holds the questionnaire builder, which is not a once-a-year
// screen but the one a firm returns to whenever a question needs rewording.
//
// Signing out gave up the slot. It is not a destination, it is the end of a
// session, and it belongs with the account rather than in the same row as the
// diary.
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "matters", label: "תיקים" },
  { id: "tasks", label: "משימות" },
  { id: "diary", label: "יומן" },
  { id: "clients", label: "לקוחות" },
  { id: "team", label: "המשרד" },
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
  const [openClient, setOpenClient] = useState<string | null>(null);

  if (!membership) return null;

  function go(next: Tab) {
    setTab(next);
    setOpenMatter(null);
    setOpenClient(null);
  }

  function openMatterFrom(id: string) {
    setTab("matters");
    setOpenClient(null);
    setOpenMatter(id);
  }

  function openClientFrom(id: string) {
    setTab("clients");
    setOpenMatter(null);
    setOpenClient(id);
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-rule bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 sm:px-6 sm:pt-4">
          <div className="flex items-baseline gap-2 sm:gap-3">
            <span className="text-lg font-bold tracking-tight">LEXA</span>
            <button
              onClick={() => go("team")}
              aria-current={tab === "team" ? "page" : undefined}
              className={`truncate text-sm underline-offset-4 hover:underline ${
                tab === "team" ? "font-semibold text-brand" : "text-muted"
              }`}
            >
              {membership.org_name}
            </button>
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

      {/* Outside main, and under the header on every tab: a hearing tomorrow is
          not a property of whichever screen happens to be open. */}
      <ReminderBanner onOpenMatter={openMatterFrom} onOpenClient={openClientFrom} />

      {/* Padded at the bottom so the fixed phone navigation never covers the
          last row of a list. */}
      <main className="flex-1 pb-20 sm:pb-0">
        {tab === "clients" && openClient ? (
          <ClientScreen
            clientId={openClient}
            onBack={() => setOpenClient(null)}
            onOpenMatter={openMatterFrom}
            onOpenFirm={() => go("team")}
          />
        ) : tab === "clients" ? (
          <ClientsScreen onOpenClient={openClientFrom} />
        ) : tab === "team" ? (
          <TeamScreen />
        ) : tab === "tasks" && !openMatter ? (
          <TasksScreen onOpenMatter={openMatterFrom} />
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
            className={`flex-1 border-t-2 py-3 text-xs font-semibold ${
              tab === t.id ? "border-brand text-brand" : "border-transparent text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
