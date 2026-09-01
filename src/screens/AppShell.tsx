import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { SearchBox } from "@/components/search-box";
import { ReminderBanner } from "@/components/reminder-banner";
import { ClientsScreen } from "@/screens/ClientsScreen";
import { ClientScreen } from "@/screens/ClientScreen";
import { MattersScreen } from "@/screens/MattersScreen";
import { MatterScreen } from "@/screens/MatterScreen";
import { DiaryScreen } from "@/screens/DiaryScreen";
import { TasksScreen } from "@/screens/TasksScreen";
import { TeamScreen } from "@/screens/TeamScreen";
import { QuestionnairesScreen } from "@/screens/QuestionnairesScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { getFirm, logoUrl } from "@/lib/invitations";

const ROLE_LABEL: Record<string, string> = {
  owner: "בעלים",
  lawyer: "עורך דין",
  intern: "מתמחה",
  secretary: "מזכירה",
};

type Tab = "matters" | "tasks" | "diary" | "clients" | "intakes" | "team";

// The firm screen earns its place here. It was reachable only by tapping the
// firm's name in the header, which is fine on a desktop and invisible on a
// phone — and it holds the questionnaire builder, which is not a once-a-year
// screen but the one a firm returns to whenever a question needs rewording.
//
// Signing out gave up the slot. It is not a destination, it is the end of a
// session, and it belongs with the account rather than in the same row as the
// diary.
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "team", label: "המשרד" },
  { id: "matters", label: "תיקים" },
  { id: "clients", label: "לקוחות" },
  { id: "intakes", label: "שאלונים" },
  { id: "diary", label: "יומן" },
  { id: "tasks", label: "משימות" },
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
  const { membership, session } = useAuth();
  // The firm screen is where the day starts: it opens on what needs doing
  // rather than on a list of every matter ever opened.
  const [tab, setTab] = useState<Tab>("team");
  const [openMatter, setOpenMatter] = useState<string | null>(null);
  const [openClient, setOpenClient] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);

  // The firm's own mark, in the header. Fetched once; a failure here leaves the
  // name doing the job it already did.
  useEffect(() => {
    getFirm()
      .then((f) => setLogo(logoUrl(f?.logo_path ?? null)))
      .catch(() => setLogo(null));
  }, [settings]);

  if (!membership) return null;

  function go(next: Tab) {
    setSettings(false);
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
          <div className="flex items-center gap-2 sm:gap-3">
            {logo ? (
              <img
                src={logo}
                alt=""
                className="h-7 w-7 shrink-0 rounded object-contain"
              />
            ) : (
              <span className="text-lg font-bold tracking-tight">LEXA</span>
            )}
            <button
              onClick={() => {
                setSettings(false);
                go("team");
              }}
              className={`truncate text-sm underline-offset-4 hover:underline ${
                tab === "team" && !settings ? "font-semibold text-brand" : "text-muted"
              }`}
            >
              {membership.org_name}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* The identity line is the first thing to go on a narrow screen:
                it tells you who you are, which you already know. */}
            <span className="hidden text-sm text-ink-soft md:inline">
              {session?.user.email}
              <span className="mx-1.5 text-rule">·</span>
              {ROLE_LABEL[membership.role] ?? membership.role}
            </span>

            {/* Opposite the firm's name, on every screen and at every width.
                Settings are rare enough that they must be findable without
                being remembered. */}
            <button
              onClick={() => setSettings(true)}
              aria-label="הגדרות המשרד"
              aria-current={settings ? "page" : undefined}
              className={`rounded-md p-2 transition-colors hover:bg-rule/50 ${
                settings ? "text-brand" : "text-ink-soft"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
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
        {settings ? (
          <SettingsScreen onClose={() => setSettings(false)} />
        ) : tab === "clients" && openClient ? (
          <ClientScreen
            clientId={openClient}
            onBack={() => setOpenClient(null)}
            onOpenMatter={openMatterFrom}
            onOpenIntakes={() => go("intakes")}
          />
        ) : tab === "clients" ? (
          <ClientsScreen onOpenClient={openClientFrom} />
        ) : tab === "intakes" ? (
          <QuestionnairesScreen onOpenClient={openClientFrom} />
        ) : tab === "team" ? (
          <TeamScreen
            go={{
              matters: () => go("matters"),
              tasks: () => go("tasks"),
              diary: () => go("diary"),
              clients: () => go("clients"),
            }}
          />
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
            className={`flex-1 border-t-2 px-0.5 py-3 text-[11px] font-semibold ${
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
